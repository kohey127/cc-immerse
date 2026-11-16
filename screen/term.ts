// A real Claude Code in a scripted terminal, with the plugin loaded from `plugin/` and the model
// replaced by `model.ts`. A scenario types, moves the pointer, clicks, and reads the screen: its
// text, the colour and style of each cell, a picture of it, and a recording.
//
// The terminal is @microsoft/tui-test. Each session has a configuration folder and a working folder
// of its own, so nothing of the machine it runs on (other plugins, hooks, a status line, a project's
// CLAUDE.md) is on the screen.

import { TuiTest } from '@microsoft/tui-test'
import type { Cell } from '@microsoft/tui-test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { startModel } from './model'
import type { Model, Script } from './model'

const ROOT = resolve(import.meta.dir, '..')
/** Where pictures and recordings go. Not in git. */
export const OUT = join(ROOT, 'screen', 'out')
// Not a key: the stand-in model takes anything. Claude Code only needs one to be set.
const KEY = 'not-a-key-screen-check'

export type Options = {
  script: Script
  /** The window, in columns and rows. */
  cols?: number
  rows?: number
  /** The plugin's options, as `/config` stores them. */
  options?: Record<string, string | boolean>
  /** A name to record the session under, as `out/<name>.gif`; no recording when left out. */
  record?: string
}

export type Session = {
  model: Model
  cols: number
  /** The screen, one string per row, without colours. */
  screen(): Promise<string[]>
  /** The 0-based row of the first line holding `text`, searching from row `from`; -1 when none does. */
  rowOf(text: string, from?: number): Promise<number>
  /** The cells of a row that hold something, each with its colour and style. */
  cells(row: number): Promise<Cell[]>
  /** Waits until the screen holds `text` (or a row matches it); throws with the screen when it never does. */
  waitFor(text: string | RegExp, ms?: number): Promise<void>
  /** Waits until the screen no longer holds `text`. */
  waitGone(text: string | RegExp, ms?: number): Promise<void>
  type(text: string): Promise<void>
  press(...keys: string[]): Promise<void>
  /** Types a message, waits for the line above the prompt box (`preview`, when given), sends it, and waits for the turn to end. */
  ask(text: string, preview?: string | RegExp): Promise<void>
  /** Moves the pointer to a 0-based row and column, with no button held. */
  move(row: number, col: number): Promise<void>
  /** Presses and releases the left button at a 0-based row and column. */
  click(row: number, col: number): Promise<void>
  /** Turns the wheel down (or up, for a negative count) with the pointer at a 0-based row and column. */
  wheel(row: number, col: number, lines: number): Promise<void>
  /** Saves a picture of the screen as `out/<name>.png` and returns its path. */
  shot(name: string): Promise<string>
  close(): Promise<void>
}

function has(screen: string[], text: string | RegExp): boolean {
  return screen.some(line => (typeof text === 'string' ? line.includes(text) : text.test(line)))
}

/** The environment a session starts in: this one's, without what would tie it to the session running the checks. */
function environment(extra: Record<string, string>): Record<string, string> {
  // The terminal adds these to its own environment, so a name is taken out by emptying it.
  const env: Record<string, string> = {}
  for (const name of Object.keys(process.env)) {
    if (/^(CLAUDE|ANTHROPIC)/.test(name)) env[name] = ''
  }
  return { ...env, ...extra }
}

