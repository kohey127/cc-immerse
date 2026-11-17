// The language pair: which language a text is in, for any native and target language, and what the
// small model is asked. Written before hooks/lang.ts existed.
import { expect, test } from 'claude-code/testing'

import { againFixSystem, againSystem, classify, fixSystem, isFixMalformed, isMistranslated, isTargetText, judgeSystem, languageByName, pairOf, readFix, readJudgement, toTargetSystem, translateSystem } from '../hooks/lang'

const JA_EN = pairOf('Japanese', 'English')
const KO_EN = pairOf('Korean', 'English')
const ES_EN = pairOf('Spanish', 'English')
const EN_JA = pairOf('English', 'Japanese')
const ZH_JA = pairOf('Chinese (Simplified)', 'Japanese')
const RU_EN = pairOf('Russian', 'English')

// --- naming a language ----------------------------------------------------------------------------

test('a language is found by its English name, its own name or its code', async () => {
  expect(languageByName('Japanese')?.code).toBe('ja')
  expect(languageByName('日本語')?.code).toBe('ja')
  expect(languageByName('ja')?.code).toBe('ja')
  expect(languageByName(' korean ')?.code).toBe('ko')
  expect(languageByName('Klingon')).toBe(undefined)
})

test('an unknown or empty setting falls back to Japanese and English, the defaults', async () => {
  const pair = pairOf('', 'nonsense')
  expect([pair.native.code, pair.target.code]).toEqual(['ja', 'en'])
})

test('each language has a short tag for the buttons', async () => {
  expect(JA_EN.native.tag).toBe('JA')
  expect(JA_EN.target.tag).toBe('EN')
  expect(KO_EN.native.tag).toBe('KO')
})

// --- which language a typed message is in ----------------------------------------------------------

test('Japanese and English: told apart by their letters, with no model call', async () => {
  expect(classify('もっとかっこいい名前ないかね', JA_EN)).toBe('native')
  expect(classify('この関数を refactor して', JA_EN)).toBe('native')
  expect(classify('Is there a cooler name for this?', JA_EN)).toBe('target')
})

test('Korean and English, Russian and English: the same, by their own letters', async () => {
  expect(classify('이 함수를 리팩터링해 주세요', KO_EN)).toBe('native')
  expect(classify('Please refactor this function', KO_EN)).toBe('target')
  expect(classify('Переименуй эту переменную', RU_EN)).toBe('native')
  expect(classify('Rename this variable please', RU_EN)).toBe('target')
})

test('Spanish and English share an alphabet: the letters cannot say, so the model is asked', async () => {
  expect(classify('Por favor cambia el nombre de esta variable', ES_EN)).toBe('unsure')
  expect(classify('Please rename this variable', ES_EN)).toBe('unsure')
})

test('the pair the other way round: English native, Japanese learned', async () => {
  expect(classify('Please rename this variable', EN_JA)).toBe('native')
  expect(classify('この変数の名前を変えてください', EN_JA)).toBe('target')
})

test('Chinese native, Japanese learned: kana marks the Japanese; Han alone is taken as native', async () => {
  expect(classify('この変数の名前を変えてください', ZH_JA)).toBe('target')
  expect(classify('请把这个变量改个名字', ZH_JA)).toBe('native')
})

test('a third language is neither: it is left alone', async () => {
  // Korean typed by someone whose pair is Japanese and English.
  expect(classify('이 함수를 리팩터링해 주세요', JA_EN)).toBe('other')
  // Russian typed under the same pair.
  expect(classify('Переименуй эту переменную', JA_EN)).toBe('other')
})

test('text with no words to judge is neither: code, a URL, numbers', async () => {
  expect(classify('`npm run build`', JA_EN)).toBe('other')
  expect(classify('https://example.com/a/b', JA_EN)).toBe('other')
  expect(classify('42', JA_EN)).toBe('other')
  expect(classify('', JA_EN)).toBe('other')
})

// --- which chunks of a reply are in the learned language --------------------------------------------

