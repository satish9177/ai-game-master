import { canonicalSerialize } from './canonicalSerialization'
import type { Belief, Confidence, RumorTransmission } from './contracts'
import type { QueryBounds } from './conflictContracts'
import type { ConflictStore } from './conflictStore'
import { currentBeliefs } from './beliefProjection'
import type { ReadableRecord } from './evidenceRecords'
import type {
  CanonicalObjective,
  CorroborationFault,
  GoalOption,
  ObjectiveAtom,
  ObjectiveAtomRegistry,
  ObjectiveMetadata,
  ObservedResult,
  OptionInputFault,
  PlanBinding,
  PlanTemplate,
} from './intentionContracts'
import {
  DERIVE_CORRECT_RUMOR_OPTION_RULE_ID,
  DERIVE_REPORT_OPTION_RULE_ID,
  DERIVE_WARN_OPTION_RULE_ID,
  INTENTION_RULE_VERSION,
} from './intentionContracts'
import { CONFLICT_CANONICALIZER_VERSION } from './conflictContracts'

/**
 * Deterministic conative rules (ADR-0009 D6/D8/D9/D16, spec intention-
 * lifecycle-replay-v0.md §2). Every function here is pure and versioned
 * (`ir_v0`): goal options are derived only from one holder's committed
 * current-belief projection, that holder's authored objective metadata, and
 * hand-registered entailment atoms -- never from TruthEvents, another
 * holder's records, an uncommitted rumor utterance, or any world-truth-
 * derived feasibility quantity (D6; the typed guards below make each of
 * those a detectable fault, F12/F13). No LLM anywhere (§4).
 */

// ---- Objective identity -----------------------------------------------------

export function objectiveKeyOf(objective: CanonicalObjective): string {
  return canonicalSerialize({ objectiveType: objective.objectiveType, roles: objective.roles })
}

// ---- Proof-local entity grammar (fixture-registered, like PREDICATE_GRAMMAR) --

// `report-crime` requires a person culprit: an NPC does not report a monster
// to the watch, it warns about it (which is exactly the Bel_C1 -> Bel_C1'
// re-adoption pivot the spec walks through).
const ENTITY_KIND: Readonly<Record<string, 'person' | 'monster'>> = {
  player: 'person',
  guard_malik: 'person',
  watch_captain: 'person',
  zombie_17: 'monster',
}

export function entityKind(name: string): 'person' | 'monster' | undefined {
  if (name.startsWith('NPC_')) return 'person'
  return ENTITY_KIND[name]
}

const CONFIDENCE_RANK: Readonly<Record<Confidence, number>> = { low: 0, medium: 1, high: 2 }

export function confidenceAtLeast(actual: Confidence, minimum: Confidence): boolean {
  return CONFIDENCE_RANK[actual] >= CONFIDENCE_RANK[minimum]
}

// ---- Option-generation inputs and the D6/D16 truth boundary -----------------

/**
 * A side-channel injection: anything beyond the holder's committed
 * current-belief projection that tries to enter option generation. Typed so
 * the F12/F13 fault injections are concrete values, not hypotheticals.
 */
export type OptionSignal =
  | { kind: 'truth-event'; recordId: string }
  | { kind: 'raw-rumor'; rumorId: string }
  | { kind: 'truth-derived-feasibility'; value: number }

export interface OptionInputs {
  holder: string
  /** The holder's committed current-belief projection at the query bounds -- the ONLY epistemic input (D6/D16). */
  beliefs: readonly Belief[]
  /** Beliefs flagged unresolved (co-held incompatibility) at the bounds -- gated by each objective type's allowUnresolved (D14). */
  unresolvedBeliefIds: ReadonlySet<string>
  atoms: ObjectiveAtomRegistry
  /** This holder's authored objective metadata only (D7). */
  objectiveMetadata: readonly ObjectiveMetadata[]
  /** Fault-injection channel: any presence is a truth-boundary violation (F12/F13). */
  extraSignals?: readonly OptionSignal[]
}

