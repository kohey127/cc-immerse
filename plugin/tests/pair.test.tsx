// The language pair as a setting, and the sessions the plugin leaves alone.
import { expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const reply = (text: string) =>
  ({
    plugin: 'cc-immerse',
    component: 'AssistantMessage',
    requestId: 'm1',
    surface: 'terminal',
    props: { text, isFirstOfReply: true },
    viewport: { columns: 80, rows: 40 },
  }) as const

const typed = (text: string) =>
  ({
    plugin: 'cc-immerse',
    component: 'UserMessage',
    requestId: 'u1',
    surface: 'terminal',
    props: { text, origin: { kind: 'composer' }, isExpanded: false },
    viewport: { columns: 80, rows: 40 },
  }) as const

/** A stored correction for every message, as if the small model had answered `answer`. */
const stored = (answer: string) => (_: unknown, e: { key: string }) =>
  e.key === 'tr' ? { value: { value: { status: 'done', text: answer }, version: 1 } } : { value: { value: undefined, version: 0 } }

test('the buttons carry the native language of the setting', { options: { nativeLanguage: 'Korean' } }, async $ => {
  const ui = await $.ui.mount(reply('The first paragraph.\n\nThe second paragraph.'))
  expect((await ui.find({ type: 'Button', key: 'all-open' }))?.props.label).toBe('▸▸ ALL KO OPEN')
  await ui.unmount()
})

test('the translation is asked for in the native language of the setting', { options: { nativeLanguage: 'Korean' } }, async ($, on) => {
  const clock = mock.clock(on)
  let system = ''
  on('model.complete', (_, e) => {
    system = String(e.system)
    return { value: { isAnswered: true as const, text: '첫 번째 문단입니다.', usage: USAGE } }
  })
  const ui = await $.ui.mount(reply('The first paragraph.'))
  await ui.press({ key: 'g0' })
  await clock.advance(10)
  await clock.settle()
  expect(system).toContain('Korean')
  expect((await ui.find({ type: 'Text', text: /문단/ }))?.text).toBe('첫 번째 문단입니다.')
  await ui.unmount()
})

test(
  'the pair the other way round: Japanese blocks get the mark, English ones do not',
  { options: { nativeLanguage: 'English', targetLanguage: 'Japanese' } },
  async $ => {
    const ui = await $.ui.mount(reply('これは最初の段落です。\n\nThis paragraph is in English.\n\nこれは三番目の段落です。'))
    const marks = (await ui.findAll({ type: 'Button' })).filter(b => b.props.label === '▸')
    expect(marks.map(b => b.key)).toEqual(['g0', 'g2'])
    await ui.unmount()
  },
)

test('a correction is shown under a typed message, with its notes', async ($, on) => {
  on('state.get', stored('I want to test this feature.\n---\n- want to のあとは原形です'))
  const ui = await $.ui.mount(typed('I want to testing this feature'))
  expect((await ui.find({ type: 'Text', text: /I want to test this feature\./ }))?.text).toBe('I want to test this feature.')
  expect((await ui.find({ type: 'Text', text: /原形/ }))?.text).toBe('want to のあとは原形です')
  await ui.unmount()
})

test('a message with nothing to correct is praised in the learned language’s name', async ($, on) => {
  on('state.get', stored('OK'))
  const ui = await $.ui.mount(typed('This sentence has no mistake in it.'))
  expect((await ui.find({ type: 'Text', text: /perfect/ }))?.text).toBe('✓ Your English is perfect!')
  await ui.unmount()
})

test('a message the model says is not in the learned language shows nothing', async ($, on) => {
  // Romaji reaches the correction: only the model can tell it is not English, and it answers SKIP.
  on('state.get', stored('SKIP'))
  const ui = await $.ui.mount(typed('cc-ryugaku oshii na, motto nai?'))
  expect(await ui.find({ type: 'Text', text: /↳/ })).toBe(undefined)
  await ui.unmount()
})

test('a session with nobody at its prompt is left alone', async ($, on) => {
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  const ui = await $.ui.mount(reply('The first paragraph.\n\nThe second paragraph.'))
  expect((await ui.findAll({ type: 'Button' })).length).toBe(0)
  await ui.unmount()
})
