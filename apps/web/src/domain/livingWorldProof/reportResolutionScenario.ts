import { canonicalKeyOf } from './canonicalProposition'
import { innerCanonicalKeyOf } from './attributionBuilder'
import type { WorldProposition } from './attributionContracts'
import { epSpeakerAct } from './attributionRules'
import type { Belief, Observation } from './contracts'
import type { CanonicalClaim, WorldInstant } from './conflictContracts'
import { CONFLICT_CANONICALIZER_VERSION } from './conflictContracts'
import { commitBelief } from './conflictStore'
import type { ReadableRecord } from './evidenceRecords'
import type { ReportIndex, ReportResolutionStore, TopicId } from './reportResolutionContracts'
import { buildReportIndexEntry, topicOf } from './reportResolutionContracts'
import { commitObservation, commitReportResolution, initReportResolutionStore } from './reportResolutionStore'
import type { CommitReportResolutionOutcome, ResolveReportInput } from './reportResolutionStore'
import { lookupSourceTrust } from './sourceTrustProjection'
import { applyReportConfidenceCap } from './reportConfidenceCap'
import type { ApplyReportConfidenceCapOutcome } from './reportConfidenceCap'

/**
 * Fixture for Source-Trust Ledger Replay v0 (research vault ADR-0012,
 * spec source-trust-ledger-replay-v0.md §2/§8). A self-contained baseline
 * (§2's "reused identity, no new meaning attached" for Cora/Borin/Daren/
 * NPC_A) -- unlike attributionScenario.ts, this rig does not extend any
 * prior fixture's committed beliefs; every belief here is minted fresh in
 * this rig's own commit sequence. `epSpeakerAct` (attributionRules.ts) is
 * reused UNMODIFIED as the report-minting path (D6 item 1): a "report" IS
 * the Belief `epSpeakerAct` mints unconditionally at rung 5+.
 */

export const CORA = 'NPC_C'
export const BORIN = 'NPC_B'
export const DAREN = 'NPC_D'
export const NPC_A = 'NPC_A'

// ---- World time (fresh ticks, no wall clock, no frame counter) -----------

function wt(tick: number): WorldInstant {
  return { night: 20, tick }
}
function timeLabel(at: WorldInstant): string {
  return `w${at.night}_${at.tick}`
}

// ---- Claim construction: one WorldProposition (for epSpeakerAct's content-
// ref) and one CanonicalClaim (for reportClaimKey/claimPolarityOf) per
// asserted fact. These predicates (e.g. 'gate-mechanism-broken') are never
// registered in canonicalProposition.ts's PREDICATE_GRAMMAR and never
// passed through detectConflict/incompatible -- ReportResolution never
// participates in conflict-edge detection (D1/D5), so `canonicalKeyOf`
// (a pure serialization of {predicate, fixedRoles}, no grammar check) is
// the only conflict-layer function this rig actually calls. ------------------

function worldProp(predicate: string, value: 'true' | 'false', at: WorldInstant): WorldProposition {
  return { kind: 'world', subject: 'village', predicate, object: value, at }
}

function claimOf(predicate: string, value: 'true' | 'false', at: WorldInstant): CanonicalClaim {
  return {
    predicate,
    fixedRoles: {},
    contestedRole: 'state',
    contestedValue: value,
    polarity: 'asserts',
    validity: { kind: 'instant', at },
    canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION,
  }
}

function witnessObservation(id: string, speaker: string, at: WorldInstant): Observation {
  return {
    schemaVersion: 1,
    id,
    observer: CORA,
    truthRef: `${id}_event`,
    channels: ['sight', 'sound'],
    perceived: { speaker, act: 'assert' },
    missing: [],
    fidelity: 'full',
    time: timeLabel(at),
  }
}

function inspectionObservation(id: string, value: 'true' | 'false', at: WorldInstant): Observation {
  return {
    schemaVersion: 1,
    id,
    observer: CORA,
    truthRef: `${id}_event`,
    channels: ['sight'],
    perceived: { state: value },
    missing: [],
    fidelity: 'full',
    time: timeLabel(at),
  }
}

interface ReportFixture {
  belief: Belief
  witness: Observation
  claim: CanonicalClaim
  claimKey: string
}

/** Mints a "report" -- the Belief `epSpeakerAct` mints unconditionally at rung 5+ (D6 item 1) -- and returns everything needed to later resolve it. */
function mintReport(
  beliefId: string,
  source: string,
  eventId: string,
  predicate: string,
  value: 'true' | 'false',
  witnessId: string,
  at: WorldInstant,
  act: 'assert' | 'present-evidence' = 'assert',
): ReportFixture {
  const witness = witnessObservation(witnessId, source, at)
  const prop = worldProp(predicate, value, at)
  const outcome = epSpeakerAct({
    beliefId,
    holder: CORA,
    speaker: source,
    eventId,
    act,
    propositionRef: innerCanonicalKeyOf(prop),
    observation: witness,
    time: timeLabel(at),
  })
  if (outcome.verdict !== 'mint') {
    throw new Error(`reportResolutionScenario: expected mint for ${beliefId}, got ${outcome.verdict}`)
  }
  const claim = claimOf(predicate, value, at)
  return { belief: outcome.belief, witness, claim, claimKey: canonicalKeyOf(claim) }
}

