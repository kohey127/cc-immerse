// The settings as `/immerse` lists them above the prompt, the way `/config` lists its own: one row a
// setting, its value beside it, the choices of a row one Enter away. Under the list a preview shows what
// the choice under the keyboard does. Pure: built from the stored options (tests/menu.test.ts).

import { LANGUAGES } from './lang'
import type { Language, Pair } from './lang'

/** What a pick writes: options by their field in `plugin.json`. */
export type Values = Readonly<Record<string, string | boolean>>

/**
 * What the preview shows for a choice: the sample reply drawn with these options laid over the stored
 * ones, or lines of text (`isFaint`: drawn as the plugin draws its own grey lines).
 */
export type Preview = { kind: 'reply'; options: Values } | { kind: 'lines'; lines: readonly { text: string; isFaint?: boolean }[] }

export type Choice = {
  key: string
  label: string
  /** What the choice means, beside its label. */
  about: string
  set: Values
  isNow: boolean
  preview: Preview
}

export type Row = {
  key: string
  name: string
  /** The choice in force, as the row shows it. */
  shown: string
  choices: readonly Choice[]
  /** Two choices: Enter flips the row in place, with no list to open. */
  isSwitch: boolean
}

/** The sample the previews are made of, in one language. */
export type Sample = {
  /** A reply of two short blocks. */
  reply: readonly [string, string]
  /** A question as the person types it. */
  asked: string
}

type Options = Readonly<Record<string, unknown>>

const SAMPLES: Readonly<Record<string, Sample>> = {
  en: { reply: ['The build passed.', 'Two tests failed.'], asked: 'What is the build status?' },
  ja: { reply: ['ビルド成功です。', 'テスト2件が失敗。'], asked: 'ビルドの状態は？' },
}

/** The sample in a language; one with no sample of its own stands as its name in brackets. */
export function sampleIn(language: Language): Sample {
  return SAMPLES[language.code] ?? { reply: [`(${language.name})`, `(${language.name})`], asked: `(${language.name})` }
}

export function samplesOf(pair: Pair): { native: Sample; target: Sample } {
  return { native: sampleIn(pair.native), target: sampleIn(pair.target) }
}

/** What is in force where nothing is stored: `plugin.json`'s defaults. */
const DEFAULTS: Values = {
  readingLevel: '4',
  nativeInput: 'Send in the language you are learning',
  corrections: 'While typing and after sending',
  mark: '▸',
  markPosition: 'Last line',
  markVisibility: 'On hover',
  translationStyle: 'Faint italic',
  layout: 'Side by side',
  allButtons: true,
  livePreview: true,
  previewDelay: '0.6 s',
}

/** The reading level as stored, Off included; level 4 when nothing valid is stored. */
export function levelOf(options: Options): string {
  const level = String(options.readingLevel ?? '').trim()
  return ['Off', '1', '2', '3', '4'].includes(level) ? level : '4'
}

type Draft = { label: string; about?: string; set: Values; preview: Preview }

/** A row from its choices. The one in force is the first whose every value is the stored one; the first choice when none is. */
function rowOf(key: string, name: string, drafts: readonly Draft[], options: Options, shown?: (c: Draft) => string): Row {
  const valueOf = (field: string): unknown => (field === 'readingLevel' ? levelOf(options) : (options[field] ?? DEFAULTS[field]))
  const found = drafts.findIndex(d => Object.entries(d.set).every(([field, value]) => valueOf(field) === value))
  const now = Math.max(0, found)
  const choices = drafts.map((d, i) => ({ key: `${key}-${i}`, label: d.label, about: d.about ?? '', set: d.set, isNow: i === now, preview: d.preview }))
  const current = drafts[now] as Draft
  return { key, name, shown: shown ? shown(current) : current.label, choices, isSwitch: drafts.length === 2 }
}

const lines = (...texts: (string | readonly [string])[]): Preview => ({
  kind: 'lines',
  lines: texts.map(t => (typeof t === 'string' ? { text: t } : { text: t[0], isFaint: true })),
})

