import { describe, expect, it, vi } from 'vitest'
import { FakeNPCDialogueProvider } from '../dialogue/FakeNPCDialogueProvider'
import { OpenAICompatibleNPCDialogueProvider } from '../generation/OpenAICompatibleNPCDialogueProvider'
import { readLlmConfig, type LlmRawEnv } from './llmConfig'
import { selectDialogueProvider } from './selectDialogueProvider'

function select(env: LlmRawEnv) {
  return selectDialogueProvider(readLlmConfig(env))
}

describe('selectDialogueProvider', () => {
  it('selects the fake provider when config is incomplete', () => {
    expect(select({})).toMatchObject({
      kind: 'fake',
      log: { provider: 'fake', reason: 'config-disabled' },
    })
    expect(select({}).provider).toBeInstanceOf(FakeNPCDialogueProvider)

    expect(select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
    })).toMatchObject({
      kind: 'fake',
      log: { provider: 'fake', reason: 'config-disabled' },
    })

    expect(select({
      VITE_AIGM_LLM_PROVIDER: 'deepseek',
      VITE_DEEPSEEK_API_KEY: 'sk-deepseek-secret',
    })).toMatchObject({
      kind: 'fake',
      log: { provider: 'fake', reason: 'config-disabled' },
    })
  })

  it('selects the real OpenAI-compatible provider when config is complete', () => {
    const openai = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
      VITE_OPENAI_API_KEY: 'sk-openai-secret',
    })
    const deepseek = select({
      VITE_AIGM_LLM_PROVIDER: 'deepseek',
      VITE_AIGM_LLM_MODEL: 'deepseek-chat',
      VITE_DEEPSEEK_API_KEY: 'sk-deepseek-secret',
    })

    expect(openai.kind).toBe('real')
    expect(openai.provider).toBeInstanceOf(OpenAICompatibleNPCDialogueProvider)
    expect(openai.log).toEqual({ provider: 'openai', model: 'gpt-test' })
    expect(deepseek.kind).toBe('real')
    expect(deepseek.provider).toBeInstanceOf(OpenAICompatibleNPCDialogueProvider)
    expect(deepseek.log).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  it('safe fake log contains only fake provider and fixed reason', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
    })

    expect(selection.kind).toBe('fake')
    expect(selection.log).toEqual({ provider: 'fake', reason: 'config-disabled' })
    expect(Object.keys(selection.log).sort()).toEqual(['provider', 'reason'])
  })

  it('safe real log contains provider and model only', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'safe-model-id',
      VITE_OPENAI_API_KEY: 'sk-secret-should-not-appear',
      VITE_AIGM_LLM_MAX_TOKENS: '9999',
      VITE_AIGM_LLM_TIMEOUT_MS: '9999',
    })

    expect(selection.kind).toBe('real')
    expect(selection.log).toEqual({ provider: 'openai', model: 'safe-model-id' })
    expect(Object.keys(selection.log).sort()).toEqual(['model', 'provider'])
  })

  it('log does not include API key, prompt, memory text, player line, ids, flags, gate JSON, or provider body', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'deepseek',
      VITE_AIGM_LLM_MODEL: 'deepseek-chat',
      VITE_DEEPSEEK_API_KEY: 'sk-secret-should-not-appear',
      VITE_AIGM_LLM_MAX_TOKENS: '9999',
      VITE_AIGM_LLM_TIMEOUT_MS: '9999',
    })
    const serialized = JSON.stringify(selection.log)

    expect(serialized).not.toContain('sk-secret-should-not-appear')
    expect(serialized).not.toContain('SECRET RAW PROMPT')
    expect(serialized).not.toContain('SECRET MEMORY TEXT')
    expect(serialized).not.toContain('SECRET PLAYER LINE')
    expect(serialized).not.toContain('secret-room-id')
    expect(serialized).not.toContain('secret-npc-id')
    expect(serialized).not.toContain('secret-object-id')
    expect(serialized).not.toContain('secret-flag-key')
    expect(serialized).not.toContain('{"unlockObjectId"')
    expect(serialized).not.toContain('raw provider body')
    expect(serialized).not.toContain('api.deepseek.com')
  })

  it('selection does not call network', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')

    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
      VITE_OPENAI_API_KEY: 'sk-openai-secret',
    })

    expect(selection.kind).toBe('real')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('fake remains the default when config is unset', () => {
    const selection = select({})

    expect(selection.kind).toBe('fake')
    expect(selection.provider).toBeInstanceOf(FakeNPCDialogueProvider)
    expect(selection.log).toEqual({ provider: 'fake', reason: 'config-disabled' })
  })
})
