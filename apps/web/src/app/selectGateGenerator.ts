import type { GateGenerator } from '../domain/ports/GateGenerator'
import { OpenAICompatibleGateGenerator } from '../generation/OpenAICompatibleGateGenerator'
import {
  REAL_PROVIDER_BASE_URLS,
  isRealProviderComplete,
  type LlmConfig,
  type RealLlmProvider,
} from './llmConfig'

export type RealGateSelectionLog = {
  provider: RealLlmProvider
  model: string
}

export type DisabledGateSelectionLog = {
  provider: 'disabled'
  reason: 'config-disabled'
}

export type GateGeneratorSelection =
  | { kind: 'disabled'; reason: 'config-disabled'; log: DisabledGateSelectionLog }
  | { kind: 'real'; generator: GateGenerator; log: RealGateSelectionLog }

export function selectGateGenerator(config: LlmConfig): GateGeneratorSelection {
  if (isRealProviderComplete(config)) {
    return {
      kind: 'real',
      generator: new OpenAICompatibleGateGenerator({
        baseUrl: REAL_PROVIDER_BASE_URLS[config.provider],
        apiKey: config.apiKey,
        model: config.model,
      }),
      log: { provider: config.provider, model: config.model },
    }
  }

  return {
    kind: 'disabled',
    reason: 'config-disabled',
    log: { provider: 'disabled', reason: 'config-disabled' },
  }
}
