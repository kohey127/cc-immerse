// Recordings 3 and 4 of the README, at level 4: a message typed in Japanese is previewed and sent in English;
// a message typed in English with a mistake is sent as typed and corrected under it.

import { expect, setDefaultTimeout, test } from 'bun:test'

import { open } from '../term'

setDefaultTimeout(90000)

test('Japanese: the preview shows the English, Enter sends the English, ↳ shows it under the message', async () => {
  const typed = 'ビルドの状態を教えてください。'
  const english = 'Tell me the status of the build.'
  const s = await open({ record: 'typing-japanese', script: { replies: ['The build passed.'], small: { toTarget: { [typed]: english }, translate: {} }, smallDelayMs: 400 } })
  try {
    await s.ask(typed, `EN ▸ ${english}`)
    const screen = await s.screen()
    const message = screen.findIndex(line => line.startsWith('❯') && line.includes(typed))
    expect(message).toBeGreaterThanOrEqual(0)
    expect(screen[message + 1]?.trimEnd()).toBe(`  ↳ ${english}`)
    // Claude gets the English as the message, and the person's own words beside it so that no meaning is lost.
    const blocks = (s.model.requests[0] ?? []).flatMap(m => ((m as { content?: unknown }).content as { text?: string }[] | undefined) ?? []).map(b => b.text ?? '')
    expect(blocks).toContain(english)
    expect(blocks.some(b => b.includes('<original-message') && b.includes(typed) && b.includes('Reply in English'))).toBe(true)
    expect(blocks).not.toContain(typed)
    expect(s.model.unscripted).toEqual([])
  } finally {
    await s.close()
  }
})

test('English with a mistake: the preview shows the correction, Enter sends what was typed, ↳ shows the correction and its notes', async () => {
  const typed = 'I has a question about build.'
  const corrected = 'I have a question about the build.'
  const notes = ['has → have: 主語が I のとき', 'build → the build: 特定のビルド']
  const s = await open({
    record: 'typing-english',
    script: { replies: ['Go ahead.'], small: { fix: { [typed]: `${corrected}\n---\n${notes.map(note => `- ${note}`).join('\n')}` } }, smallDelayMs: 400 },
  })
  try {
    await s.ask(typed, `FIX ▸ ${corrected}`)
    const screen = await s.screen()
    const message = screen.findIndex(line => line.startsWith('❯') && line.includes(typed))
    expect(screen.slice(message + 1, message + 4).map(line => line.trimEnd())).toEqual([`  ↳ ${corrected}`, `    ${notes[0]}`, `    ${notes[1]}`])
    expect(s.model.turns[0]).toContain(typed)
    expect(s.model.turns[0]).not.toContain(corrected)
    expect(s.model.unscripted).toEqual([])
  } finally {
    await s.close()
  }
})

test('after a message is sent, the line above the empty prompt box is gone', async () => {
  const typed = 'What is the build status?'
  const s = await open({ script: { replies: ['The build passed.'], small: { fix: { [typed]: 'OK' } } } })
  try {
    await s.ask(typed, 'FIX ▸ ✓')
    await Bun.sleep(1500)
    expect((await s.screen()).filter(line => line.startsWith('FIX ▸') || line.startsWith('EN ▸'))).toEqual([])
  } finally {
    await s.close()
  }
})
