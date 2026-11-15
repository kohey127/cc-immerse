// The language pair: the person's own language and the one they are learning. Which of the two a text is
// in, and what the small model is asked, for any pair. Pure functions (tests/lang.test.ts).

/** A writing system, as far as telling two languages apart needs. */
export type Script = 'latin' | 'kana' | 'han' | 'hangul' | 'cyrillic' | 'arabic' | 'devanagari' | 'thai' | 'greek' | 'hebrew'

/** `name`: in English, as the model is told it. `own`: as its speakers write it. `tag`: on the buttons. */
export type Language = { code: string; name: string; own: string; tag: string; scripts: readonly Script[] }

/** The person's own language and the one they are learning. */
export type Pair = { native: Language; target: Language }

const SCRIPTS: Record<Script, RegExp> = {
  latin: /\p{Script=Latin}/u,
  kana: /[\p{Script=Hiragana}\p{Script=Katakana}]/u,
  han: /\p{Script=Han}/u,
  hangul: /\p{Script=Hangul}/u,
  cyrillic: /\p{Script=Cyrillic}/u,
  arabic: /\p{Script=Arabic}/u,
  devanagari: /\p{Script=Devanagari}/u,
  thai: /\p{Script=Thai}/u,
  greek: /\p{Script=Greek}/u,
  hebrew: /\p{Script=Hebrew}/u,
}

const language = (code: string, name: string, own: string, scripts: readonly Script[]): Language => ({
  code,
  name,
  own,
  tag: code.slice(0, 2).toUpperCase(),
  scripts,
})

export const LANGUAGES: readonly Language[] = [
  language('en', 'English', 'English', ['latin']),
  language('ja', 'Japanese', '日本語', ['kana', 'han']),
  language('ko', 'Korean', '한국어', ['hangul']),
  language('zh-Hans', 'Chinese (Simplified)', '简体中文', ['han']),
  language('zh-Hant', 'Chinese (Traditional)', '繁體中文', ['han']),
  language('es', 'Spanish', 'Español', ['latin']),
  language('fr', 'French', 'Français', ['latin']),
  language('de', 'German', 'Deutsch', ['latin']),
  language('pt', 'Portuguese', 'Português', ['latin']),
  language('it', 'Italian', 'Italiano', ['latin']),
  language('nl', 'Dutch', 'Nederlands', ['latin']),
  language('pl', 'Polish', 'Polski', ['latin']),
  language('tr', 'Turkish', 'Türkçe', ['latin']),
  language('vi', 'Vietnamese', 'Tiếng Việt', ['latin']),
  language('id', 'Indonesian', 'Bahasa Indonesia', ['latin']),
  language('ru', 'Russian', 'Русский', ['cyrillic']),
  language('uk', 'Ukrainian', 'Українська', ['cyrillic']),
  language('ar', 'Arabic', 'العربية', ['arabic']),
  language('hi', 'Hindi', 'हिन्दी', ['devanagari']),
  language('th', 'Thai', 'ไทย', ['thai']),
  language('el', 'Greek', 'Ελληνικά', ['greek']),
  language('he', 'Hebrew', 'עברית', ['hebrew']),
]

/** A language by its English name, its own name or its code; case and outer spaces do not matter. */
export function languageByName(name: string): Language | undefined {
  const wanted = name.trim().toLowerCase()
  if (wanted === '') return undefined
  return LANGUAGES.find(l => [l.code, l.name, l.own].some(n => n.toLowerCase() === wanted))
}

/** The pair two settings name. One that names no language, or the same one twice, gives the default it stands for. */
export function pairOf(nativeName: string, targetName: string): Pair {
  const japanese = languageByName('ja') as Language
  const english = languageByName('en') as Language
  const native = languageByName(nativeName) ?? japanese
  let target = languageByName(targetName) ?? english
  if (target.code === native.code) target = native.code === 'en' ? japanese : english
  return { native, target }
}

/** A text without what is never judged as language: fenced code, code spans, URLs. */
function proseOf(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/https?:\/\/\S+/g, '')
}

/** How many letters of a text are in the native language's letters alone, the target's alone, both, or neither. */
function tally(text: string, pair: Pair): { nativeOnly: number; targetOnly: number; shared: number; other: number } {
  const count = { nativeOnly: 0, targetOnly: 0, shared: 0, other: 0 }
  for (const ch of proseOf(text)) {
    if (!/\p{L}/u.test(ch)) continue
    const isNative = pair.native.scripts.some(s => SCRIPTS[s].test(ch))
    const isTarget = pair.target.scripts.some(s => SCRIPTS[s].test(ch))
    if (isNative && isTarget) count.shared++
    else if (isNative) count.nativeOnly++
    else if (isTarget) count.targetOnly++
    else count.other++
  }
  return count
}

/** Whether each language of the pair has letters the other does not. */
function ownLetters(pair: Pair): { native: boolean; target: boolean } {
  return {
    native: pair.native.scripts.some(s => !pair.target.scripts.includes(s)),
    target: pair.target.scripts.some(s => !pair.native.scripts.includes(s)),
  }
}

/**
 * Which language a typed message is in, by its letters alone.
 *
 * `native`: the person's own language, or a mix of the two (a mix is sent in the target language whole).
 * `target`: the language they are learning. `unsure`: the two share their letters, so only the model can
 * say. `other`: neither, a third language or nothing to judge, and the message is left alone.
 */
