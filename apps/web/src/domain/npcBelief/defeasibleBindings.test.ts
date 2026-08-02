import { describe, expect, it } from 'vitest'
import {
  DEFEASIBLE_NPC_ACTION_BINDINGS,
  defeasibleNpcActionBindingFor,
  evidenceArtifactFor,
  type DefeasibleNpcActionBinding,
} from './defeasibleBindings'

const binding: DefeasibleNpcActionBinding = {
  roomId: 'fixture-room',
  npcId: 'fixture-npc',
  targetObjectId: 'gated-exit',
  triggerItemId: 'fixture-item',
  containerId: 'fixture-container',
  attentionObjectIds: ['fixture-container'],
  minConfidence: 'low',
  evidenceArtifacts: [{
    evidenceId: 'fixture-evidence',
    roomId: 'fixture-room',
    sourceObjectId: 'source-object',
    strength: 'hard',
    exposes: ['alternate-access-exists'],
    class: 'undercutting',
    defeats: {
      ruleId: 'sole-copresent-candidate@1',
      premiseId: 'p4-no-alternate-access',
    },
    reachability: {
      prerequisiteObjectIds: [],
      presentation: { objectId: 'presentation-object', toNpcId: 'fixture-npc' },
    },
  }],
}

describe('defeasible binding catalog', () => {
  it('FB-S3-01 keeps the production binding catalog empty', () => {
    expect(DEFEASIBLE_NPC_ACTION_BINDINGS).toEqual([])
    expect(defeasibleNpcActionBindingFor('fixture-room')).toBeUndefined()
  })

  it('FB-S3-02 looks up supplied authored artifacts deterministically', () => {
    expect(evidenceArtifactFor(binding, 'fixture-evidence'))
      .toBe(binding.evidenceArtifacts[0])
    expect(evidenceArtifactFor(binding, 'missing')).toBeUndefined()
  })
})
