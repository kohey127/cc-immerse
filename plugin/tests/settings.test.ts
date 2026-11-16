// The settings: what a level means, and the one switch beside it.
// A level says in which language the person and Claude talk and which language a reply is read in first.
// Written before hooks/settings.ts was changed to match.
import { expect, test } from 'claude-code/testing'

import { readSettings } from '../hooks/settings'

test('with nothing set: level 4, the learned language with Claude and on the screen, typing help on', async () => {
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

test('levels 1 and 2: with Claude in the native language; what is typed in it is sent as typed', async () => {
  const at = (level: string) => {
    const s = readSettings({ readingLevel: level })
    return [s.send, s.front, s.show]
  }
  expect(at('1')).toEqual(['preview', 'native', 'request'])
  expect(at('2')).toEqual(['preview', 'native', 'side'])
})

test('levels 3 and 4: with Claude in the learned language; what is typed in the native one is sent in it', async () => {
  const at = (level: string) => {
    const s = readSettings({ readingLevel: level })
    return [s.send, s.front, s.show]
  }
  expect(at('3')).toEqual(['target', 'target', 'side'])
  expect(at('4')).toEqual(['target', 'target', 'request'])
})

test('Off: replies are left as they are, and what is typed is sent as typed', async () => {
  const s = readSettings({ readingLevel: 'Off' })
  expect([s.show, s.send]).toEqual(['never', 'preview'])
})

test('typing help off: no line while typing and no correction; at levels 3 and 4 the message is still sent in the learned language', async () => {
  const at = (level: string) => {
    const s = readSettings({ readingLevel: level, typingHelp: false })
    return [s.hasPreview, s.correct, s.send]
  }
  expect(at('Off')).toEqual([false, 'off', 'off'])
  expect(at('1')).toEqual([false, 'off', 'off'])
  expect(at('2')).toEqual([false, 'off', 'off'])
  expect(at('3')).toEqual([false, 'off', 'target'])
  expect(at('4')).toEqual([false, 'off', 'target'])
})

test('a level that names nothing is level 4', async () => {
  const s = readSettings({ readingLevel: '9' })
  expect([s.front, s.show, s.send]).toEqual(['target', 'request', 'target'])
})

test('options that no longer exist change nothing', async () => {
  expect(readSettings({ mark: '🌐', layout: 'Below', nativeInput: 'Leave it alone', corrections: 'Off', translationStyle: 'Faint', allButtons: false, livePreview: false, previewDelay: '2 s', writing: false })).toEqual(readSettings({}))
})
