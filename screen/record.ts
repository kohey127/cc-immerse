// Records the pictures the READMEs show, from a real screen with the stand-in model, so they can be made
// again whenever the display changes. `bun screen/record.ts` makes every set; a set's name after it
// (`ja-en`, `zh-en`, `en-es`) makes that one, and a scene's name after that (`hero`, `typing`, `levels`, `settings`)
// makes that scene only. The files are in assets/<set>/.
// A set is one reader: the README in a language shows a speaker of it learning another. The scenes are a
// person at work, not a programmer: the README is for anyone who uses Claude Code.

import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { pairOf } from '../plugin/hooks/lang'
import type { Script } from './model'
import { OUT, open } from './term'
import type { Session } from './term'

const ASSETS = resolve(import.meta.dir, '..', 'assets')

/** The words of one set. `native`: the reader's language; `target`: the one being learned. */
type Words = {
  name: string
  native: string
  target: string
  /** The learned language's tag, as the line above the prompt box shows it. */
  tag: string
  /** A question in the native language, and in the learned one. */
  asked: string
  askedT: string
  /** The reply in the learned language and in the native one: two paragraphs of about three rows each and a
   * table between them, so that a picture shows the blocks a real answer is made of, each opened on its own. */
  replyT: readonly [string, string]
  tableT: string
  replyN: readonly [string, string]
  tableN: string
  /** A cell of each table, to wait for. */
  cellT: string
  cellN: string
  /** A sentence in the learned language with a mistake, as corrected, and the note in the native language. */
  wrong: string
  right: string
  note: string
  /** A short reply in the learned language. */
  short: string
}

const table = (rows: readonly (readonly [string, string, string])[]): string => rows.map((row, i) => `| ${row.join(' | ')} |${i === 0 ? '\n| --- | --- | --- |' : ''}`).join('\n')

const EN_REPLY = [
  'For next week I suggest three items. They are ordered so that the decisions that block other teams come first, and the status reports that can also be read later come last.',
  'If time runs short, move the hiring update to an email. The launch date cannot wait, because the print order for the leaflets has to be placed by Friday.',
] as const

const SETS: readonly Words[] = [
  {
    name: 'ja-en',
    native: 'Japanese',
    target: 'English',
    tag: 'EN',
    asked: '来週の会議の議題を提案して',
    askedT: "Suggest agenda items for next week's meeting.",
    replyT: EN_REPLY,
    tableT: table([['Item', 'Owner', 'Time'], ['Decide the launch date', 'Sato', '20 min'], ['Review the sales numbers', 'Tanaka', '15 min'], ['Hiring update', 'Suzuki', '10 min']]),
    replyN: [
      '来週は3つの議題を提案します。他チームの作業を止めている決定事項を先に、あとで読めば済む状況報告を最後に並べています。',
      '時間が足りなければ、採用状況の報告はメールに回してください。発売日は先送りできません。チラシの印刷発注を金曜までに出す必要があるからです。',
    ],
    tableN: table([['議題', '担当', '時間'], ['発売日の決定', '佐藤', '20分'], ['売上の確認', '田中', '15分'], ['採用状況の報告', '鈴木', '10分']]),
    cellT: 'Hiring update',
    cellN: '採用状況の報告',
    wrong: 'I has a question about the budget.',
    right: 'I have a question about the budget.',
    note: 'has → have: 主語が I のとき',
    short: 'Sure. What would you like to know?',
  },
  {
    name: 'zh-en',
    native: 'Chinese (Simplified)',
    target: 'English',
    tag: 'EN',
    asked: '请为下周的会议提几个议题',
    askedT: "Suggest agenda items for next week's meeting.",
    replyT: EN_REPLY,
    tableT: table([['Item', 'Owner', 'Time'], ['Decide the launch date', 'Wang', '20 min'], ['Review the sales numbers', 'Li', '15 min'], ['Hiring update', 'Zhang', '10 min']]),
    replyN: [
      '下周我建议讨论三个议题。排序的原则是：会卡住其他团队工作的决定放在前面，之后再看也来得及的进度汇报放在最后。',
      '如果时间不够，招聘进展可以改用邮件通知。发布日期不能再拖，因为宣传单的印刷订单必须在周五之前下单。',
    ],
    tableN: table([['议题', '负责人', '时间'], ['确定发布日期', '王', '20分钟'], ['查看销售数据', '李', '15分钟'], ['招聘进展', '张', '10分钟']]),
    cellT: 'Hiring update',
    cellN: '招聘进展',
    wrong: 'I has a question about the budget.',
    right: 'I have a question about the budget.',
    note: 'has → have：主语是 I 时用 have',
    short: 'Sure. What would you like to know?',
  },
  {
    name: 'en-es',
    native: 'English',
    target: 'Spanish',
    tag: 'ES',
    asked: "Suggest agenda items for next week's meeting.",
    askedT: 'Sugiere temas para la reunión de la próxima semana.',
    replyT: [
      'Para la próxima semana propongo tres temas. Están ordenados para que las decisiones que bloquean a otros equipos vayan primero y los informes de estado, que también se pueden leer después, vayan al final.',
      'Si falta tiempo, pasa la actualización de contratación a un correo. La fecha de lanzamiento no puede esperar, porque el pedido de impresión de los folletos debe hacerse antes del viernes.',
    ],
    tableT: table([['Tema', 'Responsable', 'Tiempo'], ['Decidir la fecha de lanzamiento', 'Ana', '20 min'], ['Revisar las cifras de ventas', 'Ben', '15 min'], ['Actualización de contratación', 'Chris', '10 min']]),
    replyN: EN_REPLY,
    tableN: table([['Item', 'Owner', 'Time'], ['Decide the launch date', 'Ana', '20 min'], ['Review the sales numbers', 'Ben', '15 min'], ['Hiring update', 'Chris', '10 min']]),
    cellT: 'Actualización de contratación',
    cellN: 'Hiring update',
    wrong: 'Yo tener una pregunta sobre el presupuesto.',
    right: 'Tengo una pregunta sobre el presupuesto.',
    note: 'tener → tengo: the form the verb takes with "yo"',
    short: 'Claro. ¿Qué quieres saber?',
  },
]

