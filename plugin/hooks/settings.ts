// The settings: the plugin's options as the code uses them. There is a level and one switch.
//
// A level says two things at once: in which language the person and Claude talk, and which language a
// reply is read in first. Levels 1 and 2 are with Claude in the native language: what is typed is sent as
// typed, Claude answers in it, and the learned language is the translation. Levels 3 and 4 are with Claude
// in the learned language: what is typed in the native one is sent in the learned one, its original beside
// it, and Claude answers in the learned one. The look of a reply is not a setting.
// Pure functions (tests/settings.test.ts).

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

/** The level as stored: Off, or 1 to 4; level 4 when nothing valid is stored. */
export function levelOf(options: Options): string {
  const level = String(options.readingLevel ?? '').trim()
  return ['Off', '1', '2', '3', '4'].includes(level) ? level : '4'
}

/** Whether a level is with Claude in the learned language: what is typed in the native one is sent in it. */
export function isWithClaudeInTarget(level: string): boolean {
  return level === '3' || level === '4'
}

export function readSettings(options: Options): Settings {
  const level = levelOf(options)
  const hasHelp = options.typingHelp !== false
  return {
    front: level === '1' || level === '2' ? 'native' : 'target',
    show: level === 'Off' ? 'never' : level === '2' || level === '3' ? 'side' : 'request',
    mark: '▸',
    markAt: 'last',
    markShown: 'hover',
    style: 'faint-italic',
    hasAllButtons: true,
    // With Claude in the learned language the message is sent in it whatever the switch says: the level is
    // the promise. Elsewhere the learned-language version is only shown, as help.
    send: isWithClaudeInTarget(level) ? 'target' : hasHelp ? 'preview' : 'off',
    hasPreview: hasHelp,
    previewDelayMs: 600,
    correct: hasHelp ? 'both' : 'off',
  }
}
