import type { EngineInterface, Register } from 'claude-code'

import type { Draft, Tr } from '../types'

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

/** `isProse`: English worth a translation. `isTable`: that English is a Markdown table, translated and drawn as one. */
type Chunk = { src: string; isProse: boolean; isTable: boolean }

function isTable(src: string): boolean {
  return /^\s*\|.*\|\s*$/m.test(src)
}

function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + text.length.toString(36)
}

/** English prose worth a translation: not code, not a table, not already Japanese. */
function isProse(src: string): boolean {
  if (/^\s*(```|~~~)/.test(src) || /^\s*([-*_]\s*){3,}$/.test(src)) return false
  const plain = src.replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '')
  const latin = (plain.match(/[A-Za-z]/g) ?? []).length
  const cjk = (plain.match(/[぀-ヿ一-鿿]/g) ?? []).length
  return latin >= 4 && cjk < latin * 0.2
}

/** Blocks separated by blank lines; a fenced block stays whole, a heading joins the block after it. */
function split(text: string): Chunk[] {
  const blocks: string[] = []
  let cur: string[] = []
  let fence: string | null = null
  for (const line of text.split('\n')) {
    const mark = /^\s*(```+|~~~+)/.exec(line)?.[1]
    if (fence) {
      cur.push(line)
      if (mark && mark.charAt(0) === fence.charAt(0) && mark.length >= fence.length) fence = null
      continue
    }
    if (mark) {
      fence = mark
      cur.push(line)
      continue
    }
    if (line.trim() === '') {
      if (cur.length) blocks.push(cur.join('\n'))
      cur = []
      continue
    }
    cur.push(line)
  }
  if (cur.length) blocks.push(cur.join('\n'))

  const merged: string[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i] ?? ''
    const after = blocks[i + 1]
    const isHeadingAlone = /^\s*#{1,6}\s/.test(block) && !block.includes('\n')
    if (isHeadingAlone && after !== undefined) {
      merged.push(block + '\n\n' + after)
      i++
    } else merged.push(block)
  }
  return merged.map(src => ({ src, isProse: isProse(src), isTable: isTable(src) }))
}

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

/** Which language a typed message is in: the native one (or a mix: both are sent in English), the learned one, or neither. */
function languageOf(text: string): 'native' | 'learning' | 'other' {
  const t = text.trim()
  if (t === '' || t.startsWith('/') || t.length > 2000) return 'other'
  const plain = t.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '')
  const cjk = (plain.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) ?? []).length
  if (cjk >= 2) return 'native'
  return isFixable(t) ? 'learning' : 'other'
}

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

/** The key a correction of `text` is kept under: apart from its translation. */
function fixKey(text: string): string {
  return hash('fix:' + text)
}

/** Whether a typed message is English prose worth a correction: not a command, not mostly Japanese, not huge. */
function isFixable(text: string): boolean {
  const t = text.trim()
  // A draft of a word or two is not judged: at least twelve letters.
  const letters = (t.replace(/`[^`]*`/g, '').match(/[A-Za-z]/g) ?? []).length
  return letters >= 12 && t.length <= 1500 && !t.startsWith('/') && isProse(t)
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

/** One drawn line of a prose chunk: what leads it (a bullet, a number, a quote bar) and its text. */
type Line = { lead: string; text: string; isHeading: boolean; isGap: boolean }

/** A prose chunk as lines: a paragraph's lines joined, each list item, heading or quote on its own. */
function linesOf(src: string): Line[] {
  const out: Line[] = []
  let isOpen = false // the last line takes a continuation
  for (const raw of src.split('\n')) {
    if (raw.trim() === '') {
      if (out.length) out.push({ lead: '', text: '', isHeading: false, isGap: true })
      isOpen = false
      continue
    }
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(raw)
    const item = /^(\s*)([-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(raw)
    const quote = /^\s*>\s?(.*)$/.exec(raw)
    if (heading) {
      out.push({ lead: '', text: heading[1] ?? '', isHeading: true, isGap: false })
      isOpen = false
    } else if (item) {
      const bullet = /^\d/.test(item[2] ?? '') ? `${item[2]} ` : '• '
      out.push({ lead: (item[1] ?? '') + bullet, text: item[3] ?? '', isHeading: false, isGap: false })
      isOpen = true
    } else if (quote) {
      out.push({ lead: '│ ', text: quote[1] ?? '', isHeading: false, isGap: false })
      isOpen = true
    } else {
      const last = out[out.length - 1]
      if (isOpen && last) last.text += ' ' + raw.trim()
      else out.push({ lead: '', text: raw.trim(), isHeading: false, isGap: false })
      isOpen = true
    }
  }
  return out
}

/** A line's inline Markdown as pieces: plain text, **bold**, *italic*, `code`, and a link's text. */
type Piece = { text: string; kind: 'plain' | 'bold' | 'italic' | 'code' | 'link' }

function piecesOf(text: string): Piece[] {
  const out: Piece[] = []
  const marks = /\*\*([^*]+)\*\*|`([^`]+)`|\*([^*\s][^*]*)\*|\[([^\]]+)\]\([^)]*\)/g
  let from = 0
  for (let m = marks.exec(text); m; m = marks.exec(text)) {
    if (m.index > from) out.push({ text: text.slice(from, m.index), kind: 'plain' })
    if (m[1] !== undefined) out.push({ text: m[1], kind: 'bold' })
    else if (m[2] !== undefined) out.push({ text: m[2], kind: 'code' })
    else if (m[3] !== undefined) out.push({ text: m[3], kind: 'italic' })
    else out.push({ text: m[4] ?? '', kind: 'link' })
    from = m.index + m[0].length
  }
  if (from < text.length) out.push({ text: text.slice(from), kind: 'plain' })
  return out
}

/** Columns a string takes in a terminal: 2 for CJK and emoji, 1 otherwise. */
function widthOf(text: string): number {
  let w = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    const isWide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || c >= 0x1f300
    w += isWide ? 2 : 1
  }
  return w
}

