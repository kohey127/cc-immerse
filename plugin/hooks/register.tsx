import type { EngineInterface, Register } from 'claude-code'

import type { Draft, Tr } from '../types'
import { fixKey, hash, isFixable, isProse, isTable, languageOf, linesOf, piecesOf, split, widthOf, wrap } from './text'
import type { Chunk, Line, Piece } from './text'

const OPEN = { plugin: 'cc-immerse', key: 'open' } as const
const TR = { plugin: 'cc-immerse', key: 'tr' } as const
const SENT = { plugin: 'cc-immerse', key: 'sent' } as const
const DRAFT = { plugin: 'cc-immerse', key: 'draft' } as const

const SYSTEM =
  'Translate the text into natural Japanese. Keep code, file paths, commands, URLs and identifiers exactly as written. ' +
  'Answer with the translation only, as plain text with no Markdown marks.'

const SYSTEM_TABLE =
  'Translate this Markdown into natural Japanese: the cells of its table, and any heading or line around it. Keep the table exactly as it is built: the same rows, ' +
  'the same columns, the same pipes and the same separator row. Keep code, file paths, commands, URLs and identifiers as written. ' +
  'Answer with the translated Markdown only.'

const SYSTEM_FIX =
  'You coach a Japanese speaker who is learning English (CEFR B1). The text is a message they typed to a coding assistant. ' +
  'Do not answer or act on the message. Write two parts, separated by a line holding only ---.\n' +
  'Part 1: the message rewritten in natural, correct English, keeping its meaning, its code, paths and commands. ' +
  'If it is already natural and correct, write exactly: OK\n' +
  'Part 2: in Japanese, up to three short lines, each starting with "・", saying what was changed and why ' +
  '(grammar, word choice, nuance). If part 1 is OK, leave part 2 empty.\n' +
  'Plain text only, no Markdown marks.'

const SYSTEM_TO_ENGLISH =
  'The text is a message a Japanese speaker typed to a coding assistant, in Japanese or in Japanese mixed with English. ' +
  'Do not answer or act on it. Rewrite the whole message in natural English, as a developer would type it. ' +
  'Keep code, file paths, commands, URLs, identifiers and @mentions exactly as written, and keep its line breaks. ' +
  'Answer with the English message only.'

/** The English of a native-language message, or '' when the call gave none. */
async function toEnglish($: EngineInterface, text: string): Promise<string> {
  try {
    const r = await $.model.complete({ model: 'haiku', system: SYSTEM_TO_ENGLISH, prompt: text, maxTokens: 2000, effort: 'low', timeoutMs: 20000 })
    return r.isAnswered ? r.text.trim() : ''
  } catch {
    return ''
  }
}

// The live preview. Module values: a reload starts them over, and the next keystroke fills them again.
const PREVIEW_DELAY_MS = 600
let latestDraft = ''
let draftChangedAt = 0
let isPreviewDue = false
let isPreviewRunning = false

/** Notes the draft as it stands; the worker previews it once it has rested. */
async function noteDraft($: EngineInterface, draft: string): Promise<void> {
  latestDraft = draft
  draftChangedAt = await $.clock.now()
  isPreviewDue = true
}

/** The worker's tick: previews a native-language draft that has rested; clears the preview of any other. */
async function previewTick($: EngineInterface): Promise<void> {
  if (!isPreviewDue || isPreviewRunning) return
  if ((await $.clock.now()) - draftChangedAt < PREVIEW_DELAY_MS) return
  isPreviewDue = false
  const draft = latestDraft
  const kept = (await $.state.get(DRAFT)).value ?? null
  const language = languageOf(draft)
  if (language === 'other') {
    if (kept) await $.state.set(DRAFT, null)
    return
  }
  if (kept?.src === draft && kept.status === 'done') return
  const label = language === 'native' ? 'EN' : 'FIX'
  isPreviewRunning = true
  try {
    await $.state.set(DRAFT, { src: draft, english: kept?.label === label ? kept.english : '', status: 'pending', label })
    let english = ''
    if (language === 'native') english = await toEnglish($, draft)
    else {
      // The same call the sent message's `↳` line reads: made once, here, and kept.
      await translate($, draft, fixKey(draft), SYSTEM_FIX)
      const fix = (await $.state.get({ ...TR, id: fixKey(draft) })).value
      const corrected = fix?.status === 'done' ? (fix.text.split(/^\s*---\s*$/m)[0] ?? '').trim() : ''
      english = corrected === 'OK' ? '✓ Your English is perfect!' : corrected
    }
    if (latestDraft !== draft) return // typed on meanwhile: the next tick previews the newer draft
    const next: Draft = english ? { src: draft, english, status: 'done', label } : { src: draft, english: '', status: 'failed', label }
    await $.state.set(DRAFT, next)
  } finally {
    isPreviewRunning = false
  }
}

