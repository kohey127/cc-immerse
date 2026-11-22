// A typed message on its way to the model: what the plugin sends in its place, and what it leaves alone.
// The hook registered in each test stands for the engine: it receives what the plugin passed on.
import { expect, mock, test } from 'claude-code/testing'

const USAGE = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const JAPANESE = 'もっとかっこいい名前ないかね'
const ENGLISH = 'I want to testing the correction feature with this sentence'

/** Sends `text` as the person would, with the small model answering `answer`. Returns what reached the engine and how often the model was called. */
async function send($: any, on: any, text: string, answer = 'Is there a cooler name for this?') {
  const clock = mock.clock(on)
  let calls = 0
  let received = ''
  let context: readonly string[] = []
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true as const, text: answer, usage: USAGE } }
  })
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => {
    received = e.text
    context = e.context ?? []
    return { text: e.text }
  })
  await $.prompt.submit({ text })
  await clock.advance(10)
  await clock.settle()
  return { received, calls, context }
}

test('levels 3 and 4: a message in the native language reaches the model in the learned one', async ($, on) => {
  const { received, calls } = await send($, on, JAPANESE)
  expect(received).toBe('Is there a cooler name for this?')
  expect(calls).toBe(1)
})

test('levels 3 and 4: the person’s own words go with it, beside the message, so that no meaning is lost', async ($, on) => {
  const { context } = await send($, on, JAPANESE)
  expect(context.length).toBe(1)
  expect(context[0]).toContain(JAPANESE)
  expect(context[0]).toContain('original wording')
  // Claude is asked in the learned language and is told to stay in it: with the original in view it would answer in that.
  expect(context[0]).toContain('Reply in English')
})

test('levels 1 and 2 with typing help off: a native-language message is sent as typed, with no model call', { options: { readingLevel: '1', typingHelp: false } }, async ($, on) => {
  const { received, calls } = await send($, on, JAPANESE)
  expect(received).toBe(JAPANESE)
  expect(calls).toBe(0)
})

test('levels 1 and 2: the model receives the person’s own words, with nothing beside them', { options: { readingLevel: '2' } }, async ($, on) => {
  const { received } = await send($, on, JAPANESE)
  expect(received).toBe(JAPANESE)
})

test('a message in the learned language is sent as typed and corrected beside the conversation', async ($, on) => {
  const { received, calls } = await send($, on, ENGLISH, 'I want to test the correction feature with this sentence.\n---\n- want to + 原形')
  expect(received).toBe(ENGLISH)
  expect(calls).toBe(1)
})

test('typing help off: a message in the learned language costs no model call', { options: { typingHelp: false } }, async ($, on) => {
  const { received, calls } = await send($, on, ENGLISH)
  expect(received).toBe(ENGLISH)
  expect(calls).toBe(0)
})

test('Off with typing help off: nothing is done to anything typed', { options: { readingLevel: 'Off', typingHelp: false } }, async ($, on) => {
  expect((await send($, on, JAPANESE)).received).toBe(JAPANESE)
})

test('a third language is sent as typed, with no model call', async ($, on) => {
  const korean = '이 함수를 리팩터링해 주세요'
  const { received, calls } = await send($, on, korean)
  expect(received).toBe(korean)
  expect(calls).toBe(0)
})

test('a slash command and a word or two are sent as typed, with no model call', async ($, on) => {
  const { received, calls } = await send($, on, 'yes')
  expect(received).toBe('yes')
  expect(calls).toBe(0)
})

// --- a pair that shares its letters: the model says which language it is ------------------------------

const SPANISH = { options: { nativeLanguage: 'Spanish' } }
const TYPED = 'Por favor cambia el nombre de esta variable'

test('shared alphabet, judged native: the message reaches the model in the learned language', SPANISH, async ($, on) => {
  const { received, calls } = await send($, on, TYPED, 'N\nPlease rename this variable.')
  expect(received).toBe('Please rename this variable.')
  expect(calls).toBe(1)
})

