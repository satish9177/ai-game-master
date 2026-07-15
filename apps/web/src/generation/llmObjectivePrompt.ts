import type { LoadedRoom } from '../domain/loadRoomSpec'
import { listInteractObjectiveCandidates } from '../domain/quests/objectiveCandidates'
import type { InteractObjectiveCandidate } from '../domain/quests/objectiveCandidates'
import type { ChatMessage } from './llmRoomPrompt'
import {
  meaningfulDiscoveryTextForObject,
  normalizeGeneratedDiscoveryText,
} from '../domain/objectPurpose/generatedMeaningfulConsequenceAttachment'
import { isEligibleObject, meaningfulObjectFamily } from '../domain/objectPurpose/meaningfulObjectRuntime'

export const MAX_MEANINGFUL_OBJECT_PROMPT_CANDIDATES = 8

export type ObjectivePromptDigest = {
  conditionKind: 'interact-object'
  candidates: InteractObjectiveCandidate[]
  roomLabel: string
  meaningfulObjectCandidates: MeaningfulObjectPromptCandidate[]
}

export type MeaningfulObjectPromptCandidate = {
  objectId: string
  type: 'book' | 'scroll' | 'paper' | 'map' | 'chest' | 'crate' | 'barrel' | 'corpse'
  action: 'read' | 'search'
  existingDiscoveryText?: string
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
  'You may additionally return "meaningfulConsequences": an array of zero to three objects.',
  'Each object is exactly { "objectId": string, "action": "read"|"search", "discoveryText"?: string, "progressCurrentObjective"?: true }.',
  'Use only ids and actions from meaningfulObjectCandidates. Omit uncertain proposals.',
  'discoveryText is plain story text <= 160 characters; never use markup, code, prompt headers, commands, effects, flags, events, facts, journal, memory, or arbitrary ids.',
  'Use progressCurrentObjective only for the same object selected by condition.objectId.',
].join('\n')

export function buildObjectivePromptDigest(room: LoadedRoom): ObjectivePromptDigest {
  return {
    conditionKind: 'interact-object',
    candidates: listInteractObjectiveCandidates(room),
    roomLabel: normalizeGeneratedDiscoveryText(room.name) ?? 'Generated room',
    meaningfulObjectCandidates: room.objects.flatMap((object) => {
      if (!isEligibleObject(object) || object.id === undefined) return []
      const family = meaningfulObjectFamily(object)
      const action = family === 'document' ? 'read' : family === 'container' || family === 'remains' ? 'search' : undefined
      if (action === undefined) return []
      const type = object.type
      if (!['book', 'scroll', 'paper', 'map', 'chest', 'crate', 'barrel', 'corpse'].includes(type)) return []
      const existingDiscoveryText = meaningfulDiscoveryTextForObject(object)
      return [{
        objectId: object.id,
        type,
        action,
        ...(existingDiscoveryText === null ? {} : { existingDiscoveryText }),
      } as MeaningfulObjectPromptCandidate]
    }).sort((left, right) => left.objectId.localeCompare(right.objectId) || left.action.localeCompare(right.action))
      .slice(0, MAX_MEANINGFUL_OBJECT_PROMPT_CANDIDATES),
  }
}

export function buildObjectivePromptMessages(room: LoadedRoom): ChatMessage[] {
  return [
    { role: 'system', content: OBJECTIVE_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify(buildObjectivePromptDigest(room)) },
  ]
}
