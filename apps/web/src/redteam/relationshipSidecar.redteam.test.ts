import { describe, expect, it } from 'vitest'
import {
  INITIAL_RELATIONSHIP_FEEDBACK_STATE,
  relationshipFeedbackAfterReduction,
  relationshipFeedbackOnRoomEntry,
  restoreNpcRelationshipsFromSlot,
} from '../app/App.helpers'
import { deriveAndReduceRelationship } from '../app/deriveAndReduceRelationship'
import { RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE } from '../app/relationshipFeedback'
import { NPC_RELATIONSHIP_SCHEMA_VERSION, type NpcRelationshipState } from '../domain/npcRelationship/contracts'
import { familiarityBucket, projectRelationshipDialogueContext } from '../domain/npcRelationship/dialogueContext'
import { neutralRelationship } from '../domain/npcRelationship/neutral'
import { buildNpcRelationshipSaveJson } from '../domain/npcRelationship/relationshipSaveState'
import {
  STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
  type StructuredDialogueEffect,
} from '../domain/structuredDialogueEffects/contracts'
import { buildDialoguePromptMessages } from '../generation/llmDialoguePrompt'
import { REDTEAM_NPC_ID, REDTEAM_ROOM_ID, REDTEAM_SESSION_ID, REDTEAM_WORLD_ID, dialogueRequest, markers } from './fixtures'

/**
 * Redteam coverage for the npc-relationship-persistence-v0 sidecar (ADR-0081,
 * Slice 5). Mirrors `memorySidecar.redteam.test.ts`'s shape for the sibling
 * room-memory sidecar: attacks the restore path with poisoned/mixed-scope
 * input and proves the safety properties the ADR requires -- strict
 * whole-record drop of any attempt to smuggle free text, cross-world/session
 * scope isolation, silent hydration, and bucket-only prompt projection.
 */

const scope = { worldId: REDTEAM_WORLD_ID, sessionId: REDTEAM_SESSION_ID }

