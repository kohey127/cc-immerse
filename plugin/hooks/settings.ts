// The settings: the plugin's options as the code uses them. Reading is Off or one of four levels; a
// level is a preset that says which language is in front and when the other one shows. Writing is a switch. The other options each change one thing. Pure functions (tests/settings.test.ts).

export type Settings = {
  /** Which language a reply is read in first: the native one (levels 1 and 2) or the learned one (levels 3 and 4). */
  front: 'native' | 'target'
  /** When the other language shows: beside the reply, always below it, when asked for, or never. */
  show: 'side' | 'below' | 'request' | 'never'
  /** The mark that opens a block's translation. */
  mark: string
  /** Beside which line of its block the mark sits. */
  markAt: 'last' | 'first'
  /** Whether the mark shows only under the pointer. */
  markShown: 'hover' | 'always'
  /** How a translation is drawn. */
  style: 'faint-italic' | 'faint'
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

/** What each reading level sets. `isBoth`: both languages show at once, laid out as the layout option says. */
const READING: Record<string, { front: Settings['front']; isBoth: boolean }> = {
  '1': { front: 'native', isBoth: false },
  '2': { front: 'native', isBoth: true },
  '3': { front: 'target', isBoth: true },
  '4': { front: 'target', isBoth: false },
}

const DEFAULT_LEVEL = '4'

/** What an option's words name, or undefined for nothing or for words that name nothing. */
function pick<T>(value: unknown, names: Readonly<Record<string, T>>): T | undefined {
  return typeof value === 'string' ? names[value.trim()] : undefined
}

export function readSettings(options: Options): Settings {
  const level = READING[String(options.readingLevel ?? '').trim()] ?? (READING[DEFAULT_LEVEL] as { front: Settings['front']; isBoth: boolean })
  const layout = pick(options.layout, { 'Side by side': 'side', Below: 'below' } as const) ?? 'side'
  const mark = typeof options.mark === 'string' && options.mark.trim() !== '' ? options.mark.trim() : '▸'
  return {
    front: level.front,
    show: String(options.readingLevel ?? '').trim() === 'Off' ? 'never' : level.isBoth ? layout : 'request',
    mark,
    markAt: pick(options.markPosition, { 'Last line': 'last', 'First line': 'first' } as const) ?? 'last',
    markShown: pick(options.markVisibility, { 'On hover': 'hover', Always: 'always' } as const) ?? 'hover',
    style: pick(options.translationStyle, { 'Faint italic': 'faint-italic', Faint: 'faint' } as const) ?? 'faint-italic',
    hasAllButtons: typeof options.allButtons === 'boolean' ? options.allButtons : true,
    send:
      (pick(options.nativeInput, {
          'Send in the language you are learning': 'target',
          'Show it, send as typed': 'preview',
          'Leave it alone': 'off',
        } as const) ?? 'target'),
    hasPreview: options.livePreview !== false,
    previewDelayMs: pick(options.previewDelay, { '0.3 s': 300, '0.6 s': 600, '1 s': 1000, '2 s': 2000 } as const) ?? 600,
    correct: (pick(options.corrections, { 'While typing and after sending': 'both', 'After sending': 'sent', Off: 'off' } as const) ?? 'both'),
  }
}
