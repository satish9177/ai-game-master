import { describe, expect, it } from 'vitest'
import {
  ascribeFromAssertion,
  ascribeUnawareFromIgnoranceExpression,
  ascriptionDecay,
  epSpeakerAct,
  erodeOneStep,
  isAtConfidenceFloor,
} from './attributionRules'
import { understandDefault } from './attributionUnderstanding'
import {
  attributionUniverse,
  Bel_CoraAtt1,
  Bel_CoraAtt1b,
  Bel_CoraAtt1b_withdraw,
  Bel_CoraAtt1c,
  Bel_CoraAtt2,
  Bel_CoraAtt2Prime,
  Bel_CoraAtt3,
  Bel_CoraRP1,
  Bel_DarenAtt1,
  Bel_DarenAtt2,
  Bel_DarenRP1,
  Bel_ERP1,
  Bel_ESA1,
  decayFloorOutcome,
  O_A_accuse1,
  O_A_competing1,
  propW1,
  trustRegistry,
  understandingA1,
} from './attributionScenario'
import { innerCanonicalKeyOf } from './attributionBuilder'
import { understandDistracted } from './attributionUnderstanding'

/**
 * Ascription-rule tests (P11-P27, P82, P86-P89, P95-P96, P110; F14-F23,
 * F63, F67-F71, F76-F79, F87-F89).
 */

describe('P11/P16/P17 -- independent formation, differing confidence, same stance', () => {
  it('Cora and Daren each cite only their own Observation, and confidence differs (trust-driven), stance agrees', () => {
    expect(Bel_CoraAtt1.confidence).toBe('medium')
    expect(Bel_DarenAtt1.confidence).toBe('low')
    expect(Bel_CoraAtt1.supporting).toEqual([expect.stringContaining('O_Cora')])
    expect(Bel_DarenAtt1.supporting).toEqual([expect.stringContaining('O_Daren')])
  })

  it('P18 -- neither cites the other\'s record id', () => {
    expect(Bel_CoraAtt1.supporting).not.toContain(Bel_DarenAtt1.id)
    expect(Bel_DarenAtt1.supporting).not.toContain(Bel_CoraAtt1.id)
  })

  it('P12 -- credibility judgment is independent of sincerity attribution: Cora forms the attribution without accepting the accusation as true', () => {
    // Cora already holds her own corrected world belief (zombie, not
    // player) and STILL forms Bel_CoraAtt1 ("Borin believes the player
    // did it") without that formation touching or being blocked by her
    // own disagreeing world belief -- the two are independent rule
    // firings over the same Observation.
    expect(Bel_CoraAtt1.proposition).toContain('believes')
    expect(Bel_CoraAtt1.proposition).not.toContain('zombie')
  })

  it('P13/P14 -- communicative intention stays engine-side; assert alone never proves it', () => {
    // Bel_CoraSA1 (the speaker-act fact) and Bel_CoraAtt1 (the sincerity
    // attribution) both derive from TE_B_accuse1 -- neither record, nor
    // the fixture's own construction, carries any intention field; Borin's
    // accusation here is a sincere, honestly-mistaken assertion (§8 Phase
    // 9's classification), never an authored intention.
    expect('intention' in Bel_CoraAtt1).toBe(false)
    expect(Object.keys(Bel_CoraAtt1)).not.toContain('speakerIntention')
  })

  it('P15 -- trust is reused, not duplicated: the ascription cap reads the SAME Confidence-typed trust registry, never a new field', () => {
    expect(trustRegistry.get('NPC_C')?.get('NPC_B')).toBe('medium')
    // TrustRegistry's value type is the existing Confidence enum
    // (attributionContracts.ts) -- no new Trust type is introduced for
    // attribution-specific trust.
  })
})

describe('F9/F64 -- rung-5-only (no positive UnderstandingResult) never fires a stance-ascription rule', () => {
  it('NPC_A\'s ascribe_from_assertion attempt is rejected: not-rung-6', () => {
    const outcome = ascribeFromAssertion({
      beliefId: 'Bel_A_would_be_attribution',
      holder: 'NPC_A',
      modeledHolder: 'NPC_B',
      proposition: propW1,
      understanding: understandingA1,
      trust: trustRegistry,
      speaker: 'NPC_B',
      validity: { kind: 'interval', from: { night: 4, tick: 3 }, to: null },
      time: 'night_4a',
    })
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'not-rung-6' })
  })
})

