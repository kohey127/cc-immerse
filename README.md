# cc-immerse

**Learn a language while you work in Claude Code. You pick how much of the conversation is in the language you are learning, and your own words always reach Claude as you wrote them.**

<!-- GIF 1 (hero): a reply in English; the pointer moves onto a paragraph, ▸ appears, a click opens the Japanese under it, a second click closes it. -->

You already spend hours a day reading and writing with Claude Code. This turns those hours into practice, without a separate study session.

> **Status: early.** It works in the Claude Code terminal. It has been used daily for Japanese and English; 22 languages can be chosen, and the other pairs are covered by tests but not yet by real use. The levels are new and checked on a real screen by automated tests; they have not been through daily use yet.

The examples below use a Japanese speaker learning English, the defaults.

## Levels

One setting decides how far in you are. It says two things at once: in which language you and Claude talk, and which language you read first.

| Level | You and Claude talk in | What you type in Japanese | How you read the reply |
| --- | --- | --- | --- |
| 1 | Japanese | Sent as typed | Japanese. Click `▸` for the English |
| 2 | Japanese | Sent as typed | Japanese on the left, the English beside it, grey |
| 3 | English | Sent in English, with your Japanese beside it | English on the left, the Japanese beside it, grey |
| **4 (default)** | English | Sent in English, with your Japanese beside it | English. Click `▸` for the Japanese |

<!-- GIF 5: the same question at levels 1, 2, 3 and 4, one after the other. -->

- **Nothing you mean is lost.** At levels 1 and 2 Claude gets exactly what you typed. At levels 3 and 4 it gets the English version as your message and your own words beside it, so it answers in English and still knows what you meant.
- **What you type in English is sent as typed at every level**, and corrected beside the conversation. Claude never sees the correction.
- At levels 1 and 2 the English you see is a translation of Claude's Japanese answer. At levels 3 and 4 it is Claude's own English.
- In a narrow window the two columns of levels 2 and 3 become one, the second language under the first.
- Off leaves replies as they are.

### Reading a reply

<!-- GIF 2: ALL JA OPEN / ALL JA CLOSE on a reply with a paragraph, a list and a table. -->

- Move the pointer onto a paragraph, a list or a table: a `▸` appears beside its last line.
- Click it: the other language for that block opens under it, in grey. Click `▾` to close it.
- `▸▸ ALL JA OPEN` and `▾▾ ALL JA CLOSE` at the end of a message do the same for the whole message.
- At levels 1 and 4 nothing is translated, or paid for, until you open it, as long as Claude answers in the language you read first. A reply in the other language is translated block by block so that you still read it in yours.

### Help while you type

<!-- GIF 3: typing Japanese, EN ▸ appears above the prompt, Enter sends, ↳ shows the English under the message. -->
<!-- GIF 4: typing English with a mistake, FIX ▸ appears, Enter sends the text as typed, ↳ shows the correction and the notes. -->

| You type | While you type | Under your sent message |
| --- | --- | --- |
| Japanese | `EN ▸` how it reads in English | At levels 3 and 4, `↳` the English that was sent |
| English | `FIX ▸` your sentence as it would read corrected | `↳` the corrected sentence, then short notes in Japanese |

This help has a switch of its own.

## Settings

Type `/immerse`. The settings appear above the prompt box as a list, the way `/config` lists its own: your language, the language you are learning, the level, and help while typing.

- **↑ and ↓ move, Enter changes the row, ← goes back.** They work the moment the list opens. A number presses the row beside it.
- **Under the list, a preview follows the keyboard.** For a level it shows the exchange at that level: what you type, what Claude gets, and the reply as you will read it.
- A change is in force at once and the list stays. Typing a message closes it.

<!-- GIF 6: /immerse, the list worked by the keyboard, the preview following it, the next reply drawn at the level picked. -->

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
| `/immerse` | Shows the settings above the prompt |
| `/immerse off` | Sets the level to Off and help while typing off |
| `/immerse on` | Brings back what was set |
| `/immerse open` | Opens the translation for every block of the latest reply |
| `/immerse close` | Closes every open translation |

## What it costs

Translations and corrections run on Claude Haiku through your own Claude Code account.

- At levels 1 and 4 a reply costs nothing until you open a block, when it is in the language you read first. At levels 2 and 3, and for a reply in the other language, each block is one small call.
- With help while typing on, a draft costs one small call each time you pause.

## Limits

- **Terminal only.** In tests, the phone and desktop apps showed nothing. The reason is not known yet.
- **Pairs that share an alphabet cost one more wait.** Japanese and English are told apart by their letters, at once. Spanish and English are not, so the small model is asked which language a message is in before it is sent.
- **A message in a third language is left alone**: sent as typed, with no translation and no correction.
- **At levels 3 and 4 Claude is told, beside your message, to answer in the language you are learning.** Without that it answers in the language of your own words, which it can see. This is the one place the plugin says anything to Claude.
- **Pointing and clicking need a terminal that reports the mouse.** Without it, use `/immerse open`.
- **Paragraphs are drawn by the plugin**, not by Claude Code, so bold, italics and inline code may look slightly different, and links inside them cannot be clicked.
- Built on Claude Code's plugin API for interface mods, which is early access and may change between releases.

## Roadmap

- Instructions to the small model that you can edit.
- The plugin counting how often you open the translation, and suggesting the next level.

## Development

The plugin is in `plugin/`. `CLAUDE.md` describes the layout, the checks and how the work is done.

```sh
claude plugin validate plugin
claude plugin test plugin
cd screen && bun install && bun test   # checks on a real screen
```

## Prior work

[cc-trans](https://github.com/ktk1012/cc-trans) and [Lingo](https://github.com/royisme/lingo) translate Claude Code conversations, and trying them led to this plugin. They show your own language next to the English. cc-immerse keeps the English in front and shows your language only when you ask, so that you read the English first. The live preview while you type follows the approach cc-trans takes.

## License

MIT
