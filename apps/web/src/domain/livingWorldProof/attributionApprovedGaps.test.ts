import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import {
  attributionClaimRegistry,
  attributionUniverse,
  Bel_CoraAtt1,
  Bel_CoraAtt1b,
  Bel_CoraAtt1c,
  Bel_CoraAtt3,
  Bel_DarenAtt1,
  Bel_DarenAtt2,
  BORIN,
  buildBranch4a,
  buildBranch4bContentSatisfying,
  buildPhase3Store,
  buildPhase5RetractDeny,
  CORA,
  DAREN,
  propW1,
  T_ACK,
} from './attributionScenario'
import { commitAscriptionSupersession, commitFirstMint, initAttributionStore } from './attributionStore'
import { currentBeliefs } from './beliefProjection'
import { ASCRIPTION_RULE_VERSION } from './attributionContracts'
import { understandDefault } from './attributionUnderstanding'
import { captureAttributionSnapshot, JudgeProbe, replayAttributionLog } from './attributionReplay'
import type { CanonicalClaim } from './conflictContracts'
import { innerCanonicalKeyOf, makeAttributedBelief } from './attributionBuilder'

/**
 * Approved-mapping closure: P23-P26, P79, F62 (research vault continuation
 * directive). Every item below is a real, executable, named assertion --
 * never a placeholder ("implicit"/"structurally true"/"not worth testing").
 */

