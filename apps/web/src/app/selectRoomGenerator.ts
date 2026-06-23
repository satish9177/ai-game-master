import type { RoomGenerator } from '../domain/ports/RoomGenerator'
import { FakeRoomGenerator } from '../generation/FakeRoomGenerator'
import { OpenAICompatibleRoomGenerator } from '../generation/OpenAICompatibleRoomGenerator'
import {
  REAL_PROVIDER_BASE_URLS,
  isRealProviderComplete,
  type LlmConfig,
  type RealLlmProvider,
} from './llmConfig'

/**
 * Choose the prompt-path `RoomGenerator` from config
 * (real-room-generator-provider v0; ADR-0023).
 *
 * `FakeRoomGenerator` is the default and the safe fallback. The real
 * `OpenAICompatibleRoomGenerator` is selected ONLY when the config is complete
 * (`provider ∈ {openai, deepseek}` + matching key + model). Any incomplete state
 * degrades to the fake with the fixed reason code `config-disabled` — gameplay is
 * never blocked.
 *
 * The returned `log` is a LOG-SAFE selection summary: provider enum, model id,
 * and numeric caps only on real selection, or `{ provider:'fake', reason }`
 * otherwise. It never contains the API key, prompt/seed, or any body — the
 * caller passes it straight to `logger.info('room generator selected', …)`.
 *
 * Constructing the real generator performs no I/O (the network call happens only
 * in `generate`), so selection is pure and safe to run at composition time.
 */

/** Log-safe selection summary for a real provider. */
export type RealSelectionLog = {
  provider: RealLlmProvider
  model: string
  maxTokens: number
  timeoutMs: number
}

/** Log-safe selection summary for the fake/default provider. */
export type FakeSelectionLog = {
  provider: 'fake'
  reason: 'config-disabled'
}

export type RoomGeneratorSelection = {
  generator: RoomGenerator
  log: RealSelectionLog | FakeSelectionLog
}

export function selectRoomGenerator(config: LlmConfig): RoomGeneratorSelection {
  if (isRealProviderComplete(config)) {
    const generator = new OpenAICompatibleRoomGenerator({
      baseUrl: REAL_PROVIDER_BASE_URLS[config.provider],
      apiKey: config.apiKey,
      model: config.model,
      maxTokens: config.maxTokens,
      timeoutMs: config.timeoutMs,
    })
    return {
      generator,
      log: {
        provider: config.provider,
        model: config.model,
        maxTokens: config.maxTokens,
        timeoutMs: config.timeoutMs,
      },
    }
  }
  return {
    generator: new FakeRoomGenerator(),
    log: { provider: 'fake', reason: 'config-disabled' },
  }
}
