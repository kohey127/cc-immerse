// The plugin's text logic: which language a text is in, how a reply is cut into chunks, how a chunk is
// laid out in rows. Pure functions: no `$`, nothing drawn, so they are tested by themselves (tests/text.test.ts).

/** `isProse`: English worth a translation. `isTable`: that English is a Markdown table, translated and drawn as one. */
export type Chunk = { src: string; isProse: boolean; isTable: boolean }

export function isTable(src: string): boolean {
  return /^\s*\|.*\|\s*$/m.test(src)
}

export function hash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + text.length.toString(36)
}

/** English prose worth a translation: not code, not a table, not already Japanese. */
export function isProse(src: string): boolean {
  if (/^\s*(```|~~~)/.test(src) || /^\s*([-*_]\s*){3,}$/.test(src)) return false
  const plain = src.replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '')
  const latin = (plain.match(/[A-Za-z]/g) ?? []).length
  const cjk = (plain.match(/[぀-ヿ一-鿿]/g) ?? []).length
  return latin >= 4 && cjk < latin * 0.2
}

/** Blocks separated by blank lines; a fenced block stays whole, a heading joins the block after it. */
export function split(text: string): Chunk[] {
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

/** Which language a typed message is in: the native one (or a mix: both are sent in English), the learned one, or neither. */
export function languageOf(text: string): 'native' | 'learning' | 'other' {
  const t = text.trim()
  if (t === '' || t.startsWith('/') || t.length > 2000) return 'other'
  const plain = t.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '').replace(/https?:\/\/\S+/g, '')
  const cjk = (plain.match(/[\u3040-\u30ff\u4e00-\u9fff]/g) ?? []).length
  if (cjk >= 2) return 'native'
  return isFixable(t) ? 'learning' : 'other'
}

/** The key a correction of `text` is kept under: apart from its translation. */
export function fixKey(text: string): string {
  return hash('fix:' + text)
}

/** Whether a typed message is English prose worth a correction: not a command, not mostly Japanese, not huge. */
export function isFixable(text: string): boolean {
  const t = text.trim()
  // A draft of a word or two is not judged: at least twelve letters.
  const letters = (t.replace(/`[^`]*`/g, '').match(/[A-Za-z]/g) ?? []).length
  return letters >= 12 && t.length <= 1500 && !t.startsWith('/') && isProse(t)
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
export function wrap(pieces: readonly Piece[], max: number): Piece[][] {
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
