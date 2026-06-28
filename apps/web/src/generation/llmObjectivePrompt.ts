import type { LoadedRoom } from '../domain/loadRoomSpec'
import { listInteractObjectiveCandidates } from '../domain/quests/objectiveCandidates'
import type { InteractObjectiveCandidate } from '../domain/quests/objectiveCandidates'
import type { ChatMessage } from './llmRoomPrompt'

export type ObjectivePromptDigest = {
  conditionKind: 'interact-object'
  candidates: InteractObjectiveCandidate[]
}

export const OBJECTIVE_SYSTEM_PROMPT = [
  'You generate one optional story objective proposal for a generated room.',
  'Output ONLY a strict JSON object. No prose, no markdown, no code fences.',
  'Use only condition.kind "interact-object". Do not use resolve-encounter or visit-room.',
  'Choose one objectId exactly from the provided candidates array.',
  'If candidates is empty, still output valid JSON using an empty objectId; it will be safely dropped.',
  'Do not invent object ids. Do not output raw flags such as interaction:<id>.',
  'Do not include executable code, renderer instructions, SQL, world events, or state mutations.',
  'JSON shape:',
  '{',
  '  "title": string,',
  '  "description": string,',
  '  "hint": string,',
  '  "completionHint": string,',
  '  "condition": { "kind": "interact-object", "objectId": string }',
  '}',
  'Keep title <= 80 characters and all other text fields <= 160 characters.',
].join('\n')

export function buildObjectivePromptDigest(room: LoadedRoom): ObjectivePromptDigest {
  return {
    conditionKind: 'interact-object',
    candidates: listInteractObjectiveCandidates(room),
  }
}

export function buildObjectivePromptMessages(room: LoadedRoom): ChatMessage[] {
  return [
    { role: 'system', content: OBJECTIVE_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(buildObjectivePromptDigest(room)) },
  ]
}
