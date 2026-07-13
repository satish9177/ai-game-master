import type { Belief, Observation } from './contracts'
import type { CanonicalClaim, ClaimRegistry, ValidExtent, WorldInstant } from './conflictContracts'
import { initConflictStore, mintEdge } from './conflictStore'
import type { ConflictStore, MintEdgeOutcome } from './conflictStore'
import { currentBeliefs } from './beliefProjection'
import type { ReadableRecord } from './evidenceRecords'
import type { AttributedStance, WorldProposition } from './attributionContracts'
import { innerCanonicalKeyOf } from './attributionBuilder'
import { ascribeFromAssertion, ascribeUnawareFromIgnoranceExpression } from './attributionRules'
import type { AscriptionOutcome } from './attributionRules'
import { understandDefault } from './attributionUnderstanding'
import { commitAscriptionSupersession, commitFirstMint, initAttributionStore } from './attributionStore'
import type { AttributionStore } from './attributionStore'
import { CORA, DAREN, propW1, trustRegistry } from './attributionScenario'

/**
 * Phase 8: the six-pair conflict-topology sub-fixture (research vault
 * ADR-0011 D5, spec §8 Phase 8/§10). Each pair, each sub-case, is its own
 * isolated store instance (§2.4) -- never sharing a commit log with the
 * main narrative or with any other sub-case. Pairs 2-6 use isolated
 * proof-local synthetic propositions (`Prop_synth1..5`); pair 1 reuses the
 * main narrative's `propW1`. Every `unaware`-stance endpoint is minted only
 * through the `express-ignorance` typed-act path (P98), never by direct
 * record construction.
 */

const BORIN = 'NPC_B'

export const propSynth: readonly WorldProposition[] = [1, 2, 3, 4, 5].map((n) => ({
  kind: 'world',
  subject: 'hidden_tunnel',
  predicate: 'exists-beneath',
  object: `gatehouse_${n}`,
  at: nightTick2(n),
}))

function nightTick2(n: number): WorldInstant {
  return { night: 10 + n, tick: 0 }
}

function propositionFor(pairIndex: number): WorldProposition {
  if (pairIndex === 0) return propW1
  const proposition = propSynth[pairIndex - 1]
  if (proposition === undefined) throw new Error(`attributionConflictScenario: no synthetic proposition for pair index ${pairIndex}`)
  return proposition
}

export const SIX_PAIRS: readonly [AttributedStance, AttributedStance][] = [
  ['believes', 'disbelieves'],
  ['believes', 'uncertain'],
  ['believes', 'unaware'],
  ['disbelieves', 'uncertain'],
  ['disbelieves', 'unaware'],
  ['uncertain', 'unaware'],
]

function pairFor(pairIndex: number): [AttributedStance, AttributedStance] {
  const pair = SIX_PAIRS[pairIndex]
  if (pair === undefined) throw new Error(`attributionConflictScenario: no such pair index ${pairIndex}`)
  return pair
}

function ignoranceObservation(id: string, proposition: WorldProposition): Observation {
  return {
    schemaVersion: 1,
    id,
    observer: CORA,
    truthRef: `TE_ignorance_${id}`,
    channels: ['sight', 'sound'],
    perceived: { speaker: BORIN, act: 'express-ignorance', propositionKey: innerCanonicalKeyOf(proposition) },
    missing: [],
    fidelity: 'full',
    time: 'night_10',
  }
}

/** Mints one endpoint belief for a pair sub-case: `believes`/`disbelieves`/`uncertain` via ascribe_from_assertion (trust-capped to `medium`, then hand-adjusted stance below); `unaware` via the ONLY mintable path, express-ignorance (P98). */
function mintEndpoint(
  beliefId: string,
  stance: AttributedStance,
  proposition: WorldProposition,
  validity: ValidExtent,
): { belief: Belief; claim: CanonicalClaim } {
  if (stance === 'unaware') {
    const observation = ignoranceObservation(`O_${beliefId}_ignorance`, proposition)
    const understanding = understandDefault(CORA, observation)
    const outcome = ascribeUnawareFromIgnoranceExpression({ beliefId, holder: CORA, modeledHolder: BORIN, proposition, understanding, time: 'night_10', validity })
    return requireMint(outcome)
  }

  const observation: Observation = {
    schemaVersion: 1,
    id: `O_${beliefId}_assert`,
    observer: CORA,
    truthRef: `TE_${beliefId}_assert`,
    channels: ['sight', 'sound'],
    perceived: { speaker: BORIN, act: 'assert', propositionKey: innerCanonicalKeyOf(proposition) },
    missing: [],
    fidelity: 'full',
    time: 'night_10',
  }
  const understanding = understandDefault(CORA, observation)
  const outcome = ascribeFromAssertion({ beliefId, holder: CORA, modeledHolder: BORIN, proposition, understanding, trust: trustRegistry, speaker: BORIN, validity, time: 'night_10' })
  const mint = requireMint(outcome)
  // ascribe_from_assertion always mints `believes` -- hand-adjust the claim's
  // contested value for disbelieves/uncertain synthetic endpoints (the
  // belief's own descriptive string is relabeled to match; this sub-fixture
  // exists solely to exercise Layer A/B/C, never a distinct ascription rule
  // per non-believes stance).
  if (stance === 'believes') {
    return mint
  }
  const adjustedClaim: CanonicalClaim = { ...mint.claim, contestedValue: stance }
  const adjustedBelief = { ...mint.belief, proposition: `${BORIN} ${stance}: synthetic proposition` }
  return { belief: adjustedBelief, claim: adjustedClaim }
}

