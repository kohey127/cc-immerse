// The settings as `/immerse` lists them above the prompt, the way `/config` lists its own: one row a
// setting, its value beside it, the choices of a row one Enter away. Under the list a preview shows what
// the choice under the keyboard does. Pure: built from the stored options (tests/menu.test.ts).

import { LANGUAGES } from './lang'
import type { Language, Pair } from './lang'
import { isWithClaudeInTarget, levelOf } from './settings'

/** What a pick writes: options by their field in `plugin.json`. */
export type Values = Readonly<Record<string, string | boolean>>

/**
 * What the preview shows for a choice: an exchange at a level (what is typed, what Claude gets, how the
 * reply is read), or lines of text (`isFaint`: drawn as the plugin draws its own grey lines).
 */
export type Preview = { kind: 'exchange'; level: string } | { kind: 'lines'; lines: readonly { text: string; isFaint?: boolean }[] }

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

/** The sample in each language the plugin offers: the same three sentences. Short, so that two fit side by side. */
const SAMPLES: Readonly<Record<string, Sample>> = {
  en: { reply: ['The build passed.', 'Two tests failed.'], asked: 'What is the build status?' },
  ja: { reply: ['ビルド成功です。', 'テスト2件が失敗。'], asked: 'ビルドの状態は？' },
  ko: { reply: ['빌드가 통과했습니다.', '테스트 2개가 실패했습니다.'], asked: '빌드 상태가 어떤가요?' },
  'zh-Hans': { reply: ['构建通过了。', '两个测试失败了。'], asked: '构建状态如何？' },
  'zh-Hant': { reply: ['建置通過了。', '兩個測試失敗了。'], asked: '建置狀態如何？' },
  es: { reply: ['La compilación pasó.', 'Fallaron dos pruebas.'], asked: '¿Cuál es el estado de la compilación?' },
  fr: { reply: ['La compilation a réussi.', 'Deux tests ont échoué.'], asked: "Quel est l'état de la compilation ?" },
  de: { reply: ['Der Build war erfolgreich.', 'Zwei Tests sind fehlgeschlagen.'], asked: 'Wie ist der Build-Status?' },
  pt: { reply: ['A compilação passou.', 'Dois testes falharam.'], asked: 'Qual é o estado da compilação?' },
  it: { reply: ['La build è riuscita.', 'Due test sono falliti.'], asked: 'Qual è lo stato della build?' },
  nl: { reply: ['De build is geslaagd.', 'Twee tests zijn mislukt.'], asked: 'Wat is de status van de build?' },
  pl: { reply: ['Build się powiódł.', 'Dwa testy nie przeszły.'], asked: 'Jaki jest status builda?' },
  tr: { reply: ['Derleme başarılı oldu.', 'İki test başarısız oldu.'], asked: 'Derlemenin durumu nedir?' },
  vi: { reply: ['Bản build đã thành công.', 'Hai bài kiểm thử thất bại.'], asked: 'Trạng thái build thế nào?' },
  id: { reply: ['Build berhasil.', 'Dua tes gagal.'], asked: 'Bagaimana status build-nya?' },
  ru: { reply: ['Сборка прошла успешно.', 'Два теста не прошли.'], asked: 'Каков статус сборки?' },
  uk: { reply: ['Збірка пройшла успішно.', 'Два тести не пройшли.'], asked: 'Який статус збірки?' },
  ar: { reply: ['نجح البناء.', 'فشل اختباران.'], asked: 'ما حالة البناء؟' },
  hi: { reply: ['बिल्ड सफल रहा।', 'दो टेस्ट विफल हुए।'], asked: 'बिल्ड की स्थिति क्या है?' },
  th: { reply: ['บิลด์ผ่านแล้ว', 'การทดสอบสองรายการล้มเหลว'], asked: 'สถานะของบิลด์เป็นอย่างไร' },
  el: { reply: ['Το build ολοκληρώθηκε με επιτυχία.', 'Δύο τεστ απέτυχαν.'], asked: 'Ποια είναι η κατάσταση του build;' },
  he: { reply: ['הבנייה עברה בהצלחה.', 'שני מבחנים נכשלו.'], asked: 'מה מצב הבנייה?' },
}

