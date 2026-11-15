import type { EngineInterface, Register } from 'claude-code'

import type { Draft, Tr } from '../types'
import { fixSystem, judgeSystem, pairOf, readFix, readJudgement, tableSystem, toTargetSystem, translateSystem } from './lang'
import type { Pair } from './lang'
import { fixKey, hash, isTable, languageOf, linesOf, piecesOf, split, widthOf, wrap } from './text'
import type { Chunk, Piece } from './text'

const OPEN = { plugin: 'cc-immerse', key: 'open' } as const
const TR = { plugin: 'cc-immerse', key: 'tr' } as const
const SENT = { plugin: 'cc-immerse', key: 'sent' } as const
const DRAFT = { plugin: 'cc-immerse', key: 'draft' } as const

// The pair in force and whether the plugin acts at all. Module values, set as the module registers and as
// the session starts: a session with nobody at its prompt (`claude -p`, a scheduled run) is left alone,
// so that a script's own prompt is never rewritten.
let pair: Pair = pairOf('', '')
let isActive = true

/** The key a translation of `src` is kept under: by native language, so a changed setting translates afresh. */
function trId(src: string): string {
  return hash(`${pair.native.code}:${src}`)
}

/** The key a correction of `text` is kept under: apart from its translation, and by pair. */
function fixId(text: string): string {
  return fixKey(`${pair.native.code}>${pair.target.code}:${text}`)
}

/** What a correction shows on its first line; null when there is nothing to show. */
function fixHead(answer: string): string | null {
  const fix = readFix(answer)
  if (fix.kind === 'skip') return null
  return fix.kind === 'ok' ? `✓ Your ${pair.target.name} is perfect!` : fix.corrected
}

/** One short call to the small model: its answer, or '' when it gave none. */
async function ask($: EngineInterface, system: string, prompt: string): Promise<string> {
  try {
    const r = await $.model.complete({ model: 'haiku', system, prompt, maxTokens: 2000, effort: 'low', timeoutMs: 20000 })
    return r.isAnswered ? r.text.trim() : ''
  } catch {
    return ''
  }
}

/**
 * A typed message as it is to be sent, where the plugin has work to do on it before it goes.
 *
 * `target`: the message in the learned language, sent in its place. `asTyped`: it is sent as typed (its
 * correction, when it has one, is kept for the row under it). `failed`: a native-language message the
 * model gave no version of.
 */
