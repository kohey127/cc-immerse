# cc-immerse

Learn English while you work in Claude Code.

Most translation plugins put your own language next to the English, and then you read only your own language. This one keeps the English in front. The Japanese is there only when you ask for it.

> Status: early. It works in the Claude Code terminal. It is built for a Japanese speaker learning English; other language pairs are not supported yet.

## What it does

**Reading Claude's replies**

- Replies stay in English, drawn as usual. Nothing extra is on screen.
- Move the pointer over a paragraph, a list or a table: a `▸` appears at its start.
- Click `▸`: the Japanese for that block opens under it. Click `▾` to close it.
- `▸▸ ALL JA OPEN` and `▾▾ ALL JA CLOSE` at the end of a message do the same for the whole message.
- Nothing is translated until you open it.

**Writing your prompts**

The plugin first checks which language you typed.

| You type | While you type | What Claude receives | Under your sent message |
| --- | --- | --- | --- |
| Japanese (or Japanese mixed with English) | `EN ▸` the English version, above the prompt box | The English version | `↳` the English that was sent |
| English | `FIX ▸` your sentence as it would read corrected | Your own text, unchanged | `↳` the corrected sentence, then short notes in Japanese |

The corrections are made beside the conversation by a small model. Claude never sees them, so they take no room in the conversation and do not change its answers.

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
| `/immerse` | Opens the Japanese for every block of the latest reply |
| `/immerse off` | Closes it |
| `/immerse where` | Lists the screens the session draws on |

## What it costs

Translations and corrections run on Claude Haiku through your own Claude Code account.

- A reply costs nothing until you open a block.
- A draft costs one small call each time you pause while typing.

## Limits

- **Terminal only.** In tests, the phone and desktop apps showed nothing. The reason is not known yet.
- **Japanese and English only**, for now. The language check counts Japanese characters, so it cannot tell two languages apart that share an alphabet.
- **Clicks need a terminal that reports the mouse** (Claude Code's fullscreen rendering). Without it, use `/immerse`.
- **English paragraphs are drawn by the plugin**, not by Claude Code, so bold, italics and inline code may look slightly different, and links inside them cannot be clicked.
- Built on Claude Code's plugin API for interface mods, which is early access and may change between releases.

## Roadmap

- Settings for the language pair.
- Levels: support that fades step by step, with the plugin counting how often you open the translation and suggesting the next step.

## Prior work

[cc-trans](https://github.com/ktk1012/cc-trans) and [Lingo](https://github.com/royisme/lingo) translate Claude Code conversations and were the starting point for this design. The live preview while typing follows the approach cc-trans takes. Both are MIT licensed.

## License

MIT