test('a reply chunk in the learned language is offered; one in the native language is not', async () => {
  expect(isTargetText('The reload finished.', JA_EN)).toBe(true)
  expect(isTargetText('リロードが完了しました。', JA_EN)).toBe(false)
  expect(isTargetText('リロードが完了しました。', EN_JA)).toBe(true)
  expect(isTargetText('The reload finished.', EN_JA)).toBe(false)
})

test('a reply chunk under a shared alphabet is offered: opening it is the reader’s choice', async () => {
  expect(isTargetText('The reload finished.', ES_EN)).toBe(true)
})

test('a reply chunk in a third language is not offered', async () => {
  expect(isTargetText('이 함수를 리팩터링해 주세요', JA_EN)).toBe(false)
})

// --- what the small model is asked -----------------------------------------------------------------

test('the instructions name the pair, not Japanese and English', async () => {
  expect(translateSystem(KO_EN)).toContain('Korean')
  expect(translateSystem(KO_EN)).not.toContain('Japanese')
  expect(toTargetSystem(EN_JA)).toContain('natural Japanese')
  expect(fixSystem(ES_EN)).toContain('Spanish')
  expect(fixSystem(ES_EN)).toContain('English')
})

test('the correction is told to skip a message that is not in the learned language', async () => {
  // Romaji, or a third language in the same letters, reaches the correction: only the model can tell.
  expect(fixSystem(JA_EN)).toContain('SKIP')
})

test('the question for a shared alphabet asks for one of three answers', async () => {
  const system = judgeSystem(ES_EN)
  for (const answer of ['N', 'T', 'X']) expect(system).toContain(`"${answer}"`)
})

// --- reading what the small model answered -----------------------------------------------------------

test('a correction is read as the corrected sentence and its notes', async () => {
  const fix = readFix('I want to test this.\n---\n- want to のあとは原形\n・文末にピリオド')
  expect(fix).toEqual({ kind: 'fixed', corrected: 'I want to test this.', notes: ['want to のあとは原形', '文末にピリオド'] })
})

test('"OK" means nothing to correct, and "SKIP" means the message was not in the learned language', async () => {
  expect(readFix('OK')).toEqual({ kind: 'ok' })
  expect(readFix('OK\n---\n')).toEqual({ kind: 'ok' })
  expect(readFix(' SKIP ')).toEqual({ kind: 'skip' })
})

test('an empty answer is read as nothing to show', async () => {
  expect(readFix('')).toEqual({ kind: 'skip' })
})

test('the answer for a shared alphabet is read by its first line', async () => {
  expect(readJudgement('N\nPlease rename this variable.')).toEqual({ kind: 'native', target: 'Please rename this variable.' })
  expect(readJudgement('T\nOK')).toEqual({ kind: 'target', fix: 'OK' })
  expect(readJudgement('X')).toEqual({ kind: 'other' })
  expect(readJudgement('"N"\nHello there.')).toEqual({ kind: 'native', target: 'Hello there.' })
  expect(readJudgement('something else entirely')).toEqual({ kind: 'other' })
})

// --- a reply in one language holding words of the other ------------------------------------------------

test('regression: a Japanese sentence holding English words is Japanese', async () => {
  // Seen on a real screen: "main ブランチで…" was taken for neither language, so a Japanese reply got no translation.
  for (const text of ['main ブランチでビルドが通りました。', 'git の rebase と merge の違いを説明します。', 'README を更新しました。']) {
    expect({ text, isJapanese: isTargetText(text, EN_JA), isEnglish: isTargetText(text, JA_EN) }).toEqual({ text, isJapanese: true, isEnglish: false })
  }
})

test('an English sentence holding a Japanese word is English', async () => {
  const text = 'The 設定 file is in the config folder of the project.'
  expect(isTargetText(text, JA_EN)).toBe(true)
  expect(isTargetText(text, EN_JA)).toBe(false)
})

