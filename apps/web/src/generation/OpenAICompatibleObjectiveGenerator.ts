import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { ObjectiveGenerator } from '../domain/ports/ObjectiveGenerator'
import type {
  LlmTransport,
  LlmTransportInit,
  LlmTransportResponse,
  OpenAICompatibleConfig,
} from './OpenAICompatibleRoomGenerator'
import { buildObjectivePromptMessages } from './llmObjectivePrompt'

export type { LlmTransport, LlmTransportInit, LlmTransportResponse }

export type OpenAICompatibleObjectiveConfig = Pick<
  OpenAICompatibleConfig,
  'baseUrl' | 'apiKey' | 'model'
>

export const OBJECTIVE_MAX_TOKENS = 400
export const OBJECTIVE_TIMEOUT_MS = 12_000

export const OBJECTIVE_LLM_REQUEST_FAILED = 'objective-llm-request-failed'
export const OBJECTIVE_LLM_TIMEOUT = 'objective-llm-timeout'
export const OBJECTIVE_LLM_EMPTY_RESPONSE = 'objective-llm-empty-response'

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

export class OpenAICompatibleObjectiveGenerator implements ObjectiveGenerator {
  private readonly config: OpenAICompatibleObjectiveConfig
  private readonly transport: LlmTransport

  constructor(
    config: OpenAICompatibleObjectiveConfig,
    transport: LlmTransport = defaultTransport,
  ) {
    this.config = config
    this.transport = transport
  }

  async generate(room: LoadedRoom): Promise<string | null> {
    const body = JSON.stringify({
      model: this.config.model,
      messages: buildObjectivePromptMessages(room),
      max_tokens: OBJECTIVE_MAX_TOKENS,
      stream: false,
    })

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, OBJECTIVE_TIMEOUT_MS)

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
      throw new Error(timedOut ? OBJECTIVE_LLM_TIMEOUT : OBJECTIVE_LLM_REQUEST_FAILED)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) throw new Error(OBJECTIVE_LLM_REQUEST_FAILED)

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error(OBJECTIVE_LLM_REQUEST_FAILED)
    }

    const content = extractContent(payload)
    if (content === '') return null
    if (typeof content !== 'string') throw new Error(OBJECTIVE_LLM_EMPTY_RESPONSE)
    return content
  }
}
