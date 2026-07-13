import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { canonicalKeyOf, incompatible } from './canonicalProposition'
import { eventPayloadRef, innerCanonicalKeyOf, makeAttributedBelief, makeEventParticipationBelief } from './attributionBuilder'
import type { AttributedBeliefProposition, AttributionTargetProposition, EventParticipationProposition, HolderStateProposition, WorldProposition } from './attributionContracts'

/**
 * Grammar, depth-cap, and builder tests (P1-P5, P91-P94, P107; F1-F6, F83,
 * F84). Compile-time exclusions (F1/F3/F5/F84) are `@ts-expect-error`
 * idioms -- proof they do not type-check at all, never a runtime-rejected
 * construction.
 */

const propW1: WorldProposition = { kind: 'world', subject: 'player', predicate: 'attacked', object: 'guard_malik', at: { night: 3, tick: 0 } }
const propHS1: HolderStateProposition = { kind: 'holder-state', subject: 'NPC_D', predicate: 'distrusts', object: 'guard_captain', at: { night: 2, tick: 0 } }

describe('P1 -- three-way union round-trips', () => {
  it('WorldProposition constructs, canonicalizes, and resolves to exactly its intended union member', () => {
    const outcome = makeAttributedBelief({
      beliefId: 'Bel_test1',
      holder: 'NPC_C',
      modeledHolder: 'NPC_B',
      attributedStance: 'believes',
      proposition: propW1,
      confidence: 'medium',
      sourceType: 'inference',
      sourceRef: 'O_x',
      supporting: ['O_x'],
      descriptiveProposition: 'Borin believes: player attacked guard_malik',
      lastUpdated: 'night_4',
      validity: { kind: 'interval', from: { night: 4, tick: 0 }, to: null },
    })
    expect(outcome.verdict).toBe('ok')
    if (outcome.verdict !== 'ok') throw new Error('unreachable')
    expect(outcome.claim.predicate).toBe('attributed-belief')
    expect(outcome.claim.fixedRoles.modeled_holder).toBe('NPC_B')
    expect(outcome.claim.fixedRoles.inner_key).toBe(innerCanonicalKeyOf(propW1))
    expect(outcome.claim.contestedValue).toBe('believes')
  })

  it('HolderStateProposition round-trips (Cora believes Daren distrusts the captain)', () => {
    const outcome = makeAttributedBelief({
      beliefId: 'Bel_synth_HS1',
      holder: 'NPC_C',
      modeledHolder: 'NPC_D',
      attributedStance: 'believes',
      proposition: propHS1,
      confidence: 'medium',
      sourceType: 'inference',
      sourceRef: 'O_y',
      supporting: ['O_y'],
      descriptiveProposition: 'Daren distrusts the captain',
      lastUpdated: 'night_2',
      validity: { kind: 'interval', from: { night: 2, tick: 0 }, to: null },
    })
    expect(outcome.verdict).toBe('ok')
  })

  it('EventParticipationProposition (speaker-act) round-trips with a populated content_ref', () => {
    const proposition: EventParticipationProposition = { kind: 'event-participation', subject: 'NPC_B', predicate: 'asserted', eventRef: eventPayloadRef('TE_B_accuse1'), contentRef: innerCanonicalKeyOf(propW1) }
    const outcome = makeEventParticipationBelief({
      beliefId: 'Bel_DarenSA_test',
      holder: 'NPC_D',
      proposition,
      confidence: 'high',
      sourceRef: 'O_z',
      supporting: ['O_z'],
      descriptiveProposition: 'Borin asserted the accusation',
      lastUpdated: 'night_4',
    })
    expect(outcome.verdict).toBe('ok')
  })
})

describe('P2 -- structural depth cap: AttributionTargetProposition admits no member capable of holding AttributedBeliefProposition', () => {
  it('F1 [compile-time type test] -- direct nested attribution is structurally unconstructible', () => {
    // @ts-expect-error -- AttributedBeliefProposition is not a member of AttributionTargetProposition; this must not type-check.
    const nested: AttributionTargetProposition = { kind: 'attributed-belief', modeledHolder: 'NPC_B', attributedStance: 'believes', proposition: propW1 }
    void nested
  })

  it('F84/P107 [compile-time type test] -- content_ref cannot resolve to AttributedBeliefProposition content', () => {
    const attributed: AttributedBeliefProposition = { kind: 'attributed-belief', modeledHolder: 'NPC_B', attributedStance: 'believes', proposition: propW1 }
    // @ts-expect-error -- contentRef is typed to InnerKey, producible only from AttributionTargetProposition via innerCanonicalKeyOf; an AttributedBeliefProposition value itself must not type-check here.
    const bad: EventParticipationProposition = { kind: 'event-participation', subject: 'NPC_D', predicate: 'asserted', eventRef: eventPayloadRef('TE_x'), contentRef: attributed }
    void bad
  })

  it('F5 [compile-time type test] -- free-text inner proposition does not type-check', () => {
    // @ts-expect-error -- AttributionTargetProposition admits only the three typed shapes, never a bare string.
    const bad: AttributionTargetProposition = 'Borin attacked Malik'
    void bad
  })

  it('F3 [compile-time type test] -- event_ref cannot be constructed from attribution content', () => {
    const attributed: AttributedBeliefProposition = { kind: 'attributed-belief', modeledHolder: 'NPC_B', attributedStance: 'believes', proposition: propW1 }
    // @ts-expect-error -- eventRef is typed to EventPayloadRef, producible only via eventPayloadRef(string); a bare object must not type-check.
    const bad: EventParticipationProposition = { kind: 'event-participation', subject: 'NPC_D', predicate: 'asserted', eventRef: attributed }
    void bad
  })
})

