// The plugin's text logic. Each "regression" test names a defect a person found by eye on 2026-11-15,
// before these tests existed.
import { expect, test } from 'claude-code/testing'

import { pairOf } from '../hooks/lang'
import { isFixable, isMostlyOther, isProse, isQuote, isTable, languageOf, linesOf, piecesOf, split, tableLines, tablesBeside, widthOf, wrap, wrappedTableLines } from '../hooks/text'

const JA_EN = pairOf('Japanese', 'English')
const ES_EN = pairOf('Spanish', 'English')

// --- which chunks of a reply get a translation mark ---------------------------------------------

test('an English paragraph is offered for translation', async () => {
  expect(isProse('The reload finished. cc-trans should be active now.', JA_EN)).toBe(true)
})

test('regression: a short line whose words are mostly code still gets a mark', async () => {
  // "I recommend `cc-ryugaku`." has ten letters outside the code span; the limit was twelve.
  expect(isProse('I recommend `cc-ryugaku`.', JA_EN)).toBe(true)
})

test('a Japanese paragraph is not offered: it is already in the native language', async () => {
  expect(isProse('変えました。末尾のボタンは ALL JA OPEN になります。', JA_EN)).toBe(false)
})

test('fenced code and a thematic break are not offered', async () => {
  expect(isProse('```sh\nclaude plugin install lingo\n```', JA_EN)).toBe(false)
  expect(isProse('---', JA_EN)).toBe(false)
})

test('regression: a table is recognised, also under a heading', async () => {
  const table = '| Part | Result |\n|---|---|\n| Hover | Works |'
  expect(isTable(table)).toBe(true)
  expect(isTable('## Status\n\n' + table)).toBe(true)
  expect(isTable('A line with a | pipe in it.')).toBe(false)
})

// --- how a reply is cut into chunks ------------------------------------------------------------

test('a reply is cut at blank lines', async () => {
  const chunks = split('First paragraph.\n\nSecond paragraph.', JA_EN)
  expect(chunks.map(c => c.src)).toEqual(['First paragraph.', 'Second paragraph.'])
})

test('a fenced block with a blank line inside stays one chunk', async () => {
  const code = '```ts\nconst a = 1\n\nconst b = 2\n```'
  const chunks = split('Before the code.\n\n' + code + '\n\nAfter the code.', JA_EN)
  expect(chunks.map(c => c.src)).toEqual(['Before the code.', code, 'After the code.'])
  expect(chunks.map(c => c.isProse)).toEqual([true, false, true])
})

test('a heading joins the chunk after it', async () => {
  const chunks = split('## What changed\n\nThe mark moved to the last line.', JA_EN)
  expect(chunks.length).toBe(1)
  expect(chunks[0]?.src).toBe('## What changed\n\nThe mark moved to the last line.')
})

test('regression: a bold line standing alone as a title joins the chunk after it', async () => {
  const chunks = split('**What I need from you**\n\n1. Run the reload.\n2. Open the settings.', JA_EN)
  expect(chunks.length).toBe(1)
  expect(chunks[0]?.src).toBe('**What I need from you**\n\n1. Run the reload.\n2. Open the settings.')
})

test('a bold sentence inside a paragraph, and a paragraph that only begins in bold, stay their own chunks', async () => {
  expect(split('**Settings:** type the command and scroll.\n\nThe next paragraph.', JA_EN).length).toBe(2)
})

test('a table chunk is marked as a table', async () => {
  const chunks = split('Here is a table:\n\n| A | B |\n|---|---|\n| one | two |', JA_EN)
  expect(chunks.map(c => c.isTable)).toEqual([false, true])
})

// --- which language a typed message is in ------------------------------------------------------

test('Japanese is the native language', async () => {
  expect(languageOf('もっとかっこいい名前ないかね', JA_EN)).toBe('native')
})

test('Japanese mixed with English counts as native: the whole message is sent in English', async () => {
  expect(languageOf('この関数を refactor して', JA_EN)).toBe('native')
})

test('an English sentence is the learned language', async () => {
  expect(languageOf('I want to testing the correction feature with this sentence', JA_EN)).toBe('learning')
})

test('regression: a word or two is not judged', async () => {
  expect(languageOf('hello', JA_EN)).toBe('other')
  expect(languageOf('yes', JA_EN)).toBe('other')
  expect(isFixable('yes', JA_EN)).toBe(false)
})

