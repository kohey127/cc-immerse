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

test('/immerse lists every setting above the prompt, a row each, its value beside its name', async ($, on) => {
  const { immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  const rows = await labels(ui)
  expect(rows.length).toBe(13)
  expect(rows[0]).toContain('Close')
  rows.shift()
  expect(rows[2]).toContain('Reading')
  expect(rows[2]).toContain('Level 4 · English first, Japanese on click')
  expect(rows[3]).toContain('Japanese, typed')
  expect(rows[3]).toContain('Sent as English')
  // The keyboard's row is marked, and the preview is of that row.
  expect(rows[2]?.includes('❯')).toBe(true)
  expect(await ui.find({ type: 'Text', text: /^Preview · Reading/ })).toBeDefined()
  await ui.unmount()
})

test('the first nine rows are pressed by a number, and Close by 0', async ($, on) => {
  const { immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  const buttons = await ui.findAll({ type: 'Button' })
  expect(buttons.map((b: any) => b.props.hotkey)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', undefined, undefined, undefined])
  await ui.unmount()
})

test('Enter on Reading shows its choices in place, the one in force marked; a pick writes it and returns to the list', async ($, on) => {
  const { seen, immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'reading' })
  const choices = await labels(ui)
  expect(choices.length).toBe(6)
  expect(choices[0]).toContain('← Back')
  expect(choices[5]).toContain('● Level 4')
  expect(choices[1]).toContain('○ Off')
  expect(choices[3]).toContain('○ Level 2')
  expect(choices[3]).toContain('Japanese on the left, English beside it in grey')
  await ui.press({ key: 'reading-2' })
  expect(seen.set).toEqual([{ key: 'cc-immerse.readingLevel', value: '2' }])
  expect((await labels(ui)).length).toBe(13)
  await ui.unmount()
})

test('a row of two choices flips where it is', async ($, on) => {
  const { seen, immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'allButtons' })
  await ui.press({ key: 'markPosition' })
  expect(seen.set).toEqual([
    { key: 'cc-immerse.allButtons', value: false },
    { key: 'cc-immerse.markPosition', value: 'First line' },
  ])
  expect((await labels(ui)).length).toBe(13)
  await ui.unmount()
})

test('a choice that sets two things writes both: the preview while typing', async ($, on) => {
  const { seen, immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'typingPreview' })
  await ui.press({ key: 'typingPreview-4' })
  expect(seen.set).toEqual([{ key: 'cc-immerse.previewDelay', value: '2 s' }])
  await ui.unmount()
})

test('the languages are all in the list, with no typing', async ($, on) => {
  const { seen, immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'native' })
  const choices = await labels(ui)
  expect(choices.length).toBe(22)
  const korean = (await ui.findAll({ type: 'Button' })).find((b: any) => String(b.props.label).includes('Korean'))
  await ui.press({ key: korean?.key as string })
  expect(seen.set).toEqual([{ key: 'cc-immerse.nativeLanguage', value: 'Korean' }])
  await ui.unmount()
})

test('the preview follows the keyboard: on a level, the sample reply as that level draws it', async ($, on) => {
  const { immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'reading' })
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', element: 'reading-2', origin: { kind: 'person' } } as never)
  const texts = await ui.findAll({ type: 'Text' })
  const native = texts.findIndex((t: any) => /ビルド成功です/.test(t.text) && t.props.dimColor !== true)
  const learned = texts.findIndex((t: any) => /The build passed/.test(t.text) && t.props.dimColor === true)
  expect(native).toBeGreaterThanOrEqual(0)
  expect(learned).toBeGreaterThan(native)
  expect(await ui.find({ type: 'Text', text: /^Preview · Level 2/ })).toBeDefined()
  await ui.unmount()
})

