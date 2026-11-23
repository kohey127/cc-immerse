// The plugin's text logic: which language a text is in, how a reply is cut into chunks, how a chunk is
// laid out in rows. Pure functions: no `$`, nothing drawn, so they are tested by themselves (tests/text.test.ts).

import { classify, isTargetText } from './lang'
import type { Pair } from './lang'

/**
 * `isProse`: text in the learned language. `isNative`: text in the native language, which Claude answers in
 * when asked in it. Either is worth a translation into the other. `isTable`: it is a Markdown table,
 * translated and drawn as one.
 */
export type Chunk = { src: string; isProse: boolean; isNative?: boolean; isTable: boolean }

export function isTable(src: string): boolean {
  return /^\s*\|.*\|\s*$/m.test(src)
}

/** The cells of one row of a Markdown table; null for a line that is not such a row. */
function cellsOf(line: string): string[] | null {
  const row = /^\s*\|(.*)\|\s*$/.exec(line)
  return row ? (row[1] ?? '').split('|').map(cell => cell.trim()) : null
}

/**
 * A text holding a Markdown table, as the rows of text that draw it: the table with its borders, a
 * rule under every row and the header centred, and any line around it as it is.
 *
 * The plugin draws a translated table from these, so that it takes the translation's colour like every
 * other translation. Null when the text holds no table or the table is wider than `max` columns.
 */
export function tableLines(src: string, max: number): string[] | null {
  const out: string[] = []
  const lines = src.split('\n')
  let hasTable = false
  for (let i = 0; i < lines.length; ) {
    if (!cellsOf(lines[i] ?? '')) {
      out.push(lines[i++] ?? '')
      continue
    }
    const rows: string[][] = []
    let hasHeader = false
    for (; i < lines.length; i++) {
      const cells = cellsOf(lines[i] ?? '')
      if (!cells) break
      const isRule = cells.every(cell => /^:?-+:?$/.test(cell))
      if (isRule) hasHeader = rows.length === 1
      else rows.push(cells)
    }
    if (rows.length === 0) continue
    hasTable = true
    const count = Math.max(...rows.map(row => row.length))
    const widths = Array.from({ length: count }, (_, k) => Math.max(1, ...rows.map(row => widthOf(row[k] ?? ''))))
    if (widths.reduce((sum, w) => sum + w + 3, 1) > max) return null
    const rule = (left: string, mid: string, right: string): string => left + widths.map(w => '─'.repeat(w + 2)).join(mid) + right
    out.push(rule('┌', '┬', '┐'))
    rows.forEach((row, r) => {
      const cells = widths.map((w, k) => {
        const cell = row[k] ?? ''
        const spare = w - widthOf(cell)
        const before = r === 0 && hasHeader ? Math.floor(spare / 2) : 0
        return ` ${' '.repeat(before)}${cell}${' '.repeat(spare - before)} `
      })
      out.push(`│${cells.join('│')}│`)
      out.push(r === rows.length - 1 ? rule('└', '┴', '┘') : rule('├', '┼', '┤'))
    })
  }
  return hasTable ? out : null
}

/** The narrowest a column of a wrapped table is made. */
const NARROWEST = 4

/**
 * A text holding a Markdown table, as rows of text no wider than `max`, each cell wrapped to its column:
 * for a table too wide for `tableLines`. A cell's Markdown marks are taken out, since rows of text draw
 * none. Null when the text holds no table or `max` has no room for the columns.
 *
 * With this a translated table of any width is drawn by the plugin, in the translation's grey. Claude Code's
 * own table keeps the reply's colour.
 */
