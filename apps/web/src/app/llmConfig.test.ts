import { describe, it, expect } from 'vitest'
import {
  readLlmConfig,
  isRealProviderComplete,
  REAL_PROVIDER_BASE_URLS,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_MS,
  type LlmRawEnv,
} from './llmConfig'

const complete: LlmRawEnv = {
  VITE_AIGM_LLM_PROVIDER: 'openai',
  VITE_AIGM_LLM_MODEL: 'gpt-test',
  VITE_OPENAI_API_KEY: 'sk-openai',
}

describe('readLlmConfig provider parsing', () => {
  it('defaults to fake when the provider is unset', () => {
    expect(readLlmConfig({}).provider).toBe('fake')
  })

  it('defaults to fake for an unrecognized provider', () => {
    expect(readLlmConfig({ VITE_AIGM_LLM_PROVIDER: 'anthropic' }).provider).toBe('fake')
  })

  it('accepts openai and deepseek, case-insensitively and trimmed', () => {
    expect(readLlmConfig({ VITE_AIGM_LLM_PROVIDER: '  OpenAI ' }).provider).toBe('openai')
    expect(readLlmConfig({ VITE_AIGM_LLM_PROVIDER: 'deepseek' }).provider).toBe('deepseek')
  })
})

describe('readLlmConfig key resolution', () => {
  it('reads the OpenAI key for the openai provider', () => {
    expect(readLlmConfig(complete).apiKey).toBe('sk-openai')
  })

  it('reads the DeepSeek key for the deepseek provider', () => {
    const config = readLlmConfig({
      VITE_AIGM_LLM_PROVIDER: 'deepseek',
      VITE_DEEPSEEK_API_KEY: 'sk-deepseek',
    })
    expect(config.apiKey).toBe('sk-deepseek')
  })

  it('does not read any key for the fake provider', () => {
    expect(readLlmConfig({ VITE_OPENAI_API_KEY: 'sk-openai' }).apiKey).toBe('')
  })

  it('trims surrounding whitespace from the key', () => {
    expect(readLlmConfig({ ...complete, VITE_OPENAI_API_KEY: '  sk-openai  ' }).apiKey).toBe('sk-openai')
  })
})

describe('readLlmConfig numeric caps', () => {
  it('applies defaults when unset', () => {
    const config = readLlmConfig(complete)
    expect(config.maxTokens).toBe(DEFAULT_MAX_TOKENS)
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })

  it('parses positive integers', () => {
    const config = readLlmConfig({
      ...complete,
      VITE_AIGM_LLM_MAX_TOKENS: '500',
      VITE_AIGM_LLM_TIMEOUT_MS: '8000',
    })
    expect(config.maxTokens).toBe(500)
    expect(config.timeoutMs).toBe(8000)
  })

  it('falls back to defaults on invalid or non-positive values', () => {
    const config = readLlmConfig({
      ...complete,
      VITE_AIGM_LLM_MAX_TOKENS: 'lots',
      VITE_AIGM_LLM_TIMEOUT_MS: '-5',
    })
    expect(config.maxTokens).toBe(DEFAULT_MAX_TOKENS)
    expect(config.timeoutMs).toBe(DEFAULT_TIMEOUT_MS)
  })
})

describe('isRealProviderComplete', () => {
  it('is true only when provider, matching key and model are all present', () => {
    expect(isRealProviderComplete(readLlmConfig(complete))).toBe(true)
  })

  it('is false for the fake provider even with a key and model present', () => {
    const config = readLlmConfig({
      VITE_AIGM_LLM_PROVIDER: 'fake',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
      VITE_OPENAI_API_KEY: 'sk-openai',
    })
    expect(isRealProviderComplete(config)).toBe(false)
  })

  it('is false when the matching key is missing', () => {
    const config = readLlmConfig({ VITE_AIGM_LLM_PROVIDER: 'openai', VITE_AIGM_LLM_MODEL: 'gpt-test' })
    expect(isRealProviderComplete(config)).toBe(false)
  })

  it('is false when the key is only whitespace', () => {
    const config = readLlmConfig({ ...complete, VITE_OPENAI_API_KEY: '   ' })
    expect(isRealProviderComplete(config)).toBe(false)
  })

  it('is false when the model is missing', () => {
    const config = readLlmConfig({ VITE_AIGM_LLM_PROVIDER: 'openai', VITE_OPENAI_API_KEY: 'sk-openai' })
    expect(isRealProviderComplete(config)).toBe(false)
  })
})

describe('REAL_PROVIDER_BASE_URLS', () => {
  it('maps each real provider to its built-in base URL', () => {
    expect(REAL_PROVIDER_BASE_URLS.openai).toBe('https://api.openai.com/v1')
    expect(REAL_PROVIDER_BASE_URLS.deepseek).toBe('https://api.deepseek.com/v1')
  })
})