async function prepare($: EngineInterface, text: string, language: 'native' | 'unsure'): Promise<{ target: string } | 'asTyped' | 'failed'> {
  if (language === 'native') {
    const target = await ask($, toTargetSystem(pair), text)
    return target === '' ? 'failed' : { target }
  }
  // The pair shares its letters: one call says which language it is and does that language's work.
  const judged = readJudgement(await ask($, judgeSystem(pair), text))
  if (judged.kind === 'native') return { target: judged.target }
  if (judged.kind === 'target') await $.state.set({ ...TR, id: fixId(text) }, { status: 'done', text: judged.fix })
  return 'asTyped'
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

/** The worker's tick: previews a draft that has rested, in whichever of the pair's languages it is; clears the preview of any other. */
async function previewTick($: EngineInterface): Promise<void> {
  if (!isPreviewDue || isPreviewRunning) return
  if ((await $.clock.now()) - draftChangedAt < PREVIEW_DELAY_MS) return
  isPreviewDue = false
  const draft = latestDraft
  const kept = (await $.state.get(DRAFT)).value ?? null
  const language = isActive ? languageOf(draft, pair) : 'other'
  if (language === 'other') {
    if (kept) await $.state.set(DRAFT, null)
    return
  }
  if (kept?.src === draft && kept.status === 'done') return
  isPreviewRunning = true
  try {
    // `sends`: Enter sends the line's text in place of the draft. A correction is shown, never sent.
    let sends = language === 'native'
    let label = sends ? pair.target.tag : language === 'learning' ? 'FIX' : ''
    await $.state.set(DRAFT, { src: draft, english: kept?.label === label ? kept.english : '', status: 'pending', label, sends })
    let shown: string | null = null
    if (language === 'learning') {
      // The same call the sent message's `↳` line reads: made once, here, and kept.
      await translate($, draft, fixId(draft), fixSystem(pair))
      const fix = (await $.state.get({ ...TR, id: fixId(draft) })).value
      shown = fix?.status === 'done' ? fixHead(fix.text) : null
    } else {
      const prepared = await prepare($, draft, language)
      if (typeof prepared === 'object') {
        sends = true
        label = pair.target.tag
        shown = prepared.target
      } else if (prepared === 'asTyped') {
        label = 'FIX'
        const fix = (await $.state.get({ ...TR, id: fixId(draft) })).value
        shown = fix?.status === 'done' ? fixHead(fix.text) : null
      }
    }
    if (latestDraft !== draft) return // typed on meanwhile: the next tick previews the newer draft
    await $.state.set(DRAFT, shown ? { src: draft, english: shown, status: 'done', label, sends } : null)
  } finally {
    isPreviewRunning = false
  }
}

/** One model call whose answer is kept under `id`: a translation of `src`, or with `system`, what that asks of it. */
async function translate($: EngineInterface, src: string, id: string = trId(src), system?: string): Promise<void> {
  const ref = { ...TR, id }
  const kept = (await $.state.get(ref)).value
  const now = await $.clock.now()
  // A call that a reload cut short leaves `pending` behind for good: past a minute, try again.
  const isStale = kept?.status === 'pending' && now - (kept.at ?? 0) > 60_000
  if (kept && kept.status !== 'error' && !isStale) return
  await $.state.set(ref, { status: 'pending', text: '', at: now })
  let next: Tr
  try {
    const r = await $.model.complete({ model: 'haiku', system: system ?? (isTable(src) ? tableSystem(pair) : translateSystem(pair)), prompt: src, maxTokens: 2000, effort: 'low', timeoutMs: 45000 })
    next = r.isAnswered ? { status: 'done', text: r.text.trim() } : { status: 'error', text: r.reason }
  } catch (err) {
    next = { status: 'error', text: (err instanceof Error ? err.message : String(err)).slice(0, 80) }
  }
  await $.state.set(ref, next)
}

/** One thing a press opens: a whole chunk (a paragraph, a list, a heading with its paragraph, a table). */
type Unit = { k: number; text: string }

/** What a chunk offers to open: itself, when it is in the learned language. `inText`: the plugin draws its text. */
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

export const register: Register = (on, options) => {
  pair = pairOf(String(options.nativeLanguage ?? ''), String(options.targetLanguage ?? ''))

  // Which messages are the latest reply, for /immerse. Module values: a reload starts them over.
  // A reload, a resize or a scroll draws old messages again, so "drawn lately" is not "latest":
  // a message belongs to the latest reply when it was first drawn after the latest turn began.
  const drawn = new Map<string, Chunk[]>() // every message drawn since the load
  let before = new Set<string>() // those already drawn when the latest turn began
  let hasTurn = false
  let recent = new Map<string, Chunk[]>()

  on('session.start', async ($, e, next) => {
    isActive = e.isInteractive
    if (!isActive) return next(e)
    $.clock.every(250, () => void previewTick($))
    await $.command.register({ name: 'immerse', description: 'Open the translation of the latest reply (/immerse off closes it, /immerse where lists the screens)' })
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
    if (n === 0) return { text: `No reply to open yet since the plugin loaded. Use ALL ${pair.native.tag} OPEN at the end of a message.`, isTextDisplayOnly: true }
    return { text: `Opened ${n} block(s) of the latest reply.`, isTextDisplayOnly: true }
  })

  // The first question for a typed message: which language is it in?
  //   native (or mixed)  -> it is sent in the learned language; the transcript keeps what was typed, that under it
  //   learning           -> it is sent as typed and corrected beside the conversation: the model never sees that
  //   unsure             -> the pair shares its letters: the model says which of the two it is
  //   other              -> it is sent as typed and nothing is done (a third language, code, a word or two)
  on('prompt.submit', async ($, e, next) => {
    const text = e.text
    if (!isActive || e.command || e.isMeta) return next(e)
    const language = languageOf(text, pair)
    if (language === 'other') return next(e)
    if (language === 'learning') {
      $.clock.after(0, () => void translate($, text, fixId(text), fixSystem(pair)))
      return next(e)
    }

    // The preview already did this draft's work: Enter sends with no wait.
    const draft = (await $.state.get(DRAFT)).value
    const prepared = draft?.status === 'done' && draft.src === text ? (draft.sends ? { target: draft.english } : 'asTyped') : await prepare($, text, language)
    if (prepared === 'asTyped') return next(e)
    if (prepared === 'failed') {
      $.ui.toast(`immerse: could not make the ${pair.target.name} version; sent as typed`)
      return next(e)
    }
    await $.state.set({ ...SENT, id: hash(prepared.target) }, text)
    return next({ ...e, text: prepared.target })
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
        <Text dimColor>{draft.label === '' ? '▸ ' : `${draft.label} ▸ `}</Text>
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
    if (!isActive || e.props.origin.kind !== 'composer') return next(e)
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
    const fix = (await $.state.get({ ...TR, id: fixId(text) })).value
    if (!fix) return row

    let head = '…'
    let points: string[] = []
    if (fix.status === 'error') head = `✗ ${fix.text}`
    else if (fix.status === 'done') {
      const shown = fixHead(fix.text)
      if (shown === null) return row // not in the learned language after all: nothing to show
      const read = readFix(fix.text)
      head = shown
      points = read.kind === 'fixed' ? read.notes : []
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
    if (!isActive || e.props.isSummary) return next(e)
    const chunks = split(e.props.text, pair)
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
            const tr = (await $.state.get({ ...TR, id: trId(u.text) })).value
            return !tr || tr.status === 'pending' ? '…' : tr.status === 'error' ? `✗ ${tr.text}` : tr.text
          }),
        )
        total += units.length
        openTotal += opens.filter(Boolean).length

        const u = units[0]
        const rowId = `${e.requestId}:${i}:0`
        const tr = u && opens[0] ? (await $.state.get({ ...TR, id: trId(u.text) })).value : null
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
            {openTotal < total && <Button key="all-open" plain dimColor label={`▸▸ ALL ${pair.native.tag} OPEN`} onPress={() => setAll($, e.requestId, chunks, true)} />}
            {openTotal > 0 && <Button key="all-close" plain dimColor label={`▾▾ ALL ${pair.native.tag} CLOSE`} onPress={() => setAll($, e.requestId, chunks, false)} />}
          </Box>
        )}
      </Box>
    )
  })
}
