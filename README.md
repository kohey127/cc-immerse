# cc-immerse

**Work in Claude Code in the language you are learning. Your own language is one click away, and nowhere else on the screen.**

<!-- GIF 1 (hero): a reply in English; the pointer moves onto a paragraph, ▸ appears, a click opens the Japanese under it, a second click closes it. -->

Translation plugins put your own language next to the English, and then you read only your own language. cc-immerse does the opposite. Claude answers in English, you read the English, and you open your own language only for the block you are stuck on. What you type is handled the same way: write in your own language and it is sent in English; write in English and it is corrected beside the conversation.

You already spend hours a day reading and writing with Claude Code. This turns those hours into practice, without a separate study session.

> **Status: early.** It works in the Claude Code terminal. It has been used daily for Japanese and English; 22 languages can be chosen in the settings, and the other pairs are covered by tests but not yet by real use. The levels and settings are built and covered by tests; most have not been through daily use yet. See [Roadmap](#roadmap) for what is still to come.

The examples below use a Japanese speaker learning English, the defaults.

## What it does

### You read the reply in English

<!-- GIF 2: ALL JA OPEN / ALL JA CLOSE on a reply with a paragraph, a list and a table. -->

- Replies look as they always do. Nothing extra is on screen.
- Move the pointer onto a paragraph, a list or a table: a `▸` appears beside its last line.
- Click it: the Japanese for that block opens under it. Click `▾` to close it.
- `▸▸ ALL JA OPEN` and `▾▾ ALL JA CLOSE` at the end of a message do the same for the whole message.
- Nothing is translated, or paid for, until you open it.

### You write, and the plugin works out which language you used

<!-- GIF 3: typing Japanese, EN ▸ appears above the prompt, Enter sends the English, ↳ shows it under the message. -->
<!-- GIF 4: typing English with a mistake, FIX ▸ appears, Enter sends the text as typed, ↳ shows the correction and the notes. -->

| You type | While you type | What Claude receives | Under your sent message |
| --- | --- | --- | --- |
| Japanese, or Japanese mixed with English | `EN ▸` the English version | The English version | `↳` the English that was sent |
| English | `FIX ▸` your sentence as it would read corrected | Your own text, unchanged | `↳` the corrected sentence, then short notes in Japanese |

The corrections are made beside the conversation by a small model. Claude never sees them, so they take no room in the conversation and do not change its answers.

## Too much at once? Start lower

Full immersion on the first day is hard, and a tool you stop using teaches nothing. So there is a ladder you climb at your own speed. Reading and writing have their own level.

| Level | Reading | Writing |
| --- | --- | --- |
| 1 | Both languages side by side (in a wide window) | Type your language: the English is shown and sent. Type English: it is corrected while you type and after you send |
| 2 | English, with your language shown faintly below | Same as 1 |
| **3 (default)** | English only; point and click to open your language | Same as 1 |
| 4 | Same as 3 for now | Corrected only after you send |
| 5 | No help | No help |

<!-- GIF 5: the same reply at levels 1, 2 and 3, one after the other. -->

Level 3 is where the plugin starts, because it is the one that makes you read the English first. If that is too much, set the reading level to 1 or 2 and come back up.

### Fine-grained settings

A level is a preset. Each thing it sets can also be set by itself, and then that setting wins.

In Claude Code, open `/config` and find **Immerse**.

| Setting | Default | Choices |
| --- | --- | --- |
| Your language | Japanese | 22 languages |
| Language you are learning | English | 22 languages |
| Reading level | 3 | 1 to 5 |
| Writing level | 3 | 1 to 5 |
| When the translation shows | Follow the level | On request · Always, below · Side by side · Never |
| Mark | `▸` | Any character |
| Mark position | Last line | Last line · First line |
| Mark visibility | On hover | On hover · Always |
| Translation style | Faint italic | Faint italic · Faint · Normal |
| Open-all and close-all buttons | On | On · Off |
| What you type in your language | Follow the level | Send in the language you are learning · Show it, send as typed · Leave it alone |
| Preview while typing | On | On · Off |
| Preview wait | 0.6 s | 0.3 s · 0.6 s · 1 s · 2 s |
| Corrections | Follow the level | While typing and after sending · After sending · Off |

A settings panel that shows a sample reply redrawing as you move between options is planned.

<!-- GIF 6: the settings panel, the sample redrawing as the option changes. -->

## Install

In a Claude Code terminal session:

```
/plugin install cc-immerse --marketplace kohey127/cc-immerse
```

From a shell:

```sh
claude plugin install cc-immerse --marketplace kohey127/cc-immerse
```

## Commands

| Command | What it does |
| --- | --- |
| `/immerse` | Opens the translation for every block of the latest reply |
| `/immerse off` | Closes every open translation |
| `/immerse where` | Lists the screens the session draws on |

## What it costs

Translations and corrections run on Claude Haiku through your own Claude Code account.

- A reply costs nothing until you open a block.
- A draft costs one small call each time you pause while typing.

## Limits

- **Terminal only.** In tests, the phone and desktop apps showed nothing. The reason is not known yet.
- **Pairs that share an alphabet cost one more wait.** Japanese and English are told apart by their letters, at once. Spanish and English are not, so the small model is asked which language a message is in before it is sent.
- **A message in a third language is left alone**: sent as typed, with no translation and no correction.
- **Pointing and clicking need a terminal that reports the mouse.** Without it, use `/immerse`.
- **English paragraphs are drawn by the plugin**, not by Claude Code, so bold, italics and inline code may look slightly different, and links inside them cannot be clicked.
- Built on Claude Code's plugin API for interface mods, which is early access and may change between releases.

## Roadmap

- Reading level 4: opening a block shows a simpler rewording in the language you are learning first.
- A settings panel with a live sample.
- Instructions to the small model that you can edit.
- The plugin counting how often you open the translation, and suggesting the next level.

## Development

The plugin is in `plugin/`. Its tests run with Claude Code's own test runner:

```sh
claude plugin validate plugin
claude plugin test plugin
```

| File | Covers |
| --- | --- |
| `plugin/tests/lang.test.ts` | Which language a text is in, for any pair, and what the small model is asked |
| `plugin/tests/text.test.ts` | How a reply is cut into blocks and laid out in rows |
| `plugin/tests/reply.test.tsx` | A reply as drawn: the marks, opening and closing a translation |
| `plugin/tests/pair.test.tsx` | The language settings, corrections under a typed message, and sessions the plugin leaves alone |
| `plugin/tests/settings.test.ts` | What each level and option means |
| `plugin/tests/modes.test.tsx` | What each reading setting does to a reply as drawn |
| `plugin/tests/typing.test.tsx` | A typed message on its way to the model: what is sent in its place, and what is left alone |

A session with nobody at its prompt (`claude -p`, a scheduled run) is left alone, so a script's own prompt is never rewritten.

## Prior work

[cc-trans](https://github.com/ktk1012/cc-trans) and [Lingo](https://github.com/royisme/lingo) translate Claude Code conversations, and trying them led to this plugin. They show your own language next to the English. cc-immerse keeps the English in front and shows your language only when you ask, so that you read the English first. The live preview while you type follows the approach cc-trans takes.

## License

MIT
