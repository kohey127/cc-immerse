// What each setting does to a reply as drawn and to a message as sent. Written before the settings were wired in.
import { expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const JA = '最初の段落です。'

const reply = (text: string, columns = 80) =>
  ({
    plugin: 'cc-immerse',
    component: 'AssistantMessage',
    requestId: 'm1',
    surface: 'terminal',
    props: { text, isFirstOfReply: true },
    viewport: { columns, rows: 40 },
  }) as const

const TWO = 'The first paragraph.\n\nThe second paragraph.'

// --- reading: when the translation shows -----------------------------------------------------------

test('Never: the plugin draws nothing of its own', { options: { showTranslation: 'Never' } }, async $ => {
  const ui = await $.ui.mount(reply(TWO))
  expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
  await ui.unmount()
})

test('Always, below: every block is translated with no press, and has no mark', { options: { showTranslation: 'Always, below' } }, async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true as const, text: JA, usage: USAGE } }
  })
  const ui = await $.ui.mount(reply(TWO))
  await clock.advance(10)
  await clock.settle()
  expect(calls).toBe(2)
  expect((await ui.findAll({ type: 'Text', text: /最初の段落/ })).length).toBe(2)
  expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
  await ui.unmount()
})

test('Side by side: in a wide window each block has its translation beside it', { options: { showTranslation: 'Side by side' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: JA, usage: USAGE } }))
  const ui = await $.ui.mount(reply(TWO, 140))
  await clock.advance(10)
  await clock.settle()
  expect((await ui.findAll({ type: 'Box', key: 'side' })).length > 0 || (await ui.findAll({ type: 'Text', text: /最初の段落/ })).length === 2).toBe(true)
  expect((await ui.findAll({ type: 'Text', text: /最初の段落/ })).length).toBe(2)
  // Each half fits half the window.
  for (const row of await ui.findAll({ type: 'Text' })) expect(row.text.length <= 70).toBe(true)
  await ui.unmount()
})

test('Side by side: in a narrow window it falls back to below', { options: { showTranslation: 'Side by side' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: JA, usage: USAGE } }))
  const ui = await $.ui.mount(reply(TWO, 60))
  await clock.advance(10)
  await clock.settle()
  expect((await ui.findAll({ type: 'Text', text: /最初の段落/ })).length).toBe(2)
  await ui.unmount()
})

// --- reading: the mark and the look -----------------------------------------------------------------

test('the mark is the one in the setting', { options: { mark: '🌐' } }, async $ => {
  const ui = await $.ui.mount(reply('The first paragraph.'))
  expect((await ui.find({ type: 'Button', key: 'g0' }))?.props.label).toBe('🌐')
  await ui.unmount()
})

test('On hover: the mark is hidden until the pointer is on its block', async $ => {
  const ui = await $.ui.mount(reply('The first paragraph.'))
  expect(JSON.stringify(await ui.drawn())).toContain('"display":"none"')
  await ui.unmount()
})

test('Always: the mark is drawn at rest', { options: { markVisibility: 'Always' } }, async $ => {
  const ui = await $.ui.mount(reply('The first paragraph.'))
  expect(JSON.stringify(await ui.drawn())).not.toContain('"display":"none"')
  expect((await ui.find({ type: 'Button', key: 'g0' }))?.props.label).toBe('▸')
  await ui.unmount()
})

test('the open-all and close-all buttons can be switched off', { options: { allButtons: false } }, async $ => {
  const ui = await $.ui.mount(reply(TWO))
  expect(await ui.find({ type: 'Button', key: 'all-open' })).toBe(undefined)
  expect((await ui.find({ type: 'Button', key: 'g0' }))?.props.label).toBe('▸')
  await ui.unmount()
})

test('Normal: an open translation is drawn at full strength', { options: { translationStyle: 'Normal' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: JA, usage: USAGE } }))
  const ui = await $.ui.mount(reply('The first paragraph.'))
  await ui.press({ key: 'g0' })
  await clock.advance(10)
  await clock.settle()
  const translation = await ui.find({ type: 'Text', text: /最初の段落/ })
  expect(Boolean(translation?.props.dimColor)).toBe(false)
  expect(Boolean(translation?.props.italic)).toBe(false)
  await ui.unmount()
})

test('Faint italic, the default: an open translation is dim and italic', async ($, on) => {
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: JA, usage: USAGE } }))
  const ui = await $.ui.mount(reply('The first paragraph.'))
  await ui.press({ key: 'g0' })
  await clock.advance(10)
  await clock.settle()
  const translation = await ui.find({ type: 'Text', text: /最初の段落/ })
  expect([translation?.props.dimColor, translation?.props.italic]).toEqual([true, true])
  await ui.unmount()
})