export async function open(opts: Options): Promise<Session> {
  const cols = opts.cols ?? 100
  const rows = opts.rows ?? 36
  const model = startModel(opts.script)
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'immerse-screen-')))
  const config = join(base, 'config')
  const work = join(base, 'work')
  mkdirSync(config)
  mkdirSync(work)
  mkdirSync(OUT, { recursive: true })
  // A first run already finished: no theme picker, no login, no question about the key or the folder.
  writeFileSync(
    join(config, '.claude.json'),
    JSON.stringify({ hasCompletedOnboarding: true, theme: 'dark', customApiKeyResponses: { approved: [KEY.slice(-20)], rejected: [] }, projects: { [work]: { hasTrustDialogAccepted: true } } }),
  )
  writeFileSync(join(config, 'settings.json'), JSON.stringify({ pluginConfigs: { 'cc-immerse@inline': { options: opts.options ?? {} } } }))

  const t = TuiTest.ephemeral('immerse')
  const screen = async (): Promise<string[]> => (await t.text()).split('\n')
  const until = async (isThere: (screen: string[]) => boolean, what: string, ms: number): Promise<void> => {
    const end = Date.now() + ms
    let last: string[] = []
    while (Date.now() < end) {
      last = await screen()
      if (isThere(last)) return
      await Bun.sleep(80)
    }
    throw new Error(`${what} after ${ms} ms. The screen:\n${last.map(line => `  | ${line}`).join('\n')}`)
  }
  // A person acts on a screen that has stopped changing, and a click sent in the first moments after
  // a redraw is not taken.
  const settle = (): Promise<void> => t.waitIdle({ timeout: 10000 }).catch(() => undefined)

  const session: Session = {
    model,
    cols,
    screen,
    rowOf: async (text, from = 0) => (await screen()).findIndex((line, i) => i >= from && line.includes(text)),
    cells: async row => (await t.cells(0, row, cols, 1)).filter(cell => cell.char.trim() !== ''),
    waitFor: (text, ms = 15000) => until(s => has(s, text), `never drawn: ${String(text)}`, ms),
    waitGone: (text, ms = 15000) => until(s => !has(s, text), `still drawn: ${String(text)}`, ms),
    type: text => t.type(text),
    press: (...keys) => t.press(...keys),
    async ask(text, preview) {
      await t.type(text)
      if (preview === undefined) await Bun.sleep(1200)
      else await session.waitFor(preview)
      await t.press('Enter')
      // The line Claude Code draws under a finished turn; the reply above it may still be settling.
      await session.waitFor(/^✻ .+ for \d+/)
      await settle()
    },
    async move(row, col) {
      if (row < 0 || col < 0) throw new Error(`the pointer was sent to row ${row}, column ${col}: what it was aimed at is not on the screen.\n${(await screen()).map(line => `  | ${line}`).join('\n')}`)
      await settle()
      await t.mouse.move(col, row)
      await Bun.sleep(150)
    },
    async click(row, col) {
      await session.move(row, col)
      await Bun.sleep(100)
      await t.mouse.click(col, row)
      await Bun.sleep(150)
    },
    async wheel(row, col, lines) {
      await session.move(row, col)
      await t.mouse.scroll(lines < 0 ? 'up' : 'down', { amount: Math.abs(lines) })
      await Bun.sleep(200)
    },
    async shot(name) {
      await settle()
      const path = join(OUT, `${name}.png`)
      await t.screenshot(path)
      return path
    },
    async close() {
      if (opts.record) await t.stopRecording().catch(() => undefined)
      await t.closeQuiet()
      model.stop()
      rmSync(base, { recursive: true, force: true })
    },
  }

  // IMMERSE_PLUGIN names another copy of the plugin: one broken on purpose, to see a check fail.
  await t.run('claude', ['--plugin-dir', process.env.IMMERSE_PLUGIN ?? join(ROOT, 'plugin')], {
    cols,
    rows,
    cwd: work,
    env: environment({ CLAUDE_CONFIG_DIR: config, ANTHROPIC_API_KEY: KEY, ANTHROPIC_BASE_URL: model.url, DISABLE_AUTOUPDATER: '1', CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1' }),
  })
  // The prompt box is drawn before the plugin has loaded, and what is typed in between is not the
  // plugin's to see. Its command is typed until Claude Code offers it by its description, then taken out:
  // that shows the plugin loaded whatever its options are.
  await session.waitFor(/^❯/, 30000)
  // A row under the prompt box naming the command: cut short in a narrow window, so matched by its start.
  const OFFERED = /^(?!❯).*\/immerse\s+\S/
  for (let tries = 1; ; tries++) {
    await t.type('/immerse')
    const isLoaded = await session.waitFor(OFFERED, 2500).then(
      () => true,
      () => false,
    )
    await t.press('Ctrl+U')
    await session.waitGone(OFFERED)
    if (isLoaded) break
    if (tries === 8) throw new Error(`Claude Code never offered the plugin's command. The screen:\n${(await screen()).join('\n')}`)
  }
  if (opts.record) await t.startRecording(join(OUT, `${opts.record}.gif`))
  return session
}
