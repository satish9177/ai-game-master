import { LIVING_WORLD_PROOF_SCHEMA_VERSION } from './contracts'
import type { Belief } from './contracts'
import type { CanonicalClaim, ClaimRegistry, ValidExtent } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION } from './conflictContracts'
import { commitBelief, initConflictStore } from './conflictStore'
import { canonicalKeyOf, WORLD_STATE_PREDICATE } from './canonicalProposition'
import { currentBeliefForKey } from './beliefProjection'
import type { ReadableRecord } from './evidenceRecords'
import type { AdoptionCandidate, IntentionCommitContext } from './intentionStore'
import { commitAdoption, initIntentionStore } from './intentionStore'
import { INTENTION_RULE_VERSION, OBJECTIVE_METADATA_VERSION } from './intentionContracts'
import type { GoalOption, ObjectiveMetadata } from './intentionContracts'
import type { SettledStance } from './attributionDeception'
import { classifyDeception } from './attributionDeception'
import type { DeceptionClassification } from './attributionDeception'

/**
 * Phase 9: the deception-taxonomy sub-fixture (research vault ADR-0011
 * D12, spec §8 Phase 9). An isolated, deterministic sub-fixture -- speaker
 * NPC_A, listener NPC_D, synthetic proposition Prop_Q ("a wolf pack is
 * denning in the old mill") -- touching no narrative record. `settledStance`
 * is derived from NPC_A's own world-belief `currentBeliefForKey` projection
 * (never a holder-readable flag); `recordedIntention`, where present, rides
 * a REAL `IntentionCommitment` with an `induce-belief` objective (engine-
 * side, never listener-readable, D6/D12) -- not a hand-authored boolean.
 */

const NPC_A = 'NPC_A'
const NPC_D = 'NPC_D'

const PROP_Q_OBJECT = 'wolf_pack_at_mill'
const PROP_Q_KEY_ROLE = { object: PROP_Q_OBJECT }

function propQClaim(contestedValue: 'present' | 'absent', validity: ValidExtent): CanonicalClaim {
  return {
    predicate: WORLD_STATE_PREDICATE,
    fixedRoles: PROP_Q_KEY_ROLE,
    contestedRole: 'state',
    contestedValue,
    polarity: 'asserts',
    validity,
    canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
  }
}

function belief(id: string, contestedValue: 'present' | 'absent'): Belief {
  return {
    schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
    id,
    holder: NPC_A,
    proposition: `wolf pack is ${contestedValue === 'present' ? '' : 'not '}denning at the old mill`,
    confidence: 'medium',
    sourceType: 'inference',
    sourceRef: `O_${id}`,
    supporting: [`O_${id}`],
    contradicting: [],
    lastUpdated: 'night_20',
  }
}

const OPEN_VALIDITY: ValidExtent = { kind: 'interval', from: { night: 20, tick: 0 }, to: null }

export const beliefAffirmative = belief('Bel_A_wolfpack_present', 'present')
export const beliefRejecting = belief('Bel_A_wolfpack_absent', 'absent')

export const omInduceBelief: ObjectiveMetadata = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'OM_induce_belief',
  version: OBJECTIVE_METADATA_VERSION,
  objectiveType: 'induce-belief',
  minConfidence: 'low',
  allowUnresolved: true,
  priorityBasis: 'manipulation',
  priorityRank: 1,
  retryLimit: 0,
  reconsiderationPolicy: 'default',
}

const planBinding = { templateId: 'PT_none', templateVersion: 'pt_v0', params: {} }
const planTemplate = {
  schemaVersion: LIVING_WORLD_PROOF_SCHEMA_VERSION,
  id: 'PT_none',
  version: 'pt_v0',
  servesObjectiveType: 'induce-belief',
  contextAtomKind: 'induce-belief-eligible',
  steps: [],
}

export interface DeceptionCase {
  caseNumber: 1 | 2 | 3 | 4 | 5 | 6
  settledStance: SettledStance
  worldTruthMatches?: boolean
  recordedIntention: boolean
  expected: DeceptionClassification
}

function buildSettledStanceUniverseAndClaims(caseNumber: DeceptionCase['caseNumber']): { universe: ReadableRecord[]; claims: ClaimRegistry; supportBeliefId?: string } {
  if (caseNumber === 5) {
    return { universe: [], claims: new Map() }
  }
  if (caseNumber === 1 || caseNumber === 2) {
    return { universe: [{ kind: 'belief', record: beliefAffirmative }], claims: new Map([[beliefAffirmative.id, propQClaim('present', OPEN_VALIDITY)]]), supportBeliefId: beliefAffirmative.id }
  }
  if (caseNumber === 3 || caseNumber === 4) {
    return { universe: [{ kind: 'belief', record: beliefRejecting }], claims: new Map([[beliefRejecting.id, propQClaim('absent', OPEN_VALIDITY)]]), supportBeliefId: beliefRejecting.id }
  }
  // case 6: co-held, unresolved -- both current, no linking transition.
  return {
    universe: [
      { kind: 'belief', record: beliefAffirmative },
      { kind: 'belief', record: beliefRejecting },
    ],
    claims: new Map([
      [beliefAffirmative.id, propQClaim('present', OPEN_VALIDITY)],
      [beliefRejecting.id, propQClaim('absent', OPEN_VALIDITY)],
    ]),
    supportBeliefId: beliefAffirmative.id,
  }
}

