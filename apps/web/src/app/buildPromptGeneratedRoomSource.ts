import { detectsNpcRequest } from './detectsNpcRequest'
import { GeneratedRoomSource } from '../room/GeneratedRoomSource'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { RoomGenerator } from '../domain/ports/RoomGenerator'
import type { Logger } from '../platform/logger/Logger'
import type { GeneratedRoomVisualTheme } from '../domain/generatedRoomThemeVocabulary'

export function buildPromptGeneratedRoomSource({
  generator,
  rawUserPrompt,
  generatorSeed,
  themePack,
  logger,
  fallbackRoom,
}: {
  generator: RoomGenerator
  rawUserPrompt: string
  generatorSeed: string
  themePack?: GeneratedRoomVisualTheme
  logger: Logger
  fallbackRoom: LoadedRoom
}): GeneratedRoomSource {
  return new GeneratedRoomSource(generator, generatorSeed, logger, fallbackRoom, {
    requestsNpc: detectsNpcRequest(rawUserPrompt),
    enrichObjectiveTarget: true,
    deriveMechanicalGateDiagnostic: true,
    themePack,
  })
}