test('the preview of a typing choice says what Claude gets', async ($, on) => {
  const { immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'nativeInput' })
  await $.ui.focus({ component: 'AbovePrompt', requestId: 'above-prompt', element: 'nativeInput-1', origin: { kind: 'person' } } as never)
  expect(await ui.find({ type: 'Text', text: 'Claude gets: ビルドの状態は？' })).toBeDefined()
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

test('/immerse off switches all three kinds of help off', { options: { readingLevel: '2' } }, async ($, on) => {
  const { seen, immerse } = world(on)
  await immerse($, 'off')
  expect(seen.set).toEqual([
    { key: 'cc-immerse.readingLevel', value: 'Off' },
    { key: 'cc-immerse.nativeInput', value: 'Leave it alone' },
    { key: 'cc-immerse.corrections', value: 'Off' },
  ])
})

const ALL_OFF = { readingLevel: 'Off', nativeInput: 'Leave it alone', corrections: 'Off' }

test('/immerse on brings back what /immerse off switched off, as it was', { options: ALL_OFF }, async ($, on) => {
  const { seen, immerse } = world(on, { beforeOff: { readingLevel: '2', nativeInput: 'Show it, send as typed', corrections: 'After sending' } })
  await immerse($, 'on')
  expect(seen.set).toEqual([
    { key: 'cc-immerse.readingLevel', value: '2' },
    { key: 'cc-immerse.nativeInput', value: 'Show it, send as typed' },
    { key: 'cc-immerse.corrections', value: 'After sending' },
  ])
})

test('/immerse on with nothing remembered brings back the defaults, and leaves alone what is on', { options: { readingLevel: 'Off', corrections: 'After sending' } }, async ($, on) => {
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

test('in a short band the six rows about the look stand in two columns, so the preview stays in view', async ($, on) => {
  const { immerse } = world(on)
  await immerse($, '')
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, maxRows: 17 } })
  expect((await labels(ui)).length).toBe(13)
  expect(await ui.find({ type: 'Text', text: /^Preview · Reading/ })).toBeDefined()
  await ui.unmount()
})

test('sending a message takes the list away', async ($, on) => {
  const { immerse } = world(on)
  mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: 'OK', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  await immerse($, '')
  await $.prompt.submit({ text: 'What is the build status?' } as never)
  const ui = await $.ui.mount(BAND)
  expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
  await ui.unmount()
})

// --- the list worked from the prompt box ---------------------------------------------------------------
// The band cannot be given the keyboard, so while the list is open the prompt box holds one line between two
// empty ones, ending in a backslash with the caret after it: an arrow pressed there reaches the plugin as an
// edit, and so does Enter, which after a backslash breaks the line and sends nothing.

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

test('/immerse puts its line in the prompt box, the caret on it, so that the arrows land there', async ($, on) => {
  const { filled, start } = keyboard(on)
  const ui = await start($)
  expect(filled).toEqual([{ text: HELD, cursor: CARET }])
  await ui.unmount()
})

test('Down and Up in the prompt box move through the rows, the preview with them, and the box stays as it was', async ($, on) => {
  const { press, start } = keyboard(on)
  const ui = await start($)
  expect(await cursorRow(ui)).toContain('Reading')
  const box = await press($, 'down')
  expect(box).toEqual({ text: HELD, cursor: CARET })
  expect(await cursorRow(ui)).toContain('Japanese, typed')
  expect(await ui.find({ type: 'Text', text: /^Preview · Japanese, typed/ })).toBeDefined()
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
  expect(await cursorRow(ui)).toContain('Preview while typing')
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
  expect((await labels(ui)).length).toBe(13)
  await ui.unmount()
})

test('Left goes back from a row’s choices, and from the list it closes it and empties the box', async ($, on) => {
  const { filled, press, start } = keyboard(on)
  const ui = await start($)
  await press($, 'right')
  await press($, 'left')
  expect((await labels(ui)).length).toBe(13)
  expect(await cursorRow(ui)).toContain('Reading')
  await press($, 'left')
  expect((await labels(ui)).length).toBe(0)
  await ui.unmount()
  expect(filled.length).toBeGreaterThan(0)
})

test('a number presses the row beside it', async ($, on) => {
  const { seen, press, start } = keyboard(on)
  const ui = await start($)
  await press($, '7', '7')
  expect(seen.set).toEqual([{ key: 'cc-immerse.markPosition', value: 'First line' }])
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

test('the list’s line is never sent to Claude, even with the list gone', async ($, on) => {
  const { enter } = keyboard(on)
  const sent = await enter($)
  expect(sent.drop).toBe('')
})

test('the list’s line left in the box beside a message is taken out of what is sent', async ($, on) => {
  keyboard(on)
  const sent = await $.prompt.submit({ text: `What is the build status?${HINT_LINE}` } as never)
  expect(sent.text).toBe('What is the build status?')
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
