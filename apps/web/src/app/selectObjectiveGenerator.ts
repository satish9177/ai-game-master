import type { ObjectiveGenerator } from '../domain/ports/ObjectiveGenerator'
import { FakeObjectiveGenerator } from '../generation/FakeObjectiveGenerator'
import { OpenAICompatibleObjectiveGenerator } from '../generation/OpenAICompatibleObjectiveGenerator'
import {
  REAL_PROVIDER_BASE_URLS,
  isRealProviderComplete,
  type LlmConfig,
  type RealLlmProvider,
} from './llmConfig'

export type RealObjectiveSelectionLog = {
  provider: RealLlmProvider
  model: string
}

export type FakeObjectiveSelectionLog = {
  provider: 'fake'
  reason: 'config-disabled'
}

export type ObjectiveGeneratorSelection = {
  generator: ObjectiveGenerator
  log: RealObjectiveSelectionLog | FakeObjectiveSelectionLog
}

export function selectObjectiveGenerator(config: LlmConfig): ObjectiveGeneratorSelection {
  if (isRealProviderComplete(config)) {
    return {
      generator: new OpenAICompatibleObjectiveGenerator({
        baseUrl: REAL_PROVIDER_BASE_URLS[config.provider],
        apiKey: config.apiKey,
        model: config.model,
      }),
      log: {
        provider: config.provider,
        model: config.model,
      },
    }
  }

  return {
    generator: new FakeObjectiveGenerator(),
    log: { provider: 'fake', reason: 'config-disabled' },
  }
}
