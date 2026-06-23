import type { RoomGenerator } from '../domain/ports/RoomGenerator'
import { buildRoomPromptMessages } from './llmRoomPrompt'

/**
 * The first real, network-backed `RoomGenerator`
 * (real-room-generator-provider v0; ADR-0023). One generic, provider-agnostic
 * adapter for any OpenAI-compatible chat-completions endpoint (OpenAI, DeepSeek);
 * providers differ only by base URL + key + model, all injected.
 *
 * It makes ONE non-streaming `POST` to `${baseUrl}/chat/completions`, with a
 * hard client timeout and NO retry, and returns `choices[0].message.content`
 * VERBATIM as `Promise<string>`. It does NOT parse, validate, repair, or
 * fence-strip the output: the string stays raw and untrusted, exactly like the
 * fake generator's output. The unchanged `GeneratedRoomSource → assembleRoom →
 * repairRoom/fallbackRoom` pipeline is the only trust boundary, and it is
 * sufficient (ADR-0001, ADR-0007).
 *
 * SAFETY / LOG-SAFETY (ADR-0023):
 * - It imports no logger and logs nothing (BOUNDARIES.md generation rule).
 * - On any failure it throws a FIXED-SHAPE `Error` whose message is one of three
 *   safe codes only — it never contains the API key, request body, response
 *   body, prompt/seed text, or any raw provider error. So `GeneratedRoomSource`'s
 *   existing `error.message`-only log line stays safe with no change there.
 *
 * The constructor takes an injected transport seam (defaulting to a `fetch` +
 * `AbortController` implementation) so tests touch no network.
 */

/** Typed config the composition root assembles from env + the base-URL map. */
export type OpenAICompatibleConfig = {
  baseUrl: string
  apiKey: string
  model: string
  maxTokens: number
  timeoutMs: number
}

/** Minimal request init the transport receives — a bounded subset of `fetch`. */
export type LlmTransportInit = {
  method: string
  headers: Record<string, string>
  body: string
  signal: AbortSignal
}

/** Minimal response the transport returns — a bounded subset of `Response`. */
export type LlmTransportResponse = {
  ok: boolean
  status: number
  json(): Promise<unknown>
}

/** The injected transport seam: a `fetch`-shaped function over the wire. */
export type LlmTransport = (
  url: string,
  init: LlmTransportInit,
) => Promise<LlmTransportResponse>

// The only error messages this generator ever throws. Fixed codes, never any
// secret or model-derived content (ADR-0023 §11/§12).
export const LLM_REQUEST_FAILED = 'llm-request-failed'
export const LLM_TIMEOUT = 'llm-timeout'
export const LLM_EMPTY_RESPONSE = 'llm-empty-response'

/** Default transport: real `fetch`, with the caller-owned abort signal. */
const defaultTransport: LlmTransport = async (url, init) => {
  const response = await fetch(url, {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: init.signal,
  })
  return {
    ok: response.ok,
    status: response.status,
    json: () => response.json(),
  }
}

/** Read `choices[0].message.content` defensively; returns undefined if absent. */
function extractContent(payload: unknown): unknown {
  if (typeof payload !== 'object' || payload === null) return undefined
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const first: unknown = choices[0]
  if (typeof first !== 'object' || first === null) return undefined
  const message = (first as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return undefined
  return (message as { content?: unknown }).content
}

export class OpenAICompatibleRoomGenerator implements RoomGenerator {
  private readonly config: OpenAICompatibleConfig
  private readonly transport: LlmTransport

  constructor(config: OpenAICompatibleConfig, transport: LlmTransport = defaultTransport) {
    this.config = config
    this.transport = transport
  }

  async generate(prompt: string): Promise<string> {
    const body = JSON.stringify({
      model: this.config.model,
      messages: buildRoomPromptMessages(prompt),
      max_tokens: this.config.maxTokens,
      stream: false,
    })

    // One attempt, hard timeout via AbortController, no retry. `timedOut`
    // disambiguates a timeout abort from any other transport rejection.
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, this.config.timeoutMs)

    let response: LlmTransportResponse
    try {
      response = await this.transport(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body,
        signal: controller.signal,
      })
    } catch {
      // Sanitized: never surface the raw transport/network error.
      throw new Error(timedOut ? LLM_TIMEOUT : LLM_REQUEST_FAILED)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) throw new Error(LLM_REQUEST_FAILED)

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error(LLM_REQUEST_FAILED)
    }

    const content = extractContent(payload)
    if (typeof content !== 'string' || content.length === 0) {
      throw new Error(LLM_EMPTY_RESPONSE)
    }
    // Verbatim raw text — untrusted until assembleRoom. No parse/validate here.
    return content
  }
}
