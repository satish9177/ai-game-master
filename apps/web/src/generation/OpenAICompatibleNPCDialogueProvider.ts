import type { NPCDialogueRequest, NPCDialogueResponse } from '../domain/dialogue/contracts'
import type { NPCDialogueProvider } from '../domain/ports/NPCDialogueProvider'
import type {
  LlmTransport,
  LlmTransportInit,
  LlmTransportResponse,
  OpenAICompatibleConfig,
} from './OpenAICompatibleRoomGenerator'
import { buildDialoguePromptMessages } from './llmDialoguePrompt'

export type { LlmTransport, LlmTransportInit, LlmTransportResponse }

export type OpenAICompatibleNPCDialogueConfig = Pick<
  OpenAICompatibleConfig,
  'baseUrl' | 'apiKey' | 'model'
>

export const DIALOGUE_MAX_TOKENS = 200
export const DIALOGUE_TIMEOUT_MS = 10_000

export const DIALOGUE_LLM_REQUEST_FAILED = 'dialogue-llm-request-failed'
export const DIALOGUE_LLM_TIMEOUT = 'dialogue-llm-timeout'
export const DIALOGUE_LLM_EMPTY_RESPONSE = 'dialogue-llm-empty-response'

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

export class OpenAICompatibleNPCDialogueProvider implements NPCDialogueProvider {
  private readonly config: OpenAICompatibleNPCDialogueConfig
  private readonly transport: LlmTransport

  constructor(config: OpenAICompatibleNPCDialogueConfig, transport: LlmTransport = defaultTransport) {
    this.config = config
    this.transport = transport
  }

  async reply(request: NPCDialogueRequest): Promise<NPCDialogueResponse> {
    const body = JSON.stringify({
      model: this.config.model,
      messages: buildDialoguePromptMessages(request),
      max_tokens: DIALOGUE_MAX_TOKENS,
      stream: false,
    })

    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, DIALOGUE_TIMEOUT_MS)

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
      throw new Error(timedOut ? DIALOGUE_LLM_TIMEOUT : DIALOGUE_LLM_REQUEST_FAILED)
    } finally {
      clearTimeout(timer)
    }

    if (!response.ok) throw new Error(DIALOGUE_LLM_REQUEST_FAILED)

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new Error(DIALOGUE_LLM_REQUEST_FAILED)
    }

    const content = extractContent(payload)
    if (typeof content !== 'string' || content.trim().length === 0) {
      throw new Error(DIALOGUE_LLM_EMPTY_RESPONSE)
    }
    return { text: content.trim() }
  }
}
