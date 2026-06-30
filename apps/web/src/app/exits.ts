import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { NavigationResult } from './NavigationService'

export type ExitTarget = { toRoomId: string }

export type ExitLookup = ReadonlyMap<string, ExitTarget>

export function buildExitLookup(room: LoadedRoom): ExitLookup {
  const exits = new Map<string, ExitTarget>()
  for (const object of room.objects) {
    if (!('interaction' in object) || !object.id || exits.has(object.id)) continue
    const exit = object.interaction?.exit
    if (!exit) continue
    exits.set(object.id, exit)
  }
  return exits
}

export function navigationResultMessage(result: NavigationResult): string | undefined {
  if (result.status === 'navigated') return undefined
  if (result.status === 'rejected' && result.reason === 'blocked') {
    return 'The north arch is barred until you deal with Steward Malik.'
  }
  if (result.status === 'rejected' && result.reason === 'gate-locked') {
    return 'This way is sealed until you deal with what is in this room.'
  }
  if (result.status === 'rejected' && result.reason === 'already-here') {
    return 'You are already here.'
  }
  if (result.status === 'failed' && result.reason === 'conflict') {
    return 'The world changed. Try again.'
  }
  if (result.status === 'failed') return 'This room could not be entered.'
  return 'The way is blocked.'
}
