import type { Evidence, NpcPosition, RumorTransmission, SceneEvent, Topology } from './contracts'

/**
 * The deterministic cellar scenario from the research vault's Observation
 * Scope Contract v0 and Truth-Belief-Rumor + Belief-Update Calculus v0
 * specs, reproduced as fixture data. Two events, four observers, an
 * A -> B -> C rumor chain that sharpens specificity without raising
 * confidence, and a hard-evidence correction. Shared by every test file in
 * this folder so the whole pipeline is exercised against one fixed seed.
 */

export const topology: Topology = {
  nodes: ['cellar', 'corridor', 'upstairs_room', 'tavern'],
  edges: [
    { a: 'corridor', b: 'cellar', sight: 'doorway_only', sound: 'clear' },
    { a: 'upstairs_room', b: 'cellar', sight: 'blocked', sound: 'muffled' },
    { a: 'tavern', b: 'cellar', sight: 'blocked', sound: 'blocked' },
  ],
}

export const positions: NpcPosition[] = [
  { npc: 'NPC_A', node: 'corridor' },
  { npc: 'NPC_B', node: 'tavern' },
  { npc: 'NPC_C', node: 'upstairs_room' },
  { npc: 'NPC_D', node: 'cellar' },
]

export const events: SceneEvent[] = [
  {
    schemaVersion: 1,
    id: 'T0',
    actor: 'player',
    action: 'entered',
    target: 'cellar',
    location: { node: 'cellar', area: 'doorway' },
    time: 'night_3',
    emissions: [{ channel: 'sight', exposes: ['actor', 'action', 'target', 'location'] }],
  },
  {
    schemaVersion: 1,
    id: 'T1',
    actor: 'zombie_17',
    action: 'attacked',
    target: 'guard_malik',
    location: { node: 'cellar', area: 'interior' },
    time: 'night_3',
    emissions: [
      { channel: 'sight', exposes: ['actor', 'action', 'target', 'location'] },
      { channel: 'sound', signature: 'scream', loudness: 'loud', exposes: ['sound_signature', 'direction'] },
    ],
  },
]

export const rumorAToB: RumorTransmission = {
  schemaVersion: 1,
  id: 'R_A_to_B',
  from: 'NPC_A',
  to: 'NPC_B',
  proposition: 'the player was involved in what happened to guard_malik',
  sourceBelief: 'Bel_A1',
  mutation: 'dropped_hedge',
  speakerTrust: 'medium',
  time: 'night_3',
}

export const rumorBToC: RumorTransmission = {
  schemaVersion: 1,
  id: 'R_B_to_C',
  from: 'NPC_B',
  to: 'NPC_C',
  proposition: 'the player attacked guard_malik',
  sourceBelief: 'Bel_B1',
  mutation: 'dropped_hedge',
  speakerTrust: 'medium',
  time: 'night_4',
}

export const clawEvidence: Evidence = {
  schemaVersion: 1,
  id: 'E_claw',
  truthRef: 'T1',
  implies: 'zombie_17 attacked guard_malik',
  contradicts: 'the player attacked guard_malik',
  strength: 'hard',
  presentedTo: 'NPC_C',
  time: 'night_4',
}
