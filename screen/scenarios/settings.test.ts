// Recording 6 of the README: `/immerse` lists the settings above the prompt as `/config` lists its own,
// worked by the arrow keys and Enter from the moment it opens, with no click and no chord; the preview
// under the list follows the keyboard; a pick is in force for the next reply. Also the shortcuts beside it.

import { expect, setDefaultTimeout, test } from 'bun:test'

import { open } from '../term'
import type { Session } from '../term'

const FIRST = 'The build passed on the main branch.'
const FIRST_JA = 'main ブランチでビルドが通りました。'
const SECOND = 'Two tests are still slow.'
const SECOND_JA = 'テストが2つまだ遅いままです。'
const REPLY = `${FIRST}\n\n${SECOND}`
const ASKED = 'What is the build status?'

setDefaultTimeout(180000)

/** The row of the prompt box that holds the list's line: what the keys do, ending in the backslash. */
const HELD_ROW = /type to close \\\s*$/

function session(record?: string, options: Record<string, string | boolean> = {}): Promise<Session> {
  return open({
    cols: 150,
    rows: 44,
    record,
    options,
    script: { replies: [REPLY, REPLY], small: { translate: { [FIRST]: FIRST_JA, [SECOND]: SECOND_JA }, fix: { [ASKED]: 'OK' } }, smallDelayMs: 300 },
  })
}

/** Runs a slash command and waits for what it brings. */
async function command(s: Session, text: string, answer: string | RegExp): Promise<void> {
  await s.type(text)
  await Bun.sleep(600)
  await s.press('Enter')
  await s.waitFor(answer)
  // The list takes its keys through the prompt box: wait for its line to be there.
  if (text === '/immerse') await s.waitFor(HELD_ROW)
  await Bun.sleep(700)
}

/** Presses keys one after another, as a person does. */
async function keys(s: Session, ...names: string[]): Promise<void> {
  for (const name of names) {
    await s.press(name)
    await Bun.sleep(450)
  }
}

/** The list as drawn: from its title down to the prompt box. */
async function list(s: Session): Promise<string[]> {
  const screen = await s.screen()
  const from = screen.findIndex(line => line.startsWith('Immerse settings'))
  const to = screen.findIndex((line, i) => i > from && /^─{20}/.test(line))
  return from < 0 ? [] : screen.slice(from, to < 0 ? undefined : to).filter(line => line.trim() !== '')
}
const rowOf = (rows: string[], name: string): string => rows.find(line => line.includes(name)) ?? ''

