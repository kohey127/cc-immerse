// The settings: what each switch and level sets, and how a single option overrides its level.
// Written before hooks/settings.ts was changed to match.
import { expect, test } from 'claude-code/testing'

import { readSettings } from '../hooks/settings'

test('with nothing set, the plugin behaves as it did before it had settings', async () => {
  expect(readSettings({})).toEqual({
    front: 'target',
    show: 'request',
    mark: '▸',
    markAt: 'last',
    markShown: 'hover',
    style: 'faint-italic',
    hasAllButtons: true,
    send: 'target',
    hasPreview: true,
    previewDelayMs: 600,
    correct: 'both',
  })
})

test('the reading level goes from the native language in front to the learned one in front', async () => {
  const at = (level: string) => {
    const s = readSettings({ readingLevel: level })
    return [s.front, s.show]
  }
  expect(['1', '2', '3', '4'].map(at)).toEqual([
    ['native', 'request'],
    ['native', 'side'],
    ['target', 'side'],
    ['target', 'request'],
  ])
})

test('the layout of levels 2 and 3 can be set to below; it changes nothing at levels 1 and 4', async () => {
  const show = (level: string) => readSettings({ readingLevel: level, layout: 'Below' }).show
  expect(['1', '2', '3', '4'].map(show)).toEqual(['request', 'below', 'below', 'request'])
})

test('reading Off: no translation is shown', async () => {
  expect(readSettings({ readingLevel: 'Off' }).show).toBe('never')
  expect(readSettings({ readingLevel: 'Off', layout: 'Below' }).show).toBe('never')
})

test('with nothing set, what is typed in the native language is sent in the learned one, and the learned one is corrected', async () => {
  const s = readSettings({})
  expect([s.send, s.hasPreview, s.correct]).toEqual(['target', true, 'both'])
})

test('both kinds of typing help off: nothing is done to anything typed', async () => {
  const s = readSettings({ nativeInput: 'Leave it alone', corrections: 'Off' })
  expect([s.send, s.correct]).toEqual(['off', 'off'])
})

test('a single typing option changes one thing', async () => {
  expect(readSettings({ corrections: 'After sending' }).correct).toBe('sent')
  expect(readSettings({ corrections: 'Off' }).correct).toBe('off')
  expect(readSettings({ nativeInput: 'Show it, send as typed' }).send).toBe('preview')
  expect(readSettings({ nativeInput: 'Leave it alone' }).send).toBe('off')
})

test('the mark, its place and its style are read from their options', async () => {
  const s = readSettings({ mark: '🌐', markPosition: 'First line', markVisibility: 'Always', translationStyle: 'Faint', allButtons: false })
  expect([s.mark, s.markAt, s.markShown, s.style, s.hasAllButtons]).toEqual(['🌐', 'first', 'always', 'faint', false])
})

test('a translation is always grey: there is no style that draws it at full strength', async () => {
  expect(readSettings({ translationStyle: 'Normal' }).style).toBe('faint-italic')
})

test('an empty mark falls back to the default: a block must have something to press', async () => {
  expect(readSettings({ mark: '   ' }).mark).toBe('▸')
})

test('the preview can be switched off and its wait changed', async () => {
  expect(readSettings({ livePreview: false }).hasPreview).toBe(false)
  expect(readSettings({ previewDelay: '2 s' }).previewDelayMs).toBe(2000)
  expect(readSettings({ previewDelay: '0.3 s' }).previewDelayMs).toBe(300)
})

test('a value that names nothing is ignored', async () => {
  const s = readSettings({ readingLevel: '9', layout: 'Sideways', previewDelay: 'soon', corrections: 'Maybe' })
  expect([s.front, s.show, s.previewDelayMs, s.correct]).toEqual(['target', 'request', 600, 'both'])
})
