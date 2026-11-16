# cc-immerse

A Claude Code plugin for learning a language while working. Replies stay in the language being learned, with the reader's own language one click away. What is typed in the reader's own language is sent in the learned one; what is typed in the learned one is corrected beside the conversation.

`README.md` is what users read. This file is for whoever changes the code.

If `notes/HANDOFF.md` exists (it is local, not in git), read it first: it holds the current state, the open work and the history of the decisions. `notes/transcript.md` is the full conversation the plugin was built in.

## Layout

| Path | What it is |
| --- | --- |
| `.claude-plugin/marketplace.json` | Makes the repository a marketplace; the plugin's source is `./plugin` |
| `plugin/` | Everything an install carries. Nothing outside it is shipped |
| `plugin/.claude-plugin/plugin.json` | Manifest and the `userConfig` options (the rows under **Immerse** in `/config`) |
| `plugin/hooks/lang.ts` | Pure. The language pair, which language a text is in, and every instruction given to the small model |
| `plugin/hooks/text.ts` | Pure. Cutting a reply into blocks, laying text out in rows |
| `plugin/hooks/settings.ts` | Pure. Options to settings: a level is a preset, a single option overrides it |
| `plugin/hooks/register.tsx` | The hooks: what is drawn, what is sent, the `/immerse` command |
| `plugin/types/index.d.ts` | The contract for every `$.state` value |
| `plugin/tests/` | One file per concern; the README's Development table lists them |
| `screen/` | Checks on a real screen. Not shipped. A real Claude Code runs in a scripted terminal with the plugin loaded and a stand-in for the model |
| `screen/term.ts` | Starts the session and gives a scenario its hands and eyes: type, move the pointer, click, read text, read each cell's colour and style, take a picture, record |
| `screen/model.ts` | The stand-in for the model: every reply and every small-model answer is written in the scenario, so a run is the same each time and costs nothing |
| `screen/scenarios/` | One file per scenario. Each comes from a recording the README needs or from a bug the author caught by eye |

## Checks, run before saying anything is done

```sh
claude plugin validate plugin
claude plugin test plugin
```

Both must pass, and validation must report no TypeScript errors.

After a change to anything on screen, run the screen checks too (about a minute; `bun install` in `screen/` once):

```sh
cd screen && bun test
```

They write pictures and recordings to `screen/out/` (not in git). Look at the pictures: a check reads text and styles, and a picture shows what no check was written for. `IMMERSE_PLUGIN=<folder>` runs the same checks against another copy of the plugin, which is how a check is seen failing: break the copy, not `plugin/`.

## How the work is done

- **Test first.** Write the test, run it, see it fail for the expected reason, then write the code. A bug the author reports becomes a test named `regression: …` before it is fixed. If a test was not seen failing, say so.
- **Tests show what is drawn and sent, not how it looks.** The screen checks show a real screen in one terminal emulator (@microsoft/tui-test), with its font, not the author's terminal. After a change to anything on screen, say what the screen checks covered, and that the author's own terminal has not been seen until they have reloaded (`/reload-plugins`) and looked.
- **A scenario is added for a reason outside the code**: a recording the README needs, or something the author rejected on a screen. What they reject becomes a check in the scenario that showed it.
- **Defaults do not change.** New behaviour arrives as an option whose default is today's behaviour. `tests/settings.test.ts` pins the defaults.
- **Logic goes in the pure files.** `register.tsx` holds wiring and drawing; anything that can be decided from a string belongs in `lang.ts`, `text.ts` or `settings.ts`, where it is tested without the engine.
- **The small model's instructions live in `lang.ts` only**, and the text handed to it is always wrapped by `asText`, so a short text is not read as a message to answer.
- Commit and push only when the author says so. Commits are small, one concern each, with a message that says what changed for the user.

## Things the plugin API taught us

The API for interface mods is early access (built on Claude Code 2.1.325). Its types are in `plugin/.claude-plugin/types/` once the plugin has loaded; grep them, do not guess.

- `$` may be passed only to top-level functions.
- A render hook cannot write state. It can schedule work with `$.clock.after(0, …)`.
- A press hook has a 10 second budget: never await a model call in it; schedule it.
- A `Button` under the pointer is always drawn inverted and is one row with no wrapping. Text the reader reads is therefore plain `Text`, wrapped by `text.ts` to the viewport's columns.
- Hover reveal is `display="none"` with `hover={{ display: 'flex' }}` inside a keyed `Box`; the keyed box is the hover area.
- An option not declared in `plugin.json` `userConfig` is dropped. A state key not declared in `types/index.d.ts` fails validation.
- A translation left `pending` by a reload is retried after 60 seconds (it carries a timestamp).
- In a test, every `on(…)` and `mock.*(on)` must come before the first call on `$`. `$.store` needs `mock.store(on)`.
- On a real screen: text typed before the plugin has loaded gets no line above the prompt box, and a click sent in the first moments after a redraw is not taken. `screen/term.ts` waits for both.
- A session with nobody at its prompt (`claude -p`, a scheduled run) must be left alone: `session.start`'s `isInteractive` switches the plugin off there.

## Design decisions that are settled

- The learned language stays in front. The reader's language is never shown by default at level 3.
- No highlight on a block. On hover, a plain mark (`▸`) appears in the left gutter beside the block's last line, tables included; a click opens the translation under the block; `▾` closes it.
- `▸▸ ALL <tag> OPEN` and `▾▾ ALL <tag> CLOSE` at the end of a message.
- While typing: `EN ▸` previews the learned-language version of a native-language draft, `FIX ▸` a correction of a learned-language draft. After sending: `↳` under the message with what was sent, or the correction and notes in the reader's language, or `✓ Your English is perfect!`.
- Input in a third language, code, or a word or two is sent as typed and nothing is done to it.
- `/immerse off` and `/immerse on` switch the whole plugin; the choice is kept across sessions.