/**
 * Every setting as a row. `samples`: the sample texts of the pair's two languages.
 */
export function settingsRows(options: Options, pair: Pair, samples: { native: Sample; target: Sample }): Row[] {
  const [n, t] = [pair.native.name, pair.target.name]
  const { native, target } = samples
  const level = levelOf(options)
  const reply = (over: Values): Preview => ({ kind: 'reply', options: over })

  const languageRow = (key: string, field: string, name: string, now: Language, other: Language, about: (l: Language) => string): Row =>
    rowOf(
      key,
      name,
      LANGUAGES.filter(l => l.code !== other.code).map(l => ({ label: l.name === l.own ? l.name : `${l.name} · ${l.own}`, set: { [field]: l.name }, preview: lines([about(l)]) })),
      { ...options, [field]: now.name },
      c => String(c.set[field]),
    )

  const levels: readonly [string, string, string][] = [
    ['Off', 'Off', 'Replies stay as Claude wrote them'],
    ['1', 'Level 1', `${n} first, ${t} on click`],
    ['2', 'Level 2', `${n} on the left, ${t} beside it in grey`],
    ['3', 'Level 3', `${t} on the left, ${n} beside it in grey`],
    ['4', 'Level 4', `${t} first, ${n} on click`],
  ]

  // What the person typed in the learned language, with a mistake, and as corrected: English has an example.
  const [wrong, fixed] = pair.target.code === 'en' ? ['I has a question.', 'I have a question.'] : [target.asked, `(${t}, corrected)`]
  const markNow = String(options.mark ?? DEFAULTS.mark).trim() || '▸'
  const marks = ['▸', '›', '+', '◆'].includes(markNow) ? ['▸', '›', '+', '◆'] : [markNow, '▸', '›', '+', '◆']
  // The layout shows at levels 2 and 3 only: previewed at level 3 while another level is set.
  const both: Values = level === '2' || level === '3' ? {} : { readingLevel: '3' }

  return [
    languageRow('native', 'nativeLanguage', 'Your language', pair.native, pair.target, l => `Translations and correction notes are written in ${l.name}.`),
    languageRow('target', 'targetLanguage', 'You are learning', pair.target, pair.native, l => `Replies in ${l.name} get a translation; ${l.name} you type is corrected.`),
    rowOf(
      'reading',
      'Reading',
      levels.map(([value, label, about]) => ({ label, about, set: { readingLevel: value }, preview: reply({ readingLevel: value }) })),
      options,
      c => (c.label === 'Off' ? 'Off' : `${c.label} · ${c.about}`),
    ),
    rowOf(
      'nativeInput',
      `${n}, typed`,
      [
        {
          label: `Sent as ${t}`,
          about: `Claude gets your message in ${t}`,
          set: { nativeInput: 'Send in the language you are learning' },
          preview: lines([`${pair.target.tag} ▸ ${target.asked}`], `❯ ${native.asked}`, [`  ↳ ${target.asked}`], `Claude gets: ${target.asked}`),
        },
        {
          label: `${t} shown, sent as typed`,
          about: `You see the ${t} as you type; Claude gets your ${n}`,
          set: { nativeInput: 'Show it, send as typed' },
          preview: lines([`${pair.target.tag} ▸ ${target.asked}`], `❯ ${native.asked}`, `Claude gets: ${native.asked}`),
        },
        { label: 'Left alone', about: `Claude gets your ${n}; nothing is shown`, set: { nativeInput: 'Leave it alone' }, preview: lines(`❯ ${native.asked}`, `Claude gets: ${native.asked}`) },
      ],
      options,
    ),
    rowOf(
      'corrections',
      `${t}, typed`,
      [
        {
          label: 'Corrected while typing and after',
          about: 'A line above the prompt as you type, and one under your message',
          set: { corrections: 'While typing and after sending' },
          preview: lines([`FIX ▸ ${fixed}`], `❯ ${wrong}`, [`  ↳ ${fixed}`], `Claude gets: ${wrong}`),
        },
        { label: 'Corrected after sending', about: 'A line under your message once it is sent', set: { corrections: 'After sending' }, preview: lines(`❯ ${wrong}`, [`  ↳ ${fixed}`], `Claude gets: ${wrong}`) },
        { label: 'Not corrected', about: 'Nothing is added', set: { corrections: 'Off' }, preview: lines(`❯ ${wrong}`, `Claude gets: ${wrong}`) },
      ],
      options,
    ),
    rowOf('mark', 'Mark', marks.map(mark => ({ label: mark, about: 'What you click to open a block', set: { mark }, preview: reply({ mark }) })), { ...options, mark: markNow }),
    rowOf(
      'markPosition',
      'Mark beside',
      [
        { label: 'Last line', about: 'Beside the last line of a block', set: { markPosition: 'Last line' }, preview: lines(`  ${target.reply[0]}`, `${markNow} ${target.reply[1]}`, ['A block of two lines: the mark is beside the second.']) },
        { label: 'First line', about: 'Beside the first line of a block', set: { markPosition: 'First line' }, preview: lines(`${markNow} ${target.reply[0]}`, `  ${target.reply[1]}`, ['A block of two lines: the mark is beside the first.']) },
      ],
      options,
    ),
    rowOf(
      'markVisibility',
      'Mark shows',
      [
        { label: 'On hover', about: 'Hidden until the pointer is on a block', set: { markVisibility: 'On hover' }, preview: lines(`  ${target.reply[0]}`, ['The mark appears while the pointer is on the block.']) },
        { label: 'Always', about: 'Drawn beside every block, pointer or not', set: { markVisibility: 'Always' }, preview: lines(`${markNow} ${target.reply[0]}`, ['The mark is there at rest.']) },
      ],
      options,
    ),
    rowOf(
      'translationStyle',
      'Grey text',
      [
        { label: 'Grey italic', about: 'The second language slanted', set: { translationStyle: 'Faint italic' }, preview: reply({ translationStyle: 'Faint italic' }) },
        { label: 'Grey', about: 'The second language upright', set: { translationStyle: 'Faint' }, preview: reply({ translationStyle: 'Faint' }) },
      ],
      options,
    ),
    rowOf(
      'layout',
      'Levels 2 and 3',
      [
        { label: 'Side by side', about: 'Two columns, in a wide window', set: { layout: 'Side by side' }, preview: reply({ layout: 'Side by side', ...both }) },
        { label: 'One under the other', about: 'The second language under each block', set: { layout: 'Below' }, preview: reply({ layout: 'Below', ...both }) },
      ],
      options,
      c => (c.label === 'One under the other' ? 'Below' : c.label),
    ),
    rowOf(
      'allButtons',
      'Open-all buttons',
      [
        { label: 'On', about: 'Two buttons at the end of a message', set: { allButtons: true }, preview: lines([`▸▸ ALL ${pair.native.tag} OPEN  ▾▾ ALL ${pair.native.tag} CLOSE`], ['At the end of a message with two blocks or more.']) },
        { label: 'Off', about: 'No buttons at the end of a message', set: { allButtons: false }, preview: lines(['No buttons at the end of a message.']) },
      ],
      options,
    ),
    rowOf(
      'typingPreview',
      'Preview while typing',
      [
        { label: 'Off', about: 'Nothing above the prompt box as you type', set: { livePreview: false }, preview: lines(`❯ ${native.asked}`, ['Nothing is shown until you send.']) },
        ...['0.3 s', '0.6 s', '1 s', '2 s'].map(wait => ({
          label: `After ${wait}`,
          about: `Made once you stop typing for ${wait}`,
          set: { livePreview: true, previewDelay: wait },
          preview: lines([`${pair.target.tag} ▸ ${target.asked}`], `❯ ${native.asked}`, [`One small model call each time you pause for ${wait}.`]),
        })),
      ],
      options,
    ),
  ]
}