export function classify(text: string, pair: Pair): 'native' | 'target' | 'unsure' | 'other' {
  const { nativeOnly, targetOnly, shared, other } = tally(text, pair)
  const known = nativeOnly + targetOnly + shared
  if (known + other < 2 || other > known) return 'other'
  const own = ownLetters(pair)
  if (!own.native && !own.target) return 'unsure'
  if (own.native && nativeOnly >= 2) return 'native'
  if (own.target) {
    if (targetOnly >= 2) return 'target'
    // The target's own letters are missing: with a native language that has none of its own (Chinese beside
    // Japanese), what is left is the native language.
    return own.native ? 'other' : 'native'
  }
  // The target has no letters of its own (Chinese beside a Japanese speaker): no native-only letters, so target.
  return shared >= 2 ? 'target' : 'other'
}

/** Whether a chunk of a reply is in the learned language, and so worth offering a translation of. */
export function isTargetText(text: string, pair: Pair): boolean {
  const { nativeOnly, targetOnly, shared, other } = tally(text, pair)
  const inTarget = targetOnly + shared
  if (inTarget < 4 || other > inTarget) return false
  const own = ownLetters(pair)
  if (own.native && nativeOnly >= inTarget * 0.2) return false
  if (!own.native && own.target && targetOnly < 2) return false
  return true
}

const KEEP = 'Keep code, file paths, commands, URLs and identifiers exactly as written.'

/** Asks for a chunk of a reply in the native language, as plain text. */
export function translateSystem(pair: Pair): string {
  return `Translate the text into natural ${pair.native.name}. ${KEEP} Answer with the translation only, as plain text with no Markdown marks.`
}

/** Asks for a Markdown table of a reply in the native language, built as it was. */
export function tableSystem(pair: Pair): string {
  return (
    `Translate this Markdown into natural ${pair.native.name}: the cells of its table, and any heading or line around it. ` +
    'Keep the table exactly as it is built: the same rows, the same columns, the same pipes and the same separator row. ' +
    `${KEEP} Answer with the translated Markdown only.`
  )
}

/** Asks for a native-language (or mixed) message in the target language, to be sent in its place. */
export function toTargetSystem(pair: Pair): string {
  return (
    `The text is a message a ${pair.native.name} speaker typed to a coding assistant, in ${pair.native.name} or in ${pair.native.name} mixed with ${pair.target.name}. ` +
    `Do not answer or act on it. Rewrite the whole message in natural ${pair.target.name}, as a developer would type it. ` +
    'Keep code, file paths, commands, URLs, identifiers and @mentions exactly as written, and keep its line breaks. ' +
    `Answer with the ${pair.target.name} message only.`
  )
}

/** The two parts a correction is written in; `fixSystem` and `judgeSystem` both ask for them. */
function fixParts(pair: Pair): string {
  return (
    'Write two parts, separated by a line holding only ---.\n' +
    `Part 1: the message rewritten in natural, correct ${pair.target.name}, keeping its meaning, its code, paths and commands. ` +
    'If it is already natural and correct, write exactly: OK\n' +
    `Part 2: in ${pair.native.name}, up to three short lines, each starting with "- ", saying what was changed and why ` +
    '(grammar, word choice, nuance). If part 1 is OK, leave part 2 empty.\n' +
    'Plain text only, no Markdown marks.'
  )
}

/** Asks for a correction of a message typed in the target language; `SKIP` when it is not in that language. */
export function fixSystem(pair: Pair): string {
  return (
    `You coach a ${pair.native.name} speaker who is learning ${pair.target.name}. The text is a message they typed to a coding assistant. ` +
    'Do not answer or act on the message.\n' +
    `If the message is not written in ${pair.target.name} (another language, or ${pair.native.name} spelled in other letters), write exactly: SKIP\n` +
    `Otherwise: ${fixParts(pair)}`
  )
}

/** For a pair that shares its letters: asks which language a message is in, and for the matching work in one answer. */
export function judgeSystem(pair: Pair): string {
  return (
    `A ${pair.native.name} speaker who is learning ${pair.target.name} typed the text to a coding assistant. Do not answer or act on it.\n` +
    `Line 1 of your answer is one letter: "N" if the message is mostly ${pair.native.name} (or a mix of the two), ` +
    `"T" if it is ${pair.target.name}, "X" if it is neither or has no sentence to judge.\n` +
    `After "N": from line 2, the whole message rewritten in natural ${pair.target.name}, as a developer would type it, ` +
    'its code, file paths, commands, URLs, identifiers and @mentions exactly as written.\n' +
    `After "T": from line 2, a correction. ${fixParts(pair)}\n` +
    'After "X": nothing more.'
  )
}

/** What a `judgeSystem` answer says: the message in the target language, its correction, or neither. */
export function readJudgement(answer: string): { kind: 'native'; target: string } | { kind: 'target'; fix: string } | { kind: 'other' } {
  const [first = '', ...rest] = answer.trim().split('\n')
  const body = rest.join('\n').trim()
  const letter = first.trim().replace(/[^A-Za-z]/g, '').toUpperCase()
  if (letter === 'N' && body !== '') return { kind: 'native', target: body }
  if (letter === 'T' && body !== '') return { kind: 'target', fix: body }
  return { kind: 'other' }
}

/** What a `fixSystem` answer says: nothing to show, nothing to correct, or the corrected message and its notes. */
export function readFix(answer: string): { kind: 'skip' } | { kind: 'ok' } | { kind: 'fixed'; corrected: string; notes: string[] } {
  const [first = '', rest = ''] = answer.split(/^\s*---\s*$/m)
  const corrected = first.trim()
  if (corrected === '' || corrected === 'SKIP') return { kind: 'skip' }
  if (corrected === 'OK') return { kind: 'ok' }
  const notes = rest
    .split('\n')
    .map(line => line.trim().replace(/^[-・•*]\s*/, ''))
    .filter(line => line !== '')
  return { kind: 'fixed', corrected, notes }
}