test('a slash command and an empty draft are left alone', async () => {
  expect(languageOf('/immerse off', JA_EN)).toBe('other')
  expect(languageOf('   ', JA_EN)).toBe('other')
})

test('Japanese inside a code span does not make a message native', async () => {
  expect(languageOf('Please rename the variable `名前` to something in English', JA_EN)).toBe('learning')
})

// --- how a chunk is laid out in rows -----------------------------------------------------------

test('list items, headings and paragraphs become lines', async () => {
  const lines = linesOf('## Title\n\n- first item\n- second item\n\nA paragraph\nover two source lines.')
  expect(lines.filter(l => !l.isGap).map(l => [l.lead, l.text, l.isHeading])).toEqual([
    ['', 'Title', true],
    ['• ', 'first item', false],
    ['• ', 'second item', false],
    ['', 'A paragraph over two source lines.', false],
  ])
})

test('a numbered list keeps its numbers', async () => {
  expect(linesOf('1. one\n2. two').map(l => l.lead)).toEqual(['1. ', '2. '])
})

test('inline marks become pieces', async () => {
  expect(piecesOf('Run `/immerse` for **all** of it.')).toEqual([
    { text: 'Run ', kind: 'plain' },
    { text: '/immerse', kind: 'code' },
    { text: ' for ', kind: 'plain' },
    { text: 'all', kind: 'bold' },
    { text: ' of it.', kind: 'plain' },
  ])
})

test('Japanese characters are two columns wide', async () => {
  expect(widthOf('abc')).toBe(3)
  expect(widthOf('日本語')).toBe(6)
})

test('regression: a long paragraph is wrapped, and no row is wider than the room it has', async () => {
  // A Button draws one row: before the plugin wrapped text itself, long paragraphs were cut at the right edge.
  const text =
    'To make a paragraph pressable, the plugin had to change how it draws the text. Before, it used ' +
    "**Claude Code's own** text drawing. Now the plugin draws each paragraph itself, as `one big button`."
  const rows = wrap(piecesOf(text), 60)
  expect(rows.length > 1).toBe(true)
  for (const row of rows) expect(widthOf(row.map(p => p.text).join('')) <= 60).toBe(true)
})

test('wrapping keeps every word, in order', async () => {
  const text = 'one two three four five six seven eight nine ten eleven twelve'
  const joined = wrap(piecesOf(text), 20).map(row => row.map(p => p.text).join('').trim()).join(' ')
  expect(joined).toBe(text)
})

// --- pairs other than Japanese and English ------------------------------------------------------

test('a pair that shares its letters: a sentence is left to the model, a word or two is left alone', async () => {
  expect(languageOf('Por favor cambia el nombre de esta variable', ES_EN)).toBe('unsure')
  expect(languageOf('gracias', ES_EN)).toBe('other')
})

test('a third language is left alone', async () => {
  expect(languageOf('이 함수를 리팩터링해 주세요', JA_EN)).toBe('other')
})

// --- a translated table, laid out by the plugin so that it can be drawn in the translation's colour ----

test('a table is laid out as rows of text: a header, a rule under every row, columns as wide as their widest cell', async () => {
  expect(tableLines('| Check | Result |\n| --- | --- |\n| Unit tests | Passed |', 80)).toEqual([
    '┌────────────┬────────┐',
    '│   Check    │ Result │',
    '├────────────┼────────┤',
    '│ Unit tests │ Passed │',
    '└────────────┴────────┘',
  ])
})

test('a Japanese cell is measured by the columns it takes, so the borders line up', async () => {
  const lines = tableLines('| チェック | 結果 |\n| --- | --- |\n| 単体テスト | 成功 |', 80) ?? []
  expect(lines).toEqual(['┌────────────┬──────┐', '│  チェック  │ 結果 │', '├────────────┼──────┤', '│ 単体テスト │ 成功 │', '└────────────┴──────┘'])
  expect(new Set(lines.map(widthOf)).size).toBe(1)
})

test('a line around the table is kept as a line of its own', async () => {
  expect(tableLines('結果の一覧\n\n| A | B |\n| --- | --- |\n| 1 | 2 |', 80)).toEqual(['結果の一覧', '', '┌───┬───┐', '│ A │ B │', '├───┼───┤', '│ 1 │ 2 │', '└───┴───┘'])
})

test('a table wider than the room it has is not laid out: the caller draws it another way', async () => {
  expect(tableLines('| A long header cell | Another long header cell |\n| --- | --- |\n| 1 | 2 |', 30)).toBeNull()
})