const SIZE = { cols: 84, rows: 30 }
const pause = (ms: number): Promise<void> => Bun.sleep(ms)
/** Types as a person does, so that a recording shows the line above the prompt arriving. */
async function slowly(s: Session, text: string): Promise<void> {
  for (const ch of text) {
    await s.type(ch)
    await pause(70)
  }
}

/** The seconds a move of the pointer takes. */
const MOVE = 0.8

/** Where the pointer is at a moment of a recording: seconds from its start, and the cell it points at. */
type Point = { at: number; row: number; col: number }

/**
 * A value over time that goes from one point's to the next in the 0.8 s before the next is reached, as ffmpeg
 * reads it: slowly off, quickly across, slowly on, as a hand moves a pointer.
 */
function path(points: readonly Point[], of: (p: Point) => number, enter: number): string {
  let expr = String(of(points[0] as Point) + enter)
  points.forEach((p, i) => {
    const before = i === 0 ? of(p) + enter : of(points[i - 1] as Point)
    const start = (p.at - MOVE).toFixed(2)
    const u = `((t-${start})/${MOVE})`
    expr = `if(gte(t,${p.at.toFixed(2)}),${of(p)},if(gte(t,${start}),${before}+(${of(p)}-${before})*${u}*${u}*(3-2*${u}),${expr}))`
  })
  return expr
}

/**
 * Cuts a picture or a recording down to rows `from` to `to` of the terminal, without the window around it:
 * what is left is what the plugin does, and nothing a reader has to work out is not part of it.
 * The terminal draws a cell 21 points high and 10 wide, the first one 64 points down and 39 in; the cut
 * leaves 15 of those 39 as a margin; a recording is drawn at twice that. A terminal does not draw the pointer, so a recording in which
 * something is clicked has one drawn on it: without it a block seems to open by itself. A recording holds a
 * frame only where the screen changed, so it is first given 25 frames a second for the pointer to move in.
 */
