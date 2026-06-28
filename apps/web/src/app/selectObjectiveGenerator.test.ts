import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import { FakeObjectiveGenerator } from '../generation/FakeObjectiveGenerator'
import { OpenAICompatibleObjectiveGenerator } from '../generation/OpenAICompatibleObjectiveGenerator'
import { readLlmConfig, type LlmRawEnv } from './llmConfig'
import { selectObjectiveGenerator } from './selectObjectiveGenerator'

function select(env: LlmRawEnv) {
  return selectObjectiveGenerator(readLlmConfig(env))
}

function makeObjectiveReadyRoom() {
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
        id: 'objective-book',
        name: 'Secret Object Name',
        position: [0, 0.3, -2],
        interaction: {
          key: 'E',
          prompt: 'Secret interaction prompt',
          title: 'Secret interaction title',
          body: 'Secret generated text body',
          effect: { kind: 'inspect' },
        },
      },
    ],
  })
}

describe('selectObjectiveGenerator fake default / fallback', () => {
  it('selects FakeObjectiveGenerator when the provider is unset', () => {
    const selection = select({})

    expect(selection.generator).toBeInstanceOf(FakeObjectiveGenerator)
    expect(selection.log).toEqual({ provider: 'fake', reason: 'config-disabled' })
  })

  it('selects FakeObjectiveGenerator when the matching key is missing', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
    })

    expect(selection.generator).toBeInstanceOf(FakeObjectiveGenerator)
    expect(selection.log).toEqual({ provider: 'fake', reason: 'config-disabled' })
  })

  it('selects FakeObjectiveGenerator when the model is missing', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'deepseek',
      VITE_DEEPSEEK_API_KEY: 'sk-deepseek',
    })

    expect(selection.generator).toBeInstanceOf(FakeObjectiveGenerator)
    expect(selection.log).toEqual({ provider: 'fake', reason: 'config-disabled' })
  })

  it('selects FakeObjectiveGenerator when the key is only whitespace', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
      VITE_OPENAI_API_KEY: '   ',
    })

    expect(selection.generator).toBeInstanceOf(FakeObjectiveGenerator)
    expect(selection.log).toEqual({ provider: 'fake', reason: 'config-disabled' })
  })

  it('preserves fake default behavior', async () => {
    const selection = select({})
    const raw = await selection.generator.generate(makeObjectiveReadyRoom())

    expect(raw).toBe(
      '{"title":"Secure the room","description":"Investigate the marked feature.","hint":"Look for the feature that responds to your touch.","completionHint":"That was the important thing here.","condition":{"kind":"interact-object","objectId":"objective-book"}}',
    )
  })
})

describe('selectObjectiveGenerator real provider', () => {
  it('selects OpenAICompatibleObjectiveGenerator when openai config is complete', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'gpt-test',
      VITE_OPENAI_API_KEY: 'sk-openai-secret',
    })

    expect(selection.generator).toBeInstanceOf(OpenAICompatibleObjectiveGenerator)
    expect(selection.log).toEqual({ provider: 'openai', model: 'gpt-test' })
  })

  it('selects OpenAICompatibleObjectiveGenerator when deepseek config is complete', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'deepseek',
      VITE_AIGM_LLM_MODEL: 'deepseek-chat',
      VITE_DEEPSEEK_API_KEY: 'sk-deepseek-secret',
    })

    expect(selection.generator).toBeInstanceOf(OpenAICompatibleObjectiveGenerator)
    expect(selection.log).toEqual({ provider: 'deepseek', model: 'deepseek-chat' })
  })
})

describe('selectObjectiveGenerator metadata safety', () => {
  it('includes model only as safe non-secret metadata', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'openai',
      VITE_AIGM_LLM_MODEL: 'safe-model-id',
      VITE_OPENAI_API_KEY: 'sk-secret-should-not-appear',
    })

    expect(selection.log).toEqual({ provider: 'openai', model: 'safe-model-id' })
    expect(Object.keys(selection.log).sort()).toEqual(['model', 'provider'])
  })

  it('does not expose apiKey, base URL, prompt text, raw JSON, object ids, hints, generated text, or provider output', () => {
    const selection = select({
      VITE_AIGM_LLM_PROVIDER: 'deepseek',
      VITE_AIGM_LLM_MODEL: 'deepseek-chat',
      VITE_DEEPSEEK_API_KEY: 'sk-secret-should-not-appear',
      VITE_AIGM_LLM_MAX_TOKENS: '9999',
      VITE_AIGM_LLM_TIMEOUT_MS: '9999',
    })
    const serialized = JSON.stringify(selection.log)

    expect(serialized).not.toContain('sk-secret-should-not-appear')
    expect(serialized).not.toContain('https://api.deepseek.com/v1')
    expect(serialized).not.toContain('Secret interaction prompt')
    expect(serialized).not.toContain('{"title"')
    expect(serialized).not.toContain('objective-book')
    expect(serialized).not.toContain('hint')
    expect(serialized).not.toContain('Secret generated text body')
    expect(serialized).not.toContain('provider output')
    expect(Object.keys(selection.log).sort()).toEqual(['model', 'provider'])
  })
})