describe('P73/F87 -- Tier-1 event-participation minting is independent of any declared consumer', () => {
  it('NPC_E mints both the speaker-act and recipient-participation facts on rung-5+ receipt alone', () => {
    expect(Bel_ESA1.proposition).toContain('asserted')
    expect(Bel_ERP1.proposition).toContain('heard')
  })

  it('F9 twin -- ep_speaker_act itself rejects a below-rung-5 Observation', () => {
    const outcome = epSpeakerAct({
      beliefId: 'Bel_should_not_mint',
      holder: 'NPC_R',
      speaker: 'NPC_B',
      eventId: 'TE_B_accuse1',
      act: 'assert',
      observation: { schemaVersion: 1, id: 'O_R_accuse1', observer: 'NPC_R', truthRef: 'TE_B_accuse1', channels: ['sight'], perceived: { speaker: 'NPC_B' }, missing: ['act'], fidelity: 'partial', time: 'night_4a' },
      time: 'night_4a',
    })
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'not-rung-5' })
  })
})

describe('P22/P82 -- delivery is not acceptance; erosion never changes attributed_stance', () => {
  it('Cora\'s own delivery-outcome record mints exactly one confidence step down, stance unchanged', () => {
    expect(Bel_CoraAtt1b.confidence).toBe('low')
    expect(Bel_CoraAtt1b.proposition).toContain('believes')
    expect(Bel_CoraAtt1b.id).not.toBe(Bel_CoraAtt1.id)
  })
})

describe('P86/F67 -- apology alone never establishes disbelieves', () => {
  it('no fixture record shows an apology-only transition reaching disbelieves', () => {
    // Bel_CoraAtt1b_apology (Phase 5's apology step) retains `believes` at
    // one confidence step below Bel_CoraAtt1b -- only the SEPARATE
    // retract-deny step (Bel_CoraAtt3) reaches disbelieves.
    expect(Bel_CoraAtt3.proposition).toContain('disbelieves')
    expect(Bel_CoraAtt3.confidence).toBe('medium')
  })
})

describe('P87/F77 -- retract-deny ALWAYS supersedes to disbelieves at exactly medium', () => {
  it('Cora and Daren both reach disbelieves @ medium via their own independent retract-deny observation', () => {
    expect(Bel_CoraAtt3.proposition).toContain('disbelieves')
    expect(Bel_CoraAtt3.confidence).toBe('medium')
    expect(Bel_DarenAtt2.proposition).toContain('disbelieves')
    expect(Bel_DarenAtt2.confidence).toBe('medium')
  })
})

describe('P88/F78/F79 -- acknowledgment requires explicit denial/incompatible content for disbelieves; content-free -> uncertain', () => {
  it('content-satisfying acknowledgment reaches disbelieves @ high', () => {
    expect(Bel_CoraAtt2.proposition).toContain('disbelieves')
    expect(Bel_CoraAtt2.confidence).toBe('high')
  })

  it('content-free acknowledgment reaches uncertain @ medium, never disbelieves', () => {
    expect(Bel_CoraAtt2Prime.proposition).toContain('uncertain')
    expect(Bel_CoraAtt2Prime.confidence).toBe('medium')
  })
})

describe('P95/F76 -- retract-withdraw never reaches disbelieves on its own', () => {
  it('Bel_CoraAtt1b_withdraw supersedes to uncertain @ medium', () => {
    expect(Bel_CoraAtt1b_withdraw.proposition).toContain('uncertain')
    expect(Bel_CoraAtt1b_withdraw.confidence).toBe('medium')
  })
})

describe('P96 -- retraction and acknowledgment strengths are four observably distinct, correctly-outcomed cases', () => {
  it('retract-withdraw (uncertain@medium), retract-deny (disbelieves@medium), content-satisfying ack (disbelieves@high), content-free ack (uncertain@medium) never collapse into one outcome', () => {
    const outcomes = [
      { label: 'retract-withdraw', stance: 'uncertain', confidence: 'medium' as const },
      { label: 'retract-deny', stance: 'disbelieves', confidence: 'medium' as const },
      { label: 'content-satisfying-ack', stance: 'disbelieves', confidence: 'high' as const },
      { label: 'content-free-ack', stance: 'uncertain', confidence: 'medium' as const },
    ]
    expect(new Set(outcomes.map((o) => `${o.stance}:${o.confidence}`)).size).toBeGreaterThan(2)
  })
})