/** Pieces laid out as rows no wider than `max` columns, broken at spaces. A Button draws one row, so the plugin wraps. */
function wrap(pieces: readonly Piece[], max: number): Piece[][] {
  const rows: Piece[][] = [[]]
  let used = 0
  for (const piece of pieces) {
    for (const token of piece.text.split(/(\s+)/)) {
      if (token === '') continue
      const isSpace = /^\s+$/.test(token)
      const w = widthOf(token)
      let row = rows[rows.length - 1] ?? []
      if (used + w > max && used > 0) {
        row = []
        rows.push(row)
        used = 0
        if (isSpace) continue
      }
      if (isSpace && used === 0) continue
      const last = row[row.length - 1]
      if (last && last.kind === piece.kind) last.text += isSpace ? ' ' : token
      else row.push({ text: isSpace ? ' ' : token, kind: piece.kind })
      used += isSpace ? 1 : w
    }
  }
  return rows.filter(row => row.length > 0)
}

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

        let body
        if (!u) {
          body = <Markdown text={c.src} />
        } else if (u.inText) {
          // Prose: plain text, never highlighted. The mark that opens it is in the gutter (see the row below).
          const columns = e.viewport?.columns ?? 100
          const lines = linesOf(c.src)
          body = (
            <Box flexDirection="column">
              {lines.map((line, j) => {
                if (line.isGap) return <Text> </Text>
                const leadWidth = widthOf(line.lead)
                // 2 for the gutter, 2 spare: a row that reaches the edge is cut.
                const rows = wrap(piecesOf(line.text), Math.max(20, columns - 4 - leadWidth))
                return (
                  <Box flexDirection="column">
                    {rows.map((row, r) => (
                      <Box flexDirection="row">
                        {leadWidth > 0 && <Text>{r === 0 ? line.lead : ' '.repeat(leadWidth)}</Text>}
                        <Text>
                          {row.map(piece =>
                            piece.kind === 'plain' && !line.isHeading ? (
                              piece.text
                            ) : (
                              <Text
                                bold={line.isHeading || piece.kind === 'bold'}
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
              })}
              {translation}
            </Box>
          )
        } else {
          // A table, or prose that ends in code: drawn as it is; its mark is in the gutter too.
          body = (
            <Box flexDirection="column">
              <Markdown text={c.src} />
              {translation}
            </Box>
          )
        }

        return (
          // The keyed Box is the hover area: the gutter, the chunk and the cells to its right. While the pointer
          // is on it, the mark shows at the start of the chunk's first line, over the gutter, so nothing moves.
          <Box key={u ? `h${i}` : undefined} flexDirection="row" marginTop={i === 0 ? 0 : 1}>
            <Box width={2} flexShrink={0}>
              <Text>{i === 0 && e.props.isFirstOfReply ? '●' : ' '}</Text>
              {u && (
                <Box position="absolute" top={0} left={0} display="none" hover={{ display: 'flex' }}>
                  <Button key={`g${i}`} plain label={opens[0] ? '▾' : '▸'} onPress={() => toggle($, rowId, u.text)} />
                </Box>
              )}
            </Box>
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              {body}
            </Box>
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
