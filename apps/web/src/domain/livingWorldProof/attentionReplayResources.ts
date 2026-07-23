/**
 * Stage A / A5 — the proof-local authoritative-domain resources P2 isolation
 * is tested against, and a minimal deterministic authoritative commit/log
 * fold to compare. Proof-local to `domain/livingWorldProof`; not a
 * production module, reducer, event, store, migration, or persistence
 * contract, and not an adapter to any real RNG, clock, or scheduler.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D19 P2 "no shared mutable RNG stream; no shared mutable ID/sequence
 *    allocator; no authoritative scheduler-slot consumption; no wall-clock-
 *    derived authoritative value; no mutable cache shared with authoritative
 *    reducers");
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§9 "P2 — fixed-input world noninterference", the P2-N1…P2-N3 negative
 *    controls and positive-control list);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§8 "3. P2 — Authoritative Noninterference", the five named negative
 *    controls and three positive controls; §9 A5 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * **Why this file exists at all.** The real production authoritative path
 * (`domain/world/events.ts`, `applyEvent.ts`, `WorldSession.ts`) is untouched
 * by every Stage A slice (plan §2/§4), and A1-A4 already prove, statically,
 * that no Stage A module names any RNG, wall-clock, or scheduler primitive
 * (`attentionLedgerStaticClosure.test.ts` FORBIDDEN_SOURCE_PATTERNS). The
 * Stage A attention pipeline therefore has no real resource to leak into: it
 * consumes no RNG, ID, scheduler slot, cache, or wall-clock value today, by
 * construction. P2's noninterference claim is proven honestly by
 * demonstrating the isolation property over a small, deterministic,
 * proof-local stand-in for "an authoritative reducer that does consume these
 * resources" — the same discipline the ADR itself requires production
 * reducers to satisfy — rather than by asserting it vacuously.
 *
 * **What is real here and what is deliberately fake.** The authoritative
 * commit fold below is a genuine, if minimal, deterministic reducer: given
 * an RNG stream, an ID allocator, a scheduler resource, a reducer cache, and
 * an injected (never wall-clock) "world-time" input, it commits one record
 * per call and its output is a pure function of those inputs. What is
 * deliberately fake is the *coupling* helpers at the bottom of this file:
 * they exist only so `attentionP2Noninterference.test.ts`'s negative
 * controls can simulate "what if the attention pass shared this resource",
 * a fault Stage A's real code structurally cannot commit. Their names say so
 * and they are never called from `attentionReplay.ts`'s real (isolated)
 * paths.
 *
 * Determinism: every function here is pure. No `Math.random`, `crypto`,
 * `Date.now`, `setTimeout`, or any other wall-clock/RNG/scheduler primitive
 * is used — the RNG is a seeded linear congruential generator, "wall clock"
 * is an injected plain number the caller supplies and this module never
 * reads a real clock to produce, and "scheduler slot" is a plain counter.
 */
import { canonicalSerialize, mintHash } from './canonicalSerialization'

// ---------------------------------------------------------------------------
// Deterministic authoritative-domain resource stand-ins
// ---------------------------------------------------------------------------

/** A seeded, pure linear-congruential stream. Never `Math.random`. */
export interface AttentionReplayRngStream {
  readonly seed: number
  readonly draws: number
}

export function createAttentionReplayRngStream(seed: number): AttentionReplayRngStream {
  return Object.freeze({ seed, draws: 0 })
}

const LCG_MULTIPLIER = 1103515245
const LCG_INCREMENT = 12345
const LCG_MODULUS = 0x7fffffff

/** Pure next-value step: no shared mutable state, no global generator. */
export function drawAttentionReplayRngValue(
  stream: AttentionReplayRngStream,
): { readonly value: number; readonly stream: AttentionReplayRngStream } {
  const nextSeed = (stream.seed * LCG_MULTIPLIER + LCG_INCREMENT) % LCG_MODULUS
  return {
    value: nextSeed,
    stream: Object.freeze({ seed: nextSeed, draws: stream.draws + 1 }),
  }
}

/** A pure counter. Never `crypto.randomUUID`. */
export interface AttentionReplayIdAllocator {
  readonly nextId: number
}

export function createAttentionReplayIdAllocator(start: number): AttentionReplayIdAllocator {
  return Object.freeze({ nextId: start })
}

export function allocateAttentionReplayId(
  allocator: AttentionReplayIdAllocator,
): { readonly id: number; readonly allocator: AttentionReplayIdAllocator } {
  return { id: allocator.nextId, allocator: Object.freeze({ nextId: allocator.nextId + 1 }) }
}

