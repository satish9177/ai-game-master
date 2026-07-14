import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { runSourceTrustAwareCompactionPass, snapshotResolutionVisibility, snapshotSourceTrust } from './reportResolutionCompactionAdapter'
import { buildSourceTrustLedgerRun, universe } from './reportResolutionScenario'

/**
 * Compaction unit tests (research vault ADR-0012 D13, spec §3.2/§12,
 * Phase M). Covers ReportResolution non-interference: the full resolution
 * set stays byte-identical (P62/P63), `resolutionVisible` verdicts stay
 * unchanged (P63), and derived tiers stay unchanged (P64), all because
 * `ReportResolution` is never a member of the demote/merge pipeline in the
 * first place (F25: compaction never mints a new trust pin/checkpoint,
 * since there is no code path here through which it could).
 */

describe('runSourceTrustAwareCompactionPass (§3.2/§12) -- ReportResolution non-interference', () => {
  it('P62/P63/P64 -- running compaction over the other record families leaves the RR ledger, its visibility, and its derived tiers completely unchanged', () => {
    const run = buildSourceTrustLedgerRun()

    const beforeResolutions = canonicalSerialize(run.store.resolutions)
    const beforeVisibility = snapshotResolutionVisibility(run.store, 'NPC_C')
    const beforeVillageTrust = snapshotSourceTrust(run.store, 'NPC_C', 'NPC_B', 'village-events')
    const beforeMonsterTrust = snapshotSourceTrust(run.store, 'NPC_C', 'NPC_B', 'monster-knowledge')

    // Demote a handful of ordinary Observations -- the compaction pass runs
    // entirely over `universe`/`ReadableRecord`; there is no parameter here
    // through which a ReportResolutionStore could even be passed.
    const demotable = universe.filter((entry) => entry.kind === 'observation').slice(0, 3)
    const { result } = runSourceTrustAwareCompactionPass(
      universe,
      [],
      [],
      [],
      [
        {
          schemaVersion: 1,
          id: 'CP_demote_observations',
          action: 'demote',
          memberIds: demotable.map((entry) => entry.record.id),
          rationale: 'test: demote a few observations to prove ReportResolution is untouched',
          proposedBy: 'engine',
        },
      ],
      1_000_000,
    )
    expect(result.compactionLog.length).toBeGreaterThan(0)

    // The ReportResolutionStore object was never passed to the pass at all --
    // it is, byte-for-byte, whatever it already was.
    expect(canonicalSerialize(run.store.resolutions)).toBe(beforeResolutions)
    expect(snapshotResolutionVisibility(run.store, 'NPC_C')).toEqual(beforeVisibility)
    expect(snapshotSourceTrust(run.store, 'NPC_C', 'NPC_B', 'village-events')).toEqual(beforeVillageTrust)
    expect(snapshotSourceTrust(run.store, 'NPC_C', 'NPC_B', 'monster-knowledge')).toEqual(beforeMonsterTrust)
  })

  it('F25 -- no trust-specific pin/checkpoint machinery exists to mint: the pass signature has no ReportResolutionStore parameter at all', () => {
    expect(runSourceTrustAwareCompactionPass.length).toBe(6)
  })
})
