import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NPCDialogueRequest } from '../domain/dialogue/contracts'
import {
  DIALOGUE_LLM_EMPTY_RESPONSE,
  DIALOGUE_LLM_REQUEST_FAILED,
  DIALOGUE_LLM_TIMEOUT,
  DIALOGUE_MAX_TOKENS,
  DIALOGUE_TIMEOUT_MS,
  OpenAICompatibleNPCDialogueProvider,
  type LlmTransport,
  type LlmTransportInit,
  type LlmTransportResponse,
  type OpenAICompatibleNPCDialogueConfig,
} from './OpenAICompatibleNPCDialogueProvider'
import { buildDialoguePromptMessages } from './llmDialoguePrompt'

const config: OpenAICompatibleNPCDialogueConfig = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'sk-dialogue-secret-key-1234567890',
  model: 'dialogue-model',
}

function request(overrides: Partial<NPCDialogueRequest> = {}): NPCDialogueRequest {
  return {
    context: {
      roomId: 'secret-room-id',
      npcId: 'secret-npc-id',
      npcName: 'Asha',
      persona: 'watchful aide',
      room: {
        focus: { type: 'altar', direction: 'north' },
        features: [{ type: 'altar', direction: 'north' }],
        affordances: ['inspect', 'talk'],
        npcCount: 1,
      },
      quest: {
        activeObjectiveId: 'secret-objective-id',
        status: 'active',
        hint: 'Secret safe quest hint.',
        objective: { status: 'active', kind: 'inspect' },
      },
      memory: {
        entries: [{ text: 'SECRET MEMORY TEXT', kind: 'player_claim' }],
      },
      player: {
        health: { current: 8, max: 10 },
        status: ['wounded'],
        inventoryItemIds: ['secret-object-id'],
      },
      history: [{ speaker: 'player', text: 'Secret prior player line.' }],
    },
    playerLine: 'SECRET PLAYER LINE',
    ...overrides,
  }
}

function okResponse(payload: unknown): LlmTransportResponse {
  return { ok: true, status: 200, json: async () => payload }
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

describe('OpenAICompatibleNPCDialogueProvider request shape', () => {
  it('sends one OpenAI-compatible non-streaming request using dialogue prompt messages', async () => {
    const input = request()
    const { transport, calls } = recordingTransport('Stay close to the light.')

    await new OpenAICompatibleNPCDialogueProvider(config, transport).reply(input)

    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]!
    expect(url).toBe('https://api.example.com/v1/chat/completions')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer sk-dialogue-secret-key-1234567890')
    expect(init.headers['Content-Type']).toBe('application/json')

    const body = JSON.parse(init.body) as Record<string, unknown>
    expect(body).toEqual({
      model: 'dialogue-model',
      messages: buildDialoguePromptMessages(input),
      max_tokens: DIALOGUE_MAX_TOKENS,
      stream: false,
    })
    expect(body).not.toHaveProperty('temperature')
    expect(body).not.toHaveProperty('top_p')
  })

  it('returns trimmed choices[0].message.content as dialogue text', async () => {
    const { transport } = recordingTransport('  The old lock remembers every hand.  ')

    await expect(
      new OpenAICompatibleNPCDialogueProvider(config, transport).reply(request()),
    ).resolves.toEqual({ text: 'The old lock remembers every hand.' })
  })

  it('uses bounded max_tokens', async () => {
    const { transport, calls } = recordingTransport('A short reply.')

    await new OpenAICompatibleNPCDialogueProvider(config, transport).reply(request())

    const body = JSON.parse(calls[0]!.init.body) as { max_tokens?: unknown }
    expect(body.max_tokens).toBe(DIALOGUE_MAX_TOKENS)
    expect(DIALOGUE_MAX_TOKENS).toBe(200)
  })

  it('has no logger constructor dependency', () => {
    const { transport } = recordingTransport('A short reply.')
    const provider = new OpenAICompatibleNPCDialogueProvider(config, transport)

    expect(OpenAICompatibleNPCDialogueProvider.length).toBe(1)
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(provider)).sort()).toEqual([
      'constructor',
      'reply',
    ])
  })
})