/** A pure token counter standing in for scheduler-slot consumption. */
export interface AttentionReplaySchedulerResource {
  readonly slotsConsumed: number
}

export function createAttentionReplaySchedulerResource(): AttentionReplaySchedulerResource {
  return Object.freeze({ slotsConsumed: 0 })
}

export function consumeAttentionReplaySchedulerSlot(
  resource: AttentionReplaySchedulerResource,
): { readonly token: number; readonly resource: AttentionReplaySchedulerResource } {
  return {
    token: resource.slotsConsumed,
    resource: Object.freeze({ slotsConsumed: resource.slotsConsumed + 1 }),
  }
}

/** A mutable-cache stand-in: a plain frozen key/value map, replaced (never mutated) on write. */
export interface AttentionReplayReducerCache {
  readonly entries: Readonly<Record<string, string>>
}

export function createAttentionReplayReducerCache(
  entries: Readonly<Record<string, string>> = {},
): AttentionReplayReducerCache {
  return Object.freeze({ entries: Object.freeze({ ...entries }) })
}

export function writeAttentionReplayReducerCache(
  cache: AttentionReplayReducerCache,
  key: string,
  value: string,
): AttentionReplayReducerCache {
  return Object.freeze({ entries: Object.freeze({ ...cache.entries, [key]: value }) })
}

function digestAttentionReplayReducerCache(cache: AttentionReplayReducerCache): string {
  return mintHash(canonicalSerialize(cache.entries))
}

/**
 * An injected "world-time" input. The type is a plain number so nothing in
 * this module can be tempted to read a real clock for it — the caller is the
 * only source, exactly as ADR-0013 D15 requires world time be read from
 * committed state, never wall clock.
 */
export type AttentionReplayWallClockInput = number

// ---------------------------------------------------------------------------
// A minimal, genuine deterministic authoritative commit/log fold
// ---------------------------------------------------------------------------

export interface AttentionReplayAuthoritativeCommit {
  readonly commitSeq: number
  readonly commandId: string
  readonly rngValue: number
  readonly allocatedId: number
  readonly schedulerToken: number
  readonly reducerCacheDigestAtCommit: string
  readonly wallClockInputAtCommit: AttentionReplayWallClockInput
}

export interface AttentionReplayAuthoritativeLog {
  readonly commits: readonly AttentionReplayAuthoritativeCommit[]
}

export function createAttentionReplayAuthoritativeLog(): AttentionReplayAuthoritativeLog {
  return Object.freeze({ commits: Object.freeze([]) })
}

export interface AttentionReplayAuthoritativeResources {
  readonly log: AttentionReplayAuthoritativeLog
  readonly rng: AttentionReplayRngStream
  readonly idAllocator: AttentionReplayIdAllocator
  readonly scheduler: AttentionReplaySchedulerResource
  readonly cache: AttentionReplayReducerCache
  /**
   * Negative-control-only. `undefined` on every real path (`createAttention
   * ReplayAuthoritativeResources` never sets it, and nothing in
   * `attentionReplay.ts`'s director-on composition ever can, because that
   * module accepts no authoritative resource of any kind). When a P2
   * negative control deliberately sets this field, it stands in for "attention
   * execution has already written into a shared authoritative wall-clock-
   * derived slot before the authoritative commit reads it" — the one D19 P2
   * isolation channel the four other coupling helpers below do not cover.
   */
  readonly wallClockAuthorityOverride?: AttentionReplayWallClockInput
}

export function createAttentionReplayAuthoritativeResources(seed: number): AttentionReplayAuthoritativeResources {
  return Object.freeze({
    log: createAttentionReplayAuthoritativeLog(),
    rng: createAttentionReplayRngStream(seed),
    idAllocator: createAttentionReplayIdAllocator(1),
    scheduler: createAttentionReplaySchedulerResource(),
    cache: createAttentionReplayReducerCache(),
  })
}

/**
 * The one authoritative "reducer" this proof rig defines: it draws one RNG
 * value, allocates one ID, consumes one scheduler slot, reads the current
 * reducer-cache digest, and records the caller-supplied (never wall-clock)
 * world-time input, then appends one commit. A pure function of its
 * arguments — the P2 oracle this file exists to make honest.
 *
 * `resources.wallClockAuthorityOverride`, when present, wins over the
 * `wallClockInput` parameter: it is the sole channel a P2 negative control
 * uses to simulate "the authoritative wall-clock-derived value was already
 * contaminated before this commit read it," never something a positive
 * path sets.
 */