// ---- Baseline: Cora already holds a high-confidence, observation-sourced
// belief that the well is fouled, minted earlier in this rig's own
// baseline (§8 Phase B) -----------------------------------------------------

export const O_Cora_well_baseline = inspectionObservation('O_Cora_well_baseline', 'true', wt(0))
export const Bel_Well1: Belief = {
  schemaVersion: 1,
  id: 'Bel_Well1',
  holder: CORA,
  proposition: 'the well is fouled',
  confidence: 'high',
  sourceType: 'observation',
  sourceRef: O_Cora_well_baseline.id,
  supporting: [O_Cora_well_baseline.id],
  contradicting: [],
  lastUpdated: timeLabel(wt(0)),
}

// ---- Phase B: confirmation without BeliefTransition (§3.1, the decisive case) --

export const rWell1 = mintReport('Bel_CoraWellReport1', BORIN, 'TE_B_well_assert1', 'well-fouled', 'true', 'O_Cora_well_witness1', wt(2))
export const O_Cora_well2 = inspectionObservation('O_Cora_well2', 'true', wt(3))

// ---- Phase C: source-presented, holder-inspected evidence -----------------

export const rGate1 = mintReport('Bel_CoraGateReport1', BORIN, 'TE_B_gate_assert1', 'gate-mechanism-broken', 'true', 'O_Cora_gate_witness1', wt(4))
/** Borin's own act of directing attention -- a typed act carrying no resolving-evidence status of its own (a Belief, never an Observation, D4/D10 rule 3). */
export const TE_B_gate_show1 = mintReport('Bel_CoraGateShow1', BORIN, 'TE_B_gate_show1', 'gate-mechanism-broken', 'true', 'O_Cora_gate_show_witness1', wt(5), 'present-evidence')
export const O_Cora_gate1 = inspectionObservation('O_Cora_gate1', 'true', wt(6))

// ---- Phase D: testimony-only rejection, then genuine resolution -----------

export const rMill1 = mintReport('Bel_CoraMillReport1', BORIN, 'TE_B_mill_assert1', 'mill-burned', 'true', 'O_Cora_mill_witness1', wt(7))
export const rMillDarenCorroborate = mintReport('Bel_DarenMillCorroborate1', DAREN, 'TE_D_mill_corroborate1', 'mill-burned', 'true', 'O_Cora_mill_corroborate_witness1', wt(8))
export const O_Cora_mill1 = inspectionObservation('O_Cora_mill1', 'true', wt(9))

// ---- Phase F: observable cap behavior --------------------------------------

export const rGateHinge1 = mintReport('Bel_CoraGateHingeReport1', BORIN, 'TE_B_gatehinge_assert1', 'gate-hinge-rusted', 'true', 'O_Cora_gatehinge_witness1', wt(10))

export const rDarenWell1 = mintReport('Bel_CoraDarenWellReport1', DAREN, 'TE_D_well_assert1', 'well-fouled', 'true', 'O_Cora_dwell_witness1', wt(11))
export const O_Cora_well3 = inspectionObservation('O_Cora_well3', 'true', wt(12))

export const rDarenMill1 = mintReport('Bel_CoraDarenMillReport1', DAREN, 'TE_D_mill_assert1', 'mill-burned', 'true', 'O_Cora_dmill_witness1', wt(13))
export const O_Cora_mill2 = inspectionObservation('O_Cora_mill2', 'true', wt(14))

export const rDarenGate1 = mintReport('Bel_CoraDarenGateReport1', DAREN, 'TE_D_gate_assert1', 'gate-mechanism-broken', 'false', 'O_Cora_dgate_witness1', wt(15))
export const O_Cora_gate2 = inspectionObservation('O_Cora_gate2', 'true', wt(16))

export const rDarenBridge1 = mintReport('Bel_CoraDarenBridgeReport1', DAREN, 'TE_D_bridge_assert1', 'bridge-collapsed', 'true', 'O_Cora_dbridge_witness1', wt(17))

// ---- Phase G: established-low rejection ------------------------------------

export const rTroll1 = mintReport('Bel_CoraTrollReport1', BORIN, 'TE_B_troll_assert1', 'troll-weak-to-fire', 'true', 'O_Cora_troll_witness1', wt(18))
export const O_Cora_troll1 = inspectionObservation('O_Cora_troll1', 'false', wt(19))

export const rGhoul1 = mintReport('Bel_CoraGhoulReport1', BORIN, 'TE_B_ghoul_assert1', 'ghoul-lair-location', 'true', 'O_Cora_ghoul_witness1', wt(20))
export const O_Cora_ghoul1 = inspectionObservation('O_Cora_ghoul1', 'false', wt(21))

export const rCaveBeast1 = mintReport('Bel_CoraCaveBeastReport1', BORIN, 'TE_B_cavebeast_assert1', 'cave-beast-nocturnal', 'true', 'O_Cora_cavebeast_witness1', wt(22))
export const O_Cora_cavebeast1 = inspectionObservation('O_Cora_cavebeast1', 'false', wt(23))

export const rHag1 = mintReport('Bel_CoraHagReport1', BORIN, 'TE_B_hag_assert1', 'swamp-hag-silver-immune', 'true', 'O_Cora_hag_witness1', wt(24))

