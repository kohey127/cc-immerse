// Every row of the settings list, checked for what it does to a real screen and to what Claude gets.
// The reading levels are in levels.test.ts. Each session starts with the option stored as the list
// writes it; that the list writes it is in settings.test.ts.

import { expect, setDefaultTimeout, test } from 'bun:test'

import { pairOf } from '../../plugin/hooks/lang'
import type { Script } from '../model'
import { open } from '../term'
import type { Session } from '../term'

const FIRST = 'The build passed on the main branch.'
const LONG =
  'Two tests are still slow, and I have not looked at them yet, because the first thing to settle was whether the build itself was green after the change to the wrapping code.'
const FIRST_JA = 'main ブランチでビルドが通りました。'
const LONG_JA = 'テストが2つまだ遅いままです。'
const ASKED = 'What is the build status?'
const TYPED_JA = 'ビルドの状態を教えてください。'
const TYPED_EN = 'Tell me the status of the build.'
const WRONG = 'I has a question about build.'
const RIGHT = 'I have a question about the build.'

setDefaultTimeout(120000)

const SCRIPT: Script = {
  replies: [`${FIRST}\n\n${LONG}`],
  small: {
    translate: { [FIRST]: FIRST_JA, [LONG]: LONG_JA },
    fix: { [ASKED]: 'OK', [WRONG]: `${RIGHT}\n---\n- has → have` },
    toTarget: { [TYPED_JA]: TYPED_EN },
  },
}

/** A session with these options stored, run through `body`, and closed. */
async function withOptions(options: Record<string, string | boolean>, body: (s: Session) => Promise<void>, script: Script = SCRIPT): Promise<void> {
  const s = await open({ cols: 100, rows: 36, options, script })
  try {
    await body(s)
  } finally {
    await s.close()
  }
}

const starts = async (s: Session, text: string, mark: string): Promise<boolean> => ((await s.screen())[await s.rowOf(text)] ?? '').startsWith(mark)
const hasLine = async (s: Session, start: string): Promise<boolean> => (await s.screen()).some(line => line.startsWith(start))
const kinds = (s: Session): string[] => s.model.calls.map(call => call.kind)

// --- Reading ---------------------------------------------------------------------------------------

test('Reading Off: a reply is left as Claude wrote it: no mark, no buttons, no translation asked for', async () => {
  await withOptions({ readingLevel: 'Off' }, async s => {
    await s.ask(ASKED, 'FIX ▸')
    await s.move(await s.rowOf(FIRST), 12)
    expect(await starts(s, FIRST, '▸')).toBe(false)
    expect(await s.rowOf('ALL JA OPEN')).toBe(-1)
    expect(kinds(s)).not.toContain('translate')
  })
})

// --- What you type in your language ----------------------------------------------------------------

test('Japanese, typed · Sent as English: Claude gets the English', async () => {
  await withOptions({ nativeInput: 'Send in the language you are learning' }, async s => {
    await s.ask(TYPED_JA, `EN ▸ ${TYPED_EN}`)
    expect(s.model.turns[0]).toContain(TYPED_EN)
    expect(s.model.turns[0]).not.toContain(TYPED_JA)
  })
})

test('Japanese, typed · English shown, sent as typed: the English is shown, Claude gets the Japanese', async () => {
  await withOptions({ nativeInput: 'Show it, send as typed' }, async s => {
    await s.ask(TYPED_JA, `EN ▸ ${TYPED_EN}`)
    expect(s.model.turns[0]).toContain(TYPED_JA)
    expect(s.model.turns[0]).not.toContain(TYPED_EN)
    // Nothing was sent in its place, so nothing is put under the message.
    expect(await s.rowOf(`↳ ${TYPED_EN}`)).toBe(-1)
  })
})

test('Japanese, typed · Left alone: nothing is shown or asked, Claude gets the Japanese', async () => {
  await withOptions({ nativeInput: 'Leave it alone' }, async s => {
    await s.type(TYPED_JA)
    await Bun.sleep(2500)
    expect(await hasLine(s, 'EN ▸')).toBe(false)
    await s.press('Enter')
    await s.waitFor(/^✻ .+ for \d+/)
    expect(s.model.turns[0]).toContain(TYPED_JA)
    expect(kinds(s)).not.toContain('toTarget')
    expect(await s.rowOf('↳')).toBe(-1)
  })
})

// --- What you type in the language you are learning -------------------------------------------------

test('English, typed · Corrected while typing and after: FIX ▸ as you type, ↳ under the message, Claude gets what was typed', async () => {
  await withOptions({ corrections: 'While typing and after sending' }, async s => {
    await s.ask(WRONG, `FIX ▸ ${RIGHT}`)
    await s.waitFor(`↳ ${RIGHT}`)
    expect(s.model.turns[0]).toContain(WRONG)
    expect(s.model.turns[0]).not.toContain(RIGHT)
  })
})

test('English, typed · Corrected after sending: no line while typing, ↳ under the message', async () => {
  await withOptions({ corrections: 'After sending' }, async s => {
    await s.type(WRONG)
    await Bun.sleep(2500)
    expect(await hasLine(s, 'FIX ▸')).toBe(false)
    await s.press('Enter')
    await s.waitFor(`↳ ${RIGHT}`)
    expect(s.model.turns[0]).toContain(WRONG)
  })
})

test('English, typed · Not corrected: nothing is added and nothing is asked', async () => {
  await withOptions({ corrections: 'Off' }, async s => {
    await s.type(WRONG)
    await Bun.sleep(2500)
    expect(await hasLine(s, 'FIX ▸')).toBe(false)
    await s.press('Enter')
    await s.waitFor(/^✻ .+ for \d+/)
    await Bun.sleep(1500)
    expect(await s.rowOf('↳')).toBe(-1)
    expect(kinds(s)).not.toContain('fix')
  })
})