function requireMint(outcome: AscriptionOutcome): { belief: NonNullable<Extract<AscriptionOutcome, { verdict: 'mint' }>['belief']>; claim: CanonicalClaim } {
  if (outcome.verdict !== 'mint' || outcome.claim === undefined) {
    throw new Error(`attributionConflictScenario: expected a claim-bearing mint, got ${outcome.verdict}`)
  }
  return { belief: outcome.belief, claim: outcome.claim }
}

export type PairSubcase = 'overlapping' | 'disjoint-unlinked' | 'explicit-transition'

export interface PairSubcaseResult {
  store: AttributionStore
  beliefAId: string
  beliefBId: string
  universe: readonly ReadableRecord[]
  mintOutcome?: MintEdgeOutcome
}

/**
 * Builds one pair/sub-case as its own fresh, isolated store (§2.4). Sub-case
 * 1 (overlapping): both endpoints open-ended and current -- Layer B's
 * `currentBeliefs(...).unresolved` discovers the pair, and the mint driver
 * (this function) proposes exactly that discovered pair to `mintEdge`
 * (never a hand-picked pair, P105). Sub-case 2 (disjoint, unlinked): authored
 * non-overlapping closed intervals, no linking transition -- no edge.
 * Sub-case 3 (explicit transition): the second endpoint supersedes the
 * first via `commitAscriptionSupersession` -- Layer C then excludes the
 * predecessor from the current projection before any pairing occurs.
 */
export function buildPairSubcase(pairIndex: number, subcase: PairSubcase): PairSubcaseResult {
  const [stanceA, stanceB] = pairFor(pairIndex)
  const proposition = propositionFor(pairIndex)
  const beliefAId = `Bel_pair${pairIndex}_${subcase}_A`
  const beliefBId = `Bel_pair${pairIndex}_${subcase}_B`

  const validityA: ValidExtent =
    subcase === 'disjoint-unlinked' ? { kind: 'interval', from: { night: 20, tick: 0 }, to: { night: 20, tick: 5 } } : { kind: 'interval', from: { night: 20, tick: 0 }, to: null }
  const validityB: ValidExtent =
    subcase === 'disjoint-unlinked' ? { kind: 'interval', from: { night: 20, tick: 5 }, to: null } : { kind: 'interval', from: { night: 20, tick: 0 }, to: null }

  // Endpoint B is always precomputed (even for the explicit-transition
  // sub-case) BEFORE the store is initialized: `commitRevision`'s
  // destination must already resolve as an immutable Belief record in the
  // universe (design plan I3/I4) -- a ConflictStore's ClaimRegistry is
  // likewise fixed at init, so both endpoints' claims must be known upfront.
  const mintA = mintEndpoint(beliefAId, stanceA, proposition, validityA)
  const mintB = mintEndpoint(beliefBId, stanceB, proposition, validityB)

  const claims: ClaimRegistry = new Map<string, CanonicalClaim>([
    [beliefAId, mintA.claim],
    [beliefBId, mintB.claim],
  ])

  const conflict: ConflictStore = initConflictStore(claims)
  const universe: ReadableRecord[] = [
    { kind: 'belief', record: mintA.belief },
    { kind: 'belief', record: mintB.belief },
  ]

  let store: AttributionStore = { conflict, sidecars: new Map() }
  const committedA = commitFirstMint(store, universe, beliefAId, { night: 20, tick: 0 })
  if (committedA.outcome.verdict !== 'committed') throw new Error('attributionConflictScenario: endpoint A failed to commit')
  store = committedA.store

  if (subcase === 'explicit-transition') {
    const superseded = commitAscriptionSupersession(store, universe, {
      transitionId: `BT_pair${pairIndex}_transition`,
      holder: CORA,
      fromBeliefId: beliefAId,
      toBeliefId: beliefBId,
      effectiveValidTime: { night: 20, tick: 1 },
      validFrom: { night: 20, tick: 1 },
      cause: 'superseded-by-update',
      ruleId: 'synthetic_pair_supersession',
      ruleVersion: 'aab_v0',
      inputRecordIds: [],
    })
    if (superseded.outcome.verdict !== 'committed') throw new Error('attributionConflictScenario: endpoint B supersession failed to commit')
    return { store: superseded.store, beliefAId, beliefBId, universe }
  }

  const committedB = commitFirstMint(store, universe, beliefBId, subcase === 'disjoint-unlinked' ? { night: 20, tick: 5 } : { night: 20, tick: 0 })
  if (committedB.outcome.verdict !== 'committed') throw new Error('attributionConflictScenario: endpoint B failed to commit')
  store = committedB.store

  let mintOutcome: MintEdgeOutcome | undefined
  if (subcase === 'overlapping') {
    // The legitimate mint driver: source the candidate pair from Layer B's
    // own `currentBeliefs(...).unresolved` list -- never a hand-picked pair
    // (P105).
    const projection = currentBeliefs(CORA, universe, store.conflict, { validT: { night: 20, tick: 0 }, txBound: store.conflict.nextSeq - 1 })
    const pair = projection.unresolved.find((candidate) => candidate.beliefIds.includes(beliefAId) && candidate.beliefIds.includes(beliefBId))
    if (pair === undefined) {
      throw new Error('attributionConflictScenario: expected Layer B to discover the overlapping pair -- fixture invariant broken')
    }
    const minted = mintEdge(store.conflict, pair.beliefIds[0], pair.beliefIds[1])
    store = { conflict: minted.store, sidecars: store.sidecars }
    mintOutcome = minted.outcome
  }

  return { store, beliefAId, beliefBId, universe, mintOutcome }
}

