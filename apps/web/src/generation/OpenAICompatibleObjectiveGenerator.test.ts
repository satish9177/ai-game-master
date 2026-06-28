import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import {
  OBJECTIVE_LLM_EMPTY_RESPONSE,
  OBJECTIVE_LLM_REQUEST_FAILED,
  OBJECTIVE_LLM_TIMEOUT,
  OBJECTIVE_MAX_TOKENS,
  OBJECTIVE_TIMEOUT_MS,
  OpenAICompatibleObjectiveGenerator,
  type LlmTransport,
  type LlmTransportInit,
  type LlmTransportResponse,
  type OpenAICompatibleObjectiveConfig,
} from './OpenAICompatibleObjectiveGenerator'
import { buildObjectivePromptMessages } from './llmObjectivePrompt'

const config: OpenAICompatibleObjectiveConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-objective-secret-key-1234567890',
  model: 'objective-model',
}

function makeRoom(): LoadedRoom {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'secret-room-id',
    name: 'Secret Room Name',
    shell: {
      dimensions: { width: 18, depth: 18, height: 4 },
      exits: [{ side: 'north', width: 3 }],
    },
    spawn: { position: [0, 1.7, 5] },
    objects: [
      {
        type: 'book',
        id: 'secret-object-id',
        name: 'Secret Object Name',
        position: [0, 0.3, -2],
        interaction: {
          key: 'E',
          prompt: 'Secret prompt body',
          title: 'Secret title',
          body: 'Secret generated body',
          effect: { kind: 'inspect' },
        },
      },
    ],
  })
}

function recordingTransport(content: string): {
  transport: LlmTransport
  calls: { url: string; init: LlmTransportInit }[]
} {
  const calls: { url: string; init: LlmTransportInit }[] = []
  const transport: LlmTransport = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content } }] }),
    }
  }
  return { transport, calls }
}

function okResponse(payload: unknown): LlmTransportResponse {
  return { ok: true, status: 200, json: async () => payload }
}

async function captureMessage(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
    return ''
  } catch (err) {
    return (err as Error).message
  }
}

afterEach(() => {
  vi.useRealTimers()
})

describe('OpenAICompatibleObjectiveGenerator request shape', () => {
  it('sends the expected OpenAI-compatible payload using structural prompt messages', async () => {
    const room = makeRoom()
    const { transport, calls } = recordingTransport('{"title":"Raw"}')

    await new OpenAICompatibleObjectiveGenerator(config, transport).generate(room)

    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]!
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sk-objective-secret-key-1234567890')
    expect(init.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body).toEqual({
      model: 'objective-model',
      messages: buildObjectivePromptMessages(room),
      max_tokens: OBJECTIVE_MAX_TOKENS,
      stream: false,
    })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })

  it('returns choices[0].message.content verbatim', async () => {
    const raw = '```json\n{"title":"Do not strip fences"}\n```'
    const { transport } = recordingTransport(raw)

    await expect(
      new OpenAICompatibleObjectiveGenerator(config, transport).generate(makeRoom()),
    ).resolves.toBe(raw)
  })

  it('returns null when content is present but empty', async () => {
    const transport: LlmTransport = async () =>
      okResponse({ choices: [{ message: { content: '' } }] })

    await expect(
      new OpenAICompatibleObjectiveGenerator(config, transport).generate(makeRoom()),
    ).resolves.toBeNull()
  })
})

describe('OpenAICompatibleObjectiveGenerator failures', () => {
  it('throws objective-llm-request-failed on network failure', async () => {
    const transport: LlmTransport = async () => {
      throw new Error('ECONNREFUSED with sensitive details')
    }

    await expect(
      new OpenAICompatibleObjectiveGenerator(config, transport).generate(makeRoom()),
    ).rejects.toThrow(OBJECTIVE_LLM_REQUEST_FAILED)
  })

  it('throws objective-llm-timeout when the hard timeout aborts the request', async () => {
    vi.useFakeTimers()
    const transport: LlmTransport = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      })

    const promise = new OpenAICompatibleObjectiveGenerator(config, transport).generate(makeRoom())
    const assertion = expect(promise).rejects.toThrow(OBJECTIVE_LLM_TIMEOUT)
    await vi.advanceTimersByTimeAsync(OBJECTIVE_TIMEOUT_MS)

    await assertion
  })

  it('throws objective-llm-request-failed on a non-2xx response', async () => {
    const transport: LlmTransport = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'raw provider response body' }),
    })

    await expect(
      new OpenAICompatibleObjectiveGenerator(config, transport).generate(makeRoom()),
    ).rejects.toThrow(OBJECTIVE_LLM_REQUEST_FAILED)
  })

  it('throws objective-llm-request-failed on malformed or non-JSON response', async () => {
    const transport: LlmTransport = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('raw response was not JSON')
      },
    })

    await expect(
      new OpenAICompatibleObjectiveGenerator(config, transport).generate(makeRoom()),
    ).rejects.toThrow(OBJECTIVE_LLM_REQUEST_FAILED)
  })

  it('throws objective-llm-empty-response when content is absent', async () => {
    const transport: LlmTransport = async () => okResponse({ choices: [{ message: {} }] })

    await expect(
      new OpenAICompatibleObjectiveGenerator(config, transport).generate(makeRoom()),
    ).rejects.toThrow(OBJECTIVE_LLM_EMPTY_RESPONSE)
  })
})

describe('OpenAICompatibleObjectiveGenerator error message safety', () => {
  it('thrown messages leak no key, room/object id, prompt body, or raw response content', async () => {
    const room = makeRoom()
    const requestBody = JSON.stringify(buildObjectivePromptMessages(room))
    const rawResponse = 'raw provider response body with generated content'
    const transport: LlmTransport = async () => {
      throw new Error(
        `boom ${config.apiKey} ${room.id} secret-object-id Secret prompt body ${requestBody} ${rawResponse}`,
      )
    }

    const message = await captureMessage(
      new OpenAICompatibleObjectiveGenerator(config, transport).generate(room),
    )

    expect([
      OBJECTIVE_LLM_REQUEST_FAILED,
      OBJECTIVE_LLM_TIMEOUT,
      OBJECTIVE_LLM_EMPTY_RESPONSE,
    ]).toContain(message)
    expect(message).not.toContain(config.apiKey)
    expect(message).not.toContain(room.id)
    expect(message).not.toContain('secret-object-id')
    expect(message).not.toContain('Secret prompt body')
    expect(message).not.toContain(requestBody)
    expect(message).not.toContain(rawResponse)
    expect(message).not.toContain('boom')
  })
})
