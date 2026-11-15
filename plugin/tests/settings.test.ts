// The settings: what each level sets, and how a single option overrides its level.
// Written before hooks/settings.ts existed.
import { expect, test } from 'claude-code/testing'

import { readSettings } from '../hooks/settings'

test('with nothing set, the plugin behaves as it did before it had settings', async () => {
  expect(readSettings({})).toEqual({
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

test('the reading level sets when the translation shows', async () => {
  const show = (level: string) => readSettings({ readingLevel: level }).show
  expect(['1', '2', '3', '4', '5'].map(show)).toEqual(['side', 'below', 'request', 'request', 'never'])
})

test('the writing level sets what happens to native-language input and when corrections come', async () => {
  const at = (level: string) => {
    const s = readSettings({ writingLevel: level })
    return [s.send, s.hasPreview, s.correct]
  }
  expect(at('1')).toEqual(['target', true, 'both'])
  expect(at('3')).toEqual(['target', true, 'both'])
  expect(at('4')).toEqual(['target', true, 'sent'])
  expect(at('5')).toEqual(['off', false, 'off'])
})

test('a single option overrides what its level would set', async () => {
  expect(readSettings({ readingLevel: '1', showTranslation: 'On request' }).show).toBe('request')
  expect(readSettings({ writingLevel: '5', corrections: 'After sending' }).correct).toBe('sent')
  expect(readSettings({ writingLevel: '5', nativeInput: 'Show it, send as typed' }).send).toBe('preview')
})

test('"Follow the level" leaves the level in charge', async () => {
  expect(readSettings({ readingLevel: '2', showTranslation: 'Follow the level' }).show).toBe('below')
})

test('the mark, its place and its style are read from their options', async () => {
  const s = readSettings({ mark: '🌐', markPosition: 'First line', markVisibility: 'Always', translationStyle: 'Normal', allButtons: false })
  expect([s.mark, s.markAt, s.markShown, s.style, s.hasAllButtons]).toEqual(['🌐', 'first', 'always', 'normal', false])
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
  const s = readSettings({ readingLevel: '9', showTranslation: 'Sideways', previewDelay: 'soon', corrections: 'Maybe' })
  expect([s.show, s.previewDelayMs, s.correct]).toEqual(['request', 600, 'both'])
})
