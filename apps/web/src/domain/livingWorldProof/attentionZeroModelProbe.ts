/**
 * Stage A / A4 — the zero-call probe for the accepted Stage A path. Proof-local to
 * `domain/livingWorldProof`; not a production module, adapter, port, transport,
 * or client of any outside service.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ e9642cba34c4a9040b73da2c6018672c55301f76:
 *
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D18 "No model call of any kind is required for Attention Ledger Replay v0
 *    acceptance, and none is in the accepted v0 decision path"; D20 item 16
 *    "byte-identical cold replay and zero model/proposer/judge calls throughout");
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§13 D4 "a `MintProbe`-style call-count-zero assertion, following the sibling
 *    specs' `JudgeProbe` discipline"; §26 T1 "no model/provider is required
 *    anywhere in the accepted v0 path");
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§7 A4 "The proof must use a zero-model probe that throws if invoked and
 *    assert zero calls in cold replay"; §9 A4 slice plan).
 *
 * These are the governing documents. This repository's own ADR-0013 is
 * "World State & Event Log v0" and is unrelated to attention.
 *
 * **What this probe is.** A counted seam that fails loudly. It is passed into a
 * cold Stage A run as the single stand-in for any generative call the path might
 * have wanted to make; the run then asserts the count is still zero. Invoking it
 * both records the attempt and throws, so a swallowed call cannot pass as an
 * absent one, and a caller that catches the throw still leaves a non-zero count
 * behind for the assertion to find.
 *
 * **What it is not, and why the count alone would not be evidence.** A counter can
 * only witness the seams it is threaded through. The load-bearing evidence that no
 * generative call exists anywhere in the Stage A path is static, not dynamic:
 * `attentionLedgerStaticClosure.test.ts` scans every Stage A module's
 * comment-stripped source and refuses any network, transport, or outside-service
 * token, in any import or call form, and separately proves that no file outside
 * the proof directory reaches a Stage A module at all. This probe is the
 * corroborating runtime half of that pair — the discipline the replay spec calls
 * "a `MintProbe`-style call-count-zero assertion" — never a substitute for it.
 *
 * The counter is a closure-local integer, not shared state: two probes never
 * observe each other, so a run cannot inherit or leak a count. Nothing here reads
 * a clock, an environment value, a random source, or any global.
 */

export interface AttentionZeroModelProbe {
  /** How many times the seam was reached. Zero in every accepted Stage A run. */
  readonly invocationCount: () => number
  /** Records the attempt and throws. It never returns. */
  readonly invoke: (callSite: string) => never
}

export function createAttentionZeroModelProbe(): AttentionZeroModelProbe {
  let invocationCount = 0

  const probe: AttentionZeroModelProbe = {
    invocationCount: () => invocationCount,
    invoke: (callSite: string): never => {
      invocationCount += 1
      throw new Error(
        'attentionZeroModelProbe: a generative call was attempted from '
        + callSite
        + '; the accepted Stage A path has none',
      )
    },
  }

  return Object.freeze(probe)
}

/**
 * The cold-replay assertion: the accepted Stage A path completed without reaching
 * the seam. It throws rather than returning a boolean so a caller cannot record a
 * failed check as a passed one.
 */
export function assertAttentionZeroModelProbeUnused(probe: AttentionZeroModelProbe): void {
  const count = probe.invocationCount()
  if (count !== 0) {
    throw new Error(
      'attentionZeroModelProbe: the accepted Stage A path must complete with zero generative calls, saw '
      + String(count),
    )
  }
}