// ---- Phase I: provenance deduplication -------------------------------------

export const rGate2 = mintReport('Bel_CoraGateReport2', BORIN, 'TE_B_gate_assert2', 'gate-mechanism-broken', 'true', 'O_Cora_gate_witness2', wt(25))
export const O_Cora_gate3 = inspectionObservation('O_Cora_gate3', 'true', wt(26))
export const O_Cora_gatehinge1 = inspectionObservation('O_Cora_gatehinge1', 'true', wt(27))

// ---- Phase J: retraction ----------------------------------------------------

export const rBridge2 = mintReport('Bel_CoraBorinBridgeReport1', BORIN, 'TE_B_bridge_assert1', 'bridge-collapsed', 'true', 'O_Cora_bridge_witness1', wt(28))
export const rBridgeRetraction = (() => {
  const witness = witnessObservation('O_Cora_bridge_retract_witness1', BORIN, wt(29))
  const outcome = epSpeakerAct({
    beliefId: 'Bel_CoraBridgeRetraction1',
    holder: CORA,
    speaker: BORIN,
    eventId: 'TE_B_bridge_retract1',
    act: 'retract',
    retractStrength: 'retract-withdraw',
    propositionRef: innerCanonicalKeyOf(worldProp('bridge-collapsed', 'true', wt(28))),
    observation: witness,
    time: timeLabel(wt(29)),
  })
  if (outcome.verdict !== 'mint') {
    throw new Error(`reportResolutionScenario: expected mint for Bel_CoraBridgeRetraction1, got ${outcome.verdict}`)
  }
  return { belief: outcome.belief, witness }
})()
export const O_Cora_bridge1 = inspectionObservation('O_Cora_bridge1', 'false', wt(30))

// ---- Phase K: holder isolation + circular-trust immunity -------------------

export const rBorinVouchesDaren = mintReport('Bel_CoraBorinVouchesDaren1', BORIN, 'TE_B_vouchDaren1', 'daren-is-trustworthy', 'true', 'O_Cora_vouchDaren_witness1', wt(31))
export const rDarenVouchesBorin = mintReport('Bel_CoraDarenVouchesBorin1', DAREN, 'TE_D_vouchBorin1', 'borin-is-trustworthy', 'true', 'O_Cora_vouchBorin_witness1', wt(32))

// ---- Phase O: topic validation at the live mint boundary (D9, F14/F15) ----
// 'topic-unmapped-x' is deliberately absent from PREDICATE_TOPIC_MAP.

export const rUnmapped1 = mintReport('Bel_CoraUnmappedReport1', BORIN, 'TE_B_unmapped_assert1', 'topic-unmapped-x', 'true', 'O_Cora_unmapped_witness1', wt(33))
export const O_Cora_unmapped1 = inspectionObservation('O_Cora_unmapped1', 'true', wt(34))

// ---- Universe: every record this rig ever mints ---------------------------

export const universe: ReadableRecord[] = [
  { kind: 'observation', record: O_Cora_well_baseline },
  { kind: 'belief', record: Bel_Well1 },
  { kind: 'belief', record: rWell1.belief },
  { kind: 'observation', record: rWell1.witness },
  { kind: 'observation', record: O_Cora_well2 },
  { kind: 'belief', record: rGate1.belief },
  { kind: 'observation', record: rGate1.witness },
  { kind: 'belief', record: TE_B_gate_show1.belief },
  { kind: 'observation', record: TE_B_gate_show1.witness },
  { kind: 'observation', record: O_Cora_gate1 },
  { kind: 'belief', record: rMill1.belief },
  { kind: 'observation', record: rMill1.witness },
  { kind: 'belief', record: rMillDarenCorroborate.belief },
  { kind: 'observation', record: rMillDarenCorroborate.witness },
  { kind: 'observation', record: O_Cora_mill1 },
  { kind: 'belief', record: rGateHinge1.belief },
  { kind: 'observation', record: rGateHinge1.witness },
  { kind: 'belief', record: rDarenWell1.belief },
  { kind: 'observation', record: rDarenWell1.witness },
  { kind: 'observation', record: O_Cora_well3 },
  { kind: 'belief', record: rDarenMill1.belief },
  { kind: 'observation', record: rDarenMill1.witness },
  { kind: 'observation', record: O_Cora_mill2 },
  { kind: 'belief', record: rDarenGate1.belief },
  { kind: 'observation', record: rDarenGate1.witness },
  { kind: 'observation', record: O_Cora_gate2 },
  { kind: 'belief', record: rDarenBridge1.belief },
  { kind: 'observation', record: rDarenBridge1.witness },
  { kind: 'belief', record: rTroll1.belief },
  { kind: 'observation', record: rTroll1.witness },
  { kind: 'observation', record: O_Cora_troll1 },
  { kind: 'belief', record: rGhoul1.belief },
  { kind: 'observation', record: rGhoul1.witness },
  { kind: 'observation', record: O_Cora_ghoul1 },
  { kind: 'belief', record: rCaveBeast1.belief },
  { kind: 'observation', record: rCaveBeast1.witness },
  { kind: 'observation', record: O_Cora_cavebeast1 },
  { kind: 'belief', record: rHag1.belief },
  { kind: 'observation', record: rHag1.witness },
  { kind: 'belief', record: rGate2.belief },
  { kind: 'observation', record: rGate2.witness },
  { kind: 'observation', record: O_Cora_gate3 },
  { kind: 'observation', record: O_Cora_gatehinge1 },
  { kind: 'belief', record: rBridge2.belief },
  { kind: 'observation', record: rBridge2.witness },
  { kind: 'belief', record: rBridgeRetraction.belief },
  { kind: 'observation', record: rBridgeRetraction.witness },
  { kind: 'observation', record: O_Cora_bridge1 },
  { kind: 'belief', record: rBorinVouchesDaren.belief },
  { kind: 'observation', record: rBorinVouchesDaren.witness },
  { kind: 'belief', record: rDarenVouchesBorin.belief },
  { kind: 'observation', record: rDarenVouchesBorin.witness },
  { kind: 'belief', record: rUnmapped1.belief },
  { kind: 'observation', record: rUnmapped1.witness },
  { kind: 'observation', record: O_Cora_unmapped1 },
]

