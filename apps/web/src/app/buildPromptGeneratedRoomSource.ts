import { detectsNpcRequest } from './detectsNpcRequest'
import { GeneratedRoomSource } from '../room/GeneratedRoomSource'
import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { RoomGenerator } from '../domain/ports/RoomGenerator'
import type { Logger } from '../platform/logger/Logger'

export function buildPromptGeneratedRoomSource({
  generator,
  rawUserPrompt,
  generatorSeed,
  logger,
  fallbackRoom,
}: {
  generator: RoomGenerator
  rawUserPrompt: string
  generatorSeed: string
  logger: Logger
  fallbackRoom: LoadedRoom
}): GeneratedRoomSource {
  return new GeneratedRoomSource(generator, generatorSeed, logger, fallbackRoom, {
    requestsNpc: detectsNpcRequest(rawUserPrompt),
  })
}
