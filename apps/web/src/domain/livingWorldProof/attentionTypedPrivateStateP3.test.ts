import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  privateBelief,
  privateIntentionCommitment,
  unobservedTruthEvent,
} from './attentionPrivateStateScenario'
import { readAttentionReadableQuestCandidateViews } from './attentionQuestCandidateAccessor'
import { constructAttentionReadableSurface } from './attentionReadableBoundary'

describe('C8 typed private-state P3 families', () => {
  const belief = privateBelief({ holderId: 'npc-a', proposition: 'the bridge is unsafe', confidence: 8 })
  const intention = privateIntentionCommitment({ holderId: 'npc-b', goal: 'protect the bridge', commitmentState: 'formed' })
  const truth = unobservedTruthEvent({ eventKind: 'bridge-collapse', participantIds: ['npc-a', 'npc-b'], observationRecord: null })

  it('keeps belief, intention, and unobserved truth structurally distinct and frozen', () => {
    expect([belief.kind, intention.kind, truth.kind]).toEqual([
      'proof_private_belief', 'proof_private_intention_commitment', 'proof_unobserved_truth_event',
    ])
    expect(Object.isFrozen(belief)).toBe(true)
    expect(Object.isFrozen(intention)).toBe(true)
    expect(Object.isFrozen(truth)).toBe(true)
    expect(Object.isFrozen(truth.participantIds)).toBe(true)
    expect(canonicalSerialize(truth)).not.toContain('visibility')
    expect(truth.observationRecord).toBeNull()
  })

  it('is rejected at both public attention input types at compile time', () => {
    const typeCheckOnly = (): boolean => false
    if (typeCheckOnly()) {
      // @ts-expect-error a private belief is not a proof quest snapshot.
      readAttentionReadableQuestCandidateViews(belief, { accessorContractVersion: 'attention-quest-candidate-accessor-v1', rankingSnapshotLsn: 1 })
      // @ts-expect-error a private intention is not an attention-readable quest view.
      constructAttentionReadableSurface({ surfaceSchemaVersion: 'attention-readable-surface-schema-v2', accessorContractVersion: 'attention-quest-candidate-accessor-v1', rankingSnapshotLsn: 1 }, [intention], [], [])
      // @ts-expect-error unobserved truth cannot be a pattern-evidence view.
      constructAttentionReadableSurface({ surfaceSchemaVersion: 'attention-readable-surface-schema-v2', accessorContractVersion: 'attention-quest-candidate-accessor-v1', rankingSnapshotLsn: 1 }, [], [], [truth])
    }
    expect(true).toBe(true)
  })
})