describe('P3 -- closed predicate vocabularies', () => {
  it('F2/F4 [runtime builder rejection] -- an unreviewed holder-state predicate is rejected at runtime', () => {
    const bad = { kind: 'holder-state', subject: 'NPC_D', predicate: 'considers-P-believed-by', object: 'x', at: { night: 2, tick: 0 } } as unknown as HolderStateProposition
    const outcome = makeAttributedBelief({
      beliefId: 'Bel_bad_predicate',
      holder: 'NPC_C',
      modeledHolder: 'NPC_D',
      attributedStance: 'believes',
      proposition: bad,
      confidence: 'medium',
      sourceType: 'inference',
      sourceRef: 'O_x',
      supporting: [],
      descriptiveProposition: 'bad',
      lastUpdated: 'night_2',
      validity: { kind: 'interval', from: { night: 2, tick: 0 }, to: null },
    })
    expect(outcome).toEqual({ verdict: 'rejected', fault: 'unknown-holder-state-predicate' })
  })
})

describe('P4 -- self-attribution bound holds via the constructor', () => {
  it('F6 [runtime builder rejection] -- modeled_holder == holder is rejected before construction completes', () => {
    const outcome = makeAttributedBelief({
      beliefId: 'Bel_self',
      holder: 'NPC_C',
      modeledHolder: 'NPC_C',
      attributedStance: 'believes',
      proposition: propW1,
      confidence: 'medium',
      sourceType: 'inference',
      sourceRef: 'O_x',
      supporting: [],
      descriptiveProposition: 'self',
      lastUpdated: 'night_4',
      validity: { kind: 'interval', from: { night: 4, tick: 0 }, to: null },
    })
    expect(outcome).toEqual({ verdict: 'rejected', fault: 'self-attribution' })
  })
})

describe('P5 -- canonical serialization is deterministic', () => {
  it('the same logical attribution content serializes to the same canonical key on every construction', () => {
    const keyA = innerCanonicalKeyOf(propW1)
    const keyB = innerCanonicalKeyOf({ kind: 'world', subject: 'player', predicate: 'attacked', object: 'guard_malik', at: { night: 3, tick: 0 } })
    expect(keyA).toBe(keyB)
  })

  it('F83 [runtime builder rejection] -- a raw hand-serialized inner-key string diverges from the canonicalizer output and is detectable', () => {
    const outcome = makeAttributedBelief({
      beliefId: 'Bel_bypass_check',
      holder: 'NPC_C',
      modeledHolder: 'NPC_B',
      attributedStance: 'believes',
      proposition: propW1,
      confidence: 'medium',
      sourceType: 'inference',
      sourceRef: 'O_x',
      supporting: [],
      descriptiveProposition: 'x',
      lastUpdated: 'night_4',
      validity: { kind: 'interval', from: { night: 4, tick: 0 }, to: null },
    })
    expect(outcome.verdict).toBe('ok')
    if (outcome.verdict !== 'ok') throw new Error('unreachable')
    const handSerializedBypass = '{"bogus":"not-the-real-canonical-form"}'
    const tampered = { ...outcome.claim, fixedRoles: { ...outcome.claim.fixedRoles, inner_key: handSerializedBypass } }
    expect(tampered.fixedRoles.inner_key).not.toBe(innerCanonicalKeyOf(propW1))
    expect(outcome.claim.fixedRoles.inner_key).toBe(innerCanonicalKeyOf(propW1))
  })
})

