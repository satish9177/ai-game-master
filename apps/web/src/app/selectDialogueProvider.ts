import type { NPCDialogueProvider } from '../domain/ports/NPCDialogueProvider'
import { FakeNPCDialogueProvider } from '../dialogue/FakeNPCDialogueProvider'
import { OpenAICompatibleNPCDialogueProvider } from '../generation/OpenAICompatibleNPCDialogueProvider'
import {
  REAL_PROVIDER_BASE_URLS,
  isRealProviderComplete,
  type LlmConfig,
  type RealLlmProvider,
} from './llmConfig'

export type RealDialogueSelectionLog = {
  provider: RealLlmProvider
  model: string
}

export type FakeDialogueSelectionLog = {
  provider: 'fake'
  reason: 'config-disabled'
}

export type DialogueProviderSelection =
  | { kind: 'fake'; provider: NPCDialogueProvider; log: FakeDialogueSelectionLog }
  | { kind: 'real'; provider: NPCDialogueProvider; log: RealDialogueSelectionLog }

export function selectDialogueProvider(config: LlmConfig): DialogueProviderSelection {
  if (isRealProviderComplete(config)) {
    return {
      kind: 'real',
      provider: new OpenAICompatibleNPCDialogueProvider({
        baseUrl: REAL_PROVIDER_BASE_URLS[config.provider],
        apiKey: config.apiKey,
        model: config.model,
      }),
      log: { provider: config.provider, model: config.model },
    }
  }

  return {
    kind: 'fake',
    provider: new FakeNPCDialogueProvider(),
    log: { provider: 'fake', reason: 'config-disabled' },
  }
}
