// Recording 5 of the README: the same question at each level.
//
// Levels 1 and 2 are with Claude in the native language: the question is sent as typed, Claude answers in
// it, and the learned language is the translation. Levels 3 and 4 are with Claude in the learned language:
// the question is sent in it with the person's own words beside it, and Claude answers in it.

import { expect, setDefaultTimeout, test } from 'bun:test'

import type { Script } from '../model'
import { open } from '../term'
import type { Session } from '../term'

const TYPED = 'ビルドの状態を教えてください。'
const TYPED_EN = 'Tell me the status of the build.'
const EN = ['The build passed on the main branch, and every check ran in under a minute.', '- The unit tests took 12 seconds.\n- The screen checks took 45 seconds.'] as const
const JA = ['main ブランチでビルドが通り、すべてのチェックが1分以内に終わりました。', '- 単体テストは12秒かかりました。\n- 画面チェックは45秒かかりました。'] as const

setDefaultTimeout(120000)

/** With Claude in the native language: it answers in Japanese, and the plugin puts that into English. */
const NATIVE: Script = {
  replies: [JA.join('\n\n')],
  small: { toTarget: { [TYPED]: TYPED_EN }, translateBack: { [JA[0]]: EN[0], [JA[1]]: EN[1] } },
  smallDelayMs: 300,
}
/** With Claude in the learned language: it answers in English, and the plugin puts that into Japanese. */
const LEARNED: Script = {
  replies: [EN.join('\n\n')],
  small: { toTarget: { [TYPED]: TYPED_EN }, translate: { [EN[0]]: JA[0], [EN[1]]: JA[1] } },
  smallDelayMs: 300,
}

function at(level: string, script: Script, cols = 130): Promise<Session> {
  return open({ cols, rows: 40, options: { readingLevel: level }, record: `level-${level}`, script })
}

/** The colours of the cells of `text` on its row. */
async function coloursOf(s: Session, text: string): Promise<string[]> {
  const row = await s.rowOf(text)
  const line = (await s.screen())[row] ?? ''
  const from = [...line.slice(0, line.indexOf(text))].reduce((w, ch) => w + (/[　-鿿＀-￯]/.test(ch) ? 2 : 1), 0)
  const cells = (await s.cells(row)).filter(cell => cell.x >= from && cell.x < from + 8)
  return [...new Set(cells.map(cell => String(cell.fg)))]
}

/** What the first turn handed Claude: the message, and whether the person's own words went beside it. */
function sent(s: Session): { text: string; hasOriginal: boolean } {
  const text = s.model.turns[0] ?? ''
  return { text, hasOriginal: text.includes('<original-message') }
}

test('level 1: with Claude in Japanese. Sent as typed, the reply read in Japanese, English behind the mark', async () => {
  const s = await at('1', NATIVE)
  try {
    await s.ask(TYPED, `EN ▸ ${TYPED_EN}`)
    expect(sent(s).text).toContain(TYPED)
    expect(sent(s)).toEqual({ text: sent(s).text, hasOriginal: false })
    expect(sent(s).text).not.toContain(TYPED_EN)
    // Nothing is translated until asked for.
    expect(s.model.calls.filter(c => c.kind === 'translateBack')).toEqual([])
    expect(await coloursOf(s, 'main ブランチ')).toEqual(['default'])
    await s.shot('level-1')
    const row = await s.rowOf('main ブランチ')
    await s.move(row, 10)
    expect((await s.screen())[row]?.startsWith('▸')).toBe(true)
    await s.click(row, 0)
    await s.waitFor('The build passed')
    expect(await s.rowOf('The build passed')).toBe(row + 1)
    expect(await coloursOf(s, 'The build passed')).not.toEqual(['default'])
    expect(await s.rowOf('ALL EN OPEN')).toBeGreaterThan(row)
    await s.shot('level-1-open')
    expect(s.model.unscripted).toEqual([])
  } finally {
    await s.close()
  }
})

