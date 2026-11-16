import type { EngineInterface, Register } from 'claude-code'

import type { Draft, Tr } from '../types'
import { asText, fixSystem, judgeSystem, pairOf, readFix, readJudgement, tableSystem, toTargetSystem, translateSystem } from './lang'
import type { Pair } from './lang'
import { samplesOf, settingsRows } from './menu'
import type { Preview, Row, Values } from './menu'
import { isWithClaudeInTarget, levelOf, readSettings } from './settings'
import type { Settings } from './settings'
import { fixKey, hash, isTable, languageOf, linesOf, piecesOf, split, tableLines, widthOf, wrap } from './text'
import type { Chunk, Piece } from './text'

const OPEN = { plugin: 'cc-immerse', key: 'open' } as const
const TR = { plugin: 'cc-immerse', key: 'tr' } as const
const SENT = { plugin: 'cc-immerse', key: 'sent' } as const
const DRAFT = { plugin: 'cc-immerse', key: 'draft' } as const
const LATEST = { plugin: 'cc-immerse', key: 'latest' } as const
const MENU = { plugin: 'cc-immerse', key: 'menu' } as const

// The pair in force and whether the plugin acts at all. Module values, set as the module registers and as
// the session starts: a session with nobody at its prompt (`claude -p`, a scheduled run) is left alone,
// so that a script's own prompt is never rewritten.
let pair: Pair = pairOf('', '')
let settings: Settings = readSettings({})
/** The options as stored: what the settings dialog shows as set now. */
let stored: Readonly<Record<string, unknown>> = {}
/** The band above the prompt, by the id its drawing is asked under: where the keyboard is put back after a pick. */
let band = ''

// The settings list is worked from the prompt box. A plugin cannot give the band the keyboard, and a pane
// that takes it sits in a column at the right. But a key pressed in the prompt box reaches `prompt.edit`:
// an arrow does while the box holds more than one line, and Enter does where the caret stands after a
// backslash, since there it breaks the line and sends nothing. So while the list is open the box holds
// this line, ending in that backslash, between two empty ones, the caret at its end. The line says what
// the keys do: the author tried the backslash alone and found it harder to understand.
const HINT = '↑↓ move · Enter change · ← back · type to close'
const HINT_LINE = `${HINT} \\`
const HELD = `\n${HINT_LINE}\n`
const CARET = 1 + HINT_LINE.length
/** Whether the list is open, for the hooks a key waits on: they have no time to read the state. Set as the band is drawn. */
let isMenuOpen = false
/** The prompt box as last seen. */
let box = ''

function isHint(text: string): boolean {
  return text.trim() === HINT_LINE
}

/** A text without the list's line, should it have been left in the prompt box: it is never sent. */
function withoutHint(text: string): string {
  return text.split(HINT_LINE).join('').split(HINT).join('')
}

let isActive = true

/** The pair the other way round: what a text in the native language is translated with, into the learned one. */
function backPair(): Pair {
  return { native: pair.target, target: pair.native }
}

/** The key a translation of `src` is kept under: by the language it is put into, so a changed setting translates afresh. */
function trId(src: string, isToNative = true): string {
  return hash(`${(isToNative ? pair.native : pair.target).code}:${src}`)
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
    const r = await $.model.complete({ model: 'haiku', system, prompt: asText(prompt), maxTokens: 2000, effort: 'low', timeoutMs: 20000 })
    return r.isAnswered ? r.text.trim() : ''
  } catch {
    return ''
  }
}

/**
 * A typed message as it is to be sent, where the plugin has work to do on it before it goes.
 *
 * `target`: the message in the learned language. `asTyped`: there is no such version, and it is sent as
 * typed (its correction, when it has one, is kept for the row under it). `failed`: a native-language
 * message the model gave no version of. Whether a `target` is sent or only shown is the setting's to say.
 */
async function prepare($: EngineInterface, text: string, language: 'native' | 'unsure'): Promise<{ target: string } | 'asTyped' | 'failed'> {
  if (language === 'native') {
    if (settings.send === 'off') return 'asTyped'
    const target = await ask($, toTargetSystem(pair), text)
    return target === '' ? 'failed' : { target }
  }
  // The pair shares its letters: one call says which language it is and does that language's work.
  // With neither kind of work switched on, there is nothing to ask.
  if (settings.send === 'off' && settings.correct === 'off') return 'asTyped'
  const judged = readJudgement(await ask($, judgeSystem(pair), text))
  if (judged.kind === 'native' && settings.send !== 'off') return { target: judged.target }
  if (judged.kind === 'target' && settings.correct !== 'off') await $.state.set({ ...TR, id: fixId(text) }, { status: 'done', text: judged.fix })
  return 'asTyped'
}

// The live preview. Module values: a reload starts them over, and the next keystroke fills them again.
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

/** Whether the plugin does anything in this session: somebody is at its prompt. */
async function isOn(_: EngineInterface): Promise<boolean> {
  return isActive
}

/** Writes one of the plugin's options, as `/config` would. The engine then loads the plugin again with it. */
async function put($: EngineInterface, field: string, value: string | boolean): Promise<void> {
  await $.config.set({ key: `cc-immerse.${field}`, value })
}

