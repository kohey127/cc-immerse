// A stand-in for the model. Claude Code and the plugin both ask it over HTTP, so a scenario draws
// the same screen on every run and costs nothing.
//
// Three kinds of request arrive:
//   the turn itself (it carries tools)            -> the scenario's next `replies` entry
//   the plugin's small calls (a <text>…</text>)   -> the scenario's answer for that kind and text
//   Claude Code's own side calls                  -> a short fixed answer
// A small call the scenario gave no answer for is answered with a visible marker and kept in
// `unscripted`, so a screen never shows text that nobody wrote down.

import { asText, fixSystem, judgeSystem, pairOf, tableSystem, toTargetSystem, translateSystem } from '../plugin/hooks/lang'
import type { Pair } from '../plugin/hooks/lang'

/**
 * Which of the plugin's instructions a small call carries. `translate` and `table` put a reply in the
 * learned language into the native one; `translateBack` and `tableBack` put a reply in the native language
 * into the learned one.
 */
export type Kind = 'translate' | 'table' | 'translateBack' | 'tableBack' | 'toTarget' | 'fix' | 'judge'

/** What a scenario says the model answers. */
export type Script = {
  /** The replies of the turns, in order. */
  replies: string[]
  /** Answers to the plugin's small calls, by kind, then by the exact text handed over. */
  small?: Partial<Record<Kind, Record<string, string>>>
  /** The pair the instructions are written for; the plugin's defaults when left out. */
  pair?: Pair
  /** How long each small call takes, in milliseconds: long enough to see what is drawn while it waits. */
  smallDelayMs?: number
}

export type Model = {
  url: string
  /** Small calls that had no scripted answer, as `kind: text`. */
  unscripted: string[]
  /** Every small call made, in order. */
  calls: { kind: Kind; text: string }[]
  /** Everything each turn handed the model on the person's side, in order: their messages, and what Claude Code adds around them. */
  turns: string[]
  /** The messages of each turn's request as sent, for a scenario that checks their exact shape. */
  requests: unknown[][]
  stop(): void
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => (block && typeof block === 'object' && 'text' in block ? String(block.text) : '')).join('\n')
}

/** The text between the tags `asText` puts around what it hands over; null when the request is not a small call. */
function handedOver(prompt: string): string | null {
  const [open = '', close = ''] = asText('\u0000').split('\u0000')
  const from = prompt.indexOf(open)
  const to = prompt.lastIndexOf(close)
  return from < 0 || to < from ? null : prompt.slice(from + open.length, to)
}

function kindOf(system: string, pair: Pair): Kind | null {
  const back: Pair = { native: pair.target, target: pair.native }
  const kinds: [Kind, string][] = [
    ['translate', translateSystem(pair)],
    ['table', tableSystem(pair)],
    ['translateBack', translateSystem(back)],
    ['tableBack', tableSystem(back)],
    ['toTarget', toTargetSystem(pair)],
    ['fix', fixSystem(pair)],
    ['judge', judgeSystem(pair)],
  ]
  return kinds.find(([, text]) => system.includes(text))?.[0] ?? null
}

function answer(body: { model?: string; stream?: boolean }, text: string): Response {
  const message = { id: 'msg_screen', type: 'message', role: 'assistant', model: body.model ?? 'screen', stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } }
  if (!body.stream) return Response.json({ ...message, content: [{ type: 'text', text }], stop_reason: 'end_turn' })
  const events: [string, unknown][] = [
    ['message_start', { type: 'message_start', message: { ...message, content: [], stop_reason: null } }],
    ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
    ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } }],
    ['content_block_stop', { type: 'content_block_stop', index: 0 }],
    ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 1 } }],
    ['message_stop', { type: 'message_stop' }],
  ]
  return new Response(events.map(([name, data]) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'content-type': 'text/event-stream' } })
}

export function startModel(script: Script): Model {
  const pair = script.pair ?? pairOf('', '')
  const unscripted: string[] = []
  const calls: { kind: Kind; text: string }[] = []
  const turns: string[] = []
  const requests: unknown[][] = []
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(req) {
      if (!new URL(req.url).pathname.endsWith('/messages')) return Response.json({}, { status: 404 })
      const body = (await req.json().catch(() => ({}))) as { model?: string; stream?: boolean; system?: unknown; tools?: unknown[]; messages?: { role?: string; content: unknown }[] }
      const text = handedOver(textOf(body.messages?.at(-1)?.content))
      const kind = text === null ? null : kindOf(textOf(body.system), pair)
      if (kind !== null && text !== null) {
        const src = text.trim()
        calls.push({ kind, text: src })
        const scripted = script.small?.[kind]?.[src]
        if (scripted === undefined) unscripted.push(`${kind}: ${src}`)
        if (script.smallDelayMs) await Bun.sleep(script.smallDelayMs)
        return answer(body, scripted ?? `[unscripted ${kind}]`)
      }
      if ((body.tools?.length ?? 0) > 0) {
        const reply = script.replies[Math.min(turns.length, script.replies.length - 1)] ?? '[no reply scripted]'
        requests.push(body.messages ?? [])
        turns.push((body.messages ?? []).filter(message => message.role === 'user').map(message => textOf(message.content)).join('\n'))
        return answer(body, reply)
      }
      return answer(body, 'ok')
    },
  })
  return { url: `http://127.0.0.1:${server.port}`, unscripted, calls, turns, requests, stop: () => void server.stop(true) }
}
