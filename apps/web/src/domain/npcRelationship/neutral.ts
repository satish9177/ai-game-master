import { NPC_RELATIONSHIP_SCHEMA_VERSION, type NpcRelationshipScope, type NpcRelationshipState } from './contracts'

/**
 * Baseline relationship for an NPC not yet reduced from any effect.
 * Callers supply this as `prior` the first time a given (worldId, sessionId,
 * npcId) triple is reduced.
 */
export function neutralRelationship(scope: NpcRelationshipScope): NpcRelationshipState {
  return {
    schemaVersion: NPC_RELATIONSHIP_SCHEMA_VERSION,
    scope,
    subject: 'npc',
    object: 'player',
    axes: {
      trust: 0,
      respect: 0,
      fear: 0,
      familiarity: 0,
    },
    interactionCount: 0,
  }
}