export function validateOptionInputs(inputs: OptionInputs): OptionInputFault | null {
  for (const signal of inputs.extraSignals ?? []) {
    if (signal.kind === 'truth-event') return 'truth-event-input'
    if (signal.kind === 'raw-rumor') return 'uncommitted-rumor-input'
    return 'truth-derived-feasibility'
  }
  if (inputs.beliefs.some((belief) => belief.holder !== inputs.holder)) {
    return 'cross-holder-belief-input'
  }
  return null
}

/**
 * Assembles option inputs exclusively from the committed read path: the
 * holder's scoped current-belief projection (ADR-0008 D4) at `bounds`.
 * There is no parameter through which a TruthEvent, another holder's
 * record, or an uncommitted utterance can arrive here.
 */
export function scopedOptionInputs(
  holder: string,
  universe: readonly ReadableRecord[],
  store: ConflictStore,
  bounds: QueryBounds,
  atoms: ObjectiveAtomRegistry,
  objectiveMetadata: readonly ObjectiveMetadata[],
): OptionInputs {
  const projection = currentBeliefs(holder, universe, store, bounds)
  const unresolvedBeliefIds = new Set(projection.unresolved.flatMap((pair) => [...pair.beliefIds]))
  return { holder, beliefs: projection.beliefs, unresolvedBeliefIds, atoms, objectiveMetadata }
}

// ---- Option generation (pure, versioned -- §2.1) ----------------------------

function atomsOf(registry: ObjectiveAtomRegistry, recordId: string): readonly ObjectiveAtom[] {
  return registry.get(recordId) ?? []
}

function objective(objectiveType: string, roles: Record<string, string>): CanonicalObjective {
  return { objectiveType, roles, canonicalizerVersion: CONFLICT_CANONICALIZER_VERSION }
}

function admissible(belief: Belief, inputs: OptionInputs, metadata: ObjectiveMetadata): boolean {
  if (!confidenceAtLeast(belief.confidence, metadata.minConfidence)) return false
  if (!metadata.allowUnresolved && inputs.unresolvedBeliefIds.has(belief.id)) return false
  return true
}

function optionFrom(
  inputs: OptionInputs,
  metadata: ObjectiveMetadata,
  candidateObjective: CanonicalObjective,
  derivedFromBeliefs: readonly string[],
  ruleId: string,
): GoalOption {
  return {
    holder: inputs.holder,
    candidateObjective,
    derivedFromBeliefs,
    sourceObjectiveMetadataId: metadata.id,
    sourceObjectiveMetadataVersion: metadata.version,
    ruleId,
    ruleVersion: INTENTION_RULE_VERSION,
    priorityBasis: metadata.priorityBasis,
    priorityRank: metadata.priorityRank,
  }
}

function optionsForMetadata(inputs: OptionInputs, metadata: ObjectiveMetadata): GoalOption[] {
  const options: GoalOption[] = []

  if (metadata.objectiveType === 'report-crime') {
    for (const belief of inputs.beliefs) {
      if (!admissible(belief, inputs, metadata)) continue
      for (const atom of atomsOf(inputs.atoms, belief.id)) {
        const culprit = atom.roles.culprit
        if (atom.kind !== 'accuses' || culprit === undefined || entityKind(culprit) !== 'person') continue
        options.push(
          optionFrom(
            inputs,
            metadata,
            objective('report-crime', {
              culprit,
              crime: atom.roles.crime ?? 'unknown',
              victim: atom.roles.victim ?? 'unknown',
            }),
            [belief.id],
            DERIVE_REPORT_OPTION_RULE_ID,
          ),
        )
      }
    }
    return options
  }

  if (metadata.objectiveType === 'warn-of-danger') {
    for (const belief of inputs.beliefs) {
      if (!admissible(belief, inputs, metadata)) continue
      for (const atom of atomsOf(inputs.atoms, belief.id)) {
        const location = atom.roles.location
        if (atom.kind !== 'danger-present' || location === undefined) continue
        options.push(
          optionFrom(
            inputs,
            metadata,
            objective('warn-of-danger', { location, source: atom.roles.source ?? 'unknown' }),
            [belief.id],
            DERIVE_WARN_OPTION_RULE_ID,
          ),
        )
      }
    }
    return options
  }

  if (metadata.objectiveType === 'correct-rumor') {
    const corrective = inputs.beliefs.find(
      (belief) => admissible(belief, inputs, metadata) && atomsOf(inputs.atoms, belief.id).some((atom) => atom.kind === 'attack-by'),
    )
    const circulation = inputs.beliefs.find((belief) =>
      atomsOf(inputs.atoms, belief.id).some((atom) => atom.kind === 'false-accusation-circulating'),
    )
    if (corrective !== undefined && circulation !== undefined) {
      const actual = atomsOf(inputs.atoms, corrective.id).find((atom) => atom.kind === 'attack-by')?.roles.actor ?? 'unknown'
      const accused =
        atomsOf(inputs.atoms, circulation.id).find((atom) => atom.kind === 'false-accusation-circulating')?.roles.accused ?? 'unknown'
      options.push(
        optionFrom(
          inputs,
          metadata,
          objective('correct-rumor', { accused, actual }),
          [corrective.id, circulation.id],
          DERIVE_CORRECT_RUMOR_OPTION_RULE_ID,
        ),
      )
    }
    return options
  }

  return options
}