test('shared alphabet, judged to be the learned language: sent as typed', SPANISH, async ($, on) => {
  const typed = 'Please rename this variable for me'
  const { received, calls } = await send($, on, typed, 'T\nOK')
  expect(received).toBe(typed)
  expect(calls).toBe(1)
})

test('shared alphabet, judged neither: sent as typed', SPANISH, async ($, on) => {
  const { received } = await send($, on, TYPED, 'X')
  expect(received).toBe(TYPED)
})

test('shared alphabet with nothing to do either way costs no model call', { options: { nativeLanguage: 'Spanish', readingLevel: '1', typingHelp: false } }, async ($, on) => {
  const { received, calls } = await send($, on, TYPED, 'N\nPlease rename this variable.')
  expect(received).toBe(TYPED)
  expect(calls).toBe(0)
})

// Seen on the author's screen: commentary in English where the correction should have been.
const CHATTY = 'The message is in English, and it is not quite natural. "Want to testing" should be "want to test", and the sentence needs a full stop at its end. A natural version would be:\n\nI want to test the correction feature with this sentence.'
const GOOD = 'I want to test the correction feature with this sentence.\n---\n- want to のあとは動詞の原形'

const typedMessage = (text: string) =>
  ({ plugin: 'cc-immerse', component: 'UserMessage', requestId: 'u1', surface: 'terminal', props: { text, origin: { kind: 'composer' }, isExpanded: false }, viewport: { columns: 80, rows: 40 } }) as const

test('regression: a correction that came back as commentary is asked for once more, and the second answer is what is shown', async ($, on) => {
  const clock = mock.clock(on)
  const systems: string[] = []
  on('model.complete', (_: unknown, e: { system?: string }) => {
    systems.push(String(e.system))
    return { value: { isAnswered: true as const, text: systems.length === 1 ? CHATTY : GOOD, usage: USAGE } }
  })
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  await ($ as any).prompt.submit({ text: ENGLISH })
  await clock.advance(10)
  await clock.settle()
  expect(systems.length).toBe(2)
  expect(systems[1]).toContain('part 2 in Japanese')
  const ui = await $.ui.mount(typedMessage(ENGLISH))
  expect(await ui.find({ type: 'Text', text: 'I want to test the correction feature with this sentence.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /want to のあとは動詞の原形/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /not quite natural/ })).toBeUndefined()
  await ui.unmount()
})

test('regression: commentary twice over shows nothing, never the commentary', async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true as const, text: CHATTY, usage: USAGE } }
  })
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  await ($ as any).prompt.submit({ text: ENGLISH })
  await clock.advance(10)
  await clock.settle()
  expect(calls).toBe(2)
  const ui = await $.ui.mount(typedMessage(ENGLISH))
  expect(await ui.find({ type: 'Text', text: /not quite natural/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /↳/ })).toBeUndefined()
  await ui.unmount()
})

// Seen in the author's sessions: at level 1, in a session that had been in English, a message typed in
// Japanese went as typed and Claude went on answering in English, which the plugin then translated, block
// by block, into Japanese.
test('regression: level 1, a native-language message goes as typed with a note beside it to answer in that language', { options: { readingLevel: '1' } }, async ($, on) => {
  const { received, context, calls } = await send($, on, JAPANESE)
  expect(received).toBe(JAPANESE)
  expect(context).toEqual(['Reply in Japanese, the language of their message.'])
  // One call, for the English shown under the message (no preview was made of this draft); the note costs none.
  expect(calls).toBe(1)
})

test('level 2: the same note', { options: { readingLevel: '2' } }, async ($, on) => {
  const { received, context } = await send($, on, JAPANESE)
  expect(received).toBe(JAPANESE)
  expect(context).toEqual(['Reply in Japanese, the language of their message.'])
})