// --- The mark -------------------------------------------------------------------------------------

test('Mark ◆: the mark under the pointer is ◆', async () => {
  await withOptions({ mark: '◆' }, async s => {
    await s.ask(ASKED, 'FIX ▸')
    await s.move(await s.rowOf(FIRST), 12)
    expect(await starts(s, FIRST, '◆')).toBe(true)
  })
})

test('Mark beside · First line: on a block of two rows the mark is beside the first', async () => {
  await withOptions({ markPosition: 'First line' }, async s => {
    await s.ask(ASKED, 'FIX ▸')
    await s.move(await s.rowOf('Two tests are still slow'), 12)
    expect(await starts(s, 'Two tests are still slow', '▸')).toBe(true)
    expect(await starts(s, 'wrapping code.', '▸')).toBe(false)
  })
})

test('Mark shows · Always: every block has its mark at rest, with no pointer on it', async () => {
  await withOptions({ markVisibility: 'Always' }, async s => {
    await s.ask(ASKED, 'FIX ▸')
    expect(await starts(s, FIRST, '▸')).toBe(true)
    expect(await starts(s, 'wrapping code.', '▸')).toBe(true)
  })
})

// --- The grey text --------------------------------------------------------------------------------

test('Grey text · Grey: an open translation is grey and upright', async () => {
  await withOptions({ translationStyle: 'Faint' }, async s => {
    await s.ask(ASKED, 'FIX ▸')
    const row = await s.rowOf(FIRST)
    await s.click(row, 0)
    await s.waitFor(FIRST_JA)
    const translation = (await s.cells(row + 1)).filter(cell => cell.x >= 2)
    const reply = (await s.cells(row)).filter(cell => cell.x >= 2)
    expect(translation.some(cell => cell.italic)).toBe(false)
    expect(translation[0]?.fg).not.toBe(reply[0]?.fg)
  })
})

test('Levels 2 and 3 · One under the other: at level 3 the second language is under the block, not beside it', async () => {
  const s = await open({ cols: 150, rows: 40, options: { readingLevel: '3', layout: 'Below' }, script: SCRIPT })
  try {
    await s.ask(ASKED, 'FIX ▸')
    await s.waitFor(FIRST_JA)
    expect(await s.rowOf(FIRST_JA)).toBe((await s.rowOf(FIRST)) + 1)
  } finally {
    await s.close()
  }
})

test('Open-all buttons · Off: a reply of two blocks has no buttons at its end', async () => {
  await withOptions({ allButtons: false }, async s => {
    await s.ask(ASKED, 'FIX ▸')
    expect(await s.rowOf('ALL JA OPEN')).toBe(-1)
    await s.move(await s.rowOf(FIRST), 12)
    expect(await starts(s, FIRST, '▸')).toBe(true)
  })
})

// --- The preview while typing -----------------------------------------------------------------------

test('Preview while typing · Off: no line above the prompt box, and the message is still sent in English', async () => {
  await withOptions({ livePreview: false }, async s => {
    await s.type(TYPED_JA)
    await Bun.sleep(2500)
    expect(await hasLine(s, 'EN ▸')).toBe(false)
    await s.press('Enter')
    await s.waitFor(/^✻ .+ for \d+/)
    expect(s.model.turns[0]).toContain(TYPED_EN)
  })
})

test('Preview while typing · After 2 s: the line is not there after one second and is there after three', async () => {
  await withOptions({ previewDelay: '2 s' }, async s => {
    await s.type(TYPED_JA)
    await Bun.sleep(1000)
    expect(await hasLine(s, 'EN ▸')).toBe(false)
    await s.waitFor(`EN ▸ ${TYPED_EN}`, 4000)
  })
})

// --- The languages ---------------------------------------------------------------------------------

test('Your language · Korean: the translation is asked for in Korean, and the buttons say KO', async () => {
  const KO = '메인 브랜치에서 빌드가 통과했습니다.'
  const script: Script = { replies: [`${FIRST}\n\n${LONG}`], pair: pairOf('Korean', 'English'), small: { translate: { [FIRST]: KO, [LONG]: KO }, fix: { [ASKED]: 'OK' } } }
  await withOptions({ nativeLanguage: 'Korean' }, async s => {
    await s.ask(ASKED, 'FIX ▸')
    expect(await s.rowOf('ALL KO OPEN')).toBeGreaterThanOrEqual(0)
    const row = await s.rowOf(FIRST)
    await s.click(row, 0)
    await s.waitFor(KO)
    expect(s.model.unscripted).toEqual([])
  }, script)
})

test('You are learning · Japanese, with English your own: a Japanese reply gets the mark, an English one does not', async () => {
  const EN = 'The build passed.'
  // All Japanese: a Japanese sentence holding an English word ("main ブランチ…") is not offered today, see lang.ts.
  const JA = 'ビルドが通りました。テストも全部通っています。'
  const script: Script = { replies: [`${JA}\n\n${FIRST}`], pair: pairOf('English', 'Japanese'), small: { translate: { [JA]: EN }, toTarget: { [ASKED]: 'ビルドの状態は？' } } }
  await withOptions({ nativeLanguage: 'English', targetLanguage: 'Japanese' }, async s => {
    await s.ask(ASKED)
    const row = await s.rowOf(JA)
    await s.move(row, 12)
    expect(await starts(s, JA, '▸')).toBe(true)
    await s.move(await s.rowOf(FIRST), 12)
    expect(await starts(s, FIRST, '▸')).toBe(false)
    await s.click(row, 0)
    await s.waitFor(EN)
    expect(s.model.unscripted).toEqual([])
  }, script)
})