export function wrappedTableLines(src: string, max: number): string[] | null {
  const out: string[] = []
  const lines = src.split('\n')
  let hasTable = false
  for (let i = 0; i < lines.length; ) {
    if (!cellsOf(lines[i] ?? '')) {
      out.push(lines[i++] ?? '')
      continue
    }
    const rows: string[][] = []
    let hasHeader = false
    for (; i < lines.length; i++) {
      const cells = cellsOf(lines[i] ?? '')
      if (!cells) break
      const isRule = cells.every(cell => /^:?-+:?$/.test(cell))
      if (isRule) hasHeader = rows.length === 1
      else rows.push(cells.map(cell => piecesOf(cell).map(piece => piece.text).join('')))
    }
    if (rows.length === 0) continue
    hasTable = true
    const count = Math.max(...rows.map(row => row.length))
    const widths = Array.from({ length: count }, (_, k) => Math.max(1, ...rows.map(row => widthOf(row[k] ?? ''))))
    // The widest column gives way first, a column at a time, until the table fits.
    const room = max - (3 * count + 1)
    for (let sum = widths.reduce((a, b) => a + b, 0); sum > room; sum--) {
      const widest = widths.indexOf(Math.max(...widths))
      if ((widths[widest] ?? 0) <= NARROWEST) return null
      widths[widest] = (widths[widest] ?? 0) - 1
    }
    const rule = (left: string, mid: string, right: string): string => left + widths.map(w => '─'.repeat(w + 2)).join(mid) + right
    out.push(rule('┌', '┬', '┐'))
    rows.forEach((row, r) => {
      const cells = widths.map((w, k) => {
        const laid = wrap([{ text: row[k] ?? '', kind: 'plain' }], w).map(pieces =>
          pieces
            .map(piece => piece.text)
            .join('')
            .trimEnd(),
        )
        return laid.length > 0 ? laid : ['']
      })
      const height = Math.max(...cells.map(cell => cell.length))
      for (let line = 0; line < height; line++) {
        const drawn = widths.map((w, k) => {
          const text = cells[k]?.[line] ?? ''
          const spare = Math.max(0, w - widthOf(text))
          const before = r === 0 && hasHeader ? Math.floor(spare / 2) : 0
          return ` ${' '.repeat(before)}${text}${' '.repeat(spare - before)} `
        })
        out.push(`│${drawn.join('│')}│`)
      }
      out.push(r === rows.length - 1 ? rule('└', '┴', '┘') : rule('├', '┼', '┤'))
    })
  }
  return hasTable ? out : null
}

export function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + text.length.toString(36)
}

/**
 * Two tables as rows to draw beside each other, each within `half` columns; null when either is not a table
 * or is wider than that, and they go one under the other.
 */
export function tablesBeside(front: string, behind: string, half: number): { front: string[]; behind: string[] } | null {
  if (!isTable(front) || !isTable(behind)) return null
  const [a, b] = [tableLines(front, half), tableLines(behind, half)]
  return a && b ? { front: a, behind: b } : null
}