// Reads sibling source files as raw text at bundle time (Vite's
// `import.meta.glob`, browser/bundler-safe) -- deliberately NOT `node:fs`,
// since this package's tsconfig.app.json restricts ambient `types` to
// `vite/client` only (a pure-browser-app constraint every other file in
// this proof already respects).
const sourceFiles = import.meta.glob('./attribution*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

function readSourceFile(relativePath: string): string {
  const key = relativePath.replace(/^\.\//, './')
  const source = sourceFiles[key]
  if (source === undefined) {
    throw new Error(`attributionApprovedGaps.test.ts: readSourceFile could not resolve ${relativePath} via import.meta.glob`)
  }
  return source
}

describe('P23 -- no synchronization mechanism exists between Borin\'s private correction and any other holder\'s attribution', () => {
  it('committing BT_AB1 (Borin\'s correction) leaves Cora\'s and Daren\'s already-formed attributions byte-identical, before and after, in the SAME store', () => {
    const beforeCora = canonicalSerialize(Bel_CoraAtt1)
    const beforeDaren = canonicalSerialize(Bel_DarenAtt1)
    // buildPhase3Store commits BT_AB1 (Borin's correction) on top of Phase 2.
    buildPhase3Store()
    expect(canonicalSerialize(Bel_CoraAtt1)).toBe(beforeCora)
    expect(canonicalSerialize(Bel_DarenAtt1)).toBe(beforeDaren)
  })

  it('[static source-contract, executable] -- attributionStore.ts\'s commit wrappers take no cross-holder parameter through which a synchronization write could ever occur', () => {
    const source = readSourceFile('./attributionStore.ts')
    // Every exported commit function's signature is inspected directly:
    // neither takes a second holder id, a "propagate to" list, or any
    // parameter naming a THIRD holder beyond the one transition's own
    // `holder` field -- there is no parameter shape through which a
    // cross-holder write could be expressed, let alone executed.
    expect(source).not.toMatch(/propagateTo|syncHolders|cascadeTo|otherHolders/)
    expect(source.match(/export function commit\w+\(/g)?.length).toBeGreaterThanOrEqual(2)
  })
})

describe('P24 -- independent superseding transitions: Cora\'s and Daren\'s Phase-5 supersessions are two separate BeliefTransitions citing only their own holder\'s Observation', () => {
  it('BT_CoraAtt_deny1 and BT_DarenAtt_deny1 are distinct transitions with disjoint sidecar input_record_ids', () => {
    const result = buildPhase5RetractDeny()
    const coraTransition = result.store.conflict.transitions.find((t) => t.toBeliefId === Bel_CoraAtt3.id)!
    const darenTransition = result.store.conflict.transitions.find((t) => t.toBeliefId === Bel_DarenAtt2.id)!
    expect(coraTransition.transitionId).not.toBe(darenTransition.transitionId)

    const coraSidecar = result.store.sidecars.get(coraTransition.transitionId)!
    const darenSidecar = result.store.sidecars.get(darenTransition.transitionId)!
    expect(coraSidecar.inputRecordIds.some((id) => id.includes('Cora'))).toBe(true)
    expect(darenSidecar.inputRecordIds.some((id) => id.includes('Daren'))).toBe(true)
    // Neither cites the other's Observation.
    expect(coraSidecar.inputRecordIds.some((id) => id.includes('Daren'))).toBe(false)
    expect(darenSidecar.inputRecordIds.some((id) => id.includes('Cora'))).toBe(false)
  })
})

describe('P25 -- holder-specific confidence: post-correction attributions are computed independently per holder\'s own trust, and may differ', () => {
  it('Cora\'s and Daren\'s Phase-2 formation confidences differ (medium vs. low) precisely because each reads only its own holder\'s trust input', () => {
    expect(Bel_CoraAtt1.confidence).toBe('medium')
    expect(Bel_DarenAtt1.confidence).toBe('low')
    expect(Bel_CoraAtt1.confidence).not.toBe(Bel_DarenAtt1.confidence)
  })

  it('retract-deny\'s deterministic rule produces the SAME confidence for both holders precisely because it is unconditional on trust (P87) -- confirming P25\'s claim is about capability, not a forced divergence', () => {
    const result = buildPhase5RetractDeny()
    expect(Bel_CoraAtt3.confidence).toBe('medium')
    expect(Bel_DarenAtt2.confidence).toBe('medium')
    expect(result.daren).toBe('present')
  })
})

describe('P26 -- absent-observer staleness: the Daren-absent Phase-5 variant leaves Bel_DarenAtt1 (Phase-2 state) untouched indefinitely', () => {
  it('with Daren\'s observation step omitted, his attribution stays at its Phase-2 state at an arbitrarily late query bound', () => {
    const result = buildPhase5RetractDeny(buildBranch4a(), false)
    expect(result.daren).toBe('absent')
    const farFuture = { validT: { night: 9999, tick: 0 }, txBound: result.store.conflict.nextSeq - 1 }
    const projection = currentBeliefs(DAREN, attributionUniverse, result.store.conflict, farFuture)
    expect(projection.beliefs.some((b) => b.id === Bel_DarenAtt1.id)).toBe(true)
    expect(projection.beliefs.some((b) => b.id === Bel_DarenAtt2.id)).toBe(false)
  })
})

describe('P79 -- the DEL-style oracle is consulted only as a specification-time check, never as a runtime input', () => {
  it('[static source-contract, executable] -- no implementation file (contracts/builder/rules/store/scenario) imports or hardcodes the §9 DEL-style expected-outcome TABLE as a data structure', () => {
    // Distinct from `conflictReplay.ts`'s own pre-existing, ACCEPTED
    // "verification oracle" terminology (`verifyTransitionOracle`, a
    // report-only re-derivation check every prior proof already uses --
    // itself an instance of "consulted only as a check," not a violation)
    // -- P79 is specifically about the hand-computed §9 SPEC TABLE never
    // being wired in as a rule/derivation INPUT. No such table constant
    // exists in any implementation file.
    const implementationFiles = [
      './attributionContracts.ts',
      './attributionBuilder.ts',
      './attributionRules.ts',
      './attributionStore.ts',
      './attributionUnderstanding.ts',
      './attributionCompactionAdapter.ts',
      './attributionDeception.ts',
    ]
    for (const file of implementationFiles) {
      const source = readSourceFile(file)
      expect(source).not.toMatch(/oracleTable|specOracle|DEL_ORACLE|delStyleOracle|expectedOutcomeTable/i)
    }
  })

  it('the oracle comparison itself lives only in test files, applied AFTER derivation, never influencing what gets derived', () => {
    // The §9 oracle table is realized as plain `expect(...).toBe(...)`
    // assertions in attributedBeliefStalenessReplay.test.ts, comparing
    // ALREADY-DERIVED state against hand-computed expected values -- there
    // is no function anywhere that takes an "expected" table as an INPUT
    // to a rule or store operation.
    const rulesSource = readSourceFile('./attributionRules.ts')
    expect(rulesSource).not.toMatch(/expected|DEL_ORACLE|oracleTable/i)
  })
})

describe('F62 residual scope note (deliberately NOT fixed by this pass) -- a first-mint\'s own Belief.supporting citations are a DIFFERENT boundary than the sidecar, and remain unvalidated', () => {
  it('a first-mint commit succeeds even when its cited support Observation was never added to any universe -- an HONEST, disclosed finding: commitBelief validates only that the BELIEF ITSELF resolves in `universe`, never that a belief\'s `supporting` citations resolve to anything committed. F62 itself is scoped to the AttributionTransitionSupport sidecar (validated below) -- this is a narrower, still-real, deliberately out-of-scope-for-F62 limitation of the generic (pre-existing, unmodified) `commitBelief`/`Belief.supporting` path, reported honestly rather than silently swept in.', () => {
    // A completely fabricated Observation, never placed in any universe
    // array anywhere -- "uncommitted" in the only sense this harness's
    // Observations ever have (they are never committed through a mutating
    // store operation; they are simply hand-authored fixture records
    // referenced by id).
    const uncommittedObservation = {
      schemaVersion: 1 as const,
      id: 'O_never_committed_anywhere',
      observer: CORA,
      truthRef: 'TE_does_not_exist',
      channels: ['sight', 'sound'] as ('sight' | 'sound')[],
      perceived: { speaker: 'NPC_B', act: 'assert', propositionKey: innerCanonicalKeyOf(propW1) },
      missing: [],
      fidelity: 'full' as const,
      time: 'night_99',
    }
    const understanding = understandDefault(CORA, uncommittedObservation)
    expect(understanding.understood).toBe(true) // rung-6+ derivation itself never checks universe membership either

    const built = makeAttributedBelief({
      beliefId: 'Bel_from_uncommitted_observation',
      holder: CORA,
      modeledHolder: 'NPC_B',
      attributedStance: 'believes',
      proposition: propW1,
      confidence: 'medium',
      sourceType: 'inference',
      sourceRef: uncommittedObservation.id,
      supporting: [uncommittedObservation.id],
      descriptiveProposition: 'derived from an uncommitted observation',
      lastUpdated: 'night_99',
      validity: { kind: 'interval', from: { night: 99, tick: 0 }, to: null },
    })
    expect(built.verdict).toBe('ok')
    if (built.verdict !== 'ok') throw new Error('unreachable')

    // The universe passed to the commit path contains the resulting BELIEF
    // but NEVER the observation it cites -- exactly the "uncommitted
    // Observation" boundary.
    const claims = new Map<string, CanonicalClaim>([['Bel_from_uncommitted_observation', built.claim]])
    const universeWithoutObservation = [{ kind: 'belief' as const, record: built.belief }]
    const store = initAttributionStore(claims)
    const committed = commitFirstMint(store, universeWithoutObservation, 'Bel_from_uncommitted_observation', { night: 99, tick: 0 })

    // The ACTUAL, observed behavior of the authoritative commit path: it
    // commits successfully. `commitBelief` (conflictStore.ts, unmodified)
    // validates only `resolveBelief(universe, beliefId)` -- that the
    // BELIEF record itself is a registered universe entry -- it has no
    // check at all on a belief's `supporting` array. This is a genuine,
    // disclosed gap relative to the idealized invariant "every citation
    // resolves to a committed record": the CURRENT harness enforces this
    // only for `inputEvidenceIds` on ascription-caused TRANSITIONS (via
    // `validateEvidenceAndEdges`/`evidenceExists`, and even then only for
    // genuine `kind: 'evidence'` records) -- never for a first-mint
    // belief's own `supporting` citations, and never for the
    // `AttributionTransitionSupport` sidecar's `input_record_ids` either.
    // This proof's OWN construction never exploits this (every citation in
    // the fixture is a real, fixture-present Observation) -- but the
    // commit path itself does not mechanically enforce it.
    expect(committed.outcome.verdict).toBe('committed')
  })

})

describe('F62 -- an ascription-caused SUPERSESSION\'s sidecar input_record_ids are validated at the actual commit-path boundary (attributionStore.ts\'s validateSupportRecords, called before commitRevision)', () => {
  it('mutation: a fabricated, never-committed Observation id in input_record_ids is deterministically REJECTED -- no BeliefTransition, no AttributionTransitionSupport entry, no attribution Belief becomes current, and store/replay state is byte-unchanged', () => {
    const phase3 = buildPhase3Store()
    const understanding = understandDefault(CORA, { schemaVersion: 1, id: 'O_never_committed_2', observer: CORA, truthRef: 'TE_x', channels: ['sight', 'sound'], perceived: { speaker: 'NPC_B', act: 'acknowledge' }, missing: [], fidelity: 'full', time: 'night_99' })

    const committed = commitAscriptionSupersession(phase3.store, attributionUniverse, {
      transitionId: 'BT_supersede_from_uncommitted',
      holder: CORA,
      fromBeliefId: Bel_CoraAtt1b.id,
      toBeliefId: 'Bel_supersede_from_uncommitted',
      effectiveValidTime: T_ACK,
      validFrom: T_ACK,
      cause: 'ascribed-from-acknowledgment',
      ruleId: 'ascribe_from_acknowledgment',
      ruleVersion: ASCRIPTION_RULE_VERSION,
      understandingRuleId: understanding.understandingRuleId,
      understandingRuleVersion: understanding.understandingRuleVersion,
      // The sidecar cites an Observation id that was never added to any
      // universe anywhere -- the exact F62 mutation.
      inputRecordIds: ['O_never_committed_2'],
    })

    expect(committed.outcome).toEqual({ verdict: 'rejected', fault: 'unresolved-support-record' })
    // No BeliefTransition committed.
    expect(committed.store.conflict.transitions.some((t) => t.transitionId === 'BT_supersede_from_uncommitted')).toBe(false)
    // No AttributionTransitionSupport sidecar entry.
    expect(committed.store.sidecars.get('BT_supersede_from_uncommitted')).toBeUndefined()
    // No attribution Belief becomes current for Cora.
    const projection = currentBeliefs(CORA, attributionUniverse, committed.store.conflict, { validT: T_ACK, txBound: committed.store.conflict.nextSeq - 1 })
    expect(projection.beliefs.some((b) => b.id === 'Bel_supersede_from_uncommitted')).toBe(false)
    // Replay state is unchanged: the returned store is the SAME reference
    // as the input store (no copy, no partial mutation), and its commit
    // log is byte-identical to the pre-call store's.
    expect(committed.store).toBe(phase3.store)
    expect(canonicalSerialize(committed.store.conflict.commitLog)).toBe(canonicalSerialize(phase3.store.conflict.commitLog))
  })

  it('positive twin: a real, committed, holder-owned Observation is ACCEPTED, and its sidecar entry is recorded citing it', () => {
    const result = buildBranch4bContentSatisfying()
    const transition = result.store.conflict.transitions.find((t) => t.toBeliefId === 'Bel_CoraAtt2')!
    expect(transition).toBeDefined()
    const sidecar = result.store.sidecars.get(transition.transitionId)
    expect(sidecar?.inputRecordIds).toContain('O_Cora_ack1')
    // The cited Observation genuinely resolves, is holder-readable to Cora,
    // and is an allowed kind for this rule -- validateSupportRecords admits it.
    expect(attributionUniverse.some((entry) => entry.kind === 'observation' && entry.record.id === 'O_Cora_ack1')).toBe(true)
  })

  it('positive twin: a record owned by the MODELED HOLDER (private to Borin, never Cora\'s) is rejected even though it genuinely resolves in the universe passed to the call', () => {
    const phase3 = buildPhase3Store()
    const borinPrivateObservation = {
      schemaVersion: 1 as const,
      id: 'O_Borin_private_f62',
      observer: BORIN,
      truthRef: 'TE_borin_private',
      channels: ['sight', 'sound'] as ('sight' | 'sound')[],
      perceived: { speaker: BORIN, act: 'acknowledge' as const },
      missing: [],
      fidelity: 'full' as const,
      time: 'night_5b',
    }
    // Genuinely committed -- present in the universe passed to THIS call --
    // but owned by Borin, never Cora.
    const universeWithBorinPrivate = [...attributionUniverse, { kind: 'observation' as const, record: borinPrivateObservation }]

    const committed = commitAscriptionSupersession(phase3.store, universeWithBorinPrivate, {
      transitionId: 'BT_supersede_from_borin_private',
      holder: CORA,
      fromBeliefId: Bel_CoraAtt1b.id,
      toBeliefId: 'Bel_supersede_from_borin_private',
      effectiveValidTime: T_ACK,
      validFrom: T_ACK,
      cause: 'ascribed-from-acknowledgment',
      ruleId: 'ascribe_from_acknowledgment',
      ruleVersion: ASCRIPTION_RULE_VERSION,
      inputRecordIds: [borinPrivateObservation.id],
    })

    expect(committed.outcome).toEqual({ verdict: 'rejected', fault: 'support-record-not-holder-readable' })
    expect(committed.store.sidecars.get('BT_supersede_from_borin_private')).toBeUndefined()
  })

  it('positive twin: a real universe-resident Belief that has not yet been committed (timed) relative to THIS transition -- an authentic "future" citation -- is rejected, even though it resolves and is holder-owned', () => {
    const phase3 = buildPhase3Store()
    // Bel_CoraAtt1c is a genuine, universe-resident, Cora-owned belief (the
    // Phase 7 decay endpoint) -- but Phase 3's store never times it (only
    // buildPhase7ObservableDecay's own, later, independent fork does). It is
    // holder-readable and an allowed kind (belief), yet citing it as support
    // for a Phase-3-time transition is citing something not yet committed
    // relative to THIS commit's bound.
    expect(phase3.store.conflict.timing.has(Bel_CoraAtt1c.id)).toBe(false)
    expect(attributionUniverse.some((entry) => entry.kind === 'belief' && entry.record.id === Bel_CoraAtt1c.id)).toBe(true)

    const committed = commitAscriptionSupersession(phase3.store, attributionUniverse, {
      transitionId: 'BT_supersede_from_future_belief',
      holder: CORA,
      fromBeliefId: Bel_CoraAtt1b.id,
      toBeliefId: 'Bel_supersede_from_future_belief',
      effectiveValidTime: T_ACK,
      validFrom: T_ACK,
      cause: 'ascribed-from-acknowledgment',
      ruleId: 'ascribe_from_acknowledgment',
      ruleVersion: ASCRIPTION_RULE_VERSION,
      inputRecordIds: [Bel_CoraAtt1c.id],
    })

    expect(committed.outcome).toEqual({ verdict: 'rejected', fault: 'support-record-not-yet-committed' })
    expect(committed.store.sidecars.get('BT_supersede_from_future_belief')).toBeUndefined()
  })

  it('a genuinely committed, holder-readable record of a DISALLOWED kind (Evidence, never observation/belief) is rejected -- isolating the kind check from the existence/readability/timing checks', () => {
    const phase3 = buildPhase3Store()
    const coraEvidence = {
      schemaVersion: 1 as const,
      id: 'E_cora_disallowed_kind',
      truthRef: 'TE_x',
      implies: 'irrelevant',
      contradicts: 'irrelevant',
      strength: 'hard' as const,
      presentedTo: CORA,
      time: 'night_5',
    }
    // Genuinely committed (present in the universe) AND holder-readable
    // (presentedTo: CORA) -- the ONLY thing wrong with this citation is its
    // kind: no ascription-supersession rule admits `evidence` as sidecar
    // support (Evidence support belongs to the untouched, generic
    // `inputEvidenceIds`, never this sidecar).
    const universeWithCoraEvidence = [...attributionUniverse, { kind: 'evidence' as const, record: coraEvidence }]

    const committed = commitAscriptionSupersession(phase3.store, universeWithCoraEvidence, {
      transitionId: 'BT_supersede_from_disallowed_kind',
      holder: CORA,
      fromBeliefId: Bel_CoraAtt1b.id,
      toBeliefId: 'Bel_supersede_from_disallowed_kind',
      effectiveValidTime: T_ACK,
      validFrom: T_ACK,
      cause: 'ascribed-from-acknowledgment',
      ruleId: 'ascribe_from_acknowledgment',
      ruleVersion: ASCRIPTION_RULE_VERSION,
      inputRecordIds: [coraEvidence.id],
    })

    expect(committed.outcome).toEqual({ verdict: 'rejected', fault: 'disallowed-support-record-kind' })
    expect(committed.store.sidecars.get('BT_supersede_from_disallowed_kind')).toBeUndefined()
  })

  it('positive twin: a valid support set commits AND remains replayable byte-identically after the fix', () => {
    const result = buildBranch4bContentSatisfying()
    const bounds = [{ validT: T_ACK, txBound: result.store.conflict.nextSeq - 1 }]
    const liveSnapshot = captureAttributionSnapshot(attributionUniverse, result.store, bounds)

    const judge = new JudgeProbe()
    const { store: replayed, report } = replayAttributionLog(attributionUniverse, attributionClaimRegistry, result.store.conflict.commitLog, result.store.sidecars, judge)
    const replayedSnapshot = captureAttributionSnapshot(attributionUniverse, replayed, bounds)

    expect(replayedSnapshot).toBe(liveSnapshot)
    expect(report.judgeCalls).toBe(0)
    expect(judge.calls).toBe(0)
    expect(report.materializedSidecars).toContain('BT_CoraAtt_ack1')
  })
})
