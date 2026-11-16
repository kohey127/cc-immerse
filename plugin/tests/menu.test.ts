// The settings list `/immerse` shows above the prompt: its rows, the choices of each, what a pick writes,
// and what the preview under the list shows for the choice the keyboard is on.
// Written before hooks/menu.ts was rewritten for the list.
import { expect, test } from 'claude-code/testing'

import { pairOf } from '../hooks/lang'
import { samplesOf, settingsRows } from '../hooks/menu'
import type { Row } from '../hooks/menu'

const JA_EN = pairOf('Japanese', 'English')
const rows = (options: Record<string, unknown> = {}) => settingsRows(options, JA_EN, samplesOf(JA_EN))
const row = (list: Row[], key: string): Row => {
  const found = list.find(r => r.key === key)
  if (!found) throw new Error(`no row ${key} in ${list.map(r => r.key).join(', ')}`)
  return found
}
const linesOf = (r: Row, choice: string): string[] => {
  const p = r.choices.find(c => c.key === choice)?.preview
  return p?.kind === 'lines' ? p.lines.map(l => l.text) : []
}

test('the rows, in reading order, each with what is set now', async () => {
  expect(rows().map(r => [r.name, r.shown])).toEqual([
    ['Your language', 'Japanese'],
    ['You are learning', 'English'],
    ['Reading', 'Level 4 · English first, Japanese on click'],
    ['Japanese, typed', 'Sent as English'],
    ['English, typed', 'Corrected while typing and after'],
    ['Mark', '▸'],
    ['Mark beside', 'Last line'],
    ['Mark shows', 'On hover'],
    ['Grey text', 'Grey italic'],
    ['Levels 2 and 3', 'Side by side'],
    ['Open-all buttons', 'On'],
    ['Preview while typing', 'After 0.6 s'],
  ])
})

test('every row has exactly one choice in force, every key is its own, and every choice has a preview', async () => {
  for (const options of [{}, { readingLevel: 'Off', livePreview: false, nativeInput: 'Leave it alone', corrections: 'Off', allButtons: false }]) {
    const list = rows(options)
    const keys = list.flatMap(r => [r.key, ...r.choices.map(c => c.key)])
    expect(new Set(keys).size).toBe(keys.length)
    for (const r of list) {
      expect({ row: r.key, now: r.choices.filter(c => c.isNow).length }).toEqual({ row: r.key, now: 1 })
      for (const c of r.choices) expect(c.preview.kind === 'reply' || c.preview.lines.length > 0).toBe(true)
    }
  }
})

test('reading: Off and four levels, each named by what you will see, drawn as a sample reply', async () => {
  const reading = row(rows(), 'reading')
  expect(reading.choices.map(c => [c.label, c.about])).toEqual([
    ['Off', 'Replies stay as Claude wrote them'],
    ['Level 1', 'Japanese first, English on click'],
    ['Level 2', 'Japanese on the left, English beside it in grey'],
    ['Level 3', 'English on the left, Japanese beside it in grey'],
    ['Level 4', 'English first, Japanese on click'],
  ])
  expect(reading.choices.map(c => c.set)).toEqual([{ readingLevel: 'Off' }, { readingLevel: '1' }, { readingLevel: '2' }, { readingLevel: '3' }, { readingLevel: '4' }])
  expect(reading.choices.map(c => (c.preview.kind === 'reply' ? c.preview.options.readingLevel : null))).toEqual(['Off', '1', '2', '3', '4'])
  expect(row(rows({ readingLevel: 'Off' }), 'reading').shown).toBe('Off')
})

test('each language row offers every language but the other one of the pair', async () => {
  const list = rows()
  expect(row(list, 'native').choices.length).toBe(21)
  expect(row(list, 'native').choices.some(c => c.label.startsWith('English'))).toBe(false)
  expect(row(list, 'native').choices.find(c => c.label.startsWith('Korean'))?.set).toEqual({ nativeLanguage: 'Korean' })
  expect(row(list, 'target').choices.some(c => c.label.startsWith('Japanese'))).toBe(false)
  expect(row(list, 'target').choices.find(c => c.isNow)?.label).toBe('English')
})

