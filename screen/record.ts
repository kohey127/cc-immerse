// Records the pictures the README shows, from a real screen with the stand-in model, so they can be made
// again whenever the display changes: bun screen/record.ts, then the files are in assets/.
// The scenes are a person at work, not a programmer: the README is for anyone who uses Claude Code.

import { join, resolve } from 'node:path'

import type { Script } from './model'
import { OUT, open } from './term'
import type { Session } from './term'

const ASSETS = resolve(import.meta.dir, '..', 'assets')
const ASKED = '来週の会議の議題を提案して'
const ASKED_EN = "Suggest agenda items for next week's meeting."
// The reply: two paragraphs of about three rows each and a table, so that a picture shows the blocks a
// real answer is made of, each opened on its own.
const EN = [
  'For next week I suggest three items. They are ordered so that the decisions that block other teams come first, and the status reports that can also be read later come last.',
  'If time runs short, move the hiring update to an email. The launch date cannot wait, because the print order for the leaflets has to be placed by Friday.',
] as const
const JA = [
  '来週は3つの議題を提案します。他チームの作業を止めている決定事項を先に、あとで読めば済む状況報告を最後に並べています。',
  '時間が足りなければ、採用状況の報告はメールに回してください。発売日は先送りできません。チラシの印刷発注を金曜までに出す必要があるからです。',
] as const
const TABLE_EN = '| Item | Owner | Time |\n| --- | --- | --- |\n| Decide the launch date | Sato | 20 min |\n| Review the sales numbers | Tanaka | 15 min |\n| Hiring update | Suzuki | 10 min |'
const TABLE_JA = '| 議題 | 担当 | 時間 |\n| --- | --- | --- |\n| 発売日の決定 | 佐藤 | 20分 |\n| 売上の確認 | 田中 | 15分 |\n| 採用状況の報告 | 鈴木 | 10分 |'
const REPLY_EN = [EN[0], TABLE_EN, EN[1]].join('\n\n')
const REPLY_JA = [JA[0], TABLE_JA, JA[1]].join('\n\n')
const WRONG = 'I has a question about the budget.'
const RIGHT = 'I have a question about the budget.'

const learned: Script = { replies: [REPLY_EN, 'Sure. What would you like to know?'], small: { toTarget: { [ASKED]: ASKED_EN }, translate: { [EN[0]]: JA[0], [EN[1]]: JA[1] }, table: { [TABLE_EN]: TABLE_JA }, fix: { [WRONG]: `${RIGHT}\n---\n- has → have: 主語が I のとき` } }, smallDelayMs: 500 }
const corrected: Script = { replies: ['Sure. What would you like to know?'], small: learned.small, smallDelayMs: 500 }
const native: Script = { replies: [REPLY_JA], small: { toTarget: { [ASKED]: ASKED_EN }, translateBack: { [JA[0]]: EN[0], [JA[1]]: EN[1] }, tableBack: { [TABLE_JA]: TABLE_EN } }, smallDelayMs: 500 }

const SIZE = { cols: 84, rows: 30 }
const pause = (ms: number): Promise<void> => Bun.sleep(ms)
/** Types as a person does, so that a recording shows the line above the prompt arriving. */
async function slowly(s: Session, text: string): Promise<void> {
  for (const ch of text) {
    await s.type(ch)
    await pause(70)
  }
}
/** Where the pointer is at a moment of a recording: seconds from its start, and the cell it points at. */
type Point = { at: number; row: number; col: number }

/** A value over time that goes from one point's to the next in the 0.6 s before the next is reached, as ffmpeg reads it. */
function path(points: readonly Point[], of: (p: Point) => number, enter: number): string {
  let expr = String(of(points[0] as Point) + enter)
  points.forEach((p, i) => {
    const before = i === 0 ? of(p) + enter : of(points[i - 1] as Point)
    const start = (p.at - 0.6).toFixed(2)
    expr = `if(gte(t,${p.at.toFixed(2)}),${of(p)},if(gte(t,${start}),${before}+(${of(p)}-${before})*(t-${start})/0.6,${expr}))`
  })
  return expr
}

/**
 * Cuts a picture or a recording down to rows `from` to `to` of the terminal, without the window around it:
 * what is left is what the plugin does, and nothing a reader has to work out is not part of it.
 * The terminal draws a cell 21 points high and 113/11 wide under 64 points of title bar, inside a 24 point
 * margin; a recording is drawn at twice that. A terminal does not draw the pointer, so a recording in which
 * something is clicked has one drawn on it: without it a block seems to open by itself.
 */