test('a text with no table in it is not laid out', async () => {
  expect(tableLines('Only a sentence.', 80)).toBeNull()
})

// --- wrapping a language written without spaces ----------------------------------------------------

const rowsOf = (text: string, max: number) => wrap(piecesOf(text), max).map(row => row.map(p => p.text).join(''))

test('regression: a long Japanese sentence is broken where the row ends, not pushed whole onto the next row', async () => {
  // Seen on a real screen at reading level 2: "main" stood alone on the first row and the rest ran past the edge.
  const text = 'main ブランチでビルドが通り、すべてのチェックが1分以内に終わりました。'
  const rows = rowsOf(text, 30)
  expect(rows[0]?.startsWith('main ブランチ')).toBe(true)
  for (const row of rows) expect(widthOf(row) <= 30).toBe(true)
  expect(rows.join('')).toBe(text)
})

test('a row never starts with a closing mark: 、 and 。 stay with the character before them', async () => {
  const rows = rowsOf('あいうえお、かきくけこ。', 10)
  expect(rows).toEqual(['あいうえ', 'お、かきく', 'けこ。'])
})

test('an English word is still never broken inside, also beside Japanese', async () => {
  const rows = rowsOf('これは wrapping のテストです', 12)
  expect(rows.some(row => /^wrapping/.test(row) || / wrapping/.test(row))).toBe(true)
  expect(rows.join('').replace(/\s/g, '')).toBe('これはwrappingのテストです')
})

test('a word wider than the row is broken, since it fits nowhere', async () => {
  const rows = rowsOf('https://example.com/a/very/long/path/that/goes/on', 20)
  for (const row of rows) expect(widthOf(row) <= 20).toBe(true)
  expect(rows.join('')).toBe('https://example.com/a/very/long/path/that/goes/on')
})

// --- a reply in the native language: Claude answers in the language it was asked in ------------------

test('a block of a reply is marked by its language: the learned one, the native one, or neither', async () => {
  const chunks = split('The reload finished.\n\n変えました。末尾のボタンが変わります。\n\n```sh\nls\n```', JA_EN)
  expect(chunks.map(c => [c.isProse, c.isNative])).toEqual([
    [true, false],
    [false, true],
    [false, false],
  ])
})

// Seen while recording the README for an English speaker learning Spanish: at level 2 Claude answered in
// English, and the plugin took every block for Spanish and asked for it to be put into English.
test('regression: where the two languages share their letters, a block is taken to be in the language the level talks in', async () => {
  const pair = pairOf('English', 'Spanish')
  const english = 'The build passed on the main branch.'
  expect(split(english, pair, 'native')[0]).toEqual({ src: english, isProse: false, isNative: true, isTable: false })
  expect(split(english, pair, 'target')[0]).toEqual({ src: english, isProse: true, isNative: false, isTable: false })
  // With nothing said it is the learned language, as before.
  expect(split(english, pair)[0]?.isProse).toBe(true)
})

test('where the letters tell the two languages apart, the level changes nothing', async () => {
  const pair = pairOf('Japanese', 'English')
  const english = 'The build passed on the main branch.'
  expect(split(english, pair, 'native')[0]).toEqual({ src: english, isProse: true, isNative: false, isTable: false })
  expect(split('main ブランチでビルドが通りました。', pair, 'target')[0]?.isNative).toBe(true)
})

// The author, of levels 2 and 3: the word is "beside it", and the paragraphs were beside each other while
// the tables were one under the other.
test('regression: two tables that each fit half the window are laid out beside each other, row for row', async () => {
  const en = '| Build | Tests |\n| --- | --- |\n| Passed | 2 failed |'
  const ja = '| ビルド | テスト |\n| --- | --- |\n| 成功 | 2件失敗 |'
  const both = tablesBeside(en, ja, 40)
  expect(both?.front[1]).toContain('Build')
  expect(both?.behind[1]).toContain('ビルド')
  expect(both?.front.length).toBe(5)
  expect(both?.behind.length).toBe(5)
})

test('a table wider than half the window is not put beside the other: both go one under the other', async () => {
  const en = '| Build | Tests |\n| --- | --- |\n| Passed | 2 failed |'
  const ja = '| ビルド | テスト |\n| --- | --- |\n| 成功 | 2件失敗 |'
  expect(tablesBeside(en, ja, 12)).toBe(null)
  expect(tablesBeside('Not a table.', ja, 40)).toBe(null)
})