/** Prose in the learned language, worth a translation: not code, not a rule, not already in the native language. */
export function isProse(src: string, pair: Pair): boolean {
  if (/^\s*(```|~~~)/.test(src) || /^\s*([-*_]\s*){3,}$/.test(src)) return false
  return isTargetText(src, pair)
}

/** Whether a block is a quote: every line of it starts with `>`. What someone said, kept as they said it. */
export function isQuote(src: string): boolean {
  const lines = src.split('\n').filter(line => line.trim() !== '')
  return lines.length > 0 && lines.every(line => /^\s*>/.test(line))
}

/**
 * Whether a reply is mostly in the language not read first, by the width of its blocks in each language (a
 * wide character counts two, so that Japanese and English weigh alike), quotes left out. Such a reply is read
 * with its blocks swapped for their translations. A reply mostly in the language read first keeps every
 * block as written: a block in the other language there is a draft or an example, part of what was said,
 * and its translation waits behind the mark.
 */
export function isMostlyOther(chunks: readonly Chunk[], isNativeFront: boolean): boolean {
  let other = 0
  let front = 0
  for (const c of chunks) {
    if (isQuote(c.src)) continue
    const isOther = isNativeFront ? c.isProse : Boolean(c.isNative)
    const isFront = isNativeFront ? Boolean(c.isNative) : c.isProse
    if (isOther) other += widthOf(c.src)
    else if (isFront) front += widthOf(c.src)
  }
  return other > front
}

/**
 * Blocks separated by blank lines; a fenced block stays whole, a heading joins the block after it.
 * `spoken`: the language the person and Claude talk in at the level. Two languages that share their letters
 * (English and Spanish) cannot be told apart by them, and a block is then taken to be in that one: Claude
 * answers in the language it is asked in.
 */
export function split(text: string, pair: Pair, spoken: 'native' | 'target' = 'target'): Chunk[] {
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
    // A title: a Markdown heading, or a line that is bold from end to end. Alone it says too little to translate well.
    const isHeadingAlone = (/^\s*#{1,6}\s/.test(block) || /^\s*\*\*[^*]+\*\*:?\s*$/.test(block)) && !block.includes('\n')
    if (isHeadingAlone && after !== undefined) {
      merged.push(block + '\n\n' + after)
      i++
    } else merged.push(block)
  }
  // The pair the other way round asks the same question of the native language.
  const back: Pair = { native: pair.target, target: pair.native }
  return merged.map(src => {
    const inNative = isProse(src, back)
    const inTarget = isProse(src, pair) && !(inNative && spoken === 'native')
    return { src, isProse: inTarget, isNative: !inTarget && inNative, isTable: isTable(src) }
  })
}

/** How many letters a typed message has outside its code spans: a word or two is not judged. */
function lettersOf(text: string): number {
  return (text.replace(/`[^`]*`/g, '').match(/\p{L}/gu) ?? []).length
}

/**
 * What the plugin does with a typed message.
 *
 * `native`: it is in the person's own language (or a mix) and is sent in the learned one.
 * `learning`: it is in the learned language and is corrected. `unsure`: the pair shares its letters, so the
 * model is asked which of those it is. `other`: it is left alone (a command, a word or two, a third
 * language, code, or a paste too long to be a message).
 */
export function languageOf(text: string, pair: Pair): 'native' | 'learning' | 'unsure' | 'other' {
  const t = text.trim()
  if (t === '' || t.startsWith('/') || t.length > 2000) return 'other'
  const kind = classify(t, pair)
  if (kind === 'native') return 'native'
  if (kind === 'other') return 'other'
  if (lettersOf(t) < 12 || t.length > 1500) return 'other'
  return kind === 'target' ? 'learning' : 'unsure'
}

/** The key a correction of `text` is kept under: apart from its translation. */
export function fixKey(text: string): string {
  return hash('fix:' + text)
}

/** Whether a typed message is in the learned language and long enough to correct. */
export function isFixable(text: string, pair: Pair): boolean {
  return languageOf(text, pair) === 'learning'
}

/** One drawn line of a prose chunk: what leads it (a bullet, a number, a quote bar) and its text. */
export type Line = { lead: string; text: string; isHeading: boolean; isGap: boolean }

/** A prose chunk as lines: a paragraph's lines joined, each list item, heading or quote on its own. */
export function linesOf(src: string): Line[] {
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
export type Piece = { text: string; kind: 'plain' | 'bold' | 'italic' | 'code' | 'link' }

export function piecesOf(text: string): Piece[] {
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
export function widthOf(text: string): number {
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
/** The marks a row does not start with: each stays with the character before it. */
const CLOSING = '、。，．！？：；）」』】〉》'

/**
 * The parts of a word a row may end after. A word in a spaced language is one part. A language
 * written without spaces can end a row after any character, so each wide character is a part; and
 * a word wider than the row, which fits nowhere, is cut to the row.
 */
function partsOf(word: string, max: number): string[] {
  const parts: string[] = []
  /** A run of narrow characters: one part, or cut to the row when it is wider than one. */
  const push = (run: string): void => {
    if (run === '') return
    if (widthOf(run) <= max) {
      parts.push(run)
      return
    }
    let cut = ''
    for (const ch of run) {
      if (widthOf(cut) + widthOf(ch) > max) {
        parts.push(cut)
        cut = ''
      }
      cut += ch
    }
    parts.push(cut)
  }
  let run = ''
  for (const ch of word) {
    if (widthOf(ch) < 2) {
      run += ch
      continue
    }
    push(run)
    run = ''
    if (CLOSING.includes(ch) && parts.length > 0) parts[parts.length - 1] += ch
    else parts.push(ch)
  }
  push(run)
  return parts
}

export function wrap(pieces: readonly Piece[], max: number): Piece[][] {
  const rows: Piece[][] = [[]]
  let used = 0
  for (const piece of pieces) {
    for (const word of piece.text.split(/(\s+)/)) {
      if (word === '') continue
      const isSpace = /^\s+$/.test(word)
      for (const token of isSpace ? [word] : partsOf(word, max)) {
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
  }
  return rows.filter(row => row.length > 0)
}