export type DeriveOptionsOutcome = { verdict: 'derived'; options: readonly GoalOption[] } | { verdict: 'rejected'; fault: OptionInputFault }

/**
 * `options(holder, valid_t, tx_bound)` (§2.1): a pure function of the
 * holder's committed projection, authored metadata, and this rule version.
 * Rejects, with a typed fault, any input carrying a truth-boundary
 * violation (F12/F13) rather than silently ignoring it.
 */
export function deriveOptions(inputs: OptionInputs): DeriveOptionsOutcome {
  const fault = validateOptionInputs(inputs)
  if (fault !== null) {
    return { verdict: 'rejected', fault }
  }
  const options = inputs.objectiveMetadata.flatMap((metadata) => optionsForMetadata(inputs, metadata))
  return { verdict: 'derived', options: rankOptions(options) }
}

/** Deterministic total order (§2.2): priority rank descending, then canonical objective key ascending as the fixed tie-break. */
export function rankOptions(options: readonly GoalOption[]): GoalOption[] {
  return [...options].sort((a, b) => {
    if (a.priorityRank !== b.priorityRank) return b.priorityRank - a.priorityRank
    return objectiveKeyOf(a.candidateObjective) < objectiveKeyOf(b.candidateObjective) ? -1 : 1
  })
}

// ---- Justification (shared by adoption, refresh-support §2.5a, and
// reconsideration -- the F18 checker) ----------------------------------------

/**
 * Re-derives whether `supportBeliefIds` still justify `candidate` under the
 * objective type's eligibility (D14): the same atom test option generation
 * used, applied to the replacement support set.
 */
export function objectiveJustifiedBy(
  candidate: CanonicalObjective,
  supportBeliefIds: readonly string[],
  beliefsById: ReadonlyMap<string, Belief>,
  atoms: ObjectiveAtomRegistry,
  metadata: ObjectiveMetadata,
): boolean {
  const supported = supportBeliefIds.some((beliefId) => {
    const belief = beliefsById.get(beliefId)
    if (belief === undefined || !confidenceAtLeast(belief.confidence, metadata.minConfidence)) return false
    return atomsOf(atoms, beliefId).some((atom) => {
      if (candidate.objectiveType === 'report-crime') {
        return atom.kind === 'accuses' && atom.roles.culprit === candidate.roles.culprit
      }
      if (candidate.objectiveType === 'warn-of-danger') {
        return atom.kind === 'danger-present' && atom.roles.location === candidate.roles.location
      }
      if (candidate.objectiveType === 'correct-rumor') {
        return atom.kind === 'attack-by'
      }
      return false
    })
  })
  return supported
}

// ---- Reconsideration decisions (§2.4 -- pure; the store/pipeline commit) ----

export type SupportReconsiderationDecision =
  | { decision: 'none' }
  | { decision: 'refresh-support'; previous: readonly string[]; replacement: readonly string[] }
  | { decision: 'complete'; triggeringIds: readonly string[] }
  | { decision: 'abandon'; cause: 'unsupported' | 'impossible-by-belief' | 'forbidden-by-belief'; triggeringIds: readonly string[] }

export interface ReconsiderationContext {
  /** The holder's NEW committed projection (post belief commit). */
  beliefs: readonly Belief[]
  atoms: ObjectiveAtomRegistry
  metadata: ObjectiveMetadata
}