/** Writes what a pick sets, leaving alone what already holds that value: each write loads the plugin again. */
async function apply($: EngineInterface, values: Values): Promise<void> {
  for (const [field, value] of Object.entries(values)) {
    const now = field === 'readingLevel' ? levelOf(stored) : stored[field]
    if (now !== value) await put($, field, value)
  }
}

/** What `/immerse off` switches off, and so what `/immerse on` brings back. */
const OFF: Values = { readingLevel: 'Off', typingHelp: false }
const ON: Values = { readingLevel: '4', typingHelp: true }

/** `/immerse off`: all help off, what was set kept for `/immerse on`. */
async function switchOff($: EngineInterface): Promise<void> {
  const before: Record<string, string | boolean> = {}
  for (const field of Object.keys(OFF)) {
    const now = field === 'readingLevel' ? levelOf(stored) : stored[field]
    if ((typeof now === 'string' || typeof now === 'boolean') && now !== OFF[field]) before[field] = now
  }
  if (Object.keys(before).length > 0) await $.store.set('beforeOff', before)
  await apply($, OFF)
}

/** `/immerse on`: what `/immerse off` switched off comes back as it was; what the person has on is left alone. */
async function switchOn($: EngineInterface): Promise<void> {
  const kept = await $.store.get('beforeOff')
  const before = kept && typeof kept === 'object' ? (kept as Record<string, unknown>) : {}
  const values: Record<string, string | boolean> = {}
  for (const field of Object.keys(OFF)) {
    const now = field === 'readingLevel' ? levelOf(stored) : stored[field]
    if (now !== OFF[field]) continue
    const was = before[field]
    values[field] = (typeof was === 'string' || typeof was === 'boolean') && was !== OFF[field] ? was : (ON[field] as string | boolean)
  }
  await apply($, values)
}

/** Puts the line the keys land on in the prompt box, the caret on it. */
async function holdKeys($: EngineInterface): Promise<void> {
  await $.prompt.fill({ text: HELD, mode: 'replace', cursor: CARET })
}

/** Takes the list away, and its line out of the prompt box unless `isTyping`: the box then holds what the person began to type. */
async function closeMenu($: EngineInterface, isTyping = false): Promise<void> {
  isMenuOpen = false
  await $.state.set(MENU, null)
  if (!isTyping) await $.prompt.fill({ text: '', mode: 'replace' })
}

/** The keys of the rows the keyboard goes through in the list showing, in order. */
function stops(menu: { view: string }, rows: readonly Row[]): string[] {
  const open = rows.find(r => r.key === menu.view)
  return open ? ['back', ...open.choices.map(c => c.key)] : rows.map(r => r.key)
}

/** A key pressed in the prompt box while the list is open. */
async function menuKey($: EngineInterface, key: string): Promise<void> {
  const menu = (await $.state.get(MENU)).value
  if (!menu) return
  const rows = settingsRows(stored, pair, samplesOf(pair))
  const open = rows.find(r => r.key === menu.view)
  const keys = stops(menu, rows)
  const at = Math.max(0, keys.indexOf(menu.cursor))
  if (key === 'up' || key === 'down') {
    const next = keys[(at + (key === 'down' ? 1 : keys.length - 1)) % keys.length] as string
    return void (await $.state.set(MENU, { ...menu, cursor: next }))
  }
  if (key === 'left' || key === '0') return open ? showMenu($, 'main', open.key) : closeMenu($)
  // A number: the row beside it, as if the keyboard were on it.
  const cursor = /^[1-9]$/.test(key) ? (open ? keys[Number(key)] : keys[Number(key) - 1]) : menu.cursor
  if (cursor === undefined) return
  if (cursor === 'back' && open) return showMenu($, 'main', open.key)
  const choice = open?.choices.find(c => c.key === cursor)
  if (open && choice) return pressChoice($, open, choice.set)
  const row = rows.find(r => r.key === cursor)
  if (row) return pressRow($, row)
}

/** Shows another list of the settings (`main`, or a row's choices) with the keyboard on `cursor`. */
async function showMenu($: EngineInterface, view: string, cursor: string): Promise<void> {
  isMenuOpen = true
  await $.state.set(MENU, { view, cursor })
  // Lands only while the band has the keyboard; a number pressed from the prompt leaves it with the prompt.
  if (band !== '') await $.ui.focus({ requestId: band, key: cursor }).catch(() => undefined)
}

/** Enter on a row of the settings: a switch flips where it is, any other row shows its choices. */
async function pressRow($: EngineInterface, row: Row): Promise<void> {
  if (!row.isSwitch) return showMenu($, row.key, row.choices.find(c => c.isNow)?.key ?? 'back')
  const next = row.choices.find(c => !c.isNow)
  await $.state.set(MENU, { view: 'main', cursor: row.key })
  if (next) await apply($, next.set)
}

/** Enter on a choice: back to the list with the keyboard on its row, then the write, which loads the plugin again. */
async function pressChoice($: EngineInterface, row: Row, values: Values): Promise<void> {
  await showMenu($, 'main', row.key)
  await apply($, values)
}

