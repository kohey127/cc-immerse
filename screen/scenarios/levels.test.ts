// Recording 5 of the README: the same reply at each reading level, from the native language in front
// (level 1) to the learned one in front (level 4).

import { expect, setDefaultTimeout, test } from 'bun:test'

import { open } from '../term'
import type { Session } from '../term'

const PARAGRAPH = 'The build passed on the main branch, and every check ran in under a minute.'
const LIST = '- The unit tests took 12 seconds.\n- The screen checks took 45 seconds.'
const PARAGRAPH_JA = 'main ブランチでビルドが通り、すべてのチェックが1分以内に終わりました。'
const LIST_JA = '- 単体テストは12秒かかりました。\n- 画面チェックは45秒かかりました。'
const ASKED = 'What is the build status?'

setDefaultTimeout(90000)

function at(level: string, cols = 120): Promise<Session> {
  return open({
    cols,
    options: { readingLevel: level },
    record: `level-${level}`,
    script: { replies: [`${PARAGRAPH}\n\n${LIST}`], small: { translate: { [PARAGRAPH]: PARAGRAPH_JA, [LIST]: LIST_JA }, fix: { [ASKED]: 'OK' } }, smallDelayMs: 300 },
  })
}

/** The colours of the cells of `text` on its row. */
async function coloursOf(s: Session, text: string): Promise<string[]> {
  const row = await s.rowOf(text)
  const line = (await s.screen())[row] ?? ''
  const from = [...line.slice(0, line.indexOf(text))].reduce((w, ch) => w + (/[　-鿿＀-￯]/.test(ch) ? 2 : 1), 0)
  const cells = (await s.cells(row)).filter(cell => cell.x >= from && cell.x < from + 8)
  return [...new Set(cells.map(cell => String(cell.fg)))]
}

test('level 1: the reply is read in the native language; the learned one is behind the mark, faint', async () => {
  const s = await at('1')
  try {
    await s.ask(ASKED, 'FIX ▸')
    await s.waitFor('main ブランチでビルドが通り')
    await s.waitFor('単体テストは12秒')
    expect(await s.rowOf('The build passed')).toBe(-1)
    expect(await coloursOf(s, 'main ブランチ')).toEqual(['default'])
    await s.shot('level-1')
    const row = await s.rowOf('main ブランチ')
    await s.move(row, 10)
    expect((await s.screen())[row]?.startsWith('▸')).toBe(true)
    await s.click(row, 0)
    await s.waitFor('The build passed')
    expect(await s.rowOf('The build passed')).toBe(row + 1)
    expect(await coloursOf(s, 'The build passed')).not.toEqual(['default'])
    expect(await s.rowOf('ALL EN OPEN')).toBeGreaterThan(row)
    await s.shot('level-1-open')
    expect(s.model.unscripted).toEqual([])
  } finally {
    await s.close()
  }
})

test('level 2: two columns, the native language on the left at full strength, the learned one on the right, faint', async () => {
  const s = await at('2')
  try {
    await s.ask(ASKED, 'FIX ▸')
    await s.waitFor('main ブランチでビルドが通り')
    await s.waitFor('単体テストは12秒')
    const screen = await s.screen()
    const row = await s.rowOf('main ブランチ')
    expect(row).toBe(await s.rowOf('The build passed'))
    expect((screen[row] ?? '').indexOf('main ブランチ')).toBeLessThan((screen[row] ?? '').indexOf('The build passed'))
    expect(await coloursOf(s, 'main ブランチ')).toEqual(['default'])
    expect(await coloursOf(s, 'The build passed')).not.toEqual(['default'])
    await s.shot('level-2')
    expect(s.model.unscripted).toEqual([])
  } finally {
    await s.close()
  }
})

test('level 3: two columns, the learned language on the left at full strength, the native one on the right, faint', async () => {
  const s = await at('3')
  try {
    await s.ask(ASKED, 'FIX ▸')
    await s.waitFor('main ブランチでビルドが通り')
    await s.waitFor('単体テストは12秒')
    const screen = await s.screen()
    const row = await s.rowOf('The build passed')
    expect(row).toBe(await s.rowOf('main ブランチ'))
    expect((screen[row] ?? '').indexOf('The build passed')).toBeLessThan((screen[row] ?? '').indexOf('main ブランチ'))
    expect(await coloursOf(s, 'The build passed')).toEqual(['default'])
    expect(await coloursOf(s, 'main ブランチ')).not.toEqual(['default'])
    await s.shot('level-3')
    expect(s.model.unscripted).toEqual([])
  } finally {
    await s.close()
  }
})

test('levels 2 and 3 in a narrow window: the second language goes below the first', async () => {
  const s = await at('2', 70)
  try {
    await s.ask(ASKED, 'FIX ▸')
    await s.waitFor('main ブランチでビルドが通り')
    await s.waitFor('単体テストは12秒')
    expect(await s.rowOf('The build passed')).toBeGreaterThan(await s.rowOf('main ブランチ'))
    await s.shot('level-2-narrow')
  } finally {
    await s.close()
  }
})

test('level 4: the reply is read in the learned language, with nothing else drawn until the mark is pressed', async () => {
  const s = await at('4')
  try {
    await s.ask(ASKED, 'FIX ▸')
    expect(await s.rowOf('The build passed')).toBeGreaterThanOrEqual(0)
    expect(await s.rowOf('main ブランチ')).toBe(-1)
    expect(s.model.calls.filter(call => call.kind === 'translate')).toEqual([])
    await s.shot('level-4')
  } finally {
    await s.close()
  }
})