// Seen on the author's screen: a block about the Spanish pictures came back in Spanish, under a reply read
// by a Japanese speaker, and was shown as its translation.
test('regression: a translation that is not in the language asked for is known as one, where the letters can say', async () => {
  const pair = pairOf('Japanese', 'English')
  expect(isMistranslated('## Qué cambió\n\n- Respuestas: cuando ambos idiomas se muestran siempre, el complemento dibuja las dos tablas.', pair)).toBe(true)
  expect(isMistranslated('## 変更点\n\n- 返信: 両方の言語が常に表示される場合、プラグインは2つの表を並べて描きます。', pair)).toBe(false)
  // A translation that keeps a name or a command in Latin letters is still Japanese.
  expect(isMistranslated('main ブランチで /reload-plugins を実行してください。', pair)).toBe(false)
  // The other way: English was asked for and Japanese came back.
  expect(isMistranslated('ビルドが通りました。テストは2件失敗しました。', { native: pair.target, target: pair.native })).toBe(true)
  // Too short to say, and a pair that shares its letters cannot say at all.
  expect(isMistranslated('OK', pair)).toBe(false)
  expect(isMistranslated('La compilación pasó en la rama principal.', pairOf('English', 'Spanish'))).toBe(false)
})

test('asking again says which language the answer must be in', async () => {
  const pair = pairOf('Japanese', 'English')
  const again = againSystem(translateSystem(pair), pair)
  expect(again.startsWith(translateSystem(pair))).toBe(true)
  expect(again).toContain('must be in Japanese')
})

// Seen on the author's screen: typed "cafe is also ok if there is no suitable one.", and the line above the
// prompt box held a paragraph of commentary in English, where the corrected sentence should have been.
test('regression: an answer that is commentary, or whose notes are not in the native language, is not a correction', async () => {
  const pair = pairOf('Japanese', 'English')
  const typed = 'cafe is also ok if there is no suitable one.'
  const chatty =
    'The message is in English, and it is not quite natural. "Also ok" is a bit terse, and "if there is no suitable one" reads better as "if there isn\'t a suitable one" or "if nothing suitable is available." A natural version would be:\n\nCafes are also fine if there isn\'t a suitable option.'
  expect(isFixMalformed(chatty, typed, pair)).toBe(true)
  // The two parts, but the notes in English.
  expect(isFixMalformed("Cafes are also fine if there isn't a suitable option.\n---\n- \"ok\" is terse here, \"fine\" reads more naturally\n- \"one\" is vague, so say what it stands for", typed, pair)).toBe(true)
  // As asked for.
  expect(isFixMalformed("Cafes are also fine if there isn't a suitable option.\n---\n- ok より fine が自然\n- one が何を指すか曖昧なので option に", typed, pair)).toBe(false)
  expect(isFixMalformed('OK', typed, pair)).toBe(false)
  expect(isFixMalformed('SKIP', typed, pair)).toBe(false)
  // A rewrite somewhat longer than what was typed is still a rewrite.
  expect(isFixMalformed("A cafe is also fine if there isn't a suitable place nearby.\n---\n- 冠詞 a が必要", typed, pair)).toBe(false)
})

test('asking again for a correction names the form and the language of the notes', async () => {
  const pair = pairOf('Japanese', 'English')
  const again = againFixSystem(fixSystem(pair), pair)
  expect(again.startsWith(fixSystem(pair))).toBe(true)
  expect(again).toContain('part 2 in Japanese')
})

// Seen on the author's screen under a one-line block: the small model translated, then wrote "Wait, I should
// translate only. Corrected:" and translated again, and all three paragraphs were shown as the translation.
test('regression: a translation with a paragraph in another language among its own is known as wrong', async () => {
  const pair = pairOf('Japanese', 'English')
  const answer = '以下の役割が以前とは違っていた理由は三つあった。\n\nWait, I should translate only. Corrected:\n\nその役割を以前とは違うものにした要因'
  expect(isMistranslated(answer, pair)).toBe(true)
  // A heading and its paragraph, both in Japanese, are two paragraphs and fine.
  expect(isMistranslated('変更点\n\n両方の言語が常に表示される場合、表は左右に並びます。', pair)).toBe(false)
  // A short line in Latin letters between them (a command, a name) is not a paragraph of prose.
  expect(isMistranslated('次のコマンドを実行します。\n\nbun test\n\nすべて通れば完了です。', pair)).toBe(false)
})