test('/immerse, keyboard only: the list, the preview following the keyboard, a level picked, the next reply drawn at it', async () => {
  const s = await session('settings')
  try {
    await command(s, '/immerse', 'Immerse settings')
    let rows = await list(s)
    // Full width, from the left edge: nothing of it beside the conversation.
    expect(rows[0]?.startsWith('Immerse settings')).toBe(true)
    for (const name of ['Your language', 'You are learning', 'Level', 'Help while typing']) expect({ name, isListed: rowOf(rows, name) !== '' }).toEqual({ name, isListed: true })
    // The row says in which language the person and Claude talk; the preview shows that exchange.
    expect(rowOf(rows, 'Level  ')).toContain('Level 4 · With Claude in English')
    expect(rows.some(line => line.startsWith('Preview · Level'))).toBe(true)
    expect(rows.some(line => line.includes('Claude gets: What is the build status?'))).toBe(true)
    expect(rows.some(line => line.includes('Claude answers in English'))).toBe(true)
    await s.shot('settings-1-list')

    // The prompt box holds the list's line, so the arrows and Enter are the list's at once.
    await s.waitFor(HELD_ROW)
    await keys(s, 'Down')
    rows = await list(s)
    expect(rowOf(rows, 'Help while typing')).toContain('❯')
    expect(rows.some(line => line.startsWith('Preview · Help while typing'))).toBe(true)

    // Level: its choices in place, the keyboard on the one in force.
    await keys(s, 'Up', 'Enter')
    rows = await list(s)
    expect(rows[0]).toContain('Immerse settings › Level')
    expect(rowOf(rows, 'Level 4')).toContain('❯ ●')
    await s.shot('settings-2-reading')

    // Up two rows: level 2, and the preview is the exchange at level 2: sent as typed, Claude answers in
    // Japanese, and the two languages are side by side.
    await keys(s, 'Up', 'Up')
    rows = await list(s)
    expect(rowOf(rows, 'Level 2')).toContain('❯ ○')
    expect(rowOf(rows, 'Level 2')).toContain('With Claude in Japanese')
    expect(rows.some(line => line.includes('Claude gets: ビルドの状態は？'))).toBe(true)
    expect(rows.some(line => line.includes('Claude answers in Japanese'))).toBe(true)
    const sample = rowOf(rows, 'ビルド成功です。')
    expect(sample.indexOf('ビルド成功です。')).toBeLessThan(sample.indexOf('The build passed.'))
    expect(sample.indexOf('The build passed.')).toBeGreaterThan(0)
    await s.shot('settings-3-level-2')

    // Enter: written, back on the list, the row saying so, the keyboard still in the list.
    await keys(s, 'Enter')
    await Bun.sleep(2500)
    rows = await list(s)
    expect(rows[0]).not.toContain('› Level')
    expect(rowOf(rows, 'Level  ')).toContain('Level 2 · With Claude in Japanese')
    await keys(s, 'Down')
    expect(rowOf(await list(s), 'Help while typing')).toContain('❯')
    await s.shot('settings-4-picked')

    // Typing a message takes the list away, the list's line with it, and the reply is at level 2.
    await s.ask(ASKED)
    expect(s.model.turns.at(-1)).not.toContain('type to close')
    expect((await s.screen()).some(line => line.includes('Prompt dropped'))).toBe(false)
    await s.waitFor(FIRST_JA)
    expect(await list(s)).toEqual([])
    const after = await s.screen()
    const r = after.findIndex(line => line.includes(FIRST_JA))
    expect((after[r] ?? '').indexOf(FIRST_JA)).toBeLessThan((after[r] ?? '').indexOf('The build passed'))
    expect((after[r] ?? '').indexOf('The build passed')).toBeGreaterThan(0)
    await s.shot('settings-5-reply')
    expect(s.model.unscripted).toEqual([])
  } finally {
    await s.close()
  }
})

test('numbers: 3 shows the levels, 2 picks level 1, 0 closes', async () => {
  const s = await session()
  try {
    await command(s, '/immerse', 'Immerse settings')
    await keys(s, '3')
    expect((await list(s))[0]).toContain('Immerse settings › Level')
    await keys(s, '2')
    await Bun.sleep(2500)
    expect(rowOf(await list(s), 'Level  ')).toContain('Level 1 · With Claude in Japanese')
    await keys(s, '0')
    expect(await list(s)).toEqual([])
    // The numbers were taken by the list, not typed into the prompt box, which is empty again.
    const screen = await s.screen()
    expect(screen.some(line => /^❯ \d/.test(line) || HELD_ROW.test(line))).toBe(false)
  } finally {
    await s.close()
  }
})

test('a switch flips where it is, and a language is picked from the list of all of them', async () => {
  const s = await session()
  try {
    await command(s, '/immerse', 'Immerse settings')
    await keys(s, '4')
    await Bun.sleep(2500)
    expect(rowOf(await list(s), 'Help while typing')).toContain('Off')
    await keys(s, '1')
    const languages = await list(s)
    expect(languages[0]).toContain('Immerse settings › Your language')
    for (const name of ['Korean', 'Spanish', 'Hindi', 'Hebrew', 'Vietnamese']) expect({ name, isListed: rowOf(languages, name) !== '' }).toEqual({ name, isListed: true })
    expect(rowOf(languages, 'English ·')).toBe('')
    await keys(s, '2')
    await Bun.sleep(2500)
    const rows = await list(s)
    expect(rowOf(rows, 'Your language')).toContain('Korean')
  } finally {
    await s.close()
  }
})