export function commitAttentionReplayAuthoritativeCommand(
  resources: AttentionReplayAuthoritativeResources,
  commandId: string,
  wallClockInput: AttentionReplayWallClockInput,
): AttentionReplayAuthoritativeResources {
  const rngDraw = drawAttentionReplayRngValue(resources.rng)
  const idDraw = allocateAttentionReplayId(resources.idAllocator)
  const schedulerDraw = consumeAttentionReplaySchedulerSlot(resources.scheduler)
  const effectiveWallClockInput = resources.wallClockAuthorityOverride ?? wallClockInput

  const commit: AttentionReplayAuthoritativeCommit = Object.freeze({
    commitSeq: resources.log.commits.length,
    commandId,
    rngValue: rngDraw.value,
    allocatedId: idDraw.id,
    schedulerToken: schedulerDraw.token,
    reducerCacheDigestAtCommit: digestAttentionReplayReducerCache(resources.cache),
    wallClockInputAtCommit: effectiveWallClockInput,
  })

  return Object.freeze({
    log: Object.freeze({ commits: Object.freeze([...resources.log.commits, commit]) }),
    rng: rngDraw.stream,
    idAllocator: idDraw.allocator,
    scheduler: schedulerDraw.resource,
    cache: resources.cache,
    ...(resources.wallClockAuthorityOverride === undefined
      ? {}
      : { wallClockAuthorityOverride: resources.wallClockAuthorityOverride }),
  })
}

/** The authoritative log digest — the P2/trace comparison surface. */
export function digestAttentionReplayAuthoritativeLog(log: AttentionReplayAuthoritativeLog): string {
  return mintHash(canonicalSerialize(log))
}

// ---------------------------------------------------------------------------
// Deliberate-coupling helpers — negative-control use only
//
// Every function below simulates the attention pass reaching into a shared
// authoritative resource, a coupling Stage A's real code cannot commit
// (attentionLedgerStaticClosure.test.ts's FORBIDDEN_SOURCE_PATTERNS statically
// closes every RNG/scheduler/wall-clock primitive out of every Stage A
// module). They exist only so a P2 negative control can prove the
// byte-identity oracle actually detects contamination, never as something
// `attentionReplay.ts`'s real director-on path calls.
// ---------------------------------------------------------------------------

/** Simulates attention consuming one draw from the authoritative RNG stream before it commits. */
export function leakAttentionExecutionIntoSharedRng(
  rng: AttentionReplayRngStream,
): AttentionReplayRngStream {
  return drawAttentionReplayRngValue(rng).stream
}

/** Simulates attention consuming one ID from the authoritative allocator before it commits. */
export function leakAttentionExecutionIntoSharedIdAllocator(
  allocator: AttentionReplayIdAllocator,
): AttentionReplayIdAllocator {
  return allocateAttentionReplayId(allocator).allocator
}

/** Simulates attention consuming one authoritative scheduler slot before it commits. */
export function leakAttentionExecutionIntoSharedScheduler(
  scheduler: AttentionReplaySchedulerResource,
): AttentionReplaySchedulerResource {
  return consumeAttentionReplaySchedulerSlot(scheduler).resource
}

/** Simulates attention writing into the shared authoritative reducer cache before it commits. */
export function leakAttentionExecutionIntoSharedReducerCache(
  cache: AttentionReplayReducerCache,
): AttentionReplayReducerCache {
  return writeAttentionReplayReducerCache(cache, 'attention-leaked-key', 'attention-leaked-value')
}

/**
 * Simulates attention execution writing into a shared authoritative
 * wall-clock-derived value before the authoritative commit reads one. Unlike
 * the four helpers above, this one does not touch `rng`/`idAllocator`/
 * `scheduler`/`cache` at all — it sets `wallClockAuthorityOverride`, the one
 * field `commitAttentionReplayAuthoritativeCommand` prefers over its own
 * `wallClockInput` parameter, so every subsequent commit in the coupled run
 * reads the leaked value regardless of what the (identical, in both paired
 * runs) caller-supplied wall-clock array says.
 */
export function leakAttentionExecutionIntoWallClockDerivedAuthoritativeValue(
  wallClockInput: AttentionReplayWallClockInput,
): AttentionReplayWallClockInput {
  return wallClockInput + 999
}
