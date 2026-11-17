// A reply as the plugin draws it. A test here stands in for the engine: it mounts the plugin's drawing of
// one message and presses its marks, so the plugin's screen behaviour is checked with no person watching.
import { expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const reply = (text: string, requestId = 'm1') =>
  ({
    plugin: 'cc-immerse',
    component: 'AssistantMessage',
    requestId,
    surface: 'terminal',
    props: { text, isFirstOfReply: true },
    viewport: { columns: 80, rows: 40 },
  }) as const

test('each English block has one mark, and a Japanese block has none', async $ => {
  const ui = await $.ui.mount(reply('The first paragraph.\n\nこれは日本語の段落です。\n\nThe third paragraph.'))
  const marks = (await ui.findAll({ type: 'Button' })).filter(b => b.props.label === '▸')
  expect(marks.map(b => b.key)).toEqual(['g0', 'g2'])
  await ui.unmount()
})

test('a press opens the translation under the block, and a second press closes it', async ($, on) => {
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: 'これは一行の段落です。', usage: USAGE } }))
  const ui = await $.ui.mount(reply('This is a one-line paragraph.'))

  await ui.press({ key: 'g0' })
  await clock.advance(10)
  await clock.settle()
  expect((await ui.find({ type: 'Text', text: /一行の段落/ }))?.text).toBe('これは一行の段落です。')
  expect((await ui.find({ type: 'Button', key: 'g0' }))?.props.label).toBe('▾')

  await ui.press({ key: 'g0' })
  expect(await ui.find({ type: 'Text', text: /一行の段落/ })).toBe(undefined)
  expect((await ui.find({ type: 'Button', key: 'g0' }))?.props.label).toBe('▸')
  await ui.unmount()
})

test('nothing is translated until a block is opened', async ($, on) => {
  let calls = 0
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true as const, text: '訳', usage: USAGE } }
  })
  const ui = await $.ui.mount(reply('One paragraph.\n\nAnother paragraph.\n\nA third paragraph.'))
  expect(calls).toBe(0)
  await ui.unmount()
})

test('regression: a paragraph longer than the window is drawn in rows that fit it', async $ => {
  const long = 'This sentence is here to be long enough that it cannot fit in a window of forty columns. '.repeat(3)
  const ui = await $.ui.mount({ ...reply(long), viewport: { columns: 40, rows: 40 } })
  const rows = (await ui.findAll({ type: 'Text' })).filter(t => t.text.trim().length > 2)
  expect(rows.length > 3).toBe(true)
  for (const row of rows) expect(row.text.length <= 40).toBe(true)
  await ui.unmount()
})

test('regression: the text reaches the small model marked as text to translate, so a short title is not answered as a message', async ($, on) => {
  const clock = mock.clock(on)
  let asked = { system: '', prompt: '' }
  on('model.complete', (_: unknown, e: { system?: string; prompt: string }) => {
    asked = { system: e.system ?? '', prompt: e.prompt }
    return { value: { isAnswered: true as const, text: '私があなたにお願いしたいこと', usage: USAGE } }
  })
  const ui = await $.ui.mount(reply('What I need from you today'))
  await ui.press({ key: 'g0' })
  await clock.advance(10)
  await clock.settle()
  expect(asked.prompt).toBe('<text>\nWhat I need from you today\n</text>')
  expect(asked.system).toContain('<text>')
  expect(asked.system).toMatch(/never (answer|reply)/i)
  await ui.unmount()
})

// Seen on the author's screen under a heading with a list: one translation came back in Spanish, and the
// others with their Markdown marks, drawn as they came.

test('regression: a translation in another language is asked for once more, and the second answer is what is shown', async ($, on) => {
  const clock = mock.clock(on)
  const systems: string[] = []
  on('model.complete', (_: unknown, e: { system?: string }) => {
    systems.push(String(e.system))
    const text = systems.length === 1 ? 'La compilación pasó en la rama principal sin errores.' : 'main ブランチでビルドが通りました。'
    return { value: { isAnswered: true as const, text, usage: USAGE } }
  })
  const ui = await $.ui.mount(reply('The build passed on the main branch.'))
  await ui.press({ key: 'g0' })
  await clock.advance(10)
  await clock.settle()
  expect(systems.length).toBe(2)
  expect(systems[1]).toContain('must be in Japanese')
  expect(await ui.find({ type: 'Text', text: /ビルドが通りました/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /compilación/ })).toBeUndefined()
  await ui.unmount()
})

test('regression: a translation that kept its Markdown is drawn as the reply is, with no marks showing', async ($, on) => {
  const clock = mock.clock(on)
  on('model.complete', () => ({ value: { isAnswered: true as const, text: '## チェック\n\n- **テスト:** `regression:` を先に書きました。\n- 141件が通っています。', usage: USAGE } }))
  const ui = await $.ui.mount(reply('## Checks\n\n- **Tests:** written first as `regression:`.\n- 141 pass.'))
  await ui.press({ key: 'g0' })
  await clock.advance(10)
  await clock.settle()
  const behind = ((await ui.findAll({ type: 'Text' })) as any[]).filter(t => t.props.dimColor === true)
  const drawn = behind.map(t => t.text).join('\n')
  expect(drawn).toContain('チェック')
  expect(drawn).toContain('141件が通っています')
  expect(drawn.includes('##')).toBe(false)
  expect(drawn.includes('**')).toBe(false)
  expect(drawn.includes('`')).toBe(false)
  await ui.unmount()
})