test('level 2: with Claude in Japanese. Two columns, Japanese on the left, its English on the right, faint', async () => {
  const s = await at('2', NATIVE)
  try {
    await s.ask(TYPED, `EN ▸ ${TYPED_EN}`)
    expect(sent(s).text).toContain(TYPED)
    expect(sent(s).hasOriginal).toBe(false)
    await s.waitFor('The build passed')
    await s.waitFor('The unit tests took')
    const screen = await s.screen()
    const row = await s.rowOf('main ブランチ')
    expect(row).toBe(await s.rowOf('The build passed'))
    expect((screen[row] ?? '').indexOf('main ブランチ')).toBeLessThan((screen[row] ?? '').indexOf('The build passed'))
    expect(await coloursOf(s, 'main ブランチ')).toEqual(['default'])
    expect(await coloursOf(s, 'The build passed')).not.toEqual(['default'])
    await s.shot('level-2')
    expect(s.model.unscripted).toEqual([])
  } finally {
    await s.close()
  }
})

test('level 3: with Claude in English. Sent in English with the Japanese beside it; English on the left, its Japanese on the right, faint', async () => {
  const s = await at('3', LEARNED)
  try {
    await s.ask(TYPED, `EN ▸ ${TYPED_EN}`)
    expect(sent(s).text).toContain(TYPED_EN)
    expect(sent(s).hasOriginal).toBe(true)
    expect(sent(s).text).toContain(TYPED)
    await s.waitFor('main ブランチ')
    await s.waitFor('単体テストは12秒')
    const screen = await s.screen()
    const row = await s.rowOf('The build passed')
    expect(row).toBe(await s.rowOf('main ブランチ'))
    expect((screen[row] ?? '').indexOf('The build passed')).toBeLessThan((screen[row] ?? '').indexOf('main ブランチ'))
    expect(await coloursOf(s, 'The build passed')).toEqual(['default'])
    expect(await coloursOf(s, 'main ブランチ')).not.toEqual(['default'])
    // The person's own words are for Claude, not for the screen.
    expect(screen.some(line => line.includes('original-message') || line.includes('practising'))).toBe(false)
    await s.shot('level-3')
    expect(s.model.unscripted).toEqual([])
  } finally {
    await s.close()
  }
})

test('level 4: with Claude in English. Sent in English with the Japanese beside it; nothing more drawn until the mark is pressed', async () => {
  const s = await at('4', LEARNED)
  try {
    await s.ask(TYPED, `EN ▸ ${TYPED_EN}`)
    expect(sent(s).text).toContain(TYPED_EN)
    expect(sent(s).hasOriginal).toBe(true)
    expect(await s.rowOf('The build passed')).toBeGreaterThanOrEqual(0)
    expect(await s.rowOf('main ブランチ')).toBe(-1)
    expect(s.model.calls.filter(c => c.kind === 'translate')).toEqual([])
    await s.shot('level-4')
  } finally {
    await s.close()
  }
})

test('level 4, and Claude answers in Japanese all the same: the reply is read in English, the Japanese behind the mark', async () => {
  const s = await at('4', NATIVE)
  try {
    await s.ask(TYPED, `EN ▸ ${TYPED_EN}`)
    await s.waitFor('The build passed')
    await s.waitFor('The unit tests took')
    expect(await s.rowOf('main ブランチ')).toBe(-1)
    expect(await coloursOf(s, 'The build passed')).toEqual(['default'])
    expect(s.model.unscripted).toEqual([])
  } finally {
    await s.close()
  }
})

test('level 2 in a narrow window: the English goes below the Japanese', async () => {
  const s = await at('2', NATIVE, 70)
  try {
    await s.ask(TYPED, `EN ▸ ${TYPED_EN}`)
    await s.waitFor('The build passed')
    expect(await s.rowOf('The build passed')).toBeGreaterThan(await s.rowOf('main ブランチ'))
    await s.shot('level-2-narrow')
  } finally {
    await s.close()
  }
})

test('Off: sent as typed, and the reply left as Claude wrote it', async () => {
  const s = await at('Off', NATIVE)
  try {
    await s.ask(TYPED, `EN ▸ ${TYPED_EN}`)
    expect(sent(s).text).toContain(TYPED)
    expect(sent(s).hasOriginal).toBe(false)
    await s.move(await s.rowOf('main ブランチ'), 10)
    expect(((await s.screen())[await s.rowOf('main ブランチ')] ?? '').startsWith('▸')).toBe(false)
    expect(await s.rowOf('ALL EN OPEN')).toBe(-1)
    expect(s.model.calls.filter(c => c.kind === 'translateBack')).toEqual([])
  } finally {
    await s.close()
  }
})