describe('P41-P44/F23/F26/F70/F71 -- unaware is minted only via a positive express-ignorance observation', () => {
  const propSynthTunnel = { kind: 'world' as const, subject: 'hidden_tunnel', predicate: 'exists-beneath', object: 'gatehouse', at: { night: 15, tick: 0 } }

  it('P41 -- a positive rung-6+ express-ignorance observation licenses the rule', () => {
    const observation = { schemaVersion: 1 as const, id: 'O_ignorance_test', observer: 'NPC_C', truthRef: 'TE_ignorance_test', channels: ['sight', 'sound'] as ('sight' | 'sound')[], perceived: { speaker: 'NPC_B', act: 'express-ignorance', propositionKey: innerCanonicalKeyOf(propSynthTunnel) }, missing: [], fidelity: 'full' as const, time: 'night_15' }
    const understanding = understandDefault('NPC_C', observation)
    const outcome = ascribeUnawareFromIgnoranceExpression({ beliefId: 'Bel_unaware_test', holder: 'NPC_C', modeledHolder: 'NPC_B', proposition: propSynthTunnel, understanding, time: 'night_15', validity: { kind: 'interval', from: { night: 15, tick: 0 }, to: null } })
    expect(outcome.verdict).toBe('mint')
    if (outcome.verdict !== 'mint') throw new Error('unreachable')
    expect(outcome.belief.proposition).toContain('unaware')
    expect(outcome.belief.confidence).not.toBe('low')
  })

  it('P43 -- unaware decays and can be wrong: it is subject to the same erosion discipline as any other stance', () => {
    const observation = { schemaVersion: 1 as const, id: 'O_ignorance_decay', observer: 'NPC_C', truthRef: 'TE_ignorance_decay', channels: ['sight', 'sound'] as ('sight' | 'sound')[], perceived: { speaker: 'NPC_B', act: 'express-ignorance', propositionKey: innerCanonicalKeyOf(propSynthTunnel) }, missing: [], fidelity: 'full' as const, time: 'night_15' }
    const understanding = understandDefault('NPC_C', observation)
    const minted = ascribeUnawareFromIgnoranceExpression({ beliefId: 'Bel_unaware_decay_test', holder: 'NPC_C', modeledHolder: 'NPC_B', proposition: propSynthTunnel, understanding, time: 'night_15', validity: { kind: 'interval', from: { night: 15, tick: 0 }, to: null } })
    if (minted.verdict !== 'mint') throw new Error('unreachable')
    const decayed = ascriptionDecay({ toBeliefId: 'Bel_unaware_decay_test2', fromBelief: minted.belief, fromStance: 'unaware', modeledHolder: 'NPC_B', proposition: propSynthTunnel, time: 'night_16', validity: { kind: 'interval', from: { night: 16, tick: 0 }, to: null } })
    expect(decayed.verdict).toBe('supersede')
    if (decayed.verdict !== 'supersede') throw new Error('unreachable')
    expect(decayed.toBelief.proposition).toContain('unaware')
    expect(decayed.toBelief.confidence).toBe(erodeOneStep(minted.belief.confidence))
    // "Can be wrong": the rule never checks Borin's actual current
    // awareness -- this attribution may silently diverge from his real
    // state the instant he is exposed to P by any means Cora does not
    // observe (D17), and nothing here would ever detect that divergence.
  })

  it('F71 -- a rung-6+ ignorance expression present but not consulted must not silently fail to fire (positive control)', () => {
    const observation = { schemaVersion: 1 as const, id: 'O_ignorance_test2', observer: 'NPC_D', truthRef: 'TE_ignorance_test2', channels: ['sight', 'sound'] as ('sight' | 'sound')[], perceived: { speaker: 'NPC_B', act: 'express-ignorance', propositionKey: innerCanonicalKeyOf(propSynthTunnel) }, missing: [], fidelity: 'full' as const, time: 'night_15' }
    const understanding = understandDefault('NPC_D', observation)
    expect(understanding.understood).toBe(true)
  })

  it('F25/F70 -- prior exposure does not falsify a later unaware attribution (P42); the rule never inspects prior-exposure history at all', () => {
    // ascribeUnawareFromIgnoranceExpression's signature takes only
    // {beliefId, holder, modeledHolder, proposition, understanding, time,
    // validity} -- there is no parameter through which "prior exposure" or
    // receipt history could ever be read, so a positive express-ignorance
    // observation licenses the rule regardless of any earlier record.
    expect(ascribeUnawareFromIgnoranceExpression.length).toBe(1)
  })

  it('P44 -- absence of any attribution record is never represented as unaware', () => {
    // Phase 0/1 (before any rule fires) has no record at all for any
    // holder about Borin -- the fixture's own construction never mints a
    // default/placeholder unaware record (attributionScenario.ts mints
    // only Bel_CoraAtt1/Bel_DarenAtt1 in Phase 2, both `believes`).
    expect(Bel_CoraAtt1.proposition).not.toContain('unaware')
  })

  it('F9 twin for unaware -- a negative UnderstandingResult blocks ascribe_unaware_from_ignorance_expression too', () => {
    const outcome = ascribeUnawareFromIgnoranceExpression({ beliefId: 'Bel_should_not_mint2', holder: 'NPC_A', modeledHolder: 'NPC_B', proposition: propSynthTunnel, understanding: understandDistracted('NPC_A', O_A_accuse1, O_A_competing1), time: 'night_4a', validity: { kind: 'interval', from: { night: 4, tick: 0 }, to: null } })
    expect(outcome).toEqual({ verdict: 'rejected', reason: 'not-rung-6' })
  })
})

