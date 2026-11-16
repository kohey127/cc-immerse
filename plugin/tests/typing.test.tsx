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
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: true as const, text: answer, usage: USAGE } }
  })
  on('prompt.submit', (_: unknown, e: { text: string }) => {
    received = e.text
    return { text: e.text }
  })
  await $.prompt.submit({ text })
  await clock.advance(10)
  await clock.settle()
  return { received, calls }
}

test('a message in the native language reaches the model in the learned one', async ($, on) => {
  const { received, calls } = await send($, on, JAPANESE)
  expect(received).toBe('Is there a cooler name for this?')
  expect(calls).toBe(1)
})

test('"Leave it alone": a native-language message is sent as typed, with no model call', { options: { nativeInput: 'Leave it alone' } }, async ($, on) => {
  const { received, calls } = await send($, on, JAPANESE)
  expect(received).toBe(JAPANESE)
  expect(calls).toBe(0)
})

test('"Show it, send as typed": the model receives the person’s own words', { options: { nativeInput: 'Show it, send as typed' } }, async ($, on) => {
  const { received } = await send($, on, JAPANESE)
  expect(received).toBe(JAPANESE)
})

test('a message in the learned language is sent as typed and corrected beside the conversation', async ($, on) => {
  const { received, calls } = await send($, on, ENGLISH, 'I want to test the correction feature with this sentence.\n---\n- want to + 原形')
  expect(received).toBe(ENGLISH)
  expect(calls).toBe(1)
})

test('corrections Off: a message in the learned language costs no model call', { options: { corrections: 'Off' } }, async ($, on) => {
  const { received, calls } = await send($, on, ENGLISH)
  expect(received).toBe(ENGLISH)
  expect(calls).toBe(0)
})

test('both kinds of typing help off: nothing is done to anything typed', { options: { nativeInput: 'Leave it alone', corrections: 'Off' } }, async ($, on) => {
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

test('shared alphabet with nothing to do either way costs no model call', { options: { nativeLanguage: 'Spanish', nativeInput: 'Leave it alone', corrections: 'Off' } }, async ($, on) => {
  const { received, calls } = await send($, on, TYPED, 'N\nPlease rename this variable.')
  expect(received).toBe(TYPED)
  expect(calls).toBe(0)
})