describe('OpenAICompatibleNPCDialogueProvider failures', () => {
  it('throws dialogue-llm-timeout when the hard timeout aborts the request', async () => {
    vi.useFakeTimers()
    let aborted = false
    const transport: LlmTransport = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => {
          aborted = true
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })

    const promise = new OpenAICompatibleNPCDialogueProvider(config, transport).reply(request())
    const assertion = expect(promise).rejects.toThrow(DIALOGUE_LLM_TIMEOUT)
    await vi.advanceTimersByTimeAsync(DIALOGUE_TIMEOUT_MS)

    await assertion
    expect(aborted).toBe(true)
  })

  it('throws dialogue-llm-request-failed on transport failure and does not retry', async () => {
    let callCount = 0
    const transport: LlmTransport = async () => {
      callCount += 1
      throw new Error('ECONNREFUSED with sensitive details')
    }

    await expect(
      new OpenAICompatibleNPCDialogueProvider(config, transport).reply(request()),
    ).rejects.toThrow(DIALOGUE_LLM_REQUEST_FAILED)
    expect(callCount).toBe(1)
  })

  it('throws dialogue-llm-request-failed on a non-ok response', async () => {
    const transport: LlmTransport = async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'raw provider response body' }),
    })

    await expect(
      new OpenAICompatibleNPCDialogueProvider(config, transport).reply(request()),
    ).rejects.toThrow(DIALOGUE_LLM_REQUEST_FAILED)
  })

  it('throws dialogue-llm-request-failed on malformed response body', async () => {
    const transport: LlmTransport = async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new SyntaxError('raw response was not JSON')
      },
    })

    await expect(
      new OpenAICompatibleNPCDialogueProvider(config, transport).reply(request()),
    ).rejects.toThrow(DIALOGUE_LLM_REQUEST_FAILED)
  })

  it('throws dialogue-llm-empty-response when content is missing, non-string, empty, or whitespace', async () => {
    const missingTransport: LlmTransport = async () => okResponse({ choices: [{ message: {} }] })
    const nonStringTransport: LlmTransport = async () =>
      okResponse({ choices: [{ message: { content: { raw: 'model-output' } } }] })
    const emptyTransport: LlmTransport = async () =>
      okResponse({ choices: [{ message: { content: '' } }] })
    const whitespaceTransport: LlmTransport = async () =>
      okResponse({ choices: [{ message: { content: '   \n\t  ' } }] })

    await expect(
      new OpenAICompatibleNPCDialogueProvider(config, missingTransport).reply(request()),
    ).rejects.toThrow(DIALOGUE_LLM_EMPTY_RESPONSE)
    await expect(
      new OpenAICompatibleNPCDialogueProvider(config, nonStringTransport).reply(request()),
    ).rejects.toThrow(DIALOGUE_LLM_EMPTY_RESPONSE)
    await expect(
      new OpenAICompatibleNPCDialogueProvider(config, emptyTransport).reply(request()),
    ).rejects.toThrow(DIALOGUE_LLM_EMPTY_RESPONSE)
    await expect(
      new OpenAICompatibleNPCDialogueProvider(config, whitespaceTransport).reply(request()),
    ).rejects.toThrow(DIALOGUE_LLM_EMPTY_RESPONSE)
  })
})

describe('OpenAICompatibleNPCDialogueProvider error message safety', () => {
  it('thrown messages leak no key, prompt, memory, body, provider output, ids, flags, or gate data', async () => {
    const input = request({
      context: {
        ...request().context,
        memory: {
          entries: [
            {
              text: 'SECRET MEMORY TEXT',
              kind: 'player_claim',
              flagKey: 'secret-flag-key',
              gateJson: '{"unlockObjectId":"secret-object-id"}',
            } as unknown as NonNullable<NPCDialogueRequest['context']['memory']>['entries'][number],
          ],
        },
        flags: { 'secret-flag-key': true },
      } as unknown as NPCDialogueRequest['context'],
    })
    const requestBody = JSON.stringify(buildDialoguePromptMessages(input))
    const rawResponse = 'raw provider response body'
    const providerOutput = 'SECRET PROVIDER OUTPUT'
    const transport: LlmTransport = async () => {
      throw new Error(
        [
          'boom',
          config.apiKey,
          requestBody,
          rawResponse,
          providerOutput,
          'SECRET PLAYER LINE',
          'SECRET MEMORY TEXT',
          'secret-room-id',
          'secret-npc-id',
          'secret-object-id',
          'secret-flag-key',
          '{"unlockObjectId":"secret-object-id"}',
        ].join(' '),
      )
    }

    const message = await captureMessage(
      new OpenAICompatibleNPCDialogueProvider(config, transport).reply(input),
    )

    expect([
      DIALOGUE_LLM_REQUEST_FAILED,
      DIALOGUE_LLM_TIMEOUT,
      DIALOGUE_LLM_EMPTY_RESPONSE,
    ]).toContain(message)
    for (const forbidden of [
      'boom',
      config.apiKey,
      requestBody,
      rawResponse,
      providerOutput,
      'SECRET PLAYER LINE',
      'SECRET MEMORY TEXT',
      'secret-room-id',
      'secret-npc-id',
      'secret-object-id',
      'secret-flag-key',
      'unlockObjectId',
    ]) {
      expect(message).not.toContain(forbidden)
    }
  })
})
