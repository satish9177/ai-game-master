import type { LoadedRoom } from '../domain/loadRoomSpec'
import type { RoomObject } from '../domain/roomSpec'
import type { ChatMessage } from './llmRoomPrompt'

export type GatePromptObjectCandidate = {
  objectId: string
  type: RoomObject['type']
}

export type GatePromptExitCandidate = {
  exitToRoomId: string
}

export type GatePromptDigest = {
  candidates: GatePromptObjectCandidate[]
  exits: GatePromptExitCandidate[]
}

export const GATE_SYSTEM_PROMPT = [
  'You choose one mechanical-gate proposal for a generated room.',
  'Output ONLY a strict JSON object. No prose, no markdown, no code fences.',
  'Choose unlockObjectId exactly from candidates[].objectId.',
  'Choose exitToRoomId exactly from exits[].exitToRoomId.',
  'If either list is empty, still output valid JSON using empty strings; it will be safely dropped.',
  'Do not invent ids. Do not include executable code, renderer instructions, SQL, world events, or state mutations.',
  'JSON shape:',
  '{',
  '  "unlockObjectId": string,',
  '  "exitToRoomId": string',
  '}',
].join('\n')

export function buildGatePromptDigest(room: LoadedRoom): GatePromptDigest {
  return {
    candidates: room.objects.flatMap((object) => gateCandidateForObject(object)),
    exits: room.objects.flatMap((object) => exitCandidateForObject(object)),
  }
}

export function buildGatePromptMessages(room: LoadedRoom): ChatMessage[] {
  return [
    { role: 'system', content: GATE_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(buildGatePromptDigest(room)) },
  ]
}

function gateCandidateForObject(object: RoomObject): GatePromptObjectCandidate[] {
  if (object.id === undefined) return []
  if (!('interaction' in object)) return []
  if (object.interaction?.encounter !== undefined) return []

  const effect = object.interaction?.effect
  if (effect?.kind !== 'inspect' && effect?.kind !== 'take-item') return []

  return [{ objectId: object.id, type: object.type }]
}

function exitCandidateForObject(object: RoomObject): GatePromptExitCandidate[] {
  if (!('interaction' in object)) return []
  const exitToRoomId = object.interaction?.exit?.toRoomId
  return exitToRoomId === undefined ? [] : [{ exitToRoomId }]
}