function cut(name: string, from: number, to: number, pointer: readonly Point[] = []): void {
  const isGif = name.endsWith('.gif')
  const k = isGif ? 2 : 1
  const crop = `crop=iw-${48 * k}:${(21 * (to - from + 1) + 10) * k}:${24 * k}:${(64 + 21 * from - 8) * k}`
  const x = (p: Point): number => Math.round(((p.col + 0.5) * 113) / 11) * k
  const y = (p: Point): number => (21 * (p.row - from) + 8 + 10) * k
  const first = pointer[0]
  const drawn = first ? `[0]${crop}[cut];[cut][1]overlay=x='${path(pointer, x, 240)}':y='${path(pointer, y, 160)}':enable='gte(t,${(first.at - 0.6).toFixed(2)})'` : `[0]${crop}`
  const filter = isGif ? `${drawn},split[a][b];[a]palettegen[p];[b][p]paletteuse` : drawn
  const made = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-i', join(OUT, name), ...(first ? ['-i', join(import.meta.dir, 'pointer.png')] : []), '-filter_complex', filter, join(ASSETS, name)])
  if (made.exitCode !== 0) throw new Error(`ffmpeg could not cut ${name}: ${made.stderr.toString()}`)
}
/** The row of the rule under the prompt box: the last thing of a session a picture keeps. */
async function boxEnd(s: Session): Promise<number> {
  return (await s.screen()).findLastIndex(line => /^─{10,}/.test(line))
}
/** The row a sent message stands on: the first thing of a session a picture keeps. */
async function sentRow(s: Session, text: string): Promise<number> {
  const row = (await s.screen()).findIndex(line => line.startsWith('❯') && line.includes(text))
  if (row < 0) throw new Error(`the message was not on the screen: ${text}`)
  return row
}
/** `bun record.ts settings` makes that one only. */
const only = process.argv[2]
const wants = (name: string): boolean => !only || only === name

// 1. The whole idea in one take: ask in Japanese, read the answer in English, open the Japanese for one block.
if (wants('hero')) {
  const s = await open({ ...SIZE, rows: 54, record: 'hero', script: learned })
  const began = Date.now()
  const pointer: Point[] = []
  /** Moves the pointer onto a block, then onto its mark, and clicks it. */
  const clickMark = async (row: number): Promise<void> => {
    await s.move(row, 12)
    pointer.push({ at: (Date.now() - began) / 1000, row, col: 12 })
    await pause(1100)
    await s.move(row, 0)
    pointer.push({ at: (Date.now() - began) / 1000 + 0.5, row, col: 0 })
    await pause(900)
    await s.click(row, 0)
  }
  await pause(600)
  await slowly(s, ASKED)
  await s.waitFor(`EN ▸ ${ASKED_EN}`)
  await pause(1400)
  await s.press('Enter')
  await s.waitFor(/^✻ .+ for \d+/)
  const from = await sentRow(s, ASKED)
  await pause(1500)
  const paragraph = await s.rowOf('come last.')
  await clickMark(paragraph)
  await s.waitFor('状況報告を最後に')
  await pause(2000)
  const table = (await s.rowOf('Hiring update')) + 1
  await clickMark(table)
  await s.waitFor('採用状況の報告')
  await pause(3000)
  const to = await boxEnd(s)
  await s.close()
  cut('hero.gif', from, to, pointer)
}

// 2. Typing: Japanese gets its English, English gets its correction, with nothing to choose.
if (wants('typing')) {
  const s = await open({ ...SIZE, rows: 24, record: 'typing', script: corrected })
  await pause(600)
  await slowly(s, ASKED)
  await s.waitFor(`EN ▸ ${ASKED_EN}`)
  await pause(1800)
  await s.press('Ctrl+U')
  await pause(700)
  await slowly(s, WRONG)
  await s.waitFor(`FIX ▸ ${RIGHT}`)
  await pause(1800)
  await s.press('Enter')
  await s.waitFor(`↳ ${RIGHT}`)
  const from = await sentRow(s, WRONG)
  await pause(2600)
  const to = await boxEnd(s)
  await s.close()
  cut('typing.gif', from, to)
}

// 3. The four levels, the same question at each: stills, so that they can be compared. The window is tall
// enough for the whole exchange, and the picture is cut from the question to the last row of the reply.
for (const n of wants('levels') ? ['1', '2', '3', '4'] : []) {
  const s = await open({ cols: 110, rows: 70, options: { readingLevel: n }, script: n === '1' || n === '2' ? native : learned })
  await s.type(ASKED)
  await s.waitFor(`EN ▸ ${ASKED_EN}`)
  await s.press('Enter')
  await s.waitFor(/^✻ .+ for \d+/)
  if (n === '2') await s.waitFor('Hiring update')
  if (n === '3') await s.waitFor('採用状況の報告')
  await pause(800)
  const from = await sentRow(s, ASKED)
  // The line Claude Code draws under a finished turn is not the plugin's: the picture ends two rows above it.
  const done = (await s.screen()).findIndex(line => /^✻ .+ for \d+/.test(line))
  await s.shot(`level-${n}`)
  await s.close()
  cut(`level-${n}.png`, from, done - 2)
}

// 4. The settings: one list, the arrows, and a preview that follows.
if (wants('settings')) {
  const s = await open({ cols: 96, rows: 50, record: 'settings', script: learned })
  await pause(600)
  await slowly(s, '/immerse')
  await pause(500)
  await s.press('Enter')
  await s.waitFor('type to close')
  await pause(1800)
  await s.press('Enter')
  await pause(1600)
  // The list of levels is the tallest thing shown: the picture starts at its first row.
  const from = await s.rowOf('Immerse settings ›')
  for (let i = 0; i < 3; i++) {
    await s.press('Up')
    await pause(1500)
  }
  await s.press('Down')
  await pause(1300)
  await s.press('Enter')
  await pause(3000)
  const to = await boxEnd(s)
  await s.close()
  cut('settings.gif', from, to)
}