// Seen on the author's screen: a wide table opened to a translation at full brightness. A table wider than
// the window was handed to Claude Code to draw, which draws it in the reply's own colour.
test('regression: a table wider than the window is drawn by the plugin too, its cells wrapped to fit', async () => {
  const src = '| Role | Result | What was missing |\n| --- | --- | --- |\n| Repository Services | Passed | Only Go, Kubernetes, Rust and gRPC, and all of them are helpful or examples |'
  expect(tableLines(src, 50)).toBeNull()
  const lines = wrappedTableLines(src, 50) ?? []
  expect(lines.length).toBeGreaterThan(5)
  // Every row fits, the borders line up, and no word is lost.
  for (const line of lines) expect(widthOf(line) <= 50).toBe(true)
  expect(new Set(lines.map(line => widthOf(line))).size).toBe(1)
  expect(lines[0]?.startsWith('┌')).toBe(true)
  expect(lines.at(-1)?.startsWith('└')).toBe(true)
  const words = lines.join(' ').replace(/[│┌┐└┘├┤┬┴┼─]/g, ' ').split(/\s+/).filter(Boolean)
  for (const word of ['Repository', 'Services', 'Passed', 'Kubernetes,', 'examples']) expect(words).toContain(word)
})

test('a cell\'s Markdown marks are drawn out of a wrapped table, and a table that fits is left to tableLines', async () => {
  const lines = wrappedTableLines('| Role | Why |\n| --- | --- |\n| **Repository Services** | See `tracker.md` and the [notes](notes.md) for the whole of the reasoning here |', 40) ?? []
  const drawn = lines.join('\n')
  expect(drawn.includes('**')).toBe(false)
  expect(drawn.includes('`')).toBe(false)
  expect(drawn.includes('](')).toBe(false)
  expect(drawn).toContain('tracker.md')
  // Too narrow for even four columns a cell, and a text with no table: null.
  expect(wrappedTableLines('| A | B | C | D |\n| --- | --- | --- | --- |\n| 1 | 2 | 3 | 4 |', 12)).toBeNull()
  expect(wrappedTableLines('Only a sentence.', 80)).toBeNull()
})

test('a quote is a block of lines that all start with >; a reply is judged by its other blocks, wide characters counting two', async () => {
  const pair = pairOf('Japanese', 'English')
  expect(isQuote('> Next, I want to focus on one product.\n> And help its users.')).toBe(true)
  expect(isQuote('A paragraph that quotes > once.')).toBe(false)
  const reply = split('推敲案です。\n\n> Next, I want to focus on one product, and help its users do things they could not do before.\n\nこの案でよければ置き換えます。', pair)
  // At level 1 (Japanese read first) this reply is Japanese: the quote does not count.
  expect(isMostlyOther(reply, true)).toBe(false)
  expect(isMostlyOther(split('The build passed.\n\nビルドが通りました。', pair), true)).toBe(false)
  expect(isMostlyOther(split('The build passed on the main branch, and every check ran.\n\n通りました。', pair), true)).toBe(true)
})

// The author: "Sources and the like cannot be clicked at all." A link in a paragraph the plugin draws kept
// its words and lost where it went.
test('regression: a link keeps where it goes, and so does a bare URL', async () => {
  expect(piecesOf('See [Built In: Envisio](https://builtin.com/company/envisio) and https://pitchbook.com/x.')).toEqual([
    { text: 'See ', kind: 'plain' },
    { text: 'Built In: Envisio', kind: 'link', href: 'https://builtin.com/company/envisio' },
    { text: ' and ', kind: 'plain' },
    { text: 'https://pitchbook.com/x', kind: 'link', href: 'https://pitchbook.com/x' },
    { text: '.', kind: 'plain' },
  ])
})

test('a link cut over two rows keeps where it goes on both, and two links side by side stay two', async () => {
  const rows = wrap(piecesOf('Read [the long article about the company](https://a.example/1) first.'), 20)
  const links = rows.flat().filter(p => p.kind === 'link')
  expect(links.length).toBeGreaterThan(1)
  for (const link of links) expect(link.href).toBe('https://a.example/1')
  const two = wrap(piecesOf('[One](https://a.example/1)[Two](https://a.example/2)'), 40).flat()
  expect(two.map(p => p.href)).toEqual(['https://a.example/1', 'https://a.example/2'])
})
