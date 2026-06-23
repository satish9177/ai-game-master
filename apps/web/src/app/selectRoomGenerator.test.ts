import { describe, it, expect } from 'vitest'
import { selectRoomGenerator } from './selectRoomGenerator'
import { readLlmConfig, type LlmRawEnv } from './llmConfig'
import { FakeRoomGenerator } from '../generation/FakeRoomGenerator'
import { OpenAICompatibleRoomGenerator } from '../generation/OpenAICompatibleRoomGenerator'

function select(env: LlmRawEnv) {
  return selectRoomGenerator(readLlmConfig(env))
}

describe('selectRoomGenerator fake default / fallback', () => {
  it('selects the fake generator when the provider is unset', () => {
    const selection = select({})
    expect(selection.generator).toBeInstanceOf(FakeRoomGenerator)
    expect(selection.log).toEqual({ provider: 'fake', reason: 'config-disabled' })
  })

  it('selects the fake generator when the matching key is missing', () => {
    const selection = select({ VITE_AIGM_LLM_PROVIDER: 'openai', VITE_AIGM_LLM_MODEL: 'gpt-test' })
    expect(selection.generator).toBeInstanceOf(FakeRoomGenerator)
    expect(selection.log).toEqual({ provider: 'fake', reason: 'config-disabled' })
  })

  it('selects the fake generator when the model is missing', () => {
    const selection = select({ VITE_AIGM_LLM_PROVIDER: 'deepseek', VITE_DEEPSEEK_API_KEY: 'sk-d' })
    expect(selection.generator).toBeInstanceOf(FakeRoomGenerator)
  })

  it('selects the fake generator when the key is only whitespace', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
      VITE_OPENAI_API_KEY: '   ',
    })
    expect(selection.generator).toBeInstanceOf(FakeRoomGenerator)
  })
})

describe('selectRoomGenerator real provider', () => {
  it('selects the generic generator for a complete openai config and logs safe metadata', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
      VITE_OPENAI_API_KEY: 'sk-openai',
      VITE_AIGM_LLM_MAX_TOKENS: '1200',
      VITE_AIGM_LLM_TIMEOUT_MS: '9000',
    })
    expect(selection.generator).toBeInstanceOf(OpenAICompatibleRoomGenerator)
    expect(selection.log).toEqual({
      provider: 'openai',
      model: 'gpt-test',
      maxTokens: 1200,
      timeoutMs: 9000,
    })
  })

  it('selects the generic generator for a complete deepseek config', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'deepseek',
      VITE_AIGM_LLM_MODEL: 'deepseek-chat',
      VITE_DEEPSEEK_API_KEY: 'sk-deepseek',
    })
    expect(selection.generator).toBeInstanceOf(OpenAICompatibleRoomGenerator)
    expect(selection.log).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat' })
  })
})

describe('selectRoomGenerator log/key safety', () => {
  it('never includes the API key in the selection log', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
      VITE_OPENAI_API_KEY: 'sk-secret-should-not-appear',
    })
    const serialized = JSON.stringify(selection.log)
    expect(serialized).not.toContain('sk-secret-should-not-appear')
    // Only the documented log-safe keys are present.
    expect(Object.keys(selection.log).sort()).toEqual(
      ['maxTokens', 'model', 'provider', 'timeoutMs'].sort(),
    )
  })
})