test('regression: /immerse open finds the latest reply after /immerse off and /immerse on', async () => {
  // Seen 2026-11-16: each answered "No reply to open yet". A setting written loads the plugin again, and
  // the latest reply was kept only in the module.
  const s = await session()
  try {
    await s.ask(ASKED, 'FIX ▸')
    await command(s, '/immerse off', 'Immerse is off')
    await Bun.sleep(3500)
    await command(s, '/immerse on', 'Immerse is on')
    await Bun.sleep(3500)
    await command(s, '/immerse open', /Opened \d+ block|No reply to open/)
    expect(await s.rowOf('Opened 2 block')).toBeGreaterThanOrEqual(0)
    await s.waitFor(SECOND_JA)
  } finally {
    await s.close()
  }
})

test('/immerse off lands every one of its writes, and /immerse on brings back what was set', async () => {
  const s = await session(undefined, { readingLevel: '2' })
  try {
    await command(s, '/immerse off', 'Immerse is off')
    await Bun.sleep(3500)
    await s.type(ASKED)
    await Bun.sleep(2500)
    expect((await s.screen()).some(line => line.startsWith('FIX ▸'))).toBe(false)
    await s.press('Ctrl+U')
    await command(s, '/immerse', 'Immerse settings')
    let rows = await list(s)
    expect(rowOf(rows, 'Level  ')).toContain('Off')
    expect(rowOf(rows, 'Help while typing')).toContain('Off')
    await keys(s, '0')
    await command(s, '/immerse on', 'Immerse is on')
    await Bun.sleep(3500)
    await command(s, '/immerse', 'Immerse settings')
    rows = await list(s)
    expect(rowOf(rows, 'Level  ')).toContain('Level 2 · With Claude in Japanese')
    expect(rowOf(rows, 'Help while typing')).toContain('On')
  } finally {
    await s.close()
  }
})

test('which language Claude gets, changed in the list: after level 1 is picked, a Japanese message arrives in Japanese, with nothing beside it', async () => {
  const typed = 'ビルドの状態を教えてください。'
  const english = 'Tell me the status of the build.'
  const s = await open({ cols: 150, rows: 44, script: { replies: ['ビルドは通りました。', 'ビルドは通りました。'], small: { toTarget: { [typed]: english } }, smallDelayMs: 300 } })
  try {
    await command(s, '/immerse', 'Immerse settings')
    await keys(s, '3', '2')
    await Bun.sleep(2500)
    expect(rowOf(await list(s), 'Level  ')).toContain('Level 1 · With Claude in Japanese')
    await keys(s, '0')
    await s.ask(typed, `EN ▸ ${english}`)
    expect(s.model.turns[0]).toContain(typed)
    expect(s.model.turns[0]).not.toContain(english)
    expect(s.model.turns[0]).not.toContain('<original-message')
  } finally {
    await s.close()
  }
})

test('← goes back from a row’s choices and then closes the list; Esc twice closes it too', async () => {
  const s = await session()
  try {
    await command(s, '/immerse', 'Immerse settings')
    await keys(s, 'Enter')
    expect((await list(s))[0]).toContain('Immerse settings › Level')
    await keys(s, 'Left')
    expect((await list(s))[0]).not.toContain('› Level')
    await keys(s, 'Left')
    expect(await list(s)).toEqual([])
    await command(s, '/immerse', 'Immerse settings')
    await keys(s, 'Escape', 'Escape')
    await Bun.sleep(800)
    expect(await list(s)).toEqual([])
    expect((await s.screen()).some(line => HELD_ROW.test(line))).toBe(false)
  } finally {
    await s.close()
  }
})