/** The sample in a language. Every language the plugin offers has one; the English one stands for any that does not. */
export function sampleIn(language: Language): Sample {
  return SAMPLES[language.code] ?? (SAMPLES.en as Sample)
}

export function samplesOf(pair: Pair): { native: Sample; target: Sample } {
  return { native: sampleIn(pair.native), target: sampleIn(pair.target) }
}

type Draft = { label: string; about?: string; set: Values; preview: Preview }

/** A row from its choices, `now` the index of the one in force. */
function rowOf(key: string, name: string, drafts: readonly Draft[], now: number, shown?: (c: Draft) => string): Row {
  const at = Math.max(0, now)
  const choices = drafts.map((d, i) => ({ key: `${key}-${i}`, label: d.label, about: d.about ?? '', set: d.set, isNow: i === at, preview: d.preview }))
  const current = drafts[at] as Draft
  return { key, name, shown: shown ? shown(current) : current.label, choices, isSwitch: drafts.length === 2 }
}

const lines = (...texts: (string | readonly [string])[]): Preview => ({
  kind: 'lines',
  lines: texts.map(t => (typeof t === 'string' ? { text: t } : { text: t[0], isFaint: true })),
})

/** Every setting as a row. `samples`: the sample texts of the pair's two languages. */
export function settingsRows(options: Options, pair: Pair, samples: { native: Sample; target: Sample }): Row[] {
  const [n, t] = [pair.native.name, pair.target.name]
  const { native, target } = samples
  const level = levelOf(options)

  const languageRow = (key: string, field: string, name: string, now: Language, other: Language, about: (l: Language) => string): Row => {
    const offered = LANGUAGES.filter(l => l.code !== other.code)
    return rowOf(
      key,
      name,
      offered.map(l => ({ label: l.name === l.own ? l.name : `${l.name} · ${l.own}`, set: { [field]: l.name }, preview: lines([about(l)]) })),
      offered.findIndex(l => l.code === now.code),
      c => String(c.set[field]),
    )
  }

  // A level says in which language the person and Claude talk, then where the other language is.
  const levels: readonly [string, string, string][] = [
    ['Off', 'Off', 'Nothing is done to replies'],
    ['1', 'Level 1', `With Claude in ${n} · ${t} on click`],
    ['2', 'Level 2', `With Claude in ${n} · ${t} beside it`],
    ['3', 'Level 3', `With Claude in ${t} · ${n} beside it`],
    ['4', 'Level 4', `With Claude in ${t} · ${n} on click`],
  ]
  // What the person typed in the learned language, with a mistake, and as corrected: English has an example.
  const [wrong, fixed] = pair.target.code === 'en' ? ['I has a question.', 'I have a question.'] : [target.asked, `(${t}, corrected)`]

  return [
    languageRow('native', 'nativeLanguage', 'Your language', pair.native, pair.target, l => `Translations and correction notes are written in ${l.name}.`),
    languageRow('target', 'targetLanguage', 'You are learning', pair.target, pair.native, l => `The language you read and write more of as the level goes up: ${l.name}.`),
    rowOf(
      'level',
      'Level',
      levels.map(([value, label, about]) => ({ label, about, set: { readingLevel: value }, preview: { kind: 'exchange', level: value } as const })),
      levels.findIndex(([value]) => value === level),
      c => (c.label === 'Off' ? 'Off' : `${c.label} · With Claude in ${isWithClaudeInTarget(String(c.set.readingLevel)) ? t : n}`),
    ),
    rowOf(
      'typingHelp',
      'Help while typing',
      [
        {
          label: 'On',
          about: 'A line above the prompt box as you type, and a correction under what you sent',
          set: { typingHelp: true },
          preview: lines([`${pair.target.tag} ▸ ${target.asked}`], `❯ ${native.asked}`, [`FIX ▸ ${fixed}`], `❯ ${wrong}`),
        },
        { label: 'Off', about: 'Nothing above the prompt box, and no correction', set: { typingHelp: false }, preview: lines(`❯ ${native.asked}`, ['Nothing is shown as you type, and nothing is corrected.']) },
      ],
      options.typingHelp === false ? 1 : 0,
    ),
  ]
}
