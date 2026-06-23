import { describe, it, expect } from 'vitest'
import {
  OpenAICompatibleRoomGenerator,
  LLM_REQUEST_FAILED,
  LLM_TIMEOUT,
  LLM_EMPTY_RESPONSE,
  type OpenAICompatibleConfig,
  type LlmTransport,
  type LlmTransportInit,
  type LlmTransportResponse,
} from './OpenAICompatibleRoomGenerator'

const config: OpenAICompatibleConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-secret-key-1234567890',
  model: 'test-model',
  maxTokens: 1500,
  timeoutMs: 50,
}

/** A transport that records its call and returns a canned completion. */
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

describe('OpenAICompatibleRoomGenerator request shape', () => {
  it('POSTs to {baseUrl}/chat/completions with a Bearer auth header', async () => {
    const { transport, calls } = recordingTransport('{}')
    await new OpenAICompatibleRoomGenerator(config, transport).generate('a seed')

    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]!
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sk-secret-key-1234567890')
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('sends model, messages, max_tokens and stream:false — and not temperature/top_p', async () => {
    const { transport, calls } = recordingTransport('{}')
    await new OpenAICompatibleRoomGenerator(config, transport).generate('a seed')

    const body = JSON.parse(calls[0]!.init.body) as Record<string, unknown>
    expect(body.model).toBe('test-model')
    expect(body.max_tokens).toBe(1500)
    expect(body.stream).toBe(false)
    expect(Array.isArray(body.messages)).toBe(true)
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')

    const messages = body.messages as { role: string; content: string }[]
    expect(messages[0]!.role).toBe('system')
    expect(messages[1]!.role).toBe('user')
    expect(messages[1]!.content).toBe('a seed')
  })

  it('returns choices[0].message.content verbatim', async () => {
    const raw = '{"schemaVersion":1,"id":"r"}'
    const { transport } = recordingTransport(raw)
    const out = await new OpenAICompatibleRoomGenerator(config, transport).generate('seed')
    expect(out).toBe(raw)
  })
})

describe('OpenAICompatibleRoomGenerator failures (fixed-code, sanitized)', () => {
  it('rejects with llm-request-failed on a non-2xx response', async () => {
    const transport: LlmTransport = async () => ({ ok: false, status: 500, json: async () => ({}) })
    await expect(
      new OpenAICompatibleRoomGenerator(config, transport).generate('seed'),
    ).rejects.toThrow(LLM_REQUEST_FAILED)
  })

  it('rejects with llm-request-failed when the transport throws (network error)', async () => {
    const transport: LlmTransport = async () => {
      throw new Error('ECONNREFUSED 10.0.0.1 — connection details here')
    }
    await expect(
      new OpenAICompatibleRoomGenerator(config, transport).generate('seed'),
    ).rejects.toThrow(LLM_REQUEST_FAILED)
  })

  it('rejects with llm-timeout when the request is aborted by the hard timeout', async () => {
    // Transport hangs until the caller's AbortController fires.
    const transport: LlmTransport = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new DOMException('Aborted', 'AbortError')),
        )
      })
    await expect(
      new OpenAICompatibleRoomGenerator({ ...config, timeoutMs: 10 }, transport).generate('seed'),
    ).rejects.toThrow(LLM_TIMEOUT)
  })

  it('rejects with llm-empty-response when content is empty', async () => {
    const transport: LlmTransport = async () => okResponse({ choices: [{ message: { content: '' } }] })
    await expect(
      new OpenAICompatibleRoomGenerator(config, transport).generate('seed'),
    ).rejects.toThrow(LLM_EMPTY_RESPONSE)
  })

  it('rejects with llm-empty-response when choices are missing', async () => {
    const transport: LlmTransport = async () => okResponse({})
    await expect(
      new OpenAICompatibleRoomGenerator(config, transport).generate('seed'),
    ).rejects.toThrow(LLM_EMPTY_RESPONSE)
  })

  it('rejects with llm-request-failed when the body is not JSON', async () => {
    const transport: LlmTransport = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('Unexpected token < in JSON')
      },
    })
    await expect(
      new OpenAICompatibleRoomGenerator(config, transport).generate('seed'),
    ).rejects.toThrow(LLM_REQUEST_FAILED)
  })
})

describe('OpenAICompatibleRoomGenerator error message safety', () => {
  it('never leaks the key, seed, or raw provider error in the thrown message', async () => {
    const seed = 'super-secret-seed-content'
    const transport: LlmTransport = async () => {
      throw new Error(`boom with key ${config.apiKey} and seed ${seed}`)
    }
    let message = ''
    try {
      await new OpenAICompatibleRoomGenerator(config, transport).generate(seed)
    } catch (err) {
      message = (err as Error).message
    }
    expect([LLM_REQUEST_FAILED, LLM_TIMEOUT, LLM_EMPTY_RESPONSE]).toContain(message)
    expect(message).not.toContain(config.apiKey)
    expect(message).not.toContain(seed)
    expect(message).not.toContain('boom')
  })
})