function beliefWithAtom(ctx: ReconsiderationContext, predicate: (atom: ObjectiveAtom) => boolean): Belief | undefined {
  return ctx.beliefs.find((belief) => atomsOf(ctx.atoms, belief.id).some(predicate))
}

/**
 * Belief-recognized termination checks (D12): completion, forbiddenness,
 * and impossibility are evaluated against the holder's beliefs, never
 * hidden world truth. Returns null when none applies.
 */
function terminalByBelief(candidate: CanonicalObjective, ctx: ReconsiderationContext): SupportReconsiderationDecision | null {
  const achieved = beliefWithAtom(ctx, (atom) => atom.kind === 'objective-achieved' && atom.roles.objectiveType === candidate.objectiveType)
  if (achieved !== undefined) {
    return { decision: 'complete', triggeringIds: [achieved.id] }
  }
  if (ctx.metadata.forbiddenAtomKind !== undefined) {
    const forbidden = beliefWithAtom(ctx, (atom) => atom.kind === ctx.metadata.forbiddenAtomKind)
    if (forbidden !== undefined) {
      return { decision: 'abandon', cause: 'forbidden-by-belief', triggeringIds: [forbidden.id] }
    }
  }
  const impossible = beliefWithAtom(
    ctx,
    (atom) => atom.kind === 'objective-impossible' && atom.roles.objectiveType === candidate.objectiveType,
  )
  if (impossible !== undefined) {
    return { decision: 'abandon', cause: 'impossible-by-belief', triggeringIds: [impossible.id] }
  }
  return null
}

/**
 * Reconsiders one intention after a BeliefTransition superseded a member of
 * its CURRENT dependency support (D5/D8). The zero-cost default is
 * continuation; a superseding-but-still-justifying belief yields
 * refresh-support; a non-justifying supersession yields abandon(unsupported).
 */
export function reconsiderOnBeliefTransition(
  candidate: CanonicalObjective,
  currentSupport: readonly string[],
  transition: { fromBeliefId: string; toBeliefId: string },
  ctx: ReconsiderationContext,
): SupportReconsiderationDecision {
  const terminal = terminalByBelief(candidate, ctx)
  if (terminal !== null) return terminal

  if (!currentSupport.includes(transition.fromBeliefId)) {
    return { decision: 'none' }
  }

  const replacement = currentSupport.map((beliefId) => (beliefId === transition.fromBeliefId ? transition.toBeliefId : beliefId))
  const beliefsById = new Map(ctx.beliefs.map((belief) => [belief.id, belief]))
  if (objectiveJustifiedBy(candidate, replacement, beliefsById, ctx.atoms, ctx.metadata)) {
    return { decision: 'refresh-support', previous: currentSupport, replacement }
  }
  return { decision: 'abandon', cause: 'unsupported', triggeringIds: [] }
}

/**
 * Reconsiders one intention after the holder ACQUIRES a belief (no
 * supersession): the believed-achieved / believed-forbidden /
 * believed-impossible triggers of D8, still purely belief-recognized.
 */
export function reconsiderOnBeliefAcquired(candidate: CanonicalObjective, ctx: ReconsiderationContext): SupportReconsiderationDecision {
  return terminalByBelief(candidate, ctx) ?? { decision: 'none' }
}

// ---- Plan authority and the strict failure hierarchy (§2.5, D9) ------------

export function planApplicable(template: PlanTemplate, holderAtomKinds: ReadonlySet<string>): boolean {
  return holderAtomKinds.has(template.contextAtomKind)
}

export function holderAtomKindsOf(beliefs: readonly Belief[], atoms: ObjectiveAtomRegistry): ReadonlySet<string> {
  return new Set(beliefs.flatMap((belief) => atomsOf(atoms, belief.id).map((atom) => atom.kind)))
}

export type OutcomeReconsiderationDecision =
  | { decision: 'none' }
  | { decision: 'retry' }
  | { decision: 'rebind'; binding: PlanBinding }
  | { decision: 'fail' }

export interface PlanFailureState {
  /** Failures already recorded at the current step, INCLUDING the outcome under reconsideration. */
  failuresAtStep: number
  /** Every template id this intention has bound so far (adopt + rebinds). */
  boundTemplateIds: readonly string[]
}

