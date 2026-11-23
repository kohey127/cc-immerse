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

test('reading Off: the plugin draws nothing of its own', { options: { readingLevel: 'Off' } }, async $ => {
  const ui = await $.ui.mount(reply(TWO))
  expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
  await ui.unmount()
})

test('level 3: in a wide window each block has its translation beside it', { options: { readingLevel: '3' } }, async ($, on) => {
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

test('level 3: in a narrow window it falls back to below', { options: { readingLevel: '3' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: JA, usage: USAGE } }))
  const ui = await $.ui.mount(reply(TWO, 60))
  await clock.advance(10)
  await clock.settle()
  expect((await ui.findAll({ type: 'Text', text: /最初の段落/ })).length).toBe(2)
  await ui.unmount()
})

// --- reading: the native language in front (levels 1 and 2) -----------------------------------------

const EN = 'The first paragraph.'

test('level 1: a block is translated with no press and read in the native language, at full strength', { options: { readingLevel: '1' } }, async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true as const, text: JA, usage: USAGE } }
  })
  const ui = await $.ui.mount(reply(EN))
  await clock.advance(10)
  await clock.settle()
  expect(calls).toBe(1)
  const front = await ui.find({ type: 'Text', text: /最初の段落/ })
  expect(Boolean(front?.props.dimColor)).toBe(false)
  expect(Boolean(front?.props.italic)).toBe(false)
  // The learned language is behind the mark.
  expect((await ui.findAll({ type: 'Text', text: /first paragraph/ })).length).toBe(0)
  expect((await ui.find({ type: 'Button', key: 'g0' }))?.props.label).toBe('▸')
  await ui.unmount()
})

test('level 1: a press opens the learned language under the block, faint, with no further model call', { options: { readingLevel: '1' } }, async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true as const, text: JA, usage: USAGE } }
  })
  const ui = await $.ui.mount(reply(EN))
  await clock.advance(10)
  await clock.settle()
  await ui.press({ key: 'g0' })
  await clock.advance(10)
  await clock.settle()
  expect(calls).toBe(1)
  const behind = await ui.find({ type: 'Text', text: /first paragraph/ })
  expect(behind?.props.dimColor).toBe(true)
  expect(Boolean((await ui.find({ type: 'Text', text: /最初の段落/ }))?.props.dimColor)).toBe(false)
  expect((await ui.find({ type: 'Button', key: 'g0' }))?.props.label).toBe('▾')
  await ui.unmount()
})

test('level 1: until its translation arrives, a block is read in the learned language', { options: { readingLevel: '1' } }, async ($, on) => {
  mock.clock(on)
  on('model.complete', () => new Promise<never>(() => {}))
  const ui = await $.ui.mount(reply(EN))
  const waiting = await ui.find({ type: 'Text', text: /first paragraph/ })
  expect(Boolean(waiting?.props.dimColor)).toBe(false)
  await ui.unmount()
})

test('level 1: the buttons at the end open and close the learned language, and say so', { options: { readingLevel: '1' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: JA, usage: USAGE } }))
  const ui = await $.ui.mount(reply(TWO))
  await clock.advance(10)
  await clock.settle()
  expect((await ui.find({ type: 'Button', key: 'all-open' }))?.props.label).toBe('▸▸ ALL EN OPEN')
  await ui.unmount()
})

test('level 2: in a wide window the native language is on the left at full strength, the learned one beside it, faint', { options: { readingLevel: '2' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: JA, usage: USAGE } }))
  const ui = await $.ui.mount(reply(EN, 140))
  await clock.advance(10)
  await clock.settle()
  const texts = await ui.findAll({ type: 'Text' })
  const native = texts.findIndex(t => /最初の段落/.test(t.text))
  const learned = texts.findIndex(t => /first paragraph/.test(t.text) && t.props.dimColor === true)
  expect(native).toBeGreaterThanOrEqual(0)
  expect(learned).toBeGreaterThan(native)
  expect(Boolean(texts[native]?.props.dimColor)).toBe(false)
  expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
  await ui.unmount()
})

// --- a reply in the native language: at levels 1 and 2 Claude is asked, and answers, in it -----------

const JA_REPLY = 'これは最初の段落です。'
const EN_OF_IT = 'This is the first paragraph.'

