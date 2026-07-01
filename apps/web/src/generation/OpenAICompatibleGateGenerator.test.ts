import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadRoomSpec, type LoadedRoom } from '../domain/loadRoomSpec'
import {
  GATE_LLM_EMPTY_RESPONSE,
  GATE_LLM_REQUEST_FAILED,
  GATE_LLM_TIMEOUT,
  GATE_MAX_TOKENS,
  GATE_TIMEOUT_MS,
  OpenAICompatibleGateGenerator,
  type LlmTransport,
  type LlmTransportInit,
  type LlmTransportResponse,
  type OpenAICompatibleGateConfig,
} from './OpenAICompatibleGateGenerator'
import { buildGatePromptMessages } from './llmGatePrompt'

const config: OpenAICompatibleGateConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-gate-secret-key-1234567890',
  model: 'gate-model',
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
      {
        type: 'arch',
        id: 'secret-exit-object-id',
        position: [0, 0, -8],
        interaction: {
          key: 'E',
          prompt: 'Secret exit prompt',
          exit: { toRoomId: 'secret-exit-room-id' },
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
    return okResponse({ choices: [{ message: { content } }] })
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

describe('OpenAICompatibleGateGenerator request shape', () => {
  it('sends one OpenAI-compatible non-streaming request using structural prompt messages', async () => {
    const room = makeRoom()
    const { transport, calls } = recordingTransport('{"unlockObjectId":"secret-object-id"}')

    await new OpenAICompatibleGateGenerator(config, transport).generate(room)

    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]!
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sk-gate-secret-key-1234567890')
    expect(init.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body).toEqual({
      model: 'gate-model',
      messages: buildGatePromptMessages(room),
      max_tokens: GATE_MAX_TOKENS,
      stream: false,
    })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })

  it('returns choices[0].message.content verbatim', async () => {
    const raw = '```json\n{"unlockObjectId":"do-not-strip-fences"}\n```'
    const { transport } = recordingTransport(raw)

    await expect(
      new OpenAICompatibleGateGenerator(config, transport).generate(makeRoom()),
    ).resolves.toBe(raw)
  })

  it('returns null when model content is present but empty', async () => {
    const transport: LlmTransport = async () =>
      okResponse({ choices: [{ message: { content: '' } }] })

    await expect(
      new OpenAICompatibleGateGenerator(config, transport).generate(makeRoom()),
    ).resolves.toBeNull()
  })
})

describe('OpenAICompatibleGateGenerator failures', () => {
  it('throws gate-llm-timeout when the hard timeout aborts the request', async () => {
    vi.useFakeTimers()
    const transport: LlmTransport = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      })

    const promise = new OpenAICompatibleGateGenerator(config, transport).generate(makeRoom())
    const assertion = expect(promise).rejects.toThrow(GATE_LLM_TIMEOUT)
    await vi.advanceTimersByTimeAsync(GATE_TIMEOUT_MS)

    await assertion
  })

  it('throws gate-llm-request-failed on network or transport failure and does not retry', async () => {
    let callCount = 0
    const transport: LlmTransport = async () => {
      callCount += 1
      throw new Error('ECONNREFUSED with sensitive details')
    }

    await expect(
      new OpenAICompatibleGateGenerator(config, transport).generate(makeRoom()),
    ).rejects.toThrow(GATE_LLM_REQUEST_FAILED)
    expect(callCount).toBe(1)
  })

  it('throws gate-llm-request-failed on a non-2xx response or malformed response body', async () => {
    const failedTransport: LlmTransport = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'raw provider response body' }),
    })
    const malformedTransport: LlmTransport = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('raw response was not JSON')
      },
    })

    await expect(
      new OpenAICompatibleGateGenerator(config, failedTransport).generate(makeRoom()),
    ).rejects.toThrow(GATE_LLM_REQUEST_FAILED)
    await expect(
      new OpenAICompatibleGateGenerator(config, malformedTransport).generate(makeRoom()),
    ).rejects.toThrow(GATE_LLM_REQUEST_FAILED)
  })

  it('throws gate-llm-empty-response when content is absent or non-string', async () => {
    const missingTransport: LlmTransport = async () => okResponse({ choices: [{ message: {} }] })
    const nonStringTransport: LlmTransport = async () =>
      okResponse({ choices: [{ message: { content: { raw: 'model-output' } } }] })

    await expect(
      new OpenAICompatibleGateGenerator(config, missingTransport).generate(makeRoom()),
    ).rejects.toThrow(GATE_LLM_EMPTY_RESPONSE)
    await expect(
      new OpenAICompatibleGateGenerator(config, nonStringTransport).generate(makeRoom()),
    ).rejects.toThrow(GATE_LLM_EMPTY_RESPONSE)
  })
})

describe('OpenAICompatibleGateGenerator error message safety', () => {
  it('thrown messages leak no key, prompt, response body, room id, object id, or model output', async () => {
    const room = makeRoom()
    const requestBody = JSON.stringify(buildGatePromptMessages(room))
    const rawResponse = 'raw provider response body with generated content'
    const modelOutput = '{"unlockObjectId":"secret-object-id","exitToRoomId":"secret-exit-room-id"}'
    const transport: LlmTransport = async () => {
      throw new Error(
        `boom ${config.apiKey} ${room.id} secret-object-id ${requestBody} ${rawResponse} ${modelOutput}`,
      )
    }

    const message = await captureMessage(
      new OpenAICompatibleGateGenerator(config, transport).generate(room),
    )

    expect([
      GATE_LLM_REQUEST_FAILED,
      GATE_LLM_TIMEOUT,
      GATE_LLM_EMPTY_RESPONSE,
    ]).toContain(message)
    expect(message).not.toContain(config.apiKey)
    expect(message).not.toContain(room.id)
    expect(message).not.toContain('secret-object-id')
    expect(message).not.toContain(requestBody)
    expect(message).not.toContain(rawResponse)
    expect(message).not.toContain(modelOutput)
    expect(message).not.toContain('boom')
  })
})
