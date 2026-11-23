// What is typed, checked for what it does to a real screen and to what Claude gets: the switch "Help while
// typing", the learned language typed at any level, and the two languages of the pair. The levels are in
// levels.test.ts; that the list writes these settings is in settings.test.ts.

import { expect, setDefaultTimeout, test } from 'bun:test'

import { pairOf } from '../../plugin/hooks/lang'
import type { Script } from '../model'
import { open } from '../term'
import type { Session } from '../term'

const FIRST = 'The build passed on the main branch.'
const SECOND = 'Two tests are still slow.'
const FIRST_JA = 'main ブランチでビルドが通りました。'
const ASKED = 'What is the build status?'
const TYPED_JA = 'ビルドの状態を教えてください。'
const TYPED_EN = 'Tell me the status of the build.'
const WRONG = 'I has a question about build.'
const RIGHT = 'I have a question about the build.'

setDefaultTimeout(120000)

const SCRIPT: Script = {
  replies: [`${FIRST}\n\n${SECOND}`],
  small: { translate: { [FIRST]: FIRST_JA, [SECOND]: 'テストが2つ遅いままです。' }, fix: { [ASKED]: 'OK', [WRONG]: `${RIGHT}\n---\n- has → have` }, toTarget: { [TYPED_JA]: TYPED_EN } },
}

async function withOptions(options: Record<string, string | boolean>, body: (s: Session) => Promise<void>, script: Script = SCRIPT): Promise<void> {
  const s = await open({ cols: 100, rows: 36, options, script })
  try {
    await body(s)
  } finally {
    await s.close()
  }
}

const hasLine = async (s: Session, start: string): Promise<boolean> => (await s.screen()).some(line => line.startsWith(start))
const kinds = (s: Session): string[] => s.model.calls.map(call => call.kind)
const first = (s: Session): string => s.model.turns[0] ?? ''

// --- Help while typing ---------------------------------------------------------------------------------

test('help while typing off, level 4: no line above the prompt box, and a Japanese message is still sent in English with the Japanese beside it', async () => {
  await withOptions({ typingHelp: false }, async s => {
    await s.type(TYPED_JA)
    await Bun.sleep(2500)
    expect(await hasLine(s, 'EN ▸')).toBe(false)
    await s.press('Enter')
    await s.waitFor(/^✻ .+ for \d+/)
    expect(first(s)).toContain(TYPED_EN)
    expect(first(s)).toContain('<original-message')
  })
})

test('help while typing off, level 1: nothing is shown or asked, and Claude gets the Japanese', async () => {
  await withOptions({ typingHelp: false, readingLevel: '1' }, async s => {
    await s.type(TYPED_JA)
    await Bun.sleep(2500)
    expect(await hasLine(s, 'EN ▸')).toBe(false)
    await s.press('Enter')
    await s.waitFor(/^✻ .+ for \d+/)
    expect(first(s)).toContain(TYPED_JA)
    expect(kinds(s)).not.toContain('toTarget')
  })
})

test('help while typing off: English typed is not corrected, and nothing is asked', async () => {
  await withOptions({ typingHelp: false }, async s => {
    await s.type(WRONG)
    await Bun.sleep(2500)
    expect(await hasLine(s, 'FIX ▸')).toBe(false)
    await s.press('Enter')
    await s.waitFor(/^✻ .+ for \d+/)
    await Bun.sleep(1500)
    expect(await s.rowOf('↳')).toBe(-1)
    expect(kinds(s)).not.toContain('fix')
  })
})

// --- the learned language typed: the same at every level ---------------------------------------------

for (const level of ['1', '4']) {
  test(`level ${level}, English typed: FIX ▸ as you type, ↳ under the message, and Claude gets what was typed with nothing beside it`, async () => {
    await withOptions({ readingLevel: level }, async s => {
      await s.ask(WRONG, `FIX ▸ ${RIGHT}`)
      await s.waitFor(`↳ ${RIGHT}`)
      expect(first(s)).toContain(WRONG)
      expect(first(s)).not.toContain(RIGHT)
      expect(first(s)).not.toContain('<original-message')
    })
  })
}

// --- the languages -------------------------------------------------------------------------------------

test('Your language · Korean: the translation is asked for in Korean, and the buttons say KO', async () => {
  const KO = '메인 브랜치에서 빌드가 통과했습니다.'
  const script: Script = { replies: [`${FIRST}\n\n${SECOND}`], pair: pairOf('Korean', 'English'), small: { translate: { [FIRST]: KO, [SECOND]: KO }, fix: { [ASKED]: 'OK' } } }
  await withOptions({ nativeLanguage: 'Korean' }, async s => {
    await s.ask(ASKED, 'FIX ▸')
    expect(await s.rowOf('ALL KO OPEN')).toBeGreaterThanOrEqual(0)
    await s.click(await s.rowOf(FIRST), 0)
    await s.waitFor(KO)
    expect(s.model.unscripted).toEqual([])
  }, script)
})

test('You are learning · Japanese, with English your own, level 4: a Japanese reply is read as it is, an English block in it too, each with the other language behind its mark', async () => {
  const EN = 'The build passed.'
  // All Japanese: a Japanese sentence holding an English word ("main ブランチ…") is not taken for Japanese today, see lang.ts.
  const JA = 'ビルドが通りました。テストも全部通っています。'
  const JA_OF_FIRST = 'メインブランチでビルドが通りました。'
  const script: Script = { replies: [`${JA}\n\n${FIRST}`], pair: pairOf('English', 'Japanese'), small: { translate: { [JA]: EN }, translateBack: { [FIRST]: JA_OF_FIRST }, toTarget: { [ASKED]: 'ビルドの状態は？' } } }
  await withOptions({ nativeLanguage: 'English', targetLanguage: 'Japanese' }, async s => {
    await s.ask(ASKED)
    // The reply is mostly Japanese, the language read first: its English block is part of what was said and
    // stays as written (it was once swapped for its Japanese, and a draft asked for in English was lost).
    await s.waitFor(FIRST)
    expect(await s.rowOf(JA_OF_FIRST)).toBe(-1)
    await s.click(await s.rowOf(FIRST), 0)
    await s.waitFor(JA_OF_FIRST)
    await s.click(await s.rowOf(JA), 0)
    await s.waitFor(EN)
    expect(s.model.unscripted).toEqual([])
  }, script)
})