/**
 * Derives `settledStance` the same way §8 Phase 9 specifies: NPC_A's own
 * `currentBeliefForKey` projection over Prop_Q's canonical key, at the
 * utterance's dispatch commit bound -- never a stored flag, never
 * listener-readable.
 */
export function deriveSettledStanceAndBuildCase(caseNumber: DeceptionCase['caseNumber'], recordedIntention: boolean): { settledStance: SettledStance; universe: readonly ReadableRecord[] } {
  const { universe, claims, supportBeliefId } = buildSettledStanceUniverseAndClaims(caseNumber)
  let conflict = initConflictStore(claims)
  for (const entry of universe) {
    if (entry.kind !== 'belief') continue
    const committed = commitBelief(conflict, universe, entry.record.id, { night: 20, tick: 0 })
    if (committed.outcome.verdict !== 'committed') {
      throw new Error(`attributionDeceptionScenario: expected ${entry.record.id} to commit -- fixture invariant broken`)
    }
    conflict = committed.store
  }

  const projection = currentBeliefForKey(NPC_A, canonicalKeyOf(propQClaim('present', OPEN_VALIDITY)), universe, conflict, { validT: { night: 20, tick: 0 }, txBound: conflict.nextSeq - 1 })

  const settledStance: SettledStance = projection.status === 'resolved' ? (projection.belief.id === beliefAffirmative.id ? 'affirmative' : 'rejecting') : 'none'

  if (recordedIntention && supportBeliefId !== undefined) {
    const atoms = new Map([[supportBeliefId, [{ kind: 'induce-belief-eligible', roles: {} }]]])
    const ctx: IntentionCommitContext = { conflict, universe, atoms, metadataById: new Map([[omInduceBelief.id, omInduceBelief]]), templates: [planTemplate] }
    const option: GoalOption = {
      holder: NPC_A,
      candidateObjective: { objectiveType: 'induce-belief', roles: { target: NPC_D }, canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION },
      derivedFromBeliefs: [supportBeliefId],
      sourceObjectiveMetadataId: omInduceBelief.id,
      sourceObjectiveMetadataVersion: OBJECTIVE_METADATA_VERSION,
      ruleId: 'derive_induce_belief_option',
      ruleVersion: INTENTION_RULE_VERSION,
      priorityBasis: 'manipulation',
      priorityRank: 1,
    }
    const candidate: AdoptionCandidate = { holder: NPC_A, option, planBinding, reconsiderationPolicy: 'default', effectiveValidTime: { night: 20, tick: 0 } }
    const adopted = commitAdoption(initIntentionStore(), candidate, ctx)
    if (adopted.outcome.verdict !== 'committed') {
      throw new Error(`attributionDeceptionScenario: expected induce-belief intention to commit for case ${caseNumber} -- ${adopted.outcome.fault}`)
    }
  }

  return { settledStance, universe }
}

/** The six §8 Phase 9 cases (P54/P100/P108) -- cases 5/6 exercise the two DISTINCT "no settled stance" sub-cases (`'none'` vs `'unresolved'`, P100), never sharing one construction. */
export const DECEPTION_CASES: readonly DeceptionCase[] = [
  { caseNumber: 1, settledStance: 'affirmative', recordedIntention: false, expected: 'sincere-assertion' },
  { caseNumber: 2, settledStance: 'affirmative', worldTruthMatches: false, recordedIntention: false, expected: 'honest-mistake' },
  { caseNumber: 3, settledStance: 'rejecting', recordedIntention: false, expected: 'counter-belief-assertion' },
  { caseNumber: 4, settledStance: 'rejecting', recordedIntention: true, expected: 'deceptive-lie' },
  { caseNumber: 5, settledStance: 'none', recordedIntention: false, expected: 'non-committal-assertion' },
  { caseNumber: 6, settledStance: 'none', recordedIntention: true, expected: 'deceptive-non-committal-assertion' },
]

export function runDeceptionCase(deceptionCase: DeceptionCase): DeceptionClassification {
  return classifyDeception({
    settledStance: deceptionCase.settledStance,
    worldTruthMatches: deceptionCase.worldTruthMatches,
    recordedIntention: deceptionCase.recordedIntention ? 'induce-belief' : undefined,
  })
}
