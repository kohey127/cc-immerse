# cc-immerse

A Claude Code plugin for learning a language while working. One level says in which language the person and Claude talk and which language a reply is read in first; the other language is one click away or beside it. What is typed in the learned language is corrected beside the conversation.

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
| `plugin/hooks/menu.ts` | Pure. The settings list `/immerse` shows: its rows, their choices, what a pick writes, what the preview shows |
| `plugin/hooks/register.tsx` | The hooks: what is drawn, what is sent, the `/immerse` command |
| `plugin/types/index.d.ts` | The contract for every `$.state` value |
| `plugin/tests/` | One file per concern; the README's Development table lists them |
| `screen/` | Checks on a real screen. Not shipped. A real Claude Code runs in a scripted terminal with the plugin loaded and a stand-in for the model |
| `screen/term.ts` | Starts the session and gives a scenario its hands and eyes: type, move the pointer, click, read text, read each cell's colour and style, take a picture, record |
| `screen/model.ts` | The stand-in for the model: every reply and every small-model answer is written in the scenario, so a run is the same each time and costs nothing |
| `screen/record.ts` | Makes the READMEs' pictures from a real screen, one set per reader in `assets/<set>/`: `ja-en` for `README.ja.md`, `zh-en` for `README.zh-CN.md`, `en-es` for `README.md`. `bun screen/record.ts`, or a set and then a scene after it (`en-es hero`); needs ffmpeg. Each picture is cut down to the exchange, and the pointer is drawn on (`screen/pointer.png`), since a terminal draws none. Run it again after a change to what is drawn |
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
- **What the plugin does with nothing set does not change** unless the author says so. `tests/settings.test.ts` pins it.
- **Logic goes in the pure files.** `register.tsx` holds wiring and drawing; anything that can be decided from a string belongs in `lang.ts`, `text.ts` or `settings.ts`, where it is tested without the engine.
- **The small model's instructions live in `lang.ts` only**, and the text handed to it is always wrapped by `asText`, so a short text is not read as a message to answer.
- **A push that changes anything under `plugin/` raises `version` in `plugin/.claude-plugin/plugin.json`**, and a release with that tag follows. Claude Code keeps an installed plugin by its version and offers an update only when the number has gone up; with the number unchanged, people who installed it keep the old code. The description there is the one the mods catalogue shows, so it says what the repository's About says.
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
- Where a plugin can draw something worked by keys, and what each costs. A pane takes the keyboard as it opens, but a fullscreen terminal from 110 columns docks it at the right and a plugin cannot move it. The band above the prompt is full width, but takes the keyboard only by the person's ctrl+x tab or click (`$.ui.focus` there is denied until then, and works after); a bare digit in an empty prompt box presses a band Button with that `hotkey` with no focus at all. The question dialog (`$.ui.ask`) takes the keyboard and is full width, but holds two to four labels, tells a plugin nothing of its cursor, and drops a rewrite that adds a `preview`.
- In the band the focus ring goes through the Buttons in the order written and wraps at the ends; `ui.focus` names the element at each move. The band is at most half the terminal high (`maxRows`); a taller tree scrolls and its top leaves the screen, so the list is laid out to fit.
- The keys of the settings list come through the prompt box, because nothing else gives a full-width list the keyboard as it opens (the author's terminal did not pass ctrl+x tab either). `prompt.edit` carries the key of every edit and may consume it (`{ text: e.text, cursor: e.cursor }` with no `next`). An arrow is an edit only while the box holds more than one line, so the box is filled with a line between two empty ones. The line says what the keys do and ends in the backslash. The author would have nothing in the box at all; that needs the band to take the keyboard, which a plugin cannot ask for. A backslash alone was tried and was harder to understand than the line. Enter is an edit only where the caret stands after a backslash (it breaks the line there); anywhere else it submits, and a submit a hook drops leaves a yellow "Prompt dropped by a hook" line. In an empty box Down, Left, Right, Enter and Tab reach no hook at all, and Up arrives only as `prompt.change` with a recalled history entry. The hook has 50 ms: it answers at once and acts in `$.clock.after(0, …)`. After a setting reloads the module, `session.start` puts the line back.
- An option written with `$.config.set` reloads the module: its own variables start over, `$.state` stays. What a command needs after a setting changes (the latest reply, for one) is kept in `$.state`. The test kit does not load a module twice, so that is checked on a real screen.
- On a real screen: text typed before the plugin has loaded gets no line above the prompt box, and a click sent in the first moments after a redraw is not taken. `screen/term.ts` waits for both.
- A session with nobody at its prompt (`claude -p`, a scheduled run) must be left alone: `session.start`'s `isInteractive` switches the plugin off there.

## Design decisions that are settled

- **What the person means reaches Claude whole.** A machine translation is never the only thing Claude gets: the author called losing nuance the one thing that must not happen. At levels 1 and 2 the message is sent as typed. At levels 3 and 4 the learned-language version is the message and the original goes beside it (`prompt.submit`'s `context`).
- **One level, not several settings.** It says in which language the person and Claude talk (1 and 2: native; 3 and 4: learned) and which language a reply is read in first. How a typed message is sent is not a setting of its own: two settings that had to agree did not, and nobody could tell what was happening. The settings list says "With Claude in <language>" on the level's row.
- **Claude answers in the language it is asked in.** The plugin says nothing to Claude about that, with one exception found by measurement: with the original beside the message Claude answers in the original's language (10 of 10 with Opus), so the note beside it ends "Reply in <learned language>, the language of their message" (10 of 10 in the learned language, and it stayed there over five turns).
- **Where the two languages share their letters, a block is taken to be in the language the level talks in** (`split`'s `spoken`). Found recording English and Spanish: at level 2 an English reply was taken for Spanish.
- **A reply is drawn by its own language, block by block.** A block in the language read first is drawn as written, the other language behind its mark or beside it. A block in the other language changes places with its translation. So a level means the same whichever language Claude answered in. Levels 1 and 4 cost nothing until a block is opened; 2 and 3 translate every block.
- **Four settings**: the two languages, the level, help while typing. The look of a reply (the mark, the grey italic, the buttons) is fixed. Settings nobody used produced the disagreement above.
- The language read first is at full strength; the other is always grey, tables included. No highlight on a block. On hover, a plain mark (`▸`) appears in the left gutter beside the block's last line; a click opens the other language under the block; `▾` closes it. `▸▸ ALL <tag> OPEN` and `▾▾ ALL <tag> CLOSE` at the end of a message.
- While typing: `EN ▸` previews the learned-language version of a native-language draft, `FIX ▸` a correction of a learned-language draft. After sending: `↳` under the message with what was sent, or the correction and notes in the reader's language, or `✓ Your English is perfect!`.
- Input in a third language, code, or a word or two is sent as typed and nothing is done to it.
- `/immerse` alone lists the settings in the band above the prompt, as `/config` lists its own: a row a setting, its value beside its name, a row's choices one Enter away, and under the list a preview of the choice the keyboard is on. `/config` is the model because the author found it clearer than everything built before it. `/immerse on`, `off`, `open` and `close` are shortcuts; `on` and `off` write the same options the list writes.
- Settings are never shown as a second column beside the conversation (a pane, which a wide terminal docks at the right), and never as questions one after another (the question dialog: one change a visit, no preview that follows the keyboard). The author rejected both.
