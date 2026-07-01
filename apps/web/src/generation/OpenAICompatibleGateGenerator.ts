import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { GateGenerator } from '../domain/ports/GateGenerator'
import type {
  LlmTransport,
  LlmTransportInit,
  LlmTransportResponse,
  OpenAICompatibleConfig,
} from './OpenAICompatibleRoomGenerator'
import { buildGatePromptMessages } from './llmGatePrompt'

export type { LlmTransport, LlmTransportInit, LlmTransportResponse }

export type OpenAICompatibleGateConfig = Pick<
  OpenAICompatibleConfig,
  'baseUrl' | 'apiKey' | 'model'
>

export const GATE_MAX_TOKENS = 200
export const GATE_TIMEOUT_MS = 10_000

export const GATE_LLM_REQUEST_FAILED = 'gate-llm-request-failed'
export const GATE_LLM_TIMEOUT = 'gate-llm-timeout'
export const GATE_LLM_EMPTY_RESPONSE = 'gate-llm-empty-response'

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

export class OpenAICompatibleGateGenerator implements GateGenerator {
  private readonly config: OpenAICompatibleGateConfig
  private readonly transport: LlmTransport

  constructor(config: OpenAICompatibleGateConfig, transport: LlmTransport = defaultTransport) {
    this.config = config
    this.transport = transport
  }

  async generate(room: LoadedRoom): Promise<string | null> {
    const body = JSON.stringify({
      model: this.config.model,
      messages: buildGatePromptMessages(room),
      max_tokens: GATE_MAX_TOKENS,
      stream: false,
    })

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, GATE_TIMEOUT_MS)

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
      throw new Error(timedOut ? GATE_LLM_TIMEOUT : GATE_LLM_REQUEST_FAILED)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) throw new Error(GATE_LLM_REQUEST_FAILED)

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error(GATE_LLM_REQUEST_FAILED)
    }

    const content = extractContent(payload)
    if (content === '') return null
    if (typeof content !== 'string') throw new Error(GATE_LLM_EMPTY_RESPONSE)
    return content
  }
}
