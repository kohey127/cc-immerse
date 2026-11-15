/** One paragraph's translation, kept by a hash of its source text. */
/** `at`: with `pending`, when the call started, so one a reload cut short is tried again. */
export type Tr = { status: 'pending' | 'done' | 'error'; text: string; at?: number }

/**
 * The line above the prompt box, made while the person types. `EN`: the English of a native-language draft,
 * which Enter sends. `FIX`: a learned-language draft as it would read corrected; the draft is sent as typed.
 */
export type Draft = { src: string; english: string; status: 'pending' | 'done' | 'failed'; label: 'EN' | 'FIX' }

declare module 'claude-code' {
  interface PluginState {
    'cc-immerse': {
      /** Whether a paragraph's translation is open, by `requestId:index`. */
      open: StateFamily<boolean>
      /** Translations, by a hash of the paragraph. */
      tr: StateFamily<Tr | null>
      /** What the person typed, by a hash of the English that was sent in its place. */
      sent: StateFamily<string | null>
      /** The live preview above the prompt box; null when the draft needs none. */
      draft: Draft | null
    }
  }
}
