import { clawMarkEvidence } from './beliefSliceFixture'

/**
 * Belief-Driven NPC Dialogue Slice v0 -- the fixed player script
 * (experiment §2, plan §3 S1.4). Talk to NPC_A, then NPC_B, then NPC_C,
 * in that order; present the claw mark to NPC_C only. The order and the
 * evidence target are part of the experimental setup and must not vary
 * between arms or runs: every arm consumes this exact sequence.
 */

export type PlayerScriptStep =
  | { readonly kind: 'talk'; readonly npcId: string; readonly playerLine: string }
  | { readonly kind: 'showEvidence'; readonly npcId: string; readonly evidenceId: string; readonly playerLine: string }

export const THREE_NPC_PLAYER_SCRIPT: readonly PlayerScriptStep[] = [
  {
    kind: 'talk',
    npcId: 'NPC_A',
    playerLine: 'You were near the cellar last night -- what did you see?',
  },
  {
    kind: 'talk',
    npcId: 'NPC_B',
    playerLine: 'Something about the guard? What did you hear?',
  },
  {
    kind: 'talk',
    npcId: 'NPC_C',
    playerLine: 'People are blaming me. What have you heard?',
  },
  {
    kind: 'showEvidence',
    npcId: 'NPC_C',
    evidenceId: clawMarkEvidence.id,
    playerLine: 'Look at this claw mark from the cellar door.',
  },
]