// ---- Report index: beliefId -> {reportRef, sourceId, claim, reportClaimKey}
// (hand-registered, proof-local -- a Belief record itself carries no
// structured source/claim fields, mirroring the existing ClaimRegistry/
// TrustRegistry discipline). Every entry is built through
// `buildReportIndexEntry`, the one constructor that derives `reportClaimKey`
// from `claim` itself (D9) -- never an independently hand-typed key, and
// `claim` (not just a predicate string) is what `mintReportResolution`'s own
// topic-derivation condition reads at the live mint boundary. ---------------

export const reportIndex: ReportIndex = new Map([
  [rWell1.belief.id, buildReportIndexEntry(rWell1.belief.id, BORIN, rWell1.claim)],
  [rGate1.belief.id, buildReportIndexEntry(rGate1.belief.id, BORIN, rGate1.claim)],
  [rMill1.belief.id, buildReportIndexEntry(rMill1.belief.id, BORIN, rMill1.claim)],
  [rGateHinge1.belief.id, buildReportIndexEntry(rGateHinge1.belief.id, BORIN, rGateHinge1.claim)],
  [rTroll1.belief.id, buildReportIndexEntry(rTroll1.belief.id, BORIN, rTroll1.claim)],
  [rGhoul1.belief.id, buildReportIndexEntry(rGhoul1.belief.id, BORIN, rGhoul1.claim)],
  [rCaveBeast1.belief.id, buildReportIndexEntry(rCaveBeast1.belief.id, BORIN, rCaveBeast1.claim)],
  [rHag1.belief.id, buildReportIndexEntry(rHag1.belief.id, BORIN, rHag1.claim)],
  [rGate2.belief.id, buildReportIndexEntry(rGate2.belief.id, BORIN, rGate2.claim)],
  [rBridge2.belief.id, buildReportIndexEntry(rBridge2.belief.id, BORIN, rBridge2.claim)],
  [rDarenWell1.belief.id, buildReportIndexEntry(rDarenWell1.belief.id, DAREN, rDarenWell1.claim)],
  [rDarenMill1.belief.id, buildReportIndexEntry(rDarenMill1.belief.id, DAREN, rDarenMill1.claim)],
  [rDarenGate1.belief.id, buildReportIndexEntry(rDarenGate1.belief.id, DAREN, rDarenGate1.claim)],
  [rDarenBridge1.belief.id, buildReportIndexEntry(rDarenBridge1.belief.id, DAREN, rDarenBridge1.claim)],
  [rUnmapped1.belief.id, buildReportIndexEntry(rUnmapped1.belief.id, BORIN, rUnmapped1.claim)],
])

const VILLAGE: TopicId = 'village-events'
const MONSTER: TopicId = 'monster-knowledge'

if (
  topicOf('well-fouled') !== VILLAGE ||
  topicOf('gate-mechanism-broken') !== VILLAGE ||
  topicOf('mill-burned') !== VILLAGE ||
  topicOf('gate-hinge-rusted') !== VILLAGE ||
  topicOf('bridge-collapsed') !== VILLAGE ||
  topicOf('troll-weak-to-fire') !== MONSTER ||
  topicOf('ghoul-lair-location') !== MONSTER ||
  topicOf('cave-beast-nocturnal') !== MONSTER ||
  topicOf('swamp-hag-silver-immune') !== MONSTER
) {
  throw new Error('reportResolutionScenario: a rig predicate does not map to the expected topic')
}

// ---- Sequential store construction: Phases A-N -----------------------------

function requireCommittedBelief(store: ReportResolutionStore, universeArg: readonly ReadableRecord[], beliefId: string, validFrom: WorldInstant): ReportResolutionStore {
  const { store: conflict, outcome } = commitBelief(store.conflict, universeArg, beliefId, validFrom)
  if (outcome.verdict !== 'committed') {
    throw new Error(`reportResolutionScenario: commitBelief failed for ${beliefId} -- ${outcome.fault}`)
  }
  return { ...store, conflict }
}