// ---- Case A: same ascriber, different modeled holder (Layer-A key separation) --

export interface CaseAResult {
  store: AttributionStore
  universe: readonly ReadableRecord[]
  beliefBorinId: string
  beliefDarenId: string
}

export function buildCaseA(): CaseAResult {
  const propSynthDaren: WorldProposition = { kind: 'world', subject: 'hidden_tunnel', predicate: 'exists-beneath', object: 'gatehouse_daren', at: { night: 30, tick: 0 } }

  const obsBorin: Observation = { schemaVersion: 1, id: 'O_caseA_borin', observer: CORA, truthRef: 'TE_caseA_borin', channels: ['sight', 'sound'], perceived: { speaker: BORIN, act: 'assert', propositionKey: innerCanonicalKeyOf(propW1) }, missing: [], fidelity: 'full', time: 'night_30' }
  const obsDaren: Observation = { schemaVersion: 1, id: 'O_caseA_daren', observer: CORA, truthRef: 'TE_caseA_daren', channels: ['sight', 'sound'], perceived: { speaker: DAREN, act: 'assert', propositionKey: innerCanonicalKeyOf(propSynthDaren) }, missing: [], fidelity: 'full', time: 'night_30' }

  const mintBorin = requireMint(ascribeFromAssertion({ beliefId: 'Bel_CoraAtt_caseA_Borin', holder: CORA, modeledHolder: BORIN, proposition: propW1, understanding: understandDefault(CORA, obsBorin), trust: trustRegistry, speaker: BORIN, validity: { kind: 'interval', from: { night: 30, tick: 0 }, to: null }, time: 'night_30' }))
  const mintDaren = requireMint(ascribeFromAssertion({ beliefId: 'Bel_CoraAtt_caseA_Daren', holder: CORA, modeledHolder: DAREN, proposition: propSynthDaren, understanding: understandDefault(CORA, obsDaren), trust: trustRegistry, speaker: DAREN, validity: { kind: 'interval', from: { night: 30, tick: 0 }, to: null }, time: 'night_30' }))

  const claims: ClaimRegistry = new Map([
    [mintBorin.belief.id, mintBorin.claim],
    [mintDaren.belief.id, mintDaren.claim],
  ])
  const universe: ReadableRecord[] = [{ kind: 'belief', record: mintBorin.belief }, { kind: 'belief', record: mintDaren.belief }]
  let store: AttributionStore = { conflict: initConflictStore(claims), sidecars: new Map() }

  const c1 = commitFirstMint(store, universe, mintBorin.belief.id, { night: 30, tick: 0 })
  if (c1.outcome.verdict !== 'committed') throw new Error('attributionConflictScenario: Case A endpoint Borin failed to commit')
  store = c1.store
  const c2 = commitFirstMint(store, universe, mintDaren.belief.id, { night: 30, tick: 0 })
  if (c2.outcome.verdict !== 'committed') throw new Error('attributionConflictScenario: Case A endpoint Daren failed to commit')
  store = c2.store

  return { store, universe, beliefBorinId: mintBorin.belief.id, beliefDarenId: mintDaren.belief.id }
}

export { initAttributionStore }