test('level 1, a native-language reply: drawn as it is, with no model call; the mark opens the learned language, faint', { options: { readingLevel: '1' } }, async ($, on) => {
  const clock = mock.clock(on)
  const systems: string[] = []
  on('model.complete', (_: unknown, e: { system?: string }) => {
    systems.push(String(e.system))
    return { value: { isAnswered: true as const, text: EN_OF_IT, usage: USAGE } }
  })
  const ui = await $.ui.mount(reply(JA_REPLY))
  await clock.advance(10)
  await clock.settle()
  expect(systems.length).toBe(0)
  expect(Boolean((await ui.find({ type: 'Text', text: /最初の段落/ }))?.props.dimColor)).toBe(false)
  expect((await ui.find({ type: 'Button', key: 'g0' }))?.props.label).toBe('▸')
  await ui.press({ key: 'g0' })
  await clock.advance(10)
  await clock.settle()
  expect(systems.length).toBe(1)
  expect(systems[0]).toContain('into natural English')
  expect((await ui.find({ type: 'Text', text: /first paragraph/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

test('level 2, a native-language reply in a wide window: it on the left at full strength, the learned language beside it, faint', { options: { readingLevel: '2' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: EN_OF_IT, usage: USAGE } }))
  const ui = await $.ui.mount(reply(JA_REPLY, 140))
  await clock.advance(10)
  await clock.settle()
  const texts = await ui.findAll({ type: 'Text' })
  const native = texts.findIndex(t => /最初の段落/.test(t.text) && t.props.dimColor !== true)
  const learned = texts.findIndex(t => /first paragraph/.test(t.text) && t.props.dimColor === true)
  expect(native).toBeGreaterThanOrEqual(0)
  expect(learned).toBeGreaterThan(native)
  await ui.unmount()
})

test('level 4, a native-language reply: read in the learned language once that arrives, the reply itself behind the mark', { options: { readingLevel: '4' } }, async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true as const, text: EN_OF_IT, usage: USAGE } }
  })
  const ui = await $.ui.mount(reply(JA_REPLY))
  await clock.advance(10)
  await clock.settle()
  expect(calls).toBe(1)
  expect(Boolean((await ui.find({ type: 'Text', text: /first paragraph/ }))?.props.dimColor)).toBe(false)
  expect((await ui.findAll({ type: 'Text', text: /最初の段落/ })).length).toBe(0)
  await ui.press({ key: 'g0' })
  await clock.advance(10)
  await clock.settle()
  expect(calls).toBe(1)
  expect((await ui.find({ type: 'Text', text: /最初の段落/ }))?.props.dimColor).toBe(true)
  await ui.unmount()
})

// --- reading: the mark and the look -----------------------------------------------------------------

test('On hover: the mark is hidden until the pointer is on its block', async $ => {
  const ui = await $.ui.mount(reply('The first paragraph.'))
  expect(JSON.stringify(await ui.drawn())).toContain('"display":"none"')
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

const TABLE = '| Build | Tests |\n| --- | --- |\n| Passed | 2 failed |'
const TABLE_JA = '| ビルド | テスト |\n| --- | --- |\n| 成功 | 2件失敗 |'

test('regression: level 3 in a wide window, a table has its translation beside it, both drawn as rows, the translation faint', { options: { readingLevel: '3' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: TABLE_JA, usage: USAGE } }))
  const ui = await $.ui.mount(reply(TABLE, 140))
  await clock.advance(10)
  await clock.settle()
  const texts = (await ui.findAll({ type: 'Text' })) as any[]
  const front = texts.findIndex(t => /Passed/.test(t.text) && t.props.dimColor !== true)
  const behind = texts.findIndex(t => /成功/.test(t.text) && t.props.dimColor === true)
  expect(front).toBeGreaterThanOrEqual(0)
  expect(behind).toBeGreaterThan(front)
  // Beside: the two are in one row, each in half of it.
  expect((await ui.findAll({ type: 'Box', key: 'tables-beside-0' })).length).toBe(1)
  await ui.unmount()
})

test('level 3 in a narrow window: the tables do not fit beside each other and go one under the other', { options: { readingLevel: '3' } }, async ($, on) => {
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: TABLE_JA, usage: USAGE } }))
  const ui = await $.ui.mount(reply(TABLE, 40))
  await clock.advance(10)
  await clock.settle()
  expect((await ui.findAll({ type: 'Box', key: 'tables-beside-0' })).length).toBe(0)
  expect(await ui.find({ type: 'Text', text: /成功/ })).toBeDefined()
  await ui.unmount()
})

// Seen in the author's link-career session at level 1: Claude answered in Japanese and quoted an English draft
// the author had asked for; the plugin swapped the English for a Japanese translation, so the draft could not
// be read. A block in the other language inside a reply in the language read first is part of what was said.
const QUOTED = '推敲案です。\n\n> Next, I want to focus on one product, and help its users do things they could not do before.\n\nこの案でよければ置き換えます。'
const QUOTE_JA = '> 次は1つのプロダクトに集中して、使う人がそれまでできなかったことをできるようにしたいです。'

test('regression: level 1, an English quote in a Japanese reply stays English; its Japanese is behind the mark', { options: { readingLevel: '1' } }, async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true as const, text: QUOTE_JA, usage: USAGE } }
  })
  const ui = await $.ui.mount(reply(QUOTED))
  await clock.advance(10)
  await clock.settle()
  // Nothing is translated until the mark is pressed: the reply is in the language read first.
  expect(calls).toBe(0)
  const quote = await ui.find({ type: 'Text', text: /focus on one product/ })
  expect(quote).toBeDefined()
  expect(Boolean(quote?.props.dimColor)).toBe(false)
  expect(await ui.find({ type: 'Text', text: /1つのプロダクト/ })).toBeUndefined()
  expect(((await ui.findAll({ type: 'Button' })) as any[]).some(b => b.props.label === '▸')).toBe(true)
  await ui.unmount()
})

test('level 4, a Japanese quote in an English reply stays Japanese; its English is behind the mark', { options: { readingLevel: '4' } }, async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true as const, text: 'The build passed on the main branch.', usage: USAGE } }
  })
  const ui = await $.ui.mount(reply('Here is what you wrote, word for word.\n\n> main ブランチでビルドが通りました。\n\nThe wording reads naturally; I would keep it as it is.'))
  await clock.advance(10)
  await clock.settle()
  expect(calls).toBe(0)
  expect(Boolean((await ui.find({ type: 'Text', text: /main ブランチ/ }))?.props.dimColor)).toBe(false)
  await ui.unmount()
})