function requireCommittedObservation(store: ReportResolutionStore, universeArg: readonly ReadableRecord[], observationId: string): ReportResolutionStore {
  const { store: next, outcome } = commitObservation(store, universeArg, observationId)
  if (outcome.verdict !== 'committed') {
    throw new Error(`reportResolutionScenario: commitObservation failed for ${observationId} -- ${outcome.fault}`)
  }
  return next
}

function requireMintedResolution(
  store: ReportResolutionStore,
  universeArg: readonly ReadableRecord[],
  input: ResolveReportInput,
): { store: ReportResolutionStore; resolutionId: string } {
  const { store: next, outcome } = commitReportResolution(store, universeArg, reportIndex, input)
  if (outcome.verdict !== 'mint') {
    throw new Error(`reportResolutionScenario: expected mint for ${input.resolutionId} -- got rejected: ${outcome.verdict === 'rejected' ? outcome.reason : ''}`)
  }
  return { store: next, resolutionId: outcome.resolution.resolutionId }
}

export interface PhaseFResult {
  storeBeforeGateHinge: ReportResolutionStore
  borinTrust: ReturnType<typeof lookupSourceTrust>
  borinCap: ApplyReportConfidenceCapOutcome
  storeAfterDarenBuildup: ReportResolutionStore
  darenTrust: ReturnType<typeof lookupSourceTrust>
  darenCap: ApplyReportConfidenceCapOutcome
}

export interface SourceTrustLedgerRun {
  store: ReportResolutionStore
  phaseE: ReportResolutionStore
  phaseF: PhaseFResult
  directingAttentionAttempt: CommitReportResolutionOutcome
  selfLicensingAttempt: CommitReportResolutionOutcome
  thirdPartyTestimonyAttempt: CommitReportResolutionOutcome
  hiddenTruthEventAttempt: CommitReportResolutionOutcome
  gate2DedupAttempt: CommitReportResolutionOutcome
  bridgeRetractionAttempt: CommitReportResolutionOutcome
  vouchDarenAttempt: CommitReportResolutionOutcome
  vouchBorinAttempt: CommitReportResolutionOutcome
  unmappedPredicateAttempt: CommitReportResolutionOutcome
  topicMismatchAttempt: CommitReportResolutionOutcome
  crossTopicSpoofAttempt: CommitReportResolutionOutcome
}

/**
 * Runs the full narrative sequence, Phases A-N (§8), threading one shared
 * store. Every "genuine mint" call uses `requireMintedResolution` (throws
 * if it doesn't mint); every deliberate fault-demonstration attempt
 * (dedup, testimony, retraction, circular vouching) calls
 * `commitReportResolution` directly and returns the `rejected` outcome for
 * the test to assert against.
 */