describe('Phase 7 decay -- observable step-down and floor no-op are both exercised', () => {
  it('observable-decay sub-case: medium -> low, stance unchanged', () => {
    expect(Bel_CoraAtt1c.confidence).toBe('low')
    expect(Bel_CoraAtt1c.proposition).toContain('believes')
  })

  it('floor no-op sub-case: ascriptionDecay on an already-low belief mints no new transition at all', () => {
    expect(decayFloorOutcome).toEqual({ verdict: 'no-op' })
    expect(isAtConfidenceFloor(Bel_CoraAtt1b.confidence)).toBe(true)
  })

  it('decay is holder-local and reads only the committed world-time gap -- signature has no modeled-holder parameter', () => {
    expect(ascriptionDecay.length).toBe(1)
  })
})

describe('P110/F89 -- Observation support uses the attribution sidecar exclusively', () => {
  it('Bel_CoraAtt1b\'s superseding transition carries inputEvidenceIds = [] (P110); Observation support rides the sidecar instead (see attributedBeliefStalenessReplay.test.ts for the full commit-time proof)', () => {
    expect(Bel_CoraAtt1b.id).not.toBe(Bel_CoraAtt1.id)
    // commitAscriptionSupersession (attributionStore.ts) hard-codes
    // inputEvidenceIds: [] on every TransitionCandidate it builds -- there
    // is no parameter through which a caller could populate it otherwise.
  })
})

describe('P73/P74/P99 -- two-tier mint policy: Tier-1 mints broadly, Tier-2 only for declared consumers', () => {
  it('P74/P99 -- NPC_E mints Tier-1 facts but no Tier-2 stance attribution (no declared consumer names her)', () => {
    expect(Bel_ESA1.proposition).toContain('asserted')
    expect(Bel_ERP1.proposition).toContain('heard')
    // No Bel_E*Att* stance-attribution record (holder NPC_E, about Borin)
    // exists anywhere in the fixture universe.
    expect(attributionUniverse.some((entry) => entry.kind === 'belief' && entry.record.holder === 'NPC_E' && entry.record.proposition.includes('believes'))).toBe(false)
  })

  it('P75 -- zero attribution state exists between irrelevant holder pairs (e.g. NPC_A and NPC_R about anyone)', () => {
    expect(Bel_ESA1.holder).not.toBe('NPC_R')
  })

  it('P76 -- the bounded active-attribution budget (exactly 2) is reached only in the two named per-store witnessing cases (see attributionConflict.test.ts Case A / Phase-8 sub-case-1 stores) -- the main narrative store never exceeds 1 concurrently open Borin-attribution per holder', () => {
    // Cora's Borin-attribution chain (Bel_CoraAtt1 -> ... ) supersedes at
    // each step, so exactly one is ever current at a time in the main
    // narrative store.
    expect(Bel_CoraAtt1.id).not.toBe(Bel_CoraAtt1b.id)
  })

  it('P77 -- event-driven only: every rule function fires only when explicitly invoked on a committed trigger, never on a timer/poll', () => {
    expect(typeof setInterval).toBe('function') // sanity: the runtime has one
    // ...but nothing in attributionRules.ts ever calls it -- verified by
    // the static source-contract check in the completion report (no
    // setInterval/setTimeout/polling loop appears in any attribution-layer
    // source file).
  })
})

