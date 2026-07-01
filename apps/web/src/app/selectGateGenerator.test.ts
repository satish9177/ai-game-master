import { describe, expect, it } from 'vitest'
import { OpenAICompatibleGateGenerator } from '../generation/OpenAICompatibleGateGenerator'
import { readLlmConfig, type LlmRawEnv } from './llmConfig'
import { selectGateGenerator } from './selectGateGenerator'

function select(env: LlmRawEnv) {
  return selectGateGenerator(readLlmConfig(env))
}

describe('selectGateGenerator', () => {
  it('selects a real gate generator when openai config is complete', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
      VITE_OPENAI_API_KEY: 'sk-openai-secret',
    })

    expect(selection.kind).toBe('real')
    expect(selection.kind === 'real' ? selection.generator : null)
      .toBeInstanceOf(OpenAICompatibleGateGenerator)
    expect(selection.log).toEqual({ provider: 'openai', model: 'gpt-test' })
  })

  it('selects a real gate generator when deepseek config is complete', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'deepseek',
      VITE_AIGM_LLM_MODEL: 'deepseek-chat',
      VITE_DEEPSEEK_API_KEY: 'sk-deepseek-secret',
    })

    expect(selection.kind).toBe('real')
    expect(selection.kind === 'real' ? selection.generator : null)
      .toBeInstanceOf(OpenAICompatibleGateGenerator)
    expect(selection.log).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })

  it('selects disabled config-disabled when provider config is incomplete', () => {
    expect(select({})).toEqual({
      kind: 'disabled',
      reason: 'config-disabled',
      log: { provider: 'disabled', reason: 'config-disabled' },
    })
    expect(select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
    })).toEqual({
      kind: 'disabled',
      reason: 'config-disabled',
      log: { provider: 'disabled', reason: 'config-disabled' },
    })
    expect(select({
      VITE_AIGM_LLM_PROVIDER: 'deepseek',
      VITE_DEEPSEEK_API_KEY: 'sk-deepseek-secret',
    })).toEqual({
      kind: 'disabled',
      reason: 'config-disabled',
      log: { provider: 'disabled', reason: 'config-disabled' },
    })
  })

  it('safe logs do not include API key, raw ids, provider body, or generated JSON', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'safe-model-id',
      VITE_OPENAI_API_KEY: 'sk-secret-should-not-appear',
      VITE_AIGM_LLM_MAX_TOKENS: '9999',
      VITE_AIGM_LLM_TIMEOUT_MS: '9999',
    })
    const serialized = JSON.stringify(selection.log)

    expect(selection.log).toEqual({ provider: 'openai', model: 'safe-model-id' })
    expect(serialized).not.toContain('sk-secret-should-not-appear')
    expect(serialized).not.toContain('secret-room-id')
    expect(serialized).not.toContain('secret-object-id')
    expect(serialized).not.toContain('interaction:secret-object-id')
    expect(serialized).not.toContain('{"unlockObjectId"')
    expect(serialized).not.toContain('provider response body')
    expect(serialized).not.toContain('api.openai.com')
    expect(Object.keys(selection.log).sort()).toEqual(['model', 'provider'])
  })
})