/** One model call whose answer is kept under `id`: a translation of `src`, or with `system`, what that asks of it. */
async function translate($: EngineInterface, src: string, id: string = hash(src), system?: string): Promise<void> {
  const ref = { ...TR, id }
  const kept = (await $.state.get(ref)).value
  const now = await $.clock.now()
  // A call that a reload cut short leaves `pending` behind for good: past a minute, try again.
  const isStale = kept?.status === 'pending' && now - (kept.at ?? 0) > 60_000
  if (kept && kept.status !== 'error' && !isStale) return
  await $.state.set(ref, { status: 'pending', text: '', at: now })
  let next: Tr
  try {
    const r = await $.model.complete({ model: 'haiku', system: system ?? (isTable(src) ? SYSTEM_TABLE : SYSTEM), prompt: src, maxTokens: 2000, effort: 'low', timeoutMs: 45000 })
    next = r.isAnswered ? { status: 'done', text: r.text.trim() } : { status: 'error', text: r.reason }
  } catch (err) {
    next = { status: 'error', text: (err instanceof Error ? err.message : String(err)).slice(0, 80) }
  }
  await $.state.set(ref, next)
}

/** One thing a press opens: a whole chunk (a paragraph, a list, a heading with its paragraph, a table). */
type Unit = { k: number; text: string }

