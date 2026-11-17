// `/immerse`: the settings listed above the prompt as `/config` lists its own, and the shortcuts beside it.
// Written before the list replaced the question dialog.
import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'cc-immerse',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  surface: 'terminal',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 30, bodyColumns: 140, scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

/** What sits beneath the plugin: settings written and the keyboard moved, each call kept. */
function world(on: any, kept: Record<string, unknown> = {}) {
  mock.store(on, kept)
  const seen = { set: [] as { key: string; value: unknown }[] }
  on('command.register', () => ({ value: { command: 'immerse' } }))
  on('config.set', (_: unknown, e: { key: string; value: unknown }) => {
    seen.set.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  on('ui.focus', () => ({ value: {} }))
  const filled: { text: string; cursor?: number }[] = []
  on('prompt.fill', (_: unknown, e: { text: string; cursor?: number }) => {
    filled.push({ text: e.text, cursor: e.cursor })
    return { isFilled: true }
  })
  const immerse = ($: any, args: string) => $.command.run({ command: 'immerse', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true } })
  return { seen, immerse, filled }
}

const labels = async (ui: any): Promise<string[]> => (await ui.findAll({ type: 'Button' })).map((b: any) => String(b.props.label))

test('before /immerse the band holds nothing of the settings', async ($, on) => {
  world(on)
  const ui = await $.ui.mount(BAND)
  expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
  await ui.unmount()
})

test('/immerse lists the four settings above the prompt, a row each, its value beside its name', async ($, on) => {
  const { immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  const rows = await labels(ui)
  expect(rows.length).toBe(5)
  expect(rows[0]).toContain('Close')
  expect(rows[1]).toContain('Your language')
  expect(rows[3]).toContain('Level')
  expect(rows[3]).toContain('Level 4 · With Claude in English')
  expect(rows[4]).toContain('Help while typing')
  // The keyboard's row is marked, and the preview is of that row.
  expect(rows[3]?.includes('❯')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^Preview · Level/ })).toBeDefined()
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props.hotkey)).toEqual(['0', '1', '2', '3', '4'])
  await ui.unmount()
})

test('the preview of a level is an exchange at that level: what is typed, what Claude gets, how the reply is read', async ($, on) => {
  const { immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  // Level 4, in force: the message is sent in English with the Japanese beside it, and Claude answers in English.
  expect(await ui.find({ type: 'Text', text: '❯ ビルドの状態は？' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^Claude gets: What is the build status\?/ })).toBeDefined()
  expect(Boolean((await ui.find({ type: 'Text', text: /The build passed/ }))?.props.dimColor)).toBe(false)
  await ui.press({ key: 'level' })
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', element: 'level-2', origin: { kind: 'person' } } as never)
  // Level 2: sent as typed, Claude answers in Japanese, the English beside it, faint.
  expect(await ui.find({ type: 'Text', text: 'Claude gets: ビルドの状態は？' })).toBeDefined()
  const texts = await ui.findAll({ type: 'Text' })
  const native = texts.findIndex((t: any) => /ビルド成功です/.test(t.text) && t.props.dimColor !== true)
  const learned = texts.findIndex((t: any) => /The build passed/.test(t.text) && t.props.dimColor === true)
  expect(native).toBeGreaterThanOrEqual(0)
  expect(learned).toBeGreaterThan(native)
  await ui.unmount()
})

test('Enter on Level shows its choices in place, the one in force marked; a pick writes it and returns to the list', async ($, on) => {
  const { seen, immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'level' })
  const choices = await labels(ui)
  expect(choices.length).toBe(6)
  expect(choices[0]).toContain('← Back')
  expect(choices[1]).toContain('○ Off')
  expect(choices[3]).toContain('○ Level 2')
  expect(choices[3]).toContain('With Claude in Japanese')
  expect(choices[5]).toContain('● Level 4')
  await ui.press({ key: 'level-2' })
  expect(seen.set).toEqual([{ key: 'cc-immerse.readingLevel', value: '2' }])
  expect((await labels(ui)).length).toBe(5)
  await ui.unmount()
})

test('Help while typing flips where it is', async ($, on) => {
  const { seen, immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'typingHelp' })
  expect(seen.set).toEqual([{ key: 'cc-immerse.typingHelp', value: false }])
  expect((await labels(ui)).length).toBe(5)
  await ui.unmount()
})

test('the languages are all in the list, with no typing', async ($, on) => {
  const { seen, immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'native' })
  expect((await labels(ui)).length).toBe(22)
  const korean = (await ui.findAll({ type: 'Button' })).find((b: any) => String(b.props.label).includes('Korean'))
  await ui.press({ key: korean?.key as string })
  expect(seen.set).toEqual([{ key: 'cc-immerse.nativeLanguage', value: 'Korean' }])
  await ui.unmount()
})

