// Recording 2 of the README: ALL JA OPEN and ALL JA CLOSE on a reply with a paragraph, a list and a
// table.
//
// It also holds two things about tables: the author once saw one stuck on "translating", and the
// mark's place beside a table's last line had never been seen on a screen.

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test'

import { open } from '../term'
import type { Session } from '../term'

const PARAGRAPH = 'The build passed on the main branch.'
const LIST = '- The unit tests took 12 seconds.\n- The screen checks took 6 seconds.'
const TABLE = '| Check | Result |\n| --- | --- |\n| Unit tests | Passed |\n| Screen checks | Passed |'
const PARAGRAPH_JA = 'main ブランチでビルドが通りました。'
const LIST_JA = '- 単体テストは12秒かかりました。\n- 画面チェックは6秒かかりました。'
const TABLE_JA = '| チェック | 結果 |\n| --- | --- |\n| 単体テスト | 成功 |\n| 画面チェック | 成功 |'
const ASKED = 'What is the build status?'

let s: Session

setDefaultTimeout(90000)

beforeAll(async () => {
  s = await open({
    cols: 100,
    rows: 44,
    record: 'list-table',
    script: {
      replies: [`${PARAGRAPH}\n\n${LIST}\n\n${TABLE}`],
      small: { translate: { [PARAGRAPH]: PARAGRAPH_JA, [LIST]: LIST_JA }, table: { [TABLE]: TABLE_JA }, fix: { [ASKED]: 'OK' } },
      smallDelayMs: 400,
    },
  })
  await s.ask(ASKED, 'FIX ▸')
})

afterAll(() => s?.close())

test('with the pointer on a table, the mark is beside its last line', async () => {
  await s.move(await s.rowOf('Unit tests'), 8)
  const marked = (await s.screen()).filter(line => line.startsWith('▸'))
  expect(marked).toHaveLength(1)
  expect(marked[0]).toContain('└')
  // The pointer leaves the reply, so the next test starts with no block under it.
  await s.move(0, 0)
})

test('ALL JA OPEN opens every block, each translation under its own block', async () => {
  await s.click(await s.rowOf('ALL JA OPEN'), 6)
  await s.waitFor('単体テストは12秒')
  await s.waitFor('│ 単体テスト')
  await s.waitFor(PARAGRAPH_JA)
  const order: number[] = []
  for (const text of [PARAGRAPH, PARAGRAPH_JA, 'The unit tests took', '単体テストは12秒', '│ Unit tests', '│ 単体テスト', 'ALL JA CLOSE']) order.push(await s.rowOf(text))
  expect(order.every(row => row >= 0)).toBe(true)
  expect(order).toEqual([...order].sort((a, b) => a - b))
  expect(await s.rowOf(PARAGRAPH_JA)).toBe((await s.rowOf(PARAGRAPH)) + 1)
  await s.shot('list-table-open')
})

/** Whether every Japanese character on the row holding `text` is drawn italic. */
async function isItalic(text: string): Promise<boolean> {
  const cells = (await s.cells(await s.rowOf(text))).filter(cell => /[ぁ-んァ-ヶ一-龠]/.test(cell.char))
  return cells.length > 0 && cells.every(cell => cell.italic)
}

test('a paragraph and a list opened this way are italic, as one opened by its mark is', async () => {
  expect(await isItalic(PARAGRAPH_JA)).toBe(true)
  expect(await isItalic('単体テストは12秒')).toBe(true)
})

/** The colours of the cells that hold something on the row holding `text`. */
async function coloursOf(text: string): Promise<string[]> {
  return [...new Set((await s.cells(await s.rowOf(text))).filter(cell => cell.x >= 2).map(cell => String(cell.fg)))]
}

// Seen on the first run of these checks: a translated table was drawn in the reply's own colour, while
// every other translation was grey. The author ruled that every translation is grey.
test('regression: a translated table is grey like every other translation, borders included', async () => {
  const grey = await coloursOf(PARAGRAPH_JA)
  expect(grey).toHaveLength(1)
  expect(grey).not.toEqual(await coloursOf(PARAGRAPH))
  for (const text of ['結果 │', '│ 単体テスト', '│ 画面チェック']) expect({ text, colours: await coloursOf(text) }).toEqual({ text, colours: grey })
})

test('regression: no block is left waiting for its translation', async () => {
  const from = await s.rowOf(PARAGRAPH)
  const to = await s.rowOf('ALL JA CLOSE')
  expect((await s.screen()).slice(from, to).filter(line => line.trim() === '…')).toEqual([])
  expect(s.model.calls.filter(call => call.kind === 'table')).toHaveLength(1)
})

test('ALL JA CLOSE closes every block', async () => {
  const row = await s.rowOf('ALL JA CLOSE')
  await s.click(row, ((await s.screen())[row] ?? '').indexOf('ALL JA CLOSE') + 2)
  await s.waitGone(PARAGRAPH_JA)
  await s.waitGone('単体テスト')
  expect(await s.rowOf('ALL JA CLOSE')).toBe(-1)
  expect(s.model.unscripted).toEqual([])
})