test('level 1, a message in the learned language: nothing is said to Claude, which answers in the language it is asked in', { options: { readingLevel: '1' } }, async ($, on) => {
  const { received, context } = await send($, on, ENGLISH, 'OK')
  expect(received).toBe(ENGLISH)
  expect(context).toEqual([])
})

test('Off: nothing is said to Claude', { options: { readingLevel: 'Off' } }, async ($, on) => {
  const { received, context } = await send($, on, JAPANESE)
  expect(received).toBe(JAPANESE)
  expect(context).toEqual([])
})

// The author, at level 2: "why does the English not show after sending?" While typing it shows above the
// prompt box, and it was gone once the message was sent.
test('regression: level 2, a native-language message sent as typed has its English under it, marked as only shown', { options: { readingLevel: '2' } }, async ($, on) => {
  const { received } = await send($, on, JAPANESE)
  expect(received).toBe(JAPANESE)
  const ui = await $.ui.mount(typedMessage(JAPANESE))
  expect(await ui.find({ type: 'Text', text: 'EN ▸ Is there a cooler name for this?' })).toBeDefined()
  await ui.unmount()
})

test('the English the preview already made is shown under the message, with no further call', { options: { readingLevel: '1' } }, async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true as const, text: 'Is there a cooler name for this?', usage: USAGE } }
  })
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  // The preview has done this draft: its English is in the draft's state.
  const draft = { src: JAPANESE, english: 'Is there a cooler name for this?', status: 'done', label: 'EN', sends: false }
  on('state.get', ((_: unknown, e: { key: string }) => ({ value: { value: e.key === 'draft' ? draft : undefined, version: e.key === 'draft' ? 1 : 0 } })) as any)
  await ($ as any).prompt.submit({ text: JAPANESE })
  await clock.advance(10)
  await clock.settle()
  expect(calls).toBe(0)
})

test('help while typing off: nothing is shown under the message and nothing is asked', { options: { readingLevel: '2', typingHelp: false } }, async ($, on) => {
  const { calls } = await send($, on, JAPANESE)
  expect(calls).toBe(0)
  const ui = await $.ui.mount(typedMessage(JAPANESE))
  expect(await ui.find({ type: 'Text', text: /EN ▸/ })).toBeUndefined()
  await ui.unmount()
})

// Read aloud: the learned-language line under a sent message is spoken with edge-tts and afplay, as the
// author's syntax project reads its sentences.