/** Exported for reuse by the plan-body pipeline's root-failure -> rebind/fail handoff (ADR-0010 D17): the same deterministic "next applicable authored template" search, one layer down. */
export function nextApplicableBinding(
  candidate: CanonicalObjective,
  state: PlanFailureState,
  templates: readonly PlanTemplate[],
  holderAtomKinds: ReadonlySet<string>,
): PlanBinding | undefined {
  const eligible = templates
    .filter(
      (template) =>
        template.servesObjectiveType === candidate.objectiveType &&
        !state.boundTemplateIds.includes(template.id) &&
        planApplicable(template, holderAtomKinds),
    )
    .sort((a, b) => (a.id < b.id ? -1 : 1))
  const [first] = eligible
  return first === undefined ? undefined : { templateId: first.id, templateVersion: first.version, params: {} }
}

/**
 * The strict hierarchy (D9): one failed action != plan failure (retry
 * within the retry budget writes NO transition); plan failure != intention
 * failure (`rebind` to another applicable authored template preserves the
 * intention); only exhaustion of applicable templates and retries yields
 * terminal `fail(plan-exhausted)`. Success writes nothing here --
 * completion is belief-recognized (D12), never outcome-recognized.
 */
export function reconsiderOnOutcome(
  candidate: CanonicalObjective,
  outcome: { verdict: string; observedResult: ObservedResult },
  state: PlanFailureState,
  templates: readonly PlanTemplate[],
  holderAtomKinds: ReadonlySet<string>,
  metadata: ObjectiveMetadata,
): OutcomeReconsiderationDecision {
  if (outcome.verdict === 'succeeded') {
    return { decision: 'none' }
  }

  if (outcome.observedResult !== 'target-absent' && state.failuresAtStep <= metadata.retryLimit) {
    return { decision: 'retry' }
  }

  const binding = nextApplicableBinding(candidate, state, templates, holderAtomKinds)
  if (binding !== undefined) {
    return { decision: 'rebind', binding }
  }
  return { decision: 'fail' }
}

// ---- Returned circular rumor boundary (D16, F14) ----------------------------

/**
 * Walks a rumor's provenance chain (rumor -> source belief -> its source
 * rumor -> ...) collecting the holder of every belief on the path. The
 * proof-level instantiation of the Belief-Update Calculus §2.4 provenance-
 * root discipline: independence requires the chain not to pass through the
 * receiver's own prior claim.
 */
export function provenancePathHolders(rumor: RumorTransmission, universe: readonly ReadableRecord[]): readonly string[] {
  const holders: string[] = []
  const seen = new Set<string>()
  let current: RumorTransmission | undefined = rumor
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id)
    const sourceBeliefId: string = current.sourceBelief
    const beliefEntry = universe.find((entry) => entry.kind === 'belief' && entry.record.id === sourceBeliefId)
    if (beliefEntry === undefined || beliefEntry.kind !== 'belief') break
    holders.push(beliefEntry.record.holder)
    if (beliefEntry.record.sourceType !== 'rumor') break
    const sourceRumorId = beliefEntry.record.sourceRef
    const rumorEntry = universe.find((entry) => entry.kind === 'rumor' && entry.record.id === sourceRumorId)
    current = rumorEntry !== undefined && rumorEntry.kind === 'rumor' ? rumorEntry.record : undefined
  }
  return holders
}

export type CorroborationOutcome = { admitted: true } | { admitted: false; fault: CorroborationFault }

/**
 * A rumor whose provenance chain passes through the receiver's own prior
 * claim is an echo, never independent corroboration (D16): it must not be
 * treated as a belief, must not restore a superseded belief, and must not
 * feed reconsideration. Only the belief calculus committing a NEW current
 * belief may do any of that.
 */
export function admitRumorAsCorroboration(
  receiver: string,
  rumor: RumorTransmission,
  universe: readonly ReadableRecord[],
): CorroborationOutcome {
  if (provenancePathHolders(rumor, universe).includes(receiver)) {
    return { admitted: false, fault: 'circular-corroboration' }
  }
  return { admitted: true }
}
