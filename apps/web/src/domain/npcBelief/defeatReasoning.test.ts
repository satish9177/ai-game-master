import { describe, expect, it } from 'vitest'
import type { EvidenceArtifact } from './defeasibleBindings'
import { evaluateDefeat } from './defeatReasoning'
import type { NpcBeliefWarrant } from './beliefVersions'

const warrant: NpcBeliefWarrant = {
  ruleId: 'sole-copresent-candidate@1',
  premises: [
    {
      id: 'p1-before', kind: 'observed', observationEventIds: ['before'], defeasible: false,
    },
    {
      id: 'p4-no-alternate-access', kind: 'default', observationEventIds: [], defeasible: true,
    },
  ],
  defeasiblePremiseIds: ['p4-no-alternate-access'],
}

function undercutter(
  premiseId: 'p1-before' | 'p2-after' | 'p4-no-alternate-access',
  ruleId: 'sole-copresent-candidate@1' | 'direct-witness@1' = 'sole-copresent-candidate@1',
): EvidenceArtifact {
  return {
    evidenceId: 'fixture-undercutter',
    roomId: 'fixture-room',
    sourceObjectId: 'source-object',
    strength: 'hard',
    exposes: ['alternate-access-exists'],
    class: 'undercutting',
    defeats: { ruleId, premiseId },
    reachability: {
      prerequisiteObjectIds: [],
      presentation: { objectId: 'presentation-object', toNpcId: 'fixture-npc' },
    },
  }
}

describe('evaluateDefeat', () => {
  it('FB-S3-15 returns no-belief without a supplied warrant', () => {
    expect(evaluateDefeat({ warrant: null, artifact: undercutter('p4-no-alternate-access') }))
      .toEqual({ status: 'unchanged', reason: 'no-belief' })
  })

  it('FB-S3-16 leaves a belief unchanged for an inert artifact', () => {
    const artifact: EvidenceArtifact = {
      evidenceId: 'inert', roomId: 'fixture-room', sourceObjectId: 'source',
      strength: 'soft', exposes: [], class: 'inert', defeats: null,
    }
    expect(evaluateDefeat({ warrant, artifact })).toEqual({
      status: 'unchanged', reason: 'no-defeater',
    })
  })

  it('FB-S3-17 leaves unknown rules and premises unchanged', () => {
    expect(evaluateDefeat({
      warrant,
      artifact: undercutter('p4-no-alternate-access', 'direct-witness@1'),
    })).toEqual({ status: 'unchanged', reason: 'defeater-targets-unknown-premise' })
    expect(evaluateDefeat({ warrant, artifact: undercutter('p2-after') })).toEqual({
      status: 'unchanged', reason: 'defeater-targets-unknown-premise',
    })
  })

  it('FB-S3-18 N4 refuses an undercutter aimed at an indefeasible premise', () => {
    expect(evaluateDefeat({ warrant, artifact: undercutter('p1-before') })).toEqual({
      status: 'unchanged', reason: 'defeater-targets-indefeasible-premise',
    })
  })

  it('FB-S3-19 retracts on a valid p4 undercut without inventing a successor', () => {
    expect(evaluateDefeat({ warrant, artifact: undercutter('p4-no-alternate-access') })).toEqual({
      status: 'retracted',
      defeatedPremiseId: 'p4-no-alternate-access',
      evidenceId: 'fixture-undercutter',
      ruleId: 'sole-copresent-candidate@1',
    })
  })

  it('FB-S3-20 RB1 replaces, rather than retracts, for a rebutting fixture', () => {
    const artifact: EvidenceArtifact = {
      evidenceId: 'fixture-rebuttal', roomId: 'fixture-room', sourceObjectId: 'source',
      strength: 'hard', exposes: ['porter-took-item'], class: 'rebutting',
      rebuts: 'porter-took-item',
    }
    expect(evaluateDefeat({ warrant, artifact })).toEqual({
      status: 'replaced',
      evidenceId: 'fixture-rebuttal',
      successorPredicate: 'porter-took-item',
    })
  })
})
