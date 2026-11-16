// regression: text was cut at the right edge. The author saw it; a wide window hid it. A long
// paragraph and its long translation are read back whole at three widths.

import { expect, setDefaultTimeout, test } from 'bun:test'

import { open } from '../term'

const PARAGRAPH =
  'The wrapping code now measures every character by the columns it takes on the screen, so a line that mixes English words with Japanese ones is broken at the right place and nothing is lost beyond the right edge of the window, however narrow that window is.'
const PARAGRAPH_JA =
  '折り返しのコードは、すべての文字を画面上で占める桁数で測るようになりました。そのため、英語と日本語が混ざった行も正しい位置で折り返され、ウィンドウがどれだけ狭くても右端の先で文字が失われることはありません。'
const ASKED = 'What changed in the wrapping code?'

setDefaultTimeout(90000)

/** The rows from the one holding `first` to the one holding `last`, without the gutter and the space wrapping left. */
function rowsBetween(screen: string[], first: string, last: string): string[] {
  const from = screen.findIndex(line => line.includes(first))
  const to = screen.findIndex((line, i) => i >= from && line.includes(last))
  return from < 0 || to < 0 ? [] : screen.slice(from, to + 1).map(line => line.slice(2).trim())
}

for (const cols of [60, 80, 120]) {
  test(`at ${cols} columns a long paragraph and its translation are drawn whole`, async () => {
    const s = await open({ cols, rows: 40, script: { replies: [PARAGRAPH], small: { translate: { [PARAGRAPH]: PARAGRAPH_JA }, fix: { [ASKED]: 'OK' } } } })
    try {
      await s.ask(ASKED, 'FIX ▸')
      await s.click(await s.rowOf('that window is.'), 0)
      await s.waitFor('ありません。')
      const screen = await s.screen()
      expect(rowsBetween(screen, 'The wrapping code now', 'that window is.').join(' ')).toBe(PARAGRAPH)
      expect(rowsBetween(screen, '折り返しのコードは', 'ありません。').join('')).toBe(PARAGRAPH_JA)
      expect(s.model.unscripted).toEqual([])
      await s.shot(`width-${cols}`)
    } finally {
      await s.close()
    }
  })
}