/** Sends `text` with read aloud as set, and keeps every command run. `edgeTts`: whether edge-tts is there. */
async function sendAloud($: any, on: any, text: string, answer: string, edgeTts = true) {
  const clock = mock.clock(on)
  const runs: string[][] = []
  const spoken: string[] = []
  on('model.complete', () => ({ value: { isAnswered: true as const, text: answer, usage: USAGE } }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('process.run', ((_: unknown, e: { argv: readonly string[] }) => {
    runs.push([...e.argv])
    if (e.argv[0] === 'edge-tts' && !edgeTts) throw new Error('spawn edge-tts ENOENT')
    const stdout = e.argv[0] === 'say' ? 'Kyoko               ja_JP    # こんにちは\nSamantha            en_US    # Hello! My name is Samantha.' : ''
    return { value: { exitCode: 0, stdout, stderr: '' } }
  }) as any)
  // The sound plays as a child of its own, so that switching read aloud off, which loads the plugin again,
  // stops it where it is.
  on('process.spawn', (async function* (_: unknown, e: { argv: readonly string[] }) {
    runs.push(['spawn', ...e.argv])
    return { value: { code: 0, signal: null } }
  }) as any)
  on('audio.speak', ((_: unknown, e: { text: string; voice?: string }) => {
    spoken.push(`${e.voice ?? '(default)'}: ${e.text}`)
    return { value: { synthesizer: 'say' } }
  }) as any)
  await $.prompt.submit({ text })
  await clock.advance(10)
  await clock.settle()
  await clock.advance(10)
  await clock.settle()
  return { runs, spoken }
}

test('level 4, read aloud on: the English that was sent is read in an English voice, then played', { options: { readAloud: true } }, async ($, on) => {
  const { runs } = await sendAloud($, on, JAPANESE, 'Is there a cooler name for this?')
  const tts = runs.find(r => r[0] === 'edge-tts') ?? []
  expect(tts).toContain('en-US-AriaNeural')
  expect(tts).toContain('Is there a cooler name for this?')
  const file = tts[tts.indexOf('--write-media') + 1]
  expect(runs.some(r => r[0] === 'spawn' && r[1] === 'afplay' && r[2] === file)).toBe(true)
})

test('level 2, read aloud on: the English shown under the message is read', { options: { readingLevel: '2', readAloud: true } }, async ($, on) => {
  const { runs } = await sendAloud($, on, JAPANESE, 'Is there a cooler name for this?')
  expect(runs.find(r => r[0] === 'edge-tts')).toContain('Is there a cooler name for this?')
})

test('an English message with a correction: the corrected sentence is read', { options: { readAloud: true } }, async ($, on) => {
  const { runs } = await sendAloud($, on, ENGLISH, 'I want to test the correction feature with this sentence.\n---\n- want to のあとは原形')
  expect(runs.find(r => r[0] === 'edge-tts')).toContain('I want to test the correction feature with this sentence.')
})

test('read aloud off, as with nothing set: no command is run', async ($, on) => {
  const { runs, spoken } = await sendAloud($, on, JAPANESE, 'Is there a cooler name for this?')
  expect(runs).toEqual([])
  expect(spoken).toEqual([])
})

test('without edge-tts a system voice of the learned language reads it', { options: { readAloud: true } }, async ($, on) => {
  const { spoken } = await sendAloud($, on, JAPANESE, 'Is there a cooler name for this?', false)
  expect(spoken).toEqual(['Samantha: Is there a cooler name for this?'])
})

// Seen in the author's link-life session with read aloud on: a background task's notification came in as a
// prompt, the plugin took it for a message typed in Japanese, and read its English aloud at length. At levels
// 3 and 4 it would have sent the notification to Claude in English in place of what it said.
const NOTIFICATION = '<task-notification>\n<task-id>a591f05f9dfd2df75</task-id>\n<summary>記事の下書きを書き終えました。読者役のテストも通っています。</summary>\n</task-notification>'

test('regression: a background task\'s notification is left alone: sent as it came, nothing said beside it, nothing read aloud', { options: { readAloud: true } }, async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  const runs: string[][] = []
  let received: { text?: string; context?: readonly string[] } = {}
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true as const, text: 'I finished the draft.', usage: USAGE } }
  })
  on('prompt.submit', (_: unknown, e: { text: string; context?: readonly string[] }) => {
    received = e
    return { text: e.text }
  })
  on('process.run', ((_: unknown, e: { argv: readonly string[] }) => {
    runs.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  }) as any)
  for (const kind of ['task-notification', 'peer-send-message', 'scheduled-trigger']) {
    await ($ as any).prompt.submit({ text: NOTIFICATION, origin: { kind } })
    await clock.advance(10)
    await clock.settle()
    expect(received.text).toBe(NOTIFICATION)
    expect(received.context ?? []).toEqual([])
  }
  expect(calls).toBe(0)
  expect(runs).toEqual([])
})

test('a message from the person by Remote Control is theirs, as one typed at the terminal is', async ($, on) => {
  const clock = mock.clock(on)
  let received = ''
  on('model.complete', () => ({ value: { isAnswered: true as const, text: 'Is there a cooler name for this?', usage: USAGE } }))
  on('prompt.submit', (_: unknown, e: { text: string }) => {
    received = e.text
    return { text: e.text }
  })
  await ($ as any).prompt.submit({ text: JAPANESE, origin: { kind: 'bridge' } })
  await clock.advance(10)
  await clock.settle()
  expect(received).toBe('Is there a cooler name for this?')
})