test('what you type in your language: the preview says, for each choice, what Claude gets', async () => {
  const typed = row(rows(), 'nativeInput')
  expect(typed.choices.map(c => c.label)).toEqual(['Sent as English', 'English shown, sent as typed', 'Left alone'])
  expect(linesOf(typed, 'nativeInput-0').at(-1)).toBe('Claude gets: What is the build status?')
  expect(linesOf(typed, 'nativeInput-1').at(-1)).toBe('Claude gets: ビルドの状態は？')
  // The English is seen above the prompt as it is typed; nothing is put under the message, since nothing was sent in its place.
  expect(linesOf(typed, 'nativeInput-1')).toEqual(['EN ▸ What is the build status?', '❯ ビルドの状態は？', 'Claude gets: ビルドの状態は？'])
  expect(linesOf(typed, 'nativeInput-0')).toContain('  ↳ What is the build status?')
  expect(linesOf(typed, 'nativeInput-2')).toEqual(['❯ ビルドの状態は？', 'Claude gets: ビルドの状態は？'])
})

test('what you type in the language you are learning: Claude always gets what you typed', async () => {
  const fixed = row(rows(), 'corrections')
  expect(fixed.choices.map(c => c.label)).toEqual(['Corrected while typing and after', 'Corrected after sending', 'Not corrected'])
  for (const c of fixed.choices) expect(linesOf(fixed, c.key).at(-1)).toBe('Claude gets: I has a question.')
  expect(linesOf(fixed, 'corrections-0')[0]).toBe('FIX ▸ I have a question.')
  expect(linesOf(fixed, 'corrections-1')).not.toContain('FIX ▸ I have a question.')
  expect(linesOf(fixed, 'corrections-2')).toEqual(['❯ I has a question.', 'Claude gets: I has a question.'])
})

test('the preview while typing is one row: off, or how long it waits', async () => {
  const preview = row(rows(), 'typingPreview')
  expect(preview.choices.map(c => [c.label, c.set])).toEqual([
    ['Off', { livePreview: false }],
    ['After 0.3 s', { livePreview: true, previewDelay: '0.3 s' }],
    ['After 0.6 s', { livePreview: true, previewDelay: '0.6 s' }],
    ['After 1 s', { livePreview: true, previewDelay: '1 s' }],
    ['After 2 s', { livePreview: true, previewDelay: '2 s' }],
  ])
  expect(row(rows({ livePreview: false, previewDelay: '2 s' }), 'typingPreview').shown).toBe('Off')
  expect(row(rows({ previewDelay: '2 s' }), 'typingPreview').shown).toBe('After 2 s')
})

test('a value already stored is the one in force', async () => {
  const list = rows({ readingLevel: '2', markPosition: 'First line', nativeInput: 'Show it, send as typed', allButtons: false, mark: '◆' })
  expect(row(list, 'reading').shown).toBe('Level 2 · Japanese on the left, English beside it in grey')
  expect(row(list, 'markPosition').shown).toBe('First line')
  expect(row(list, 'nativeInput').shown).toBe('English shown, sent as typed')
  expect(row(list, 'allButtons').shown).toBe('Off')
  expect(row(list, 'mark').shown).toBe('◆')
})

test('a mark typed into /config that is none of the four is still shown, and kept as a choice', async () => {
  const mark = row(rows({ mark: '🌐' }), 'mark')
  expect(mark.shown).toBe('🌐')
  expect(mark.choices.find(c => c.isNow)?.set).toEqual({ mark: '🌐' })
})

test('a row of two choices is a switch: Enter flips it with no list to open', async () => {
  const list = rows()
  expect(list.filter(r => r.isSwitch).map(r => r.key)).toEqual(['markPosition', 'markVisibility', 'translationStyle', 'layout', 'allButtons'])
})

test('the look of a reply is previewed on a sample reply drawn with that choice', async () => {
  const list = rows()
  expect(row(list, 'mark').choices.map(c => (c.preview.kind === 'reply' ? c.preview.options.mark : null))).toEqual(['▸', '›', '+', '◆'])
  const layout = row(list, 'layout').choices.map(c => (c.preview.kind === 'reply' ? c.preview.options : null))
  // The layout only shows at levels 2 and 3, so it is previewed at level 3 while another level is set.
  expect(layout).toEqual([{ layout: 'Side by side', readingLevel: '3' }, { layout: 'Below', readingLevel: '3' }])
})

test('a pair other than Japanese and English: the names follow, and the samples fall back to words', async () => {
  const pair = pairOf('Korean', 'English')
  const list = settingsRows({ nativeLanguage: 'Korean' }, pair, samplesOf(pair))
  expect(row(list, 'reading').shown).toBe('Level 4 · English first, Korean on click')
  expect(row(list, 'nativeInput').name).toBe('Korean, typed')
})