test('Close takes the list away', async ($, on) => {
  const { immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'close' })
  expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
  await ui.unmount()
})

// --- the shortcuts ----------------------------------------------------------------------------------

test('/immerse off sets the level to Off and typing help off', { options: { readingLevel: '2' } }, async ($, on) => {
  const { seen, immerse } = world(on)
  await immerse($, 'off')
  expect(seen.set).toEqual([
    { key: 'cc-immerse.readingLevel', value: 'Off' },
    { key: 'cc-immerse.typingHelp', value: false },
  ])
})

test('/immerse on brings back what /immerse off switched off, as it was', { options: { readingLevel: 'Off', typingHelp: false } }, async ($, on) => {
  const { seen, immerse } = world(on, { beforeOff: { readingLevel: '2', typingHelp: true } })
  await immerse($, 'on')
  expect(seen.set).toEqual([
    { key: 'cc-immerse.readingLevel', value: '2' },
    { key: 'cc-immerse.typingHelp', value: true },
  ])
})

test('/immerse on with nothing remembered brings back level 4, and leaves alone what is on', { options: { readingLevel: 'Off' } }, async ($, on) => {
  const { seen, immerse } = world(on)
  await immerse($, 'on')
  expect(seen.set).toEqual([{ key: 'cc-immerse.readingLevel', value: '4' }])
})

// That /immerse open survives the reload a setting causes is checked on a real screen (screen/scenarios/settings.test.ts):
// the test kit does not load a module twice.

test('with reading Off, /immerse open says so', { options: { readingLevel: 'Off' } }, async ($, on) => {
  const { immerse } = world(on)
  expect(JSON.stringify(await immerse($, 'open'))).toContain('Reading is off')
})

// --- the list worked from the prompt box ---------------------------------------------------------------
// The band cannot be given the keyboard, so while the list is open the prompt box holds one line between two
// empty ones, ending in a backslash with the caret after it: an arrow pressed there reaches the plugin as an
// edit, and so does Enter, which after a backslash breaks the line and sends nothing. The line says what the
// keys do.

const HINT = '↑↓ move · Enter change · ← back · type to close'
const HINT_LINE = `${HINT} \\`
const HELD = `\n${HINT_LINE}\n`
const CARET = 1 + HINT_LINE.length