/** Notes a message of the latest reply in the session's state, where a reload does not lose it. */
async function noteLatest($: EngineInterface, id: string, text: string): Promise<void> {
  const latest = (await $.state.get(LATEST)).value ?? []
  if (!latest.some(m => m.id === id)) await $.state.set(LATEST, [...latest, { id, text }])
}

/** The worker's tick: previews a draft that has rested, in whichever of the pair's languages it is; clears the preview of any other. */
async function previewTick($: EngineInterface): Promise<void> {
  if (!isPreviewDue || isPreviewRunning) return
  if ((await $.clock.now()) - draftChangedAt < settings.previewDelayMs) return
  isPreviewDue = false
  const draft = latestDraft
  const kept = (await $.state.get(DRAFT)).value ?? null
  let language = (await isOn($)) && settings.hasPreview ? languageOf(draft, pair) : 'other'
  // A correction while typing is its own setting; a native-language draft left alone has nothing to preview.
  if (language === 'learning' && settings.correct !== 'both') language = 'other'
  if (language === 'native' && settings.send === 'off') language = 'other'
  if (language === 'other') {
    if (kept) await $.state.set(DRAFT, null)
    return
  }
  if (kept?.src === draft && kept.status === 'done') return
  isPreviewRunning = true
  try {
    // `sends`: Enter sends the line's text in place of the draft. A correction is shown, never sent.
    let sends = language === 'native' && settings.send === 'target'
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
        sends = settings.send === 'target'
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

/**
 * One model call whose answer is kept under `id`: a translation of `src`, or with `system`, what that asks
 * of it. `isToNative`: into the native language (a reply in the learned one); false, into the learned one
 * (a reply in the native one, which Claude writes when asked in it).
 */
async function translate($: EngineInterface, src: string, id: string = trId(src), system?: string, isToNative = true): Promise<void> {
  const into = isToNative ? pair : backPair()
  const ref = { ...TR, id }
  const kept = (await $.state.get(ref)).value
  const now = await $.clock.now()
  // A call that a reload cut short leaves `pending` behind for good: past a minute, try again.
  const isStale = kept?.status === 'pending' && now - (kept.at ?? 0) > 60_000
  if (kept && kept.status !== 'error' && !isStale) return
  await $.state.set(ref, { status: 'pending', text: '', at: now })
  let next: Tr
  try {
    const r = await $.model.complete({ model: 'haiku', system: system ?? (isTable(src) ? tableSystem(into) : translateSystem(into)), prompt: asText(src), maxTokens: 2000, effort: 'low', timeoutMs: 45000 })
    next = r.isAnswered ? { status: 'done', text: r.text.trim() } : { status: 'error', text: r.reason }
  } catch (err) {
    next = { status: 'error', text: (err instanceof Error ? err.message : String(err)).slice(0, 80) }
  }
  await $.state.set(ref, next)
}

/** One thing a press opens: a whole chunk (a paragraph, a list, a heading with its paragraph, a table). `isToNative`: its translation is into the native language. */
type Unit = { k: number; text: string; isToNative: boolean }

/** What a chunk offers to open: itself, when it is in one of the pair's languages. `inText`: the plugin draws its text. */
function offers(c: Chunk): (Unit & { inText: boolean })[] {
  if (!c.isProse && !c.isNative) return []
  const hasCode = /^\s*(```|~~~)/m.test(c.src)
  return [{ k: 0, text: c.src, isToNative: c.isProse, inText: !c.isTable && !hasCode }]
}

async function setOpen($: EngineInterface, rowId: string, u: Unit, isOpen: boolean): Promise<void> {
  await $.state.set({ ...OPEN, id: rowId }, isOpen)
  // Not awaited: a press has ten seconds, and a translation may take longer. The row redraws when it lands.
  if (isOpen) $.clock.after(0, () => void translate($, u.text, trId(u.text, u.isToNative), undefined, u.isToNative))
}

async function toggle($: EngineInterface, rowId: string, u: Unit): Promise<void> {
  const isOpen = (await $.state.get({ ...OPEN, id: rowId })).value ?? false
  await setOpen($, rowId, u, !isOpen)
}

/** Opens (and translates) or closes everything one message offers. Returns how many. */
async function setAll($: EngineInterface, requestId: string, chunks: readonly Chunk[], isOpen: boolean): Promise<number> {
  const work: Promise<void>[] = []
  chunks.forEach((c, i) => {
    for (const u of offers(c)) work.push(setOpen($, `${requestId}:${i}:${u.k}`, u, isOpen))
  })
  await Promise.all(work)
  return work.length
}

/** A reply's blocks, or a sample of them, and how they are to be drawn. */
type View = {
  /** The reply's request id. */
  id: string
  chunks: readonly Chunk[]
  columns: number
  isFirstOfReply: boolean
  settings: Settings
  pair: Pair
  /** A sample in the settings preview: its translations and what is open are given, the model is asked nothing, and its marks are drawn, not pressed. */
  sample?: { translations: readonly string[]; open: readonly boolean[] }
}

/** Draws a reply as the settings say. The settings preview draws its sample with it, so the sample is what a reply will be. */
async function drawReply($: EngineInterface, e: Parameters<EngineInterface['ui']['resolve']>[0], view: View) {
  const { Box, Button, Markdown, Text } = $.ui.resolve(e)
  const { chunks, columns, settings, pair, sample } = view
  // `isAlways`: every translation shows with no press, so there is no mark and nothing to open or close.
  const isAlways = settings.show !== 'request'
  // Side by side needs room for two columns of text: a narrow window gets the translation below instead.
  const half = Math.floor((columns - 6) / 2)
  const isSide = settings.show === 'side' && half >= 40
  const isSlanted = settings.style === 'faint-italic'
  // A sample shows its mark at rest: nobody points at a preview.
  const isMarkHidden = settings.markShown === 'hover' && !sample

  // Which language is read first. A chunk in the other one changes places with its translation: the translation
  // is drawn as the reply and the reply's own text is what shows beside it, below it or behind the mark.
  const isNativeFront = settings.front === 'native'
  const behindTag = isNativeFront ? pair.target.tag : pair.native.tag

  type Laid = { lead: string; pieces: Piece[]; isHeading: boolean }
  /** A text as rows that fit `room` columns, each with its list marker or indent. */
  const lay = (text: string, room: number): Laid[] => {
    const laid: Laid[] = []
    for (const line of linesOf(text)) {
      if (line.isGap) {
        laid.push({ lead: '', pieces: [], isHeading: false })
        continue
      }
      const leadWidth = widthOf(line.lead)
      wrap(piecesOf(line.text), Math.max(20, room - leadWidth)).forEach((pieces, r) =>
        laid.push({ lead: r === 0 ? line.lead : ' '.repeat(leadWidth), pieces, isHeading: line.isHeading }),
      )
    }
    return laid
  }
  /** One laid row's words. `isBehind`: drawn as the second language is, faint. */
  const words = (row: Laid, isBehind: boolean) => (
    <Text dimColor={isBehind} italic={isBehind && isSlanted}>
      {row.lead}
      {row.pieces.length === 0
        ? ' '
        : row.pieces.map(piece =>
            piece.kind === 'plain' && !row.isHeading ? (
              piece.text
            ) : (
              <Text
                bold={row.isHeading || piece.kind === 'bold'}
                italic={piece.kind === 'italic' || (isBehind && isSlanted)}
                underline={piece.kind === 'link'}
                color={piece.kind === 'code' && !isBehind ? 'permission' : undefined}
              >
                {piece.text}
              </Text>
            ),
          )}
    </Text>
  )
  /** A text holding a table or code, drawn faint: a table from rows of text, since the engine's own keeps the reply's colour. */
  const behindBlock = (text: string, isTableText: boolean) => {
    const table = isTableText ? tableLines(text, columns - 4) : null
    if (table) {
      return (
        <Box flexDirection="column">
          {table.map(line => (
            <Text dimColor>{line}</Text>
          ))}
        </Box>
      )
    }
    return isTableText ? <Markdown text={text} dimColor /> : <Text dimColor>{text}</Text>
  }

  let total = 0
  let openTotal = 0
  const rows = await Promise.all(
    chunks.map(async (c, i) => {
      const u = offers(c)[0]
      const rowId = `${view.id}:${i}:0`
      const isOpen = u ? isAlways || (sample ? (sample.open[i] ?? false) : ((await $.state.get({ ...OPEN, id: rowId })).value ?? false)) : false
      // A chunk in the language that is not read first changes places with its translation, which is then
      // the text read and so wanted at once: an English reply at level 1, a Japanese one at level 4.
      const needsSwap = Boolean(u) && u?.isToNative === isNativeFront
      const isWanted = Boolean(u) && (isOpen || needsSwap)
      const tr: Tr | null = !u || !isWanted ? null : sample ? { status: 'done', text: sample.translations[i] ?? '' } : ((await $.state.get({ ...TR, id: trId(u.text, u.isToNative) })).value ?? null)
      // Shown with no press: the translation is asked for as the chunk is drawn. Once asked, the state holds
      // it (pending, then done), so drawing the chunk again asks nothing.
      if (u && (isAlways || needsSwap) && !tr && !sample) $.clock.after(0, () => void translate($, u.text, trId(u.text, u.isToNative), undefined, u.isToNative))
      const done = tr?.status === 'done' ? tr.text : null
      // Until its translation arrives a chunk is read as written, with nothing to open yet.
      const isSwapped = needsSwap && done !== null
      const isPressable = Boolean(u) && !isAlways && (!needsSwap || isSwapped)
      if (u && (!needsSwap || isSwapped)) total++
      if (u && isOpen && (!needsSwap || isSwapped)) openTotal++

      // A chunk the plugin draws itself can have the other language beside it; one the engine draws is too wide.
      const isBeside = isSide && Boolean(u?.inText)
      const room = isBeside ? half : columns - 4 // 2 for the gutter, 2 spare: a row that reaches the edge is cut

      // What shows beside the chunk, below it or behind its mark.
      let behind = null
      if (u && isOpen) {
        if (isSwapped) behind = u.inText ? <Box flexDirection="column">{lay(c.src, room).map(row => words(row, true))}</Box> : behindBlock(c.src, c.isTable)
        else if (needsSwap) behind = isAlways ? <Text dimColor>{tr?.status === 'error' ? `✗ ${tr.text}` : '…'}</Text> : null
        else if (done !== null && c.isTable) behind = behindBlock(done, true)
        else
          behind = (
            <Text dimColor italic={isSlanted}>
              {done ?? (tr?.status === 'error' ? `✗ ${tr.text}` : '…')}
            </Text>
          )
      }

      const bullet = i === 0 && view.isFirstOfReply ? '●' : ' '
      // In a sample the mark is text: the keyboard moving through the settings does not stop on it.
      const mark =
        !isPressable || !u ? null : sample ? (
          <Text>{isOpen ? '▾' : settings.mark}</Text>
        ) : (
          <Button key={`g${i}`} plain label={isOpen ? '▾' : settings.mark} onPress={() => toggle($, rowId, u)} />
        )
      // Drawn over its gutter cell, so nothing moves; hidden until the pointer is on the chunk unless set to show always.
      const overCell = mark ? (
        isMarkHidden ? (
          <Box position="absolute" top={0} left={0} display="none" hover={{ display: 'flex' }}>
            {mark}
          </Box>
        ) : (
          <Box position="absolute" top={0} left={0}>
            {mark}
          </Box>
        )
      ) : null

      // The text read first: the chunk as written, or its translation once that is in front.
      const front = isSwapped ? (done ?? c.src) : c.src
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
        // The first cell holds the reply's bullet; the mark shows over the cell of the line the setting names.
        const laid = lay(front, room)
        const markRow = settings.markAt === 'first' ? 0 : laid.length - 1
        block = (
          <Box flexDirection="column">
            {laid.map((row, k) => (
              <Box flexDirection="row">
                <Box width={2} flexShrink={0}>
                  <Text>{k === 0 ? bullet : ' '}</Text>
                  {k === markRow && overCell}
                </Box>
                {words(row, false)}
              </Box>
            ))}
          </Box>
        )
      } else {
        // A table, or prose that ends in code: drawn by the engine, so its height is not known here. For the
        // last line the gutter stretches to the chunk, the bullet at its top and the mark at its bottom (such
        // a chunk has two lines or more). For the first line the mark shows over the bullet's cell.
        block = (
          <Box flexDirection="row">
            {settings.markAt === 'first' ? (
              <Box width={2} flexShrink={0}>
                <Text>{bullet}</Text>
                {overCell}
              </Box>
            ) : (
              <Box width={2} flexShrink={0} flexDirection="column" justifyContent="space-between">
                <Text>{bullet}</Text>
                {mark && (isMarkHidden ? <Box display="none" hover={{ display: 'flex' }}>{mark}</Box> : <Box>{mark}</Box>)}
              </Box>
            )}
            <Box flexDirection="column" flexGrow={1} flexShrink={1}>
              <Markdown text={front} />
            </Box>
          </Box>
        )
      }

      return (
        // The keyed Box is the hover area: the chunk with its gutter, what is behind it, and the cells to their right.
        <Box key={mark && !sample ? `h${i}` : undefined} flexDirection={isBeside ? 'row' : 'column'} marginTop={i === 0 || sample ? 0 : 1}>
          {isBeside ? (
            <Box width={half + 2} flexShrink={0}>
              {block}
            </Box>
          ) : (
            block
          )}
          {behind && (
            <Box paddingLeft={2} width={isBeside ? half + 2 : undefined} flexShrink={1}>
              {behind}
            </Box>
          )}
        </Box>
      )
    }),
  )

  return (
    <Box flexDirection="column">
      {rows}
      {settings.hasAllButtons && !isAlways && !sample && total >= 2 && (
        <Box flexDirection="row" gap={2} paddingLeft={2} marginTop={1}>
          {openTotal < total && (
            <Button key="all-open" plain dimColor label={`▸▸ ALL ${behindTag} OPEN`} onPress={() => setAll($, view.id, chunks, true)} />
          )}
          {openTotal > 0 && (
            <Button key="all-close" plain dimColor label={`▾▾ ALL ${behindTag} CLOSE`} onPress={() => setAll($, view.id, chunks, false)} />
          )}
        </Box>
      )}
    </Box>
  )
}

export const register: Register = (on, options) => {
  pair = pairOf(String(options.nativeLanguage ?? ''), String(options.targetLanguage ?? ''))
  settings = readSettings(options)
  stored = options

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
    // Loaded again by a setting the list wrote: the list is still open, and its line goes back in the prompt box.
    if ((await $.state.get(MENU)).value) {
      isMenuOpen = true
      $.clock.after(0, () => void holdKeys($))
    }
    $.clock.every(250, () => void previewTick($))
    await $.command.register({
      name: 'immerse',
      description: 'Show the settings above the prompt. /immerse on, /immerse off: all help at once. /immerse open, /immerse close: the latest reply’s translations',
      argumentHint: '[on|off|open|close]',
    })
    return next(e)
  })

  on('session.attach', ($, e, next) => {
    $.ui.toast(`immerse: a ${e.surface} screen joined`)
    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    before = new Set(drawn.keys())
    recent = new Map()
    hasTurn = true
    await $.state.set(LATEST, [])
    return next(e)
  })

  on('command.run', { command: 'immerse' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === '') {
      isMenuOpen = true
      await $.state.set(MENU, { view: 'main', cursor: 'level' })
      // After this answer is shown: the command's own line leaves the prompt box first.
      $.clock.after(0, () => void holdKeys($))
      return { text: 'Settings are above the prompt: ↑↓ move, Enter change, ← back.', isTextDisplayOnly: true }
    }
    // The shortcuts write what the list writes: there is one place a setting is kept.
    if (arg === 'on' || arg === 'off') {
      if (arg === 'off') {
        await switchOff($)
        return { text: 'Immerse is off: the level is Off and typing help is off. /immerse on brings them back; /immerse shows the settings.', isTextDisplayOnly: true }
      }
      await switchOn($)
      return { text: 'Immerse is on. /immerse shows the settings.', isTextDisplayOnly: true }
    }
    if (arg === 'open' && settings.show === 'never') return { text: 'Reading is off (the level is Off), so there is nothing to open. /immerse on brings it back.', isTextDisplayOnly: true }
    if (arg !== 'open' && arg !== 'close') return { text: 'Usage: /immerse shows the settings. /immerse on, off: all help at once. /immerse open, close: the latest reply’s translations.', isTextDisplayOnly: true }
    // `close` closes everything on screen (no model call); `open` covers the latest reply alone.
    const isOff = arg === 'close'
    // The latest reply is in the module since its turn began, or in the session's state from before a reload.
    const kept = recent.size > 0 || isOff ? [] : ((await $.state.get(LATEST)).value ?? [])
    const targets = isOff ? drawn : recent.size > 0 ? recent : new Map(kept.map(m => [m.id, split(m.text, pair)] as const))
    const counts = await Promise.all([...targets].map(([requestId, chunks]) => setAll($, requestId, chunks, !isOff)))
    const n = counts.reduce((a, b) => a + b, 0)
    if (isOff) return { text: 'Closed every translation.', isTextDisplayOnly: true }
    if (n === 0) return { text: `No reply to open yet since the plugin loaded. Use the ALL OPEN button at the end of a message.`, isTextDisplayOnly: true }
    return { text: `Opened ${n} block(s) of the latest reply.`, isTextDisplayOnly: true }
  })

  // The first question for a typed message: which language is it in?
  //   native (or mixed)  -> it is sent in the learned language; the transcript keeps what was typed, that under it
  //   learning           -> it is sent as typed and corrected beside the conversation: the model never sees that
  //   unsure             -> the pair shares its letters: the model says which of the two it is
  //   other              -> it is sent as typed and nothing is done (a third language, code, a word or two)
  on('prompt.submit', async ($, e, next) => {
    const text = e.text
    if (e.command || e.isMeta || !(await isOn($))) return next(e)
    // Enter on the list's own line: the row under the keyboard is changed, and nothing is sent.
    if (isHint(text)) {
      if (!isMenuOpen) return { drop: '' }
      // The line goes back in the box first: the change may load the plugin again, and what follows it here is lost.
      $.clock.after(0, async () => {
        await holdKeys($)
        await menuKey($, 'return')
      })
      return { drop: '' }
    }
    // The list's line left in the box with a message typed beside it is not part of the message.
    if (text.includes(HINT)) return next({ ...e, text: withoutHint(text).trim() })
    // A message is on its way: the settings list has done its work and gives the band back.
    if ((await $.state.get(MENU)).value) {
      isMenuOpen = false
      await $.state.set(MENU, null)
    }
    const language = languageOf(text, pair)
    if (language === 'other') return next(e)
    if (language === 'learning') {
      if (settings.correct !== 'off') $.clock.after(0, () => void translate($, text, fixId(text), fixSystem(pair)))
      return next(e)
    }
    // Shown but not sent: the preview is all there is, and the message goes as typed.
    if (language === 'native' && settings.send !== 'target') return next(e)

    // The preview already did this draft's work: Enter sends with no wait.
    const draft = (await $.state.get(DRAFT)).value
    const prepared = draft?.status === 'done' && draft.src === text ? (draft.sends ? { target: draft.english } : 'asTyped') : await prepare($, text, language)
    if (prepared === 'asTyped' || settings.send !== 'target') return next(e)
    if (prepared === 'failed') {
      $.ui.toast(`immerse: could not make the ${pair.target.name} version; sent as typed`)
      return next(e)
    }
    await $.state.set({ ...SENT, id: hash(prepared.target) }, text)
    // The person's own words go with the message, beside it and not shown: Claude reads the learned-language
    // version as the message and answers in that language, and has the original for what a translation loses.
    // The last sentence is needed: with the original in view and nothing said, it answers in the original's language.
    const original =
      `The user is practising ${pair.target.name}. Their message in this turn is the ${pair.target.name} version of what they typed in ${pair.native.name}. ` +
      `This is their original wording, given only so that its exact meaning is not lost:\n<original-message language="${pair.native.name}">\n${text}\n</original-message>\n` +
      `Reply in ${pair.target.name}, the language of their message.`
    return next({ ...e, text: prepared.target, context: [...(e.context ?? []), original] })
  })

  // While the person types, above the prompt box: a native-language draft's English (what Enter will send),
  // or a learned-language draft as it would read corrected.
  on('prompt.edit', async ($, e, next) => {
    // While the box holds the list's line, a key is the list's. This hook has 50 ms: the key is acted on
    // after it answers.
    if (isHint(e.text)) {
      const key = e.key && !e.key.ctrl && !e.key.meta ? e.key.key : ''
      // The box should hold the line between two empty ones, or an arrow has nowhere to go; put right if not.
      if (isMenuOpen && e.text !== HELD) $.clock.after(0, () => void holdKeys($))
      if (isMenuOpen && (['up', 'down', 'left', 'right', 'return', 'space'].includes(key) || /^[0-9]$/.test(key))) {
        $.clock.after(0, () => void menuKey($, key === 'space' || key === 'return' ? 'right' : key))
        return { text: e.text, cursor: e.cursor }
      }
      // Anything else that puts text in, one key or a burst or a paste, is the start of a message: the
      // list goes, and the box holds what was typed alone.
      if (e.inputText !== '') {
        if (isMenuOpen) $.clock.after(0, () => void closeMenu($, true))
        box = e.inputText
        await noteDraft($, e.inputText)
        return next({ ...e, text: '', cursor: 0, start: 0, end: 0 })
      }
      // A key that would only take something out of the line: the line stays whole while the list is open.
      if (isMenuOpen) return { text: e.text, cursor: e.cursor }
    }
    const after = await next(e)
    box = after.text
    await noteDraft($, isHint(after.text) ? '' : after.text)
    return after
  })

  on('prompt.change', async ($, e, next) => {
    const r = await next(e)
    box = e.text
    await noteDraft($, isHint(e.text) ? '' : e.text)
    // The box emptied under the open list: Esc twice. (Enter empties it too, and the engine puts the line
    // back when the send is dropped, so this waits a moment to see which it was.)
    if (isMenuOpen && e.text === '') {
      $.clock.after(250, async () => {
        if (box !== '' || !isMenuOpen) return
        const menu = (await $.state.get(MENU)).value
        if (!menu) return
        if (menu.view === 'main') return closeMenu($, true)
        await showMenu($, 'main', menu.view)
        await holdKeys($)
      })
    }
    return r
  })

  // The keyboard moved in the band: the settings list notes the row it is on, and the preview follows.
  on('ui.focus', { component: 'AbovePrompt' }, async ($, e, next) => {
    const menu = (await $.state.get(MENU)).value
    if (menu && e.element && e.element !== menu.cursor) await $.state.set(MENU, { ...menu, cursor: e.element })
    return next(e)
  })

  // The settings, while `/immerse` has them open, in place of the line a draft gets: one row a setting, as
  // `/config` lists its own, and under them a preview of the choice the keyboard is on.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    band = e.requestId
    const menu = (await $.state.get(MENU)).value
    // Noted for the hooks a key waits on; after a setting reloads the module this is where they learn it again.
    isMenuOpen = Boolean(menu)
    if (!menu || e.props.hasSurvey || !(await isOn($))) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const columns = Math.max(40, e.props.bodyColumns ?? 100)
    const samples = samplesOf(pair)
    const rows = settingsRows(stored, pair, samples)
    const open = rows.find(r => r.key === menu.view)
    const { cursor } = menu
    const at = (key: string): string => (cursor === key ? '❯' : ' ')
    const digit = (i: number): string | undefined => (i < 9 ? String(i + 1) : undefined)
    // A row with no number is set in by the width a number takes.
    const lead = (i: number): string => (i < 9 ? '' : '   ')

    /** The preview of one choice: an exchange at a level, or lines saying what happens. */
    const preview = async (p: Preview) => {
      if (p.kind === 'lines') {
        return (
          <Box flexDirection="column">
            {p.lines.map(line => (
              <Text dimColor={line.isFaint === true}>{line.text}</Text>
            ))}
          </Box>
        )
      }
      // An exchange: what is typed, what Claude gets, and its answer as the level draws it. With Claude in
      // the learned language the answer is in it; in the native one, or with nothing done, Claude answers
      // in the language it was asked in.
      const isInTarget = isWithClaudeInTarget(p.level)
      const drawn = readSettings({ ...stored, readingLevel: p.level })
      const [said, other] = isInTarget ? [samples.target, samples.native] : [samples.native, samples.target]
      const [n, t] = [pair.native.name, pair.target.name]
      return (
        <Box flexDirection="column">
          <Text>{`❯ ${samples.native.asked}`}</Text>
          {isInTarget && <Text dimColor>{`  ↳ ${samples.target.asked}`}</Text>}
          <Text dimColor>{`Claude gets: ${isInTarget ? `${samples.target.asked}  (with your ${n} beside it, so no meaning is lost)` : samples.native.asked}`}</Text>
          <Text dimColor>{`Claude answers in ${isInTarget ? t : n}${p.level === 'Off' ? ', and nothing is done to it' : ''}:`}</Text>
          {drawn.show === 'never' ? (
            <Box flexDirection="column">
              {said.reply.map(line => (
                <Text>{`  ${line}`}</Text>
              ))}
            </Box>
          ) : (
            await drawReply($, e, {
              id: 'preview',
              chunks: said.reply.map(src => ({ src, isProse: isInTarget, isNative: !isInTarget, isTable: false })),
              columns: Math.min(columns, 100),
              isFirstOfReply: false,
              settings: drawn,
              pair,
              sample: { translations: other.reply, open: [false, true] },
            })
          )}
        </Box>
      )
    }
    const under = open?.choices.find(c => c.key === cursor) ?? rows.find(r => r.key === cursor)?.choices.find(c => c.isNow)

    const nameWidth = Math.max(...rows.map(r => widthOf(r.name))) + 3
    const list = open ? (
      // A row's choices. A long list (the languages) goes in three columns, so that it fits the band.
      (() => {
        const labelWidth = Math.max(...open.choices.map(c => widthOf(c.label))) + 3
        const one = (c: Row['choices'][number], i: number) => (
          <Button
            key={c.key}
            plain
            hotkey={digit(i)}
            autoFocus={cursor === c.key ? true : undefined}
            label={`${lead(i)}${at(c.key)} ${c.isNow ? '●' : '○'} ${c.label}${c.about === '' ? '' : `${' '.repeat(Math.max(1, labelWidth - widthOf(c.label)))}${c.about}`}`}
            onPress={() => pressChoice($, open, c.set)}
          />
        )
        const perColumn = open.choices.length > 9 ? Math.ceil(open.choices.length / 3) : open.choices.length
        const groups = [0, 1, 2].map(k => open.choices.slice(k * perColumn, (k + 1) * perColumn)).filter(g => g.length > 0)
        return (
          <Box flexDirection="column">
            <Button key="back" plain hotkey="0" autoFocus={cursor === 'back' ? true : undefined} label={`${at('back')} ← Back`} onPress={() => showMenu($, 'main', open.key)} />
            <Box flexDirection="row" gap={3}>
              {groups.map((group, k) => (
                <Box flexDirection="column">{group.map((c, i) => one(c, k * perColumn + i))}</Box>
              ))}
            </Box>
          </Box>
        )
      })()
    ) : (
      (() => {
        const one = (r: Row, width: number) => {
          const i = rows.indexOf(r)
          return (
            <Button
              key={r.key}
              plain
              hotkey={digit(i)}
              autoFocus={cursor === r.key ? true : undefined}
              label={`${lead(i)}${at(r.key)} ${r.name}${' '.repeat(Math.max(1, width - widthOf(r.name)))}${r.shown}${r.isSwitch ? '' : '  ›'}`}
              onPress={() => pressRow($, r)}
            />
          )
        }
        return <Box flexDirection="column">{rows.map(r => one(r, nameWidth))}</Box>
      })()
    )

    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={3}>
          <Text bold>{open ? `Immerse settings › ${open.name}` : 'Immerse settings'}</Text>
          <Text dimColor>{`↑↓ move · Enter ${open ? 'pick' : 'change'} · ← back · or press a number`}</Text>
          {!open && <Button key="close" plain hotkey="0" autoFocus={cursor === 'close' ? true : undefined} label={`${at('close')} Close`} onPress={() => closeMenu($)} />}
        </Box>
        {list}
        {under ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>{`Preview · ${open ? under.label : (rows.find(r => r.key === cursor)?.name ?? '')}${under.about === '' || !open ? '' : ` · ${under.about}`}`}</Text>
            <Box paddingLeft={2}>{await preview(under.preview)}</Box>
          </Box>
        ) : (
          <Box marginTop={1}>
            <Text dimColor>{cursor === 'back' ? 'Back to the settings.' : 'Closes the settings.'}</Text>
          </Box>
        )}
      </Box>
    )
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
    if (e.props.origin.kind !== 'composer' || !(await isOn($))) return next(e)
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
    if (settings.show === 'never' || e.props.isSummary || !(await isOn($))) return next(e)
    const chunks = split(e.props.text, pair)
    if (!chunks.some(c => c.isProse || c.isNative)) return next(e)
    drawn.set(e.requestId, chunks)
    if (hasTurn && !before.has(e.requestId) && !recent.has(e.requestId)) {
      recent.set(e.requestId, chunks)
      const text = e.props.text
      $.clock.after(0, () => void noteLatest($, e.requestId, text))
    }
    return drawReply($, e, { id: e.requestId, chunks, columns: e.viewport?.columns ?? 100, isFirstOfReply: Boolean(e.props.isFirstOfReply), settings, pair })
  })
}