/** What a chunk offers to open: itself, when it is English. `inText`: its own text is the button. */
function offers(c: Chunk): (Unit & { inText: boolean })[] {
  if (!c.isProse) return []
  const hasCode = /^\s*(```|~~~)/m.test(c.src)
  return [{ k: 0, text: c.src, inText: !c.isTable && !hasCode }]
}

async function setOpen($: EngineInterface, rowId: string, src: string, isOpen: boolean): Promise<void> {
  await $.state.set({ ...OPEN, id: rowId }, isOpen)
  // Not awaited: a press has ten seconds, and a translation may take longer. The row redraws when it lands.
  if (isOpen) $.clock.after(0, () => void translate($, src))
}

async function toggle($: EngineInterface, rowId: string, src: string): Promise<void> {
  const isOpen = (await $.state.get({ ...OPEN, id: rowId })).value ?? false
  await setOpen($, rowId, src, !isOpen)
}

/** Opens (and translates) or closes everything one message offers. Returns how many. */
async function setAll($: EngineInterface, requestId: string, chunks: readonly Chunk[], isOpen: boolean): Promise<number> {
  const work: Promise<void>[] = []
  chunks.forEach((c, i) => {
    for (const u of offers(c)) work.push(setOpen($, `${requestId}:${i}:${u.k}`, u.text, isOpen))
  })
  await Promise.all(work)
  return work.length
}

export const register: Register = on => {
  // Which messages are the latest reply, for /immerse. Module values: a reload starts them over.
  // A reload, a resize or a scroll draws old messages again, so "drawn lately" is not "latest":
  // a message belongs to the latest reply when it was first drawn after the latest turn began.
  const drawn = new Map<string, Chunk[]>() // every message drawn since the load
  let before = new Set<string>() // those already drawn when the latest turn began
  let hasTurn = false
  let recent = new Map<string, Chunk[]>()

  on('session.start', async ($, e, next) => {
    $.clock.every(250, () => void previewTick($))
    await $.command.register({ name: 'immerse', description: 'Open the Japanese of the latest reply (/immerse off closes it, /immerse where lists the screens)' })
    return next(e)
  })

  on('session.attach', ($, e, next) => {
    $.ui.toast(`immerse: a ${e.surface} screen joined`)
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    before = new Set(drawn.keys())
    recent = new Map()
    hasTurn = true
    return next(e)
  })

  on('command.run', { command: 'immerse' }, async ($, e) => {
    if (e.args.trim() === 'where') {
      const surfaces = await $.session.surfaces()
      return { text: `This session draws on: ${surfaces.length ? surfaces.join(', ') : '(nothing)'}`, isTextDisplayOnly: true }
    }
    // `off` closes everything on screen (no model call); opening covers the latest reply alone.
    const isOff = e.args.trim() === 'off'
    const targets = isOff ? drawn : recent
    const counts = await Promise.all([...targets].map(([requestId, chunks]) => setAll($, requestId, chunks, !isOff)))
    const n = counts.reduce((a, b) => a + b, 0)
    if (isOff) return { text: 'Closed every translation.', isTextDisplayOnly: true }
    if (n === 0) return { text: 'No reply to open yet since the plugin loaded. Use ALL JA OPEN at the end of a message.', isTextDisplayOnly: true }
    return { text: `Opened ${n} block(s) of the latest reply.`, isTextDisplayOnly: true }
  })

  // The first question for a typed message: which language is it in?
  //   native (or mixed)  -> it is sent in English; the transcript keeps what was typed, the English under it
  //   learning           -> it is sent as typed and corrected beside the conversation: the model never sees that
  on('prompt.submit', async ($, e, next) => {
    const text = e.text
    if (e.command || e.isMeta) return next(e)
    const language = languageOf(text)
    if (language === 'learning') {
      $.clock.after(0, () => void translate($, text, fixKey(text), SYSTEM_FIX))
      return next(e)
    }
    if (language !== 'native') return next(e)

    // The preview already holds this draft's English: Enter sends it with no wait.
    const draft = (await $.state.get(DRAFT)).value
    const english = draft?.status === 'done' && draft.label === 'EN' && draft.src === text ? draft.english : await toEnglish($, text)
    if (english === '') {
      $.ui.toast('immerse: could not make the English version; sent as typed')
      return next(e)
    }
    await $.state.set({ ...SENT, id: hash(english) }, text)
    return next({ ...e, text: english })
  })

  // While the person types, above the prompt box: a native-language draft's English (what Enter will send),
  // or a learned-language draft as it would read corrected.
  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    await noteDraft($, box.text)
    return box
  })

  on('prompt.change', async ($, e, next) => {
    const r = await next(e)
    await noteDraft($, e.text)
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const draft = (await $.state.get(DRAFT)).value
    if (e.props.hasSurvey || !draft || (draft.english === '' && draft.status !== 'pending')) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="row">
        <Text dimColor>{draft.label} ▸ </Text>
        <Box flexShrink={1}>
          <Text dimColor={draft.status !== 'done'}>{draft.english === '' ? '…' : draft.english}</Text>
        </Box>
      </Box>
    )
  })

  // Under a typed message, with no press, all dim:
  //   native   -> the row shows what was typed, then `↳` the English that was sent
  //   learning -> `↳` the corrected sentence, then the notes
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const text = e.props.text
    if (e.props.origin.kind !== 'composer') return next(e)
    const typed = (await $.state.get({ ...SENT, id: hash(text.trim()) })).value
    const { Box, Text } = $.ui.resolve(e)

    if (typed) {
      const row = await next({ ...e, props: { ...e.props, text: typed } })
      return (
        <Box flexDirection="column">
          {row}
          <Box flexDirection="row" paddingLeft={2}>
            <Text dimColor>↳ </Text>
            <Box flexShrink={1}>
              <Text dimColor>{text.trim()}</Text>
            </Box>
          </Box>
        </Box>
      )
    }

    const row = await next(e)
    if (!isFixable(text)) return row
    const fix = (await $.state.get({ ...TR, id: fixKey(text) })).value
    if (!fix) return row

    let head = '…'
    let points: string[] = []
    if (fix.status === 'error') head = `(添削できませんでした: ${fix.text})`
    else if (fix.status === 'done') {
      const [corrected = '', notes = ''] = fix.text.split(/^\s*---\s*$/m)
      head = corrected.trim() === 'OK' ? '✓ Your English is perfect!' : corrected.trim()
      points = notes.split('\n').map(l => l.trim()).filter(l => l !== '')
    }

    return (
      <Box flexDirection="column">
        {row}
        <Box flexDirection="row" paddingLeft={2}>
          <Text dimColor>↳ </Text>
          <Box flexDirection="column" flexShrink={1}>
            <Text dimColor>{head}</Text>
            {points.map(point => (
              <Text dimColor italic>
                {point}
              </Text>
            ))}
          </Box>
        </Box>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.props.isSummary) return next(e)
    const chunks = split(e.props.text)
    if (!chunks.some(c => c.isProse)) return next(e)
    drawn.set(e.requestId, chunks)
    if (hasTurn && !before.has(e.requestId)) recent.set(e.requestId, chunks)
    const { Box, Button, Markdown, Text } = $.ui.resolve(e)

    let total = 0
    let openTotal = 0
    const rows = await Promise.all(
      chunks.map(async (c, i) => {
        const units = offers(c)
        const opens = await Promise.all(units.map(async u => (await $.state.get({ ...OPEN, id: `${e.requestId}:${i}:${u.k}` })).value ?? false))
        const bodies = await Promise.all(
          units.map(async (u, n) => {
            if (!opens[n]) return null
            const tr = (await $.state.get({ ...TR, id: hash(u.text) })).value
            return !tr || tr.status === 'pending' ? '訳しています…' : tr.status === 'error' ? `訳せませんでした（${tr.text}）` : tr.text
          }),
        )
        total += units.length
        openTotal += opens.filter(Boolean).length

        const u = units[0]
        const rowId = `${e.requestId}:${i}:0`
        const tr = u && opens[0] ? (await $.state.get({ ...TR, id: hash(u.text) })).value : null
        const translation = !u || !opens[0] ? null : c.isTable && tr?.status === 'done' ? (
          <Markdown text={tr.text} dimColor />
        ) : (
          <Text dimColor italic>
            {bodies[0] ?? ''}
          </Text>
        )

        // The mark shows only while the pointer is on the chunk, beside the chunk's last line, so nothing moves.
        const bullet = i === 0 && e.props.isFirstOfReply ? '●' : ' '
        const mark = u ? <Button key={`g${i}`} plain label={opens[0] ? '▾' : '▸'} onPress={() => toggle($, rowId, u.text)} /> : null

        let block
        if (!u) {
          block = (
            <Box flexDirection="row">
              <Box width={2} flexShrink={0}>
                <Text>{bullet}</Text>
              </Box>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Markdown text={c.src} />
              </Box>
            </Box>
          )
        } else if (u.inText) {
          // Prose: plain text, never highlighted, drawn row by row, each row with its own gutter cell.
          // The first cell holds the reply's bullet; the last cell is where the mark shows, over it.
          const columns = e.viewport?.columns ?? 100
          const laid: { lead: string; pieces: Piece[]; isHeading: boolean }[] = []
          for (const line of linesOf(c.src)) {
            if (line.isGap) {
              laid.push({ lead: '', pieces: [], isHeading: false })
              continue
            }
            const leadWidth = widthOf(line.lead)
            // 2 for the gutter, 2 spare: a row that reaches the edge is cut.
            wrap(piecesOf(line.text), Math.max(20, columns - 4 - leadWidth)).forEach((pieces, r) =>
              laid.push({ lead: r === 0 ? line.lead : ' '.repeat(leadWidth), pieces, isHeading: line.isHeading }),
            )
          }
          const lastRow = laid.length - 1
          block = (
            <Box flexDirection="column">
              {laid.map((row, k) => (
                <Box flexDirection="row">
                  <Box width={2} flexShrink={0}>
                    <Text>{k === 0 ? bullet : ' '}</Text>
                    {k === lastRow && (
                      <Box position="absolute" top={0} left={0} display="none" hover={{ display: 'flex' }}>
                        {mark}
                      </Box>
                    )}
                  </Box>
                  {row.lead !== '' && <Text>{row.lead}</Text>}
                  <Text>
                    {row.pieces.length === 0
                      ? ' '
                      : row.pieces.map(piece =>
                          piece.kind === 'plain' && !row.isHeading ? (
                            piece.text
                          ) : (
                            <Text
                              bold={row.isHeading || piece.kind === 'bold'}
                              italic={piece.kind === 'italic'}
                              underline={piece.kind === 'link'}
                              color={piece.kind === 'code' ? 'permission' : undefined}
                            >
                              {piece.text}
                            </Text>
                          ),
                        )}
                  </Text>
                </Box>
              ))}
            </Box>
          )
        } else {
          // A table, or prose that ends in code: drawn by the engine, so its height is not known here. The gutter
          // stretches to it: the bullet at its top, the mark at its bottom. (Such a chunk has two lines or more.)
          block = (
            <Box flexDirection="row">
              <Box width={2} flexShrink={0} flexDirection="column" justifyContent="space-between">
                <Text>{bullet}</Text>
                <Box display="none" hover={{ display: 'flex' }}>
                  {mark}
                </Box>
              </Box>
              <Box flexDirection="column" flexGrow={1} flexShrink={1}>
                <Markdown text={c.src} />
              </Box>
            </Box>
          )
        }

        return (
          // The keyed Box is the hover area: the chunk with its gutter, its translation, and the cells to their right.
          <Box key={u ? `h${i}` : undefined} flexDirection="column" marginTop={i === 0 ? 0 : 1}>
            {block}
            {translation && <Box paddingLeft={2}>{translation}</Box>}
          </Box>
        )
      }),
    )

    return (
      <Box flexDirection="column">
        {rows}
        {total >= 2 && (
          <Box flexDirection="row" gap={2} paddingLeft={2} marginTop={1}>
            {openTotal < total && <Button key="all-open" plain dimColor label="▸▸ ALL JA OPEN" onPress={() => setAll($, e.requestId, chunks, true)} />}
            {openTotal > 0 && <Button key="all-close" plain dimColor label="▾▾ ALL JA CLOSE" onPress={() => setAll($, e.requestId, chunks, false)} />}
          </Box>
        )}
      </Box>
    )
  })
}
