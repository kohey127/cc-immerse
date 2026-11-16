// Recording 1 of the README: the pointer moves onto a paragraph, the mark appears, a click opens the
// translation under the block, a second click closes it.
//
// It also holds two things the author once caught by eye: the mark vanished before the pointer
// reached it, and the mark sat on the first line of a block (it belongs beside the last).

import { afterAll, beforeAll, expect, setDefaultTimeout, test } from 'bun:test'

import { open } from '../term'
import type { Session } from '../term'

const FIRST = 'The build passed on the main branch.'
const SECOND =
  'Two tests are still slow, and I have not looked at them yet, because the first thing to settle was whether the build itself was green after the change to the wrapping code.'
const FIRST_JA = 'main ブランチでビルドが通りました。'
const SECOND_JA = 'テストが2つまだ遅いままです。'
const ASKED = 'What is the build status?'

let s: Session

setDefaultTimeout(90000)

beforeAll(async () => {
  s = await open({
    cols: 100,
    record: 'open-close',
    script: {
      replies: [`${FIRST}\n\n${SECOND}`],
      small: { translate: { [FIRST]: FIRST_JA, [SECOND]: SECOND_JA }, fix: { [ASKED]: 'OK' } },
      smallDelayMs: 300,
    },
  })
  await s.ask(ASKED, 'FIX ▸')
})

afterAll(() => s?.close())

/** The rows of the second paragraph: it is long enough to wrap at 100 columns. */
async function secondBlock(): Promise<{ first: number; last: number }> {
  return { first: await s.rowOf('Two tests are still slow'), last: await s.rowOf('wrapping code.') }
}

test('at rest no mark is drawn', async () => {
  const { first, last } = await secondBlock()
  expect(last).toBeGreaterThan(first)
  for (const line of (await s.screen()).slice(first, last + 1)) expect(line.startsWith('▸')).toBe(false)
})

test('with the pointer on a block, the mark is beside its last line and nowhere else', async () => {
  const { first, last } = await secondBlock()
  await s.move(first, 12)
  const screen = await s.screen()
  expect(screen[last]?.startsWith('▸')).toBe(true)
  expect(screen.filter(line => line.startsWith('▸'))).toHaveLength(1)
})

test('regression: the mark stays while the pointer travels from the text to it', async () => {
  const { first, last } = await secondBlock()
  await s.move(first, 12)
  await s.move(last, 12)
  for (let col = 11; col >= 0; col--) {
    await s.move(last, col)
    expect((await s.screen())[last]?.startsWith('▸')).toBe(true)
  }
})

test('a click on the mark opens the translation under the block', async () => {
  const { last } = await secondBlock()
  await s.click(last, 0)
  await s.waitFor(SECOND_JA)
  expect((await s.screen())[last]?.startsWith('▾')).toBe(true)
  expect(await s.rowOf(SECOND_JA)).toBe(last + 1)
  expect(await s.rowOf(FIRST_JA)).toBe(-1)
  await s.shot('open-close-open')
})

test('the translation is drawn faint and italic, the reply plain', async () => {
  const { last } = await secondBlock()
  const reply = (await s.cells(last)).filter(cell => cell.x >= 2)
  const translation = await s.cells(last + 1)
  expect(translation.length).toBeGreaterThan(0)
  expect(translation.every(cell => cell.italic)).toBe(true)
  expect(reply.some(cell => cell.italic)).toBe(false)
  expect(new Set(translation.map(cell => cell.fg)).size).toBe(1)
  expect(translation[0]?.fg).not.toBe(reply[0]?.fg)
})

test('a second click closes it', async () => {
  const { last } = await secondBlock()
  await s.click(last, 0)
  await s.waitGone(SECOND_JA)
  expect(s.model.unscripted).toEqual([])
})
