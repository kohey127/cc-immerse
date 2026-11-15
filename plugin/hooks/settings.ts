// The settings: the plugin's options as the code uses them. A level is a preset: it sets several things
// at once, and each of them can be set by itself, which then wins. Pure functions (tests/settings.test.ts).

export type Settings = {
  /** When a reply's translation shows: beside it, always below it, when asked for, or never. */
  show: 'side' | 'below' | 'request' | 'never'
  /** The mark that opens a block's translation. */
  mark: string
  /** Beside which line of its block the mark sits. */
  markAt: 'last' | 'first'
  /** Whether the mark shows only under the pointer. */
  markShown: 'hover' | 'always'
  /** How a translation is drawn. */
  style: 'faint-italic' | 'faint' | 'normal'
  /** The open-all and close-all buttons at the end of a message. */
  hasAllButtons: boolean
  /** A message typed in the native language: sent in the learned one, shown in it but sent as typed, or left alone. */
  send: 'target' | 'preview' | 'off'
  /** The line above the prompt box while typing. */
  hasPreview: boolean
  /** How long a draft rests before the preview is made. */
  previewDelayMs: number
  /** When a message typed in the learned language is corrected: while typing and after sending, after sending, or not at all. */
  correct: 'both' | 'sent' | 'off'
}

type Options = Readonly<Record<string, unknown>>

const READING: Record<string, Pick<Settings, 'show'>> = {
  '1': { show: 'side' },
  '2': { show: 'below' },
  '3': { show: 'request' },
  '4': { show: 'request' },
  '5': { show: 'never' },
}

const WRITING: Record<string, Pick<Settings, 'send' | 'hasPreview' | 'correct'>> = {
  '1': { send: 'target', hasPreview: true, correct: 'both' },
  '2': { send: 'target', hasPreview: true, correct: 'both' },
  '3': { send: 'target', hasPreview: true, correct: 'both' },
  '4': { send: 'target', hasPreview: true, correct: 'sent' },
  '5': { send: 'off', hasPreview: false, correct: 'off' },
}

const DEFAULT_LEVEL = '3'

/** What an option's words name, or undefined for "Follow the level", nothing, or words that name nothing. */
function pick<T>(value: unknown, names: Readonly<Record<string, T>>): T | undefined {
  return typeof value === 'string' ? names[value.trim()] : undefined
}

export function readSettings(options: Options): Settings {
  const reading = READING[String(options.readingLevel ?? '').trim()] ?? (READING[DEFAULT_LEVEL] as Pick<Settings, 'show'>)
  const writing = WRITING[String(options.writingLevel ?? '').trim()] ?? (WRITING[DEFAULT_LEVEL] as Pick<Settings, 'send' | 'hasPreview' | 'correct'>)
  const mark = typeof options.mark === 'string' && options.mark.trim() !== '' ? options.mark.trim() : '▸'
  return {
    show: pick(options.showTranslation, { 'Side by side': 'side', 'Always, below': 'below', 'On request': 'request', Never: 'never' } as const) ?? reading.show,
    mark,
    markAt: pick(options.markPosition, { 'Last line': 'last', 'First line': 'first' } as const) ?? 'last',
    markShown: pick(options.markVisibility, { 'On hover': 'hover', Always: 'always' } as const) ?? 'hover',
    style: pick(options.translationStyle, { 'Faint italic': 'faint-italic', Faint: 'faint', Normal: 'normal' } as const) ?? 'faint-italic',
    hasAllButtons: typeof options.allButtons === 'boolean' ? options.allButtons : true,
    send:
      pick(options.nativeInput, {
        'Send in the language you are learning': 'target',
        'Show it, send as typed': 'preview',
        'Leave it alone': 'off',
      } as const) ?? writing.send,
    hasPreview: typeof options.livePreview === 'boolean' ? options.livePreview : writing.hasPreview,
    previewDelayMs: pick(options.previewDelay, { '0.3 s': 300, '0.6 s': 600, '1 s': 1000, '2 s': 2000 } as const) ?? 600,
    correct:
      pick(options.corrections, { 'While typing and after sending': 'both', 'After sending': 'sent', Off: 'off' } as const) ?? writing.correct,
  }
}