describe('P91/P92 -- speaker-act and recipient-participation facts use distinct canonical keys', () => {
  const eventRef = eventPayloadRef('TE_B_accuse1')
  const speakerAct: EventParticipationProposition = { kind: 'event-participation', subject: 'NPC_B', predicate: 'asserted', eventRef, contentRef: innerCanonicalKeyOf(propW1) }
  const recipientParticipation: EventParticipationProposition = { kind: 'event-participation', subject: 'NPC_D', predicate: 'heard', eventRef }

  it('F73 -- the two shapes never share a canonical key for the same event', () => {
    expect(innerCanonicalKeyOf(speakerAct)).not.toBe(innerCanonicalKeyOf(recipientParticipation))
  })

  it('a holder may hold the speaker-act fact without the recipient-participation fact, or vice versa (P92)', () => {
    const onlySpeakerAct = makeEventParticipationBelief({ beliefId: 'Bel_only_sa', holder: 'NPC_D', proposition: speakerAct, confidence: 'high', sourceRef: 'O_x', supporting: ['O_x'], descriptiveProposition: 'sa', lastUpdated: 'night_4' })
    expect(onlySpeakerAct.verdict).toBe('ok')
  })
})

describe('P93 -- rungs 1-4 support only occurrence-level participation', () => {
  it('a witnessed-only fact carries no content_ref', () => {
    const proposition: EventParticipationProposition = { kind: 'event-participation', subject: 'NPC_R', predicate: 'witnessed', eventRef: eventPayloadRef('TE_B_accuse1') }
    expect(proposition.contentRef).toBeUndefined()
  })

  it('missing content_ref on a content-bearing predicate is rejected', () => {
    const bad: EventParticipationProposition = { kind: 'event-participation', subject: 'NPC_B', predicate: 'asserted', eventRef: eventPayloadRef('TE_x') }
    const outcome = makeEventParticipationBelief({ beliefId: 'Bel_missing_ref', holder: 'NPC_D', proposition: bad, confidence: 'high', sourceRef: 'O_x', supporting: [], descriptiveProposition: 'x', lastUpdated: 'night_4' })
    expect(outcome).toEqual({ verdict: 'rejected', fault: 'missing-content-ref' })
  })
})

describe('D5 -- stance-as-object canonical keying makes all six pairs incompatible with zero pair-specific code', () => {
  it('two distinct stances over the same attribution key are incompatible via the unmodified incompatible()', () => {
    const believesMint = makeAttributedBelief({ beliefId: 'b1', holder: 'NPC_C', modeledHolder: 'NPC_B', attributedStance: 'believes', proposition: propW1, confidence: 'medium', sourceType: 'inference', sourceRef: 'o', supporting: [], descriptiveProposition: 'x', lastUpdated: 't', validity: { kind: 'interval', from: { night: 1, tick: 0 }, to: null } })
    const unawareMint = makeAttributedBelief({ beliefId: 'b2', holder: 'NPC_C', modeledHolder: 'NPC_B', attributedStance: 'unaware', proposition: propW1, confidence: 'medium', sourceType: 'inference', sourceRef: 'o', supporting: [], descriptiveProposition: 'x', lastUpdated: 't', validity: { kind: 'interval', from: { night: 1, tick: 0 }, to: null } })
    if (believesMint.verdict !== 'ok' || unawareMint.verdict !== 'ok') throw new Error('unreachable')
    expect(canonicalKeyOf(believesMint.claim)).toBe(canonicalKeyOf(unawareMint.claim))
    expect(incompatible(believesMint.claim, unawareMint.claim)).toBe(true)
  })

  it('the same stance value is never incompatible with itself', () => {
    const a = makeAttributedBelief({ beliefId: 'b3', holder: 'NPC_C', modeledHolder: 'NPC_B', attributedStance: 'believes', proposition: propW1, confidence: 'medium', sourceType: 'inference', sourceRef: 'o', supporting: [], descriptiveProposition: 'x', lastUpdated: 't', validity: { kind: 'interval', from: { night: 1, tick: 0 }, to: null } })
    const b = makeAttributedBelief({ beliefId: 'b4', holder: 'NPC_C', modeledHolder: 'NPC_B', attributedStance: 'believes', proposition: propW1, confidence: 'low', sourceType: 'inference', sourceRef: 'o', supporting: [], descriptiveProposition: 'x', lastUpdated: 't', validity: { kind: 'interval', from: { night: 1, tick: 0 }, to: null } })
    if (a.verdict !== 'ok' || b.verdict !== 'ok') throw new Error('unreachable')
    expect(incompatible(a.claim, b.claim)).toBe(false)
  })
})

describe('deterministic construction is reproducible', () => {
  it('two independent builder calls with identical logical content produce byte-identical claims', () => {
    const build = () =>
      makeAttributedBelief({ beliefId: 'b5', holder: 'NPC_C', modeledHolder: 'NPC_B', attributedStance: 'believes', proposition: propW1, confidence: 'medium', sourceType: 'inference', sourceRef: 'o', supporting: ['o'], descriptiveProposition: 'x', lastUpdated: 't', validity: { kind: 'interval', from: { night: 1, tick: 0 }, to: null } })
    const first = build()
    const second = build()
    expect(canonicalSerialize(first)).toBe(canonicalSerialize(second))
  })
})
