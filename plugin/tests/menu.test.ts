// The settings list `/immerse` shows above the prompt: four rows, the choices of each, what a pick writes,
// and what the preview under the list shows for the choice the keyboard is on.
// Written before hooks/menu.ts was rewritten for the four rows.
import { expect, test } from 'claude-code/testing'

import { LANGUAGES, pairOf } from '../hooks/lang'
import { hasRoomForTable, sampleIn, samplesOf, settingsRows } from '../hooks/menu'
import type { Row } from '../hooks/menu'

const JA_EN = pairOf('Japanese', 'English')
const rows = (options: Record<string, unknown> = {}) => settingsRows(options, JA_EN, samplesOf(JA_EN))
const row = (list: Row[], key: string): Row => {
  const found = list.find(r => r.key === key)
  if (!found) throw new Error(`no row ${key} in ${list.map(r => r.key).join(', ')}`)
  return found
}

test('four rows, each with what is set now; the level says in which language you and Claude talk', async () => {
  expect(rows().map(r => [r.name, r.shown])).toEqual([
    ['Your language', 'Japanese'],
    ['You are learning', 'English'],
    ['Level', 'Level 4 · With Claude in English'],
    ['Help while typing', 'On'],
  ])
  expect(row(rows({ readingLevel: '2' }), 'level').shown).toBe('Level 2 · With Claude in Japanese')
  expect(row(rows({ readingLevel: 'Off' }), 'level').shown).toBe('Off')
})

test('every row has exactly one choice in force, every key is its own, and every choice has a preview', async () => {
  for (const options of [{}, { readingLevel: 'Off', typingHelp: false }, { readingLevel: '1' }]) {
    const list = rows(options)
    const keys = list.flatMap(r => [r.key, ...r.choices.map(c => c.key)])
    expect(new Set(keys).size).toBe(keys.length)
    for (const r of list) {
      expect({ row: r.key, now: r.choices.filter(c => c.isNow).length }).toEqual({ row: r.key, now: 1 })
      for (const c of r.choices) expect(c.preview.kind === 'exchange' || c.preview.lines.length > 0).toBe(true)
    }
  }
})

test('the levels: Off and four, each saying the language with Claude and where the other language is', async () => {
  const level = row(rows(), 'level')
  expect(level.choices.map(c => [c.label, c.about])).toEqual([
    ['Off', 'Nothing is done to replies'],
    ['Level 1', 'With Claude in Japanese · English on click'],
    ['Level 2', 'With Claude in Japanese · English beside it'],
    ['Level 3', 'With Claude in English · Japanese beside it'],
    ['Level 4', 'With Claude in English · Japanese on click'],
  ])
  expect(level.choices.map(c => c.set)).toEqual([{ readingLevel: 'Off' }, { readingLevel: '1' }, { readingLevel: '2' }, { readingLevel: '3' }, { readingLevel: '4' }])
  // Each is previewed as an exchange at that level: what is typed, what Claude gets, how the reply is read.
  expect(level.choices.map(c => (c.preview.kind === 'exchange' ? c.preview.level : null))).toEqual(['Off', '1', '2', '3', '4'])
})

test('each language row offers every language but the other one of the pair', async () => {
  const list = rows()
  expect(row(list, 'native').choices.length).toBe(21)
  expect(row(list, 'native').choices.some(c => c.label.startsWith('English'))).toBe(false)
  expect(row(list, 'native').choices.find(c => c.label.startsWith('Korean'))?.set).toEqual({ nativeLanguage: 'Korean' })
  expect(row(list, 'target').choices.find(c => c.isNow)?.label).toBe('English')
})

test('help while typing is a switch, and its preview shows the line above the prompt box', async () => {
  const help = row(rows(), 'typingHelp')
  expect(help.isSwitch).toBe(true)
  expect(help.choices.map(c => [c.label, c.set])).toEqual([
    ['On', { typingHelp: true }],
    ['Off', { typingHelp: false }],
  ])
  const on = help.choices[0]?.preview
  expect(on?.kind === 'lines' && on.lines.some(l => l.text.startsWith('EN ▸ '))).toBe(true)
  expect(row(rows({ typingHelp: false }), 'typingHelp').shown).toBe('Off')
})

test('a pair other than Japanese and English: the names follow', async () => {
  const pair = pairOf('Korean', 'English')
  const list = settingsRows({ nativeLanguage: 'Korean', readingLevel: '1' }, pair, samplesOf(pair))
  expect(row(list, 'level').shown).toBe('Level 1 · With Claude in Korean')
})

test('every language offered has a sample of its own for the preview: no placeholder is ever drawn', async () => {
  // Seen on the author's screen: "(Korean)" where the Korean sample should have been.
  expect(LANGUAGES.length).toBe(22)
  const seen = new Set<string>()
  for (const language of LANGUAGES) {
    const sample = sampleIn(language)
    const texts = [...sample.reply, sample.asked]
    expect({ language: language.name, isWhole: texts.every(text => text.trim() !== '' && !text.includes('(')) }).toEqual({ language: language.name, isWhole: true })
    seen.add(texts.join('|'))
  }
  // Each its own: none falls back to another's.
  expect(seen.size).toBe(22)
})

test('with Korean being learned, the preview of level 4 is in Korean', async () => {
  const pair = pairOf('Japanese', 'Korean')
  expect(samplesOf(pair).target.asked).toBe('빌드 상태가 어떤가요?')
})

test('every language has a table of its own for the preview: a header and one row', async () => {
  const seen = new Set<string>()
  for (const language of LANGUAGES) {
    const lines = sampleIn(language).table.split('\n')
    expect({ language: language.name, rows: lines.length, isTable: lines.every(line => line.startsWith('|') && line.endsWith('|')) }).toEqual({ language: language.name, rows: 3, isTable: true })
    seen.add(lines.join())
  }
  expect(seen.size).toBe(22)
})

test('the preview shows the table only where the band has rows for the list first, then the exchange with it', async () => {
  // One language behind its mark: the list, then 16 rows.
  expect(hasRoomForTable(21, 5, false)).toBe(true)
  expect(hasRoomForTable(20, 5, false)).toBe(false)
  // Both languages always shown: the two tables beside each other, 15 rows.
  expect(hasRoomForTable(22, 7, true)).toBe(true)
  expect(hasRoomForTable(21, 7, true)).toBe(false)
})