describe('redteam npcRelationshipJson sidecar restore', () => {
  it('drops a record whole when attacker-supplied extra fields try to smuggle dialogue/prompt/provider/feedback text', () => {
    const good = neutralRelationship({ ...scope, npcId: 'good-npc' })
    const poisoned = {
      ...neutralRelationship({ ...scope, npcId: 'poisoned-npc' }),
      dialogueText: markers.playerText,
      promptText: markers.userPrompt,
      providerOutput: markers.providerBody,
      feedbackText: `${RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE} leak attempt`,
      bucket: 'high',
      reason: markers.memoryText,
    }
    const json = JSON.stringify({ schemaVersion: 1, records: [good, poisoned] })

    const restored = restoreNpcRelationshipsFromSlot({ npcRelationshipJson: json, scope })

    expect(restored.records.map((record) => record.scope.npcId)).toEqual(['good-npc'])
    const serialized = JSON.stringify(restored)
    expect(serialized).not.toContain(markers.playerText)
    expect(serialized).not.toContain(markers.userPrompt)
    expect(serialized).not.toContain(markers.providerBody)
    expect(serialized).not.toContain(markers.memoryText)
    expect(serialized).not.toContain(RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE)
  })

  it('drops sidecar records from a different world/session when loading a different world/session, and an all-dropped restore stays crash-safe', () => {
    const scopeA = { worldId: 'redteam-world-a', sessionId: 'redteam-session-a' }
    const scopeB = { worldId: 'redteam-world-b', sessionId: 'redteam-session-b' }
    const recordA = neutralRelationship({ ...scopeA, npcId: 'npc-a' })
    const recordB = neutralRelationship({ ...scopeB, npcId: 'npc-b' })
    const mixedJson = JSON.stringify({ schemaVersion: 1, records: [recordA, recordB] })

    const restoredForB = restoreNpcRelationshipsFromSlot({ npcRelationshipJson: mixedJson, scope: scopeB })
    expect(restoredForB.records.map((record) => record.scope.npcId)).toEqual(['npc-b'])
    expect(restoredForB.diagnostics.droppedByScope).toBe(1)

    const restoredForNeither = restoreNpcRelationshipsFromSlot({
      npcRelationshipJson: mixedJson,
      scope: { worldId: 'redteam-world-c', sessionId: 'redteam-session-c' },
    })
    expect(restoredForNeither.records).toEqual([])
    expect(restoredForNeither.diagnostics.status).toBe('restored')
    expect(restoredForNeither.diagnostics.droppedByScope).toBe(2)
  })

  it('hydration is silent, but the first post-load reducer tick still produces normal feedback', () => {
    const restoredRecord: NpcRelationshipState = {
      schemaVersion: NPC_RELATIONSHIP_SCHEMA_VERSION,
      scope: { ...scope, npcId: REDTEAM_NPC_ID },
      subject: 'npc',
      object: 'player',
      axes: { trust: 0, respect: 0, fear: 0, familiarity: 0 },
      interactionCount: 1,
    }
    const json = buildNpcRelationshipSaveJson([restoredRecord], scope)!

    // Mirrors App.tsx handleLoad ordering: the feedback slot is reset at load
    // start, then the sidecar is restored directly into the ref -- never
    // through the reducer or feedback deriver.
    let feedbackState = relationshipFeedbackOnRoomEntry(INITIAL_RELATIONSHIP_FEEDBACK_STATE)
    const restored = restoreNpcRelationshipsFromSlot({ npcRelationshipJson: json, scope })
    const relationshipsRef = new Map<string, NpcRelationshipState>()
    for (const record of restored.records) relationshipsRef.set(record.scope.npcId, record)

    expect(feedbackState).toEqual(INITIAL_RELATIONSHIP_FEEDBACK_STATE)
    expect(relationshipsRef.size).toBe(1)

    // First post-load real reducer movement: the same neutral candidate effect
    // used elsewhere to prove a familiarity bucket crossing.
    const prior = relationshipsRef.get(REDTEAM_NPC_ID)!
    const prevBucket = familiarityBucket(prior.axes.familiarity)
    const effect: StructuredDialogueEffect = {
      schemaVersion: STRUCTURED_DIALOGUE_EFFECT_SCHEMA_VERSION,
      effectId: 'redteam-relationship-effect-0',
      kind: 'player_question_effect_candidate',
      sourceEventId: 'redteam-relationship-event-0',
      sourceKind: 'player_asked_question',
      status: 'candidate',
      actor: 'player',
      target: 'npc',
      scope: { ...scope, roomId: REDTEAM_ROOM_ID, npcId: REDTEAM_NPC_ID },
      provenance: { classifier: 'deterministic-local' },
      confidence: 'medium',
    }
    const result = deriveAndReduceRelationship({
      effects: [effect],
      prior,
      ctx: { ...scope, npcId: REDTEAM_NPC_ID },
      logger: { info: () => {} },
    })
    const nextBucket = familiarityBucket(result.state.axes.familiarity)
    expect(prevBucket).toBe('none')
    expect(nextBucket).toBe('low') // guard against a vacuous pass

    feedbackState = relationshipFeedbackAfterReduction(feedbackState, { prevBucket, nextBucket })
    expect(feedbackState.message).toBe(RELATIONSHIP_FAMILIARITY_INCREASED_MESSAGE)
  })

  it('a restored high-familiarity record projects into the prompt as bucket text only, never the raw axis score', () => {
    const restoredRecord: NpcRelationshipState = {
      schemaVersion: NPC_RELATIONSHIP_SCHEMA_VERSION,
      scope: { ...scope, npcId: REDTEAM_NPC_ID },
      subject: 'npc',
      object: 'player',
      axes: { trust: 0, respect: 0, fear: 0, familiarity: 95 },
      interactionCount: 40,
    }
    const json = buildNpcRelationshipSaveJson([restoredRecord], scope)!
    const restored = restoreNpcRelationshipsFromSlot({ npcRelationshipJson: json, scope })
    const relationshipsRef = new Map<string, NpcRelationshipState>()
    for (const record of restored.records) relationshipsRef.set(record.scope.npcId, record)

    const relationshipContext = projectRelationshipDialogueContext(relationshipsRef.get(REDTEAM_NPC_ID))
    expect(relationshipContext.familiarityBucket).toBe('high')

    const content = buildDialoguePromptMessages(dialogueRequest({
      context: { ...dialogueRequest().context, relationship: relationshipContext },
    }))[1]!.content

    expect(content).toContain('familiarity: high')
    expect(content).not.toContain('95')
    expect(content).not.toContain('interactionCount')
  })
})