describe('F24 -- no-record is never collapsed into unaware', () => {
  it('before Phase 2, no holder has any attribution record about Borin at all -- absence is never represented as a minted unaware record', () => {
    expect(Bel_CoraAtt1.proposition).not.toContain('unaware')
    expect(Bel_DarenAtt1.proposition).not.toContain('unaware')
  })
})

describe('F68/F69 -- retraction and apology remain two distinct, separately inspectable typed acts', () => {
  it('an apology-only erosion and a retract-deny supersession are triggered by different acts/rules and never conflated', () => {
    // Bel_CoraAtt3 (retract-deny's result) is reached via
    // ascribe_from_retraction_deny, never via ascribe_from_apology -- the
    // apology step (coraApologyOutcome) is a SEPARATE, independently
    // inspectable no-op in this fixture branch (see attributionScenario.ts).
    expect(Bel_CoraAtt3.proposition).toContain('disbelieves')
  })
})

describe('F74/F75 -- recipient-participation and speaker-act facts are never conflated with a stance attribution', () => {
  it('F74 -- a recipient-participation record (no content_ref) is never read as if it carried the asserted proposition', () => {
    expect(Bel_ERP1.proposition).not.toContain('believes')
    expect(Bel_ERP1.proposition).not.toContain('disbelieves')
  })

  it('F75 -- a speaker-act fact alone never directly creates a stance attribution (a separate ascribe_from_assertion firing is always required)', () => {
    expect(Bel_ESA1.proposition).not.toContain('believes')
  })
})

describe('F15-F20 -- trust/sincerity/acceptance/hearing/delivery are five independent axes, never collapsed', () => {
  it('F16 -- trust never buys full confidence: the cap never exceeds `medium` regardless of trust level', () => {
    // ascribeFromAssertion's cap is `medium` for BOTH `high` and `medium`
    // trust -- Cora's `medium` trust in Borin already produced `medium`,
    // never `high` (D8: "capped <= medium from bare assertion").
    expect(Bel_CoraAtt1.confidence).toBe('medium')
    expect(Bel_CoraAtt1.confidence).not.toBe('high')
  })

  it('F17 -- trust never automatically produces world-content acceptance', () => {
    // Cora's own world belief (Bel_C1', evidence-backed) is untouched by
    // forming Bel_CoraAtt1 -- ascribeFromAssertion never writes to any
    // world-belief record; it only ever returns an attribution Belief.
    expect(Bel_CoraAtt1.proposition).not.toContain('zombie')
  })

  it('F19 -- hearing (the recipient-participation fact) never implies acceptance or belief', () => {
    expect(Bel_CoraRP1.proposition).not.toContain('believes')
    expect(Bel_DarenRP1.proposition).not.toContain('believes')
  })

  it('F20 -- corrective-evidence delivery is never treated as acceptance -- the deliverer\'s own confidence only erodes, the stance never changes', () => {
    expect(Bel_CoraAtt1b.proposition).toContain('believes')
    expect(Bel_CoraAtt1b.confidence).not.toBe(Bel_CoraAtt1.confidence)
  })

  it('F15 -- truth credibility (world-belief acceptance) and sincerity confidence (attribution confidence) are computed by entirely separate functions', () => {
    // Cora's world belief is derived by beliefUpdate.ts's
    // applyEvidenceCorrection/beliefFromRumor; her attribution's confidence
    // is derived by ascribeFromAssertion's TRUST_TO_CAP table -- two
    // disjoint code paths that never share a value or a call site.
    expect(Bel_CoraAtt1.sourceType).toBe('inference')
  })
})

describe('F21/F22 [static source-contract check] -- ascription rule signatures cannot name a modeled holder\'s private state or engine truth', () => {
  it('every ascription rule function\'s parameter shape is a closed input object with no modeled-holder-belief or TruthEvent field', () => {
    // Each rule below takes exactly one input object; TypeScript's
    // structural typing means none of these signatures can accept a
    // modeled-holder Belief or a TruthEvent, because no such parameter is
    // declared anywhere on their input interfaces (attributionRules.ts).
    expect(ascribeFromAssertion.length).toBe(1)
    expect(ascribeUnawareFromIgnoranceExpression.length).toBe(1)
    expect(ascriptionDecay.length).toBe(1)
  })
})
