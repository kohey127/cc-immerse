/** One paragraph's translation, kept by a hash of its source text. */
/** `at`: with `pending`, when the call started, so one a reload cut short is tried again. */
export type Tr = { status: 'pending' | 'done' | 'error'; text: string; at?: number }

/**
 * The line above the prompt box, made while the person types. `label` names what it is: the learned
 * language's tag for a native-language draft in that language, `FIX` for a learned-language draft as it
 * would read corrected, empty while a pair that shares its letters is still being told apart.
 * `sends`: Enter sends `english` in place of the draft; a correction is shown and never sent.
 */
export type Draft = { src: string; english: string; status: 'pending' | 'done' | 'failed'; label: string; sends: boolean }

declare module 'claude-code' {
  interface PluginState {
    'cc-immerse': {
      /** Whether a paragraph's translation is open, by `requestId:index`. */
      open: StateFamily<boolean>
      /** Translations, by a hash of the paragraph. */
      tr: StateFamily<Tr | null>
      /** What the person typed, by a hash of the English that was sent in its place. */
      sent: StateFamily<string | null>
      /** The learned-language version of a message sent as typed, shown under it and never sent; by a hash of the message. */
      shown: StateFamily<string | null>
      /** The live preview above the prompt box; null when the draft needs none. */
      draft: Draft | null
      /** The latest reply, for `/immerse open`: each message of it with its text. Kept here, not in the module, because a setting written loads the module again. */
      latest: { id: string; text: string }[]
      /** The settings list above the prompt, while `/immerse` has it open: which list shows (`main`, or a row's key) and the row the keyboard is on. Null when closed. */
      menu: { view: string; cursor: string } | null
    }
  }
}