function cut(name: string, from: number, to: number, pointer: readonly Point[] = []): void {
  const isGif = name.endsWith('.gif')
  const k = isGif ? 2 : 1
  const crop = `crop=iw-${48 * k}:${(21 * (to - from + 1) + 10) * k}:${24 * k}:${(64 + 21 * from - 8) * k}`
  const x = (p: Point): number => (15 + 10 * p.col + 5) * k
  const y = (p: Point): number => (21 * (p.row - from) + 8 + 10) * k
  const first = pointer[0]
  const drawn = first ? `[0]fps=25,${crop}[cut];[cut][1]overlay=x='${path(pointer, x, 240)}':y='${path(pointer, y, 160)}':enable='gte(t,${(first.at - MOVE).toFixed(2)})'` : `[0]${crop}`
  const filter = isGif ? `${drawn},split[a][b];[a]palettegen[p];[b][p]paletteuse` : drawn
  const made = Bun.spawnSync(['ffmpeg', '-v', 'error', '-y', '-i', join(OUT, name), ...(first ? ['-i', join(import.meta.dir, 'pointer.png')] : []), '-filter_complex', filter, join(ASSETS, set.name, name)])
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
/** `bun record.ts en-es settings`: that set, and that scene only. */
const [onlySet, onlyScene] = process.argv.slice(2)
const wants = (name: string): boolean => !onlyScene || onlyScene === name
/** The set being made: the helpers above write into its folder. */
let set = SETS[0] as Words

for (const words of SETS.filter(w => !onlySet || onlySet === w.name)) {
  set = words
  mkdirSync(join(ASSETS, set.name), { recursive: true })
  const w = words
  const pair = pairOf(w.native, w.target)
  const options = { nativeLanguage: w.native, targetLanguage: w.target }
  const fix = `${w.right}\n---\n- ${w.note}`
  // A pair that shares its letters asks the small model which language a message is in; one that does not
  // asks for the work at once. Both are scripted, so a set needs no thought about which it is.
  const typed = { toTarget: { [w.asked]: w.askedT }, fix: { [w.wrong]: fix }, judge: { [w.asked]: `N\n${w.askedT}`, [w.wrong]: `T\n${fix}` } }
  const replyT = [w.replyT[0], w.tableT, w.replyT[1]].join('\n\n')
  const replyN = [w.replyN[0], w.tableN, w.replyN[1]].join('\n\n')
  const learned: Script = { pair, replies: [replyT, w.short], small: { ...typed, translate: { [w.replyT[0]]: w.replyN[0], [w.replyT[1]]: w.replyN[1] }, table: { [w.tableT]: w.tableN } }, smallDelayMs: 500 }
  const corrected: Script = { pair, replies: [w.short], small: learned.small, smallDelayMs: 500 }
  const native: Script = { pair, replies: [replyN], small: { ...typed, translateBack: { [w.replyN[0]]: w.replyT[0], [w.replyN[1]]: w.replyT[1] }, tableBack: { [w.tableN]: w.tableT } }, smallDelayMs: 500 }
  const preview = `${w.tag} ▸ ${w.askedT}`

  // 1. The whole idea in one take: ask in the native language, read the answer in the learned one, open the
  // native one for a paragraph, then for the table.
  if (wants('hero')) {
    const s = await open({ ...SIZE, rows: 54, options, record: 'hero', script: learned })
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
    await slowly(s, w.asked)
    await s.waitFor(preview)
    await pause(1400)
    await s.press('Enter')
    await s.waitFor(/^✻ .+ for \d+/)
    const from = await sentRow(s, w.asked)
    await pause(1500)
    // A block's mark is beside its last line: the paragraph's is two rows above the table's first.
    await clickMark((await s.rowOf('┌')) - 2)
    await s.waitFor(w.replyN[0].slice(0, 8))
    await pause(2000)
    await clickMark(await s.rowOf('└'))
    await s.waitFor(w.cellN)
    await pause(3000)
    const to = await boxEnd(s)
    await s.close()
    cut('hero.gif', from, to, pointer)
  }

  // 2. Typing: the native language gets its version in the learned one, the learned one gets its correction,
  // with nothing to choose.
  if (wants('typing')) {
    const s = await open({ ...SIZE, rows: 24, options, record: 'typing', script: corrected })
    await pause(600)
    await slowly(s, w.asked)
    await s.waitFor(preview)
    await pause(1800)
    await s.press('Ctrl+U')
    await pause(700)
    await slowly(s, w.wrong)
    await s.waitFor(`FIX ▸ ${w.right}`)
    await pause(1800)
    await s.press('Enter')
    await s.waitFor(`↳ ${w.right}`)
    const from = await sentRow(s, w.wrong)
    await pause(2600)
    const to = await boxEnd(s)
    await s.close()
    cut('typing.gif', from, to)
  }

  // 3. The four levels, the same question at each: stills, so that they can be compared. The window is tall
  // enough for the whole exchange, and the picture is cut from the question to the last row of the reply.
  for (const n of wants('levels') ? ['1', '2', '3', '4'] : []) {
    const s = await open({ cols: 110, rows: 70, options: { ...options, readingLevel: n }, script: n === '1' || n === '2' ? native : learned })
    await s.type(w.asked)
    await s.waitFor(preview)
    await s.press('Enter')
    await s.waitFor(/^✻ .+ for \d+/)
    if (n === '2') await s.waitFor(w.cellT)
    if (n === '3') await s.waitFor(w.cellN)
    await pause(800)
    const from = await sentRow(s, w.asked)
    // The line Claude Code draws under a finished turn is not the plugin's: the picture ends two rows above it.
    const done = (await s.screen()).findIndex(line => /^✻ .+ for \d+/.test(line))
    await s.shot(`level-${n}`)
    await s.close()
    cut(`level-${n}.png`, from, done - 2)
  }

  // 4. The settings: one list, the arrows, and a preview that follows.
  if (wants('settings')) {
    const s = await open({ cols: 96, rows: 72, options, record: 'settings', script: learned })
    await pause(600)
    await slowly(s, '/immerse')
    await pause(500)
    await s.press('Enter')
    await s.waitFor('type to close')
    await pause(1800)
    await s.press('Enter')
    await pause(1600)
    // The list grows upwards with its preview: the picture starts at the highest row its header reaches.
    let from = await s.rowOf('Immerse settings')
    const look = async (ms: number): Promise<void> => {
      await pause(ms)
      from = Math.min(from, await s.rowOf('Immerse settings'))
    }
    for (let i = 0; i < 3; i++) {
      await s.press('Up')
      await look(1500)
    }
    await s.press('Down')
    await look(1300)
    await s.press('Enter')
    await look(3000)
    const to = await boxEnd(s)
    await s.close()
    cut('settings.gif', from, to)
  }
}