/** The world, with the prompt box beneath the plugin: fills kept, an edit applied as the editor would. */
function keyboard(on: any) {
  const base = world(on)
  const clock = mock.clock(on)
  on('prompt.edit', (_: unknown, e: { text: string; start: number; end: number; inputText: string }) => ({ text: e.text.slice(0, e.start) + e.inputText + e.text.slice(e.end), cursor: e.start + e.inputText.length }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  const settle = async () => {
    await clock.advance(300)
    await clock.settle()
  }
  /** Opens the list as `/immerse` does and draws the band once, as the engine would. */
  const start = async ($: any) => {
    await base.immerse($, '')
    await settle()
    return $.ui.mount(BAND)
  }
  /** A key pressed in the prompt box while it holds the list's line. */
  const press = async ($: any, key: string, inputText = '') => {
    const box = await $.prompt.edit({ origin: { kind: 'composer' }, key: { key }, text: HELD, cursor: CARET, start: CARET, end: CARET, inputText })
    await settle()
    return box
  }
  const enter = async ($: any) => {
    const r = await $.prompt.submit({ text: `\n${HINT_LINE}` })
    await settle()
    return r
  }
  return { ...base, press, enter, start }
}

const cursorRow = async (ui: any): Promise<string> => (await labels(ui)).find(l => l.includes('❯')) ?? ''

test('/immerse puts its line in the prompt box, the caret at its end, so that the arrows and Enter land there', async ($, on) => {
  const { filled, start } = keyboard(on)
  const ui = await start($)
  expect(filled).toEqual([{ text: HELD, cursor: CARET }])
  await ui.unmount()
})

test('Down and Up in the prompt box move through the rows, the preview with them, and the box stays as it was', async ($, on) => {
  const { press, start } = keyboard(on)
  const ui = await start($)
  expect(await cursorRow(ui)).toContain('Level')
  const box = await press($, 'down')
  expect(box).toEqual({ text: HELD, cursor: CARET })
  expect(await cursorRow(ui)).toContain('Help while typing')
  expect(await ui.find({ type: 'Text', text: /^Preview · Help while typing/ })).toBeDefined()
  await press($, 'up')
  await press($, 'up')
  expect(await cursorRow(ui)).toContain('You are learning')
  await ui.unmount()
})

test('the rows wrap: Up from the first is the last', async ($, on) => {
  const { press, start } = keyboard(on)
  const ui = await start($)
  await press($, 'up')
  await press($, 'up')
  await press($, 'up')
  expect(await cursorRow(ui)).toContain('Help while typing')
  await ui.unmount()
})

test('Enter shows the row’s choices; Enter on one writes it and sends nothing', async ($, on) => {
  const { seen, press, start } = keyboard(on)
  const ui = await start($)
  const box = await press($, 'return')
  expect(box).toEqual({ text: HELD, cursor: CARET })
  expect((await labels(ui))[0]).toContain('← Back')
  expect(await cursorRow(ui)).toContain('Level 4')
  await press($, 'up')
  await press($, 'up')
  expect(await cursorRow(ui)).toContain('Level 2')
  await press($, 'return')
  expect(seen.set).toEqual([{ key: 'cc-immerse.readingLevel', value: '2' }])
  expect((await labels(ui)).length).toBe(5)
  await ui.unmount()
})

test('Left goes back from a row’s choices, and from the list it closes it and empties the box', async ($, on) => {
  const { filled, press, start } = keyboard(on)
  const ui = await start($)
  await press($, 'right')
  await press($, 'left')
  expect((await labels(ui)).length).toBe(5)
  expect(await cursorRow(ui)).toContain('Level')
  await press($, 'left')
  expect((await labels(ui)).length).toBe(0)
  await ui.unmount()
  expect(filled.length).toBeGreaterThan(0)
})

test('a number presses the row beside it', async ($, on) => {
  const { seen, press, start } = keyboard(on)
  const ui = await start($)
  await press($, '4', '4')
  expect(seen.set).toEqual([{ key: 'cc-immerse.typingHelp', value: false }])
  await press($, '3', '3')
  expect((await labels(ui))[0]).toContain('← Back')
  await press($, '2', '2')
  expect(seen.set.at(-1)).toEqual({ key: 'cc-immerse.readingLevel', value: '1' })
  await ui.unmount()
})

test('anything else typed is the start of a message: the list goes, and the box holds what was typed alone', async ($, on) => {
  const { press, start } = keyboard(on)
  const ui = await start($)
  const box = await press($, 'w', 'w')
  expect(box.text).toBe('w')
  expect((await labels(ui)).length).toBe(0)
  await ui.unmount()
})

test('closing the list empties the prompt box', async ($, on) => {
  const { filled, press, start } = keyboard(on)
  const ui = await start($)
  await press($, '0', '0')
  expect(filled.at(-1)).toEqual({ text: '', cursor: undefined })
  await ui.unmount()
})

test('regression: a message typed fast or pasted over the open list arrives as one edit with no key, and still replaces the list’s line', async ($, on) => {
  // Seen on a real screen: the line stayed in the box in front of the message.
  const { start } = keyboard(on)
  const ui = await start($)
  const box = await ($ as any).prompt.edit({ origin: { kind: 'composer' }, text: HELD, cursor: CARET, start: CARET, end: CARET, inputText: 'What is the build status?' })
  expect(box.text).toBe('What is the build status?')
  await ui.unmount()
})

test('the list’s line is never sent to Claude: alone it is dropped, and beside a message it is taken out', async ($, on) => {
  const { enter } = keyboard(on)
  expect((await enter($)).drop).toBe('')
  const sent = await ($ as any).prompt.submit({ text: `What is the build status?${HINT_LINE}` })
  expect(sent.text).toBe('What is the build status?')
})

test('the preview of a level holds a table: closed behind its mark at level 4, in both languages at level 2', async ($, on) => {
  const { immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  // Level 4: the reply is in English, so its table is, drawn as Claude Code draws a table. The sentence is the
  // block shown open; the Japanese table stays behind its mark, so that the list keeps its rows.
  const front = (await ui.find({ type: 'Markdown', text: /Passed/ })) as any
  expect(front).toBeDefined()
  expect(Boolean(front?.props.dimColor)).toBe(false)
  expect(((await ui.find({ type: 'Text', text: /ビルド成功です/ })) as any)?.props.dimColor).toBe(true)
  expect(await ui.find({ type: 'Text', text: /成功 / })).toBeUndefined()
  await ui.press({ key: 'level' })
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', element: 'level-2', origin: { kind: 'person' } } as never)
  // Level 2: both languages always show, the English table under the Japanese one, faint.
  expect(await ui.find({ type: 'Markdown', text: /成功/ })).toBeDefined()
  const behind = (await ui.findAll({ type: 'Text', text: /Passed/ })) as any[]
  expect(behind.length).toBe(1)
  expect(behind[0]?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('in a band too short for the tables the preview keeps to its two sentences, so the list stays on the screen', async ($, on) => {
  const { immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 17 } })
  expect(await ui.find({ type: 'Text', text: /Two tests failed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /Passed/ })).toBeUndefined()
  await ui.unmount()
})