export function buildSourceTrustLedgerRun(): SourceTrustLedgerRun {
  let store = initReportResolutionStore(new Map())

  // Baseline + Phase B
  store = requireCommittedObservation(store, universe, O_Cora_well_baseline.id)
  store = requireCommittedBelief(store, universe, Bel_Well1.id, wt(0))
  store = requireCommittedBelief(store, universe, rWell1.belief.id, wt(2))
  store = requireCommittedObservation(store, universe, O_Cora_well2.id)
  ;({ store } = requireMintedResolution(store, universe, {
    resolutionId: 'RR_Cora_Borin_Well1',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rWell1.belief.id,
    reportClaimKey: rWell1.claimKey,
    resolutionRef: O_Cora_well2.id,
    resolutionClaimKey: rWell1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(3),
  }))

  // Phase C
  store = requireCommittedBelief(store, universe, rGate1.belief.id, wt(4))
  store = requireCommittedBelief(store, universe, TE_B_gate_show1.belief.id, wt(5))
  // D4/D10 rule 3 / P5: directing attention is not provenance -- an attempt
  // naming Borin's own showing act (kind: belief) fails condition 4.
  const directingAttentionAttempt = commitReportResolution(store, universe, reportIndex, {
    resolutionId: 'RR_attempt_directing_attention',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rGate1.belief.id,
    reportClaimKey: rGate1.claimKey,
    resolutionRef: TE_B_gate_show1.belief.id,
    resolutionClaimKey: rGate1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(5),
  }).outcome
  if (directingAttentionAttempt.verdict !== 'rejected') throw new Error('reportResolutionScenario: P5 directing-attention attempt unexpectedly minted')
  store = requireCommittedObservation(store, universe, O_Cora_gate1.id)
  ;({ store } = requireMintedResolution(store, universe, {
    resolutionId: 'RR_Cora_Borin_Gate1',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rGate1.belief.id,
    reportClaimKey: rGate1.claimKey,
    resolutionRef: O_Cora_gate1.id,
    resolutionClaimKey: rGate1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(6),
  }))

  // Phase D
  store = requireCommittedBelief(store, universe, rMill1.belief.id, wt(7))
  store = requireCommittedBelief(store, universe, rMillDarenCorroborate.belief.id, wt(8))
  // F6: self-licensing -- resolutionRef names Borin's own report (kind: belief).
  const selfLicensingAttempt = commitReportResolution(store, universe, reportIndex, {
    resolutionId: 'RR_attempt_self_licensing',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rMill1.belief.id,
    reportClaimKey: rMill1.claimKey,
    resolutionRef: rMill1.belief.id,
    resolutionClaimKey: rMill1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(8),
  }).outcome
  if (selfLicensingAttempt.verdict !== 'rejected') throw new Error('reportResolutionScenario: F6 self-licensing attempt unexpectedly minted')
  // F7: third-party testimony -- resolutionRef names Daren's own report (kind: belief).
  const thirdPartyTestimonyAttempt = commitReportResolution(store, universe, reportIndex, {
    resolutionId: 'RR_attempt_third_party',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rMill1.belief.id,
    reportClaimKey: rMill1.claimKey,
    resolutionRef: rMillDarenCorroborate.belief.id,
    resolutionClaimKey: rMill1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(8),
  }).outcome
  if (thirdPartyTestimonyAttempt.verdict !== 'rejected') throw new Error('reportResolutionScenario: F7 third-party testimony attempt unexpectedly minted')
  // F8: hidden TruthEvent -- resolutionRef names an id that resolves to no
  // committed record at all in `universe` (a holder can never dereference
  // engine-truth it never observed; even a raw id supplied directly still
  // fails condition 4's runtime kind lookup).
  const hiddenTruthEventAttempt = commitReportResolution(store, universe, reportIndex, {
    resolutionId: 'RR_attempt_hidden_truth_event',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rMill1.belief.id,
    reportClaimKey: rMill1.claimKey,
    resolutionRef: 'TE_hidden_truth_event',
    resolutionClaimKey: rMill1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(8),
  }).outcome
  if (hiddenTruthEventAttempt.verdict !== 'rejected') throw new Error('reportResolutionScenario: F8 hidden-TruthEvent attempt unexpectedly minted')
  store = requireCommittedObservation(store, universe, O_Cora_mill1.id)
  ;({ store } = requireMintedResolution(store, universe, {
    resolutionId: 'RR_Cora_Borin_Mill1',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rMill1.belief.id,
    reportClaimKey: rMill1.claimKey,
    resolutionRef: O_Cora_mill1.id,
    resolutionClaimKey: rMill1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(9),
  }))

  // Phase E: snapshot -- (Cora, Borin, village-events) = C=3, R=0
  const phaseE = store

  // Phase F: cap computation happens BEFORE GateHinge1's own resolution.
  store = requireCommittedBelief(store, universe, rGateHinge1.belief.id, wt(10))
  const storeBeforeGateHinge = store
  // NPC_A's independent corroboration feeds the ordinary, unchanged
  // evidence-hierarchy/corroboration rule (calculus §2.4/§2.9) -- given
  // here as the fixture's own narrated fact (spec §8 Phase F), since that
  // rule is explicitly out of scope for this rig to reimplement (§6.2).
  const borinTrust = lookupSourceTrust(storeBeforeGateHinge, CORA, BORIN, VILLAGE)
  const borinCap = applyReportConfidenceCap({ preCapConfidence: 'medium', trust: borinTrust })

  store = requireCommittedBelief(store, universe, rDarenWell1.belief.id, wt(11))
  store = requireCommittedObservation(store, universe, O_Cora_well3.id)
  ;({ store } = requireMintedResolution(store, universe, {
    resolutionId: 'RR_Cora_Daren_Well1',
    holderId: CORA,
    sourceId: DAREN,
    topicId: VILLAGE,
    reportRef: rDarenWell1.belief.id,
    reportClaimKey: rDarenWell1.claimKey,
    resolutionRef: O_Cora_well3.id,
    resolutionClaimKey: rDarenWell1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(12),
  }))

  store = requireCommittedBelief(store, universe, rDarenMill1.belief.id, wt(13))
  store = requireCommittedObservation(store, universe, O_Cora_mill2.id)
  ;({ store } = requireMintedResolution(store, universe, {
    resolutionId: 'RR_Cora_Daren_Mill1',
    holderId: CORA,
    sourceId: DAREN,
    topicId: VILLAGE,
    reportRef: rDarenMill1.belief.id,
    reportClaimKey: rDarenMill1.claimKey,
    resolutionRef: O_Cora_mill2.id,
    resolutionClaimKey: rDarenMill1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(14),
  }))

  store = requireCommittedBelief(store, universe, rDarenGate1.belief.id, wt(15))
  store = requireCommittedObservation(store, universe, O_Cora_gate2.id)
  ;({ store } = requireMintedResolution(store, universe, {
    resolutionId: 'RR_Cora_Daren_Gate1',
    holderId: CORA,
    sourceId: DAREN,
    topicId: VILLAGE,
    reportRef: rDarenGate1.belief.id,
    reportClaimKey: rDarenGate1.claimKey,
    resolutionRef: O_Cora_gate2.id,
    resolutionClaimKey: rDarenGate1.claimKey,
    polarity: 'refutes',
    resolutionCause: 'ordinary',
    validTime: wt(16),
  }))

  store = requireCommittedBelief(store, universe, rDarenBridge1.belief.id, wt(17))
  const storeAfterDarenBuildup = store
  const darenTrust = lookupSourceTrust(storeAfterDarenBuildup, CORA, DAREN, VILLAGE)
  const darenCap = applyReportConfidenceCap({ preCapConfidence: 'medium', trust: darenTrust })

  // Phase G
  store = requireCommittedBelief(store, universe, rTroll1.belief.id, wt(18))
  store = requireCommittedObservation(store, universe, O_Cora_troll1.id)
  ;({ store } = requireMintedResolution(store, universe, {
    resolutionId: 'RR_Cora_Borin_Troll1',
    holderId: CORA,
    sourceId: BORIN,
    topicId: MONSTER,
    reportRef: rTroll1.belief.id,
    reportClaimKey: rTroll1.claimKey,
    resolutionRef: O_Cora_troll1.id,
    resolutionClaimKey: rTroll1.claimKey,
    polarity: 'refutes',
    resolutionCause: 'ordinary',
    validTime: wt(19),
  }))

  store = requireCommittedBelief(store, universe, rGhoul1.belief.id, wt(20))
  store = requireCommittedObservation(store, universe, O_Cora_ghoul1.id)
  ;({ store } = requireMintedResolution(store, universe, {
    resolutionId: 'RR_Cora_Borin_Ghoul1',
    holderId: CORA,
    sourceId: BORIN,
    topicId: MONSTER,
    reportRef: rGhoul1.belief.id,
    reportClaimKey: rGhoul1.claimKey,
    resolutionRef: O_Cora_ghoul1.id,
    resolutionClaimKey: rGhoul1.claimKey,
    polarity: 'refutes',
    resolutionCause: 'ordinary',
    validTime: wt(21),
  }))

  store = requireCommittedBelief(store, universe, rCaveBeast1.belief.id, wt(22))
  store = requireCommittedObservation(store, universe, O_Cora_cavebeast1.id)
  ;({ store } = requireMintedResolution(store, universe, {
    resolutionId: 'RR_Cora_Borin_CaveBeast1',
    holderId: CORA,
    sourceId: BORIN,
    topicId: MONSTER,
    reportRef: rCaveBeast1.belief.id,
    reportClaimKey: rCaveBeast1.claimKey,
    resolutionRef: O_Cora_cavebeast1.id,
    resolutionClaimKey: rCaveBeast1.claimKey,
    polarity: 'refutes',
    resolutionCause: 'ordinary',
    validTime: wt(23),
  }))

  store = requireCommittedBelief(store, universe, rHag1.belief.id, wt(24))
  // rHag1 is deliberately never resolved (D14 item 10, a never-resolved report).

  // Phase I: dedup rejection, then GateHinge1's own independent resolution.
  store = requireCommittedBelief(store, universe, rGate2.belief.id, wt(25))
  store = requireCommittedObservation(store, universe, O_Cora_gate3.id)
  const gate2DedupAttempt = commitReportResolution(store, universe, reportIndex, {
    resolutionId: 'RR_attempt_gate_dedup',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rGate2.belief.id,
    reportClaimKey: rGate2.claimKey,
    resolutionRef: O_Cora_gate3.id,
    resolutionClaimKey: rGate2.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(26),
  }).outcome
  if (gate2DedupAttempt.verdict !== 'rejected') throw new Error('reportResolutionScenario: F16 dedup attempt unexpectedly minted')

  store = requireCommittedObservation(store, universe, O_Cora_gatehinge1.id)
  ;({ store } = requireMintedResolution(store, universe, {
    resolutionId: 'RR_Cora_Borin_GateHinge1',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rGateHinge1.belief.id,
    reportClaimKey: rGateHinge1.claimKey,
    resolutionRef: O_Cora_gatehinge1.id,
    resolutionClaimKey: rGateHinge1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(27),
  }))

  // Phase J: retraction
  store = requireCommittedBelief(store, universe, rBridge2.belief.id, wt(28))
  store = requireCommittedBelief(store, universe, rBridgeRetraction.belief.id, wt(29))
  const bridgeRetractionAttempt = commitReportResolution(store, universe, reportIndex, {
    resolutionId: 'RR_attempt_retraction_alone',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rBridge2.belief.id,
    reportClaimKey: rBridge2.claimKey,
    resolutionRef: rBridgeRetraction.belief.id,
    resolutionClaimKey: rBridge2.claimKey,
    polarity: 'refutes',
    resolutionCause: 'ordinary',
    validTime: wt(29),
  }).outcome
  if (bridgeRetractionAttempt.verdict !== 'rejected') throw new Error('reportResolutionScenario: F27 retraction-alone attempt unexpectedly minted')

  store = requireCommittedObservation(store, universe, O_Cora_bridge1.id)
  ;({ store } = requireMintedResolution(store, universe, {
    resolutionId: 'RR_Cora_Borin_Bridge2',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rBridge2.belief.id,
    reportClaimKey: rBridge2.claimKey,
    resolutionRef: O_Cora_bridge1.id,
    resolutionClaimKey: rBridge2.claimKey,
    polarity: 'refutes',
    resolutionCause: 'refuted-after-source-retraction',
    validTime: wt(30),
  }))

  // Phase K: holder isolation + circular-trust immunity
  store = requireCommittedBelief(store, universe, rBorinVouchesDaren.belief.id, wt(31))
  const vouchDarenAttempt = commitReportResolution(store, universe, reportIndex, {
    resolutionId: 'RR_attempt_vouch_daren',
    holderId: CORA,
    sourceId: DAREN,
    topicId: VILLAGE,
    reportRef: rDarenWell1.belief.id,
    reportClaimKey: rDarenWell1.claimKey,
    resolutionRef: rBorinVouchesDaren.belief.id,
    resolutionClaimKey: rDarenWell1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(31),
  }).outcome
  if (vouchDarenAttempt.verdict !== 'rejected') throw new Error('reportResolutionScenario: P68 Borin-vouches-Daren attempt unexpectedly minted')

  store = requireCommittedBelief(store, universe, rDarenVouchesBorin.belief.id, wt(32))
  const vouchBorinAttempt = commitReportResolution(store, universe, reportIndex, {
    resolutionId: 'RR_attempt_vouch_borin',
    holderId: CORA,
    sourceId: BORIN,
    topicId: MONSTER,
    reportRef: rTroll1.belief.id,
    reportClaimKey: rTroll1.claimKey,
    resolutionRef: rDarenVouchesBorin.belief.id,
    resolutionClaimKey: rTroll1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(32),
  }).outcome
  if (vouchBorinAttempt.verdict !== 'rejected') throw new Error('reportResolutionScenario: P68 Daren-vouches-Borin attempt unexpectedly minted')

  // Phase O: topic validation at the live mint boundary (D9, F14/F15)
  store = requireCommittedBelief(store, universe, rUnmapped1.belief.id, wt(33))
  store = requireCommittedObservation(store, universe, O_Cora_unmapped1.id)
  // F14: 'topic-unmapped-x' has no PREDICATE_TOPIC_MAP row -- rejected on the
  // predicate's own missing topic row regardless of the topicId supplied.
  const unmappedPredicateAttempt = commitReportResolution(store, universe, reportIndex, {
    resolutionId: 'RR_attempt_unmapped_predicate',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rUnmapped1.belief.id,
    reportClaimKey: rUnmapped1.claimKey,
    resolutionRef: O_Cora_unmapped1.id,
    resolutionClaimKey: rUnmapped1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(34),
  }).outcome
  if (unmappedPredicateAttempt.verdict !== 'rejected') throw new Error('reportResolutionScenario: F14 unmapped-predicate attempt unexpectedly minted')

  // F15: rGateHinge1 ('gate-hinge-rusted') is a genuine, already-resolved
  // village-events report -- supplying MONSTER here exercises "topicId
  // disagrees with topicOf(predicate)", independent of and prior to any
  // dedup concern (GateHinge1's own provenance root is already consumed,
  // but the topic check fires first regardless).
  const topicMismatchAttempt = commitReportResolution(store, universe, reportIndex, {
    resolutionId: 'RR_attempt_topic_mismatch',
    holderId: CORA,
    sourceId: BORIN,
    topicId: MONSTER,
    reportRef: rGateHinge1.belief.id,
    reportClaimKey: rGateHinge1.claimKey,
    resolutionRef: O_Cora_gatehinge1.id,
    resolutionClaimKey: rGateHinge1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(27),
  }).outcome
  if (topicMismatchAttempt.verdict !== 'rejected') throw new Error('reportResolutionScenario: F15 topic-mismatch attempt unexpectedly minted')

  // Phase P: reportPredicate-authority gap closure (D9). rTroll1 is a real,
  // already-resolved monster-knowledge report ('troll-weak-to-fire'). There
  // is no reportPredicate field left anywhere in this rig's public input for
  // a caller to independently supply -- so the only way left to attempt a
  // cross-topic spoof is to name a genuine reportRef/resolutionRef pair
  // under the WRONG topicId outright. `mintReportResolution` must still
  // derive the topic from rTroll1's own registered ReportIndexEntry.claim
  // (monster-knowledge), never from the topicId supplied here, and reject
  // this as topic-mismatch -- identically to topicMismatchAttempt above, but
  // exercised against a report that was previously vulnerable to a forged
  // reportPredicate (troll-weak-to-fire paired with a fake village-events
  // predicate used to produce a false agreement in the old condition 0).
  const crossTopicSpoofAttempt = commitReportResolution(store, universe, reportIndex, {
    resolutionId: 'RR_attempt_cross_topic_spoof',
    holderId: CORA,
    sourceId: BORIN,
    topicId: VILLAGE,
    reportRef: rTroll1.belief.id,
    reportClaimKey: rTroll1.claimKey,
    resolutionRef: O_Cora_troll1.id,
    resolutionClaimKey: rTroll1.claimKey,
    polarity: 'confirms',
    resolutionCause: 'ordinary',
    validTime: wt(19),
  }).outcome
  if (crossTopicSpoofAttempt.verdict !== 'rejected') throw new Error('reportResolutionScenario: cross-topic spoof attempt unexpectedly minted')

  return {
    store,
    phaseE,
    phaseF: { storeBeforeGateHinge, borinTrust, borinCap, storeAfterDarenBuildup, darenTrust, darenCap },
    directingAttentionAttempt,
    selfLicensingAttempt,
    thirdPartyTestimonyAttempt,
    hiddenTruthEventAttempt,
    gate2DedupAttempt,
    bridgeRetractionAttempt,
    vouchDarenAttempt,
    vouchBorinAttempt,
    unmappedPredicateAttempt,
    topicMismatchAttempt,
    crossTopicSpoofAttempt,
  }
}
