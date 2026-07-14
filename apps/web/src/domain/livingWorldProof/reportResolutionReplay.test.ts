import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { canonicalSerialize } from './canonicalSerialization'
import { JudgeProbe, MintProbe, replaySourceTrustLog } from './reportResolutionReplay'
import { buildSourceTrustLedgerRun, universe } from './reportResolutionScenario'
import { lookupSourceTrust } from './sourceTrustProjection'

/**
 * Replay unit tests (research vault ADR-0012 D12, spec §11). Covers
 * byte-identical cold replay (P58), identical derived tiers at every key
 * (P59), zero mint/judge calls (P60/F10/F11), and version-stable
 * materialization (P61) at the module-import-graph level.
 */

describe('replaySourceTrustLog (§11) -- byte-identical replay, zero mint/judge calls', () => {
  it('P58/P59 -- replays the full narrative to a byte-identical resolution ledger and identical derived tiers', () => {
    const run = buildSourceTrustLedgerRun()
    const judge = new JudgeProbe()
    const mint = new MintProbe()

    const { store: replayed, report } = replaySourceTrustLog(universe, new Map(), run.store.conflict.commitLog, run.store.commitLog, judge, mint)

    expect(canonicalSerialize(replayed.resolutions)).toBe(canonicalSerialize(run.store.resolutions))

    const liveVillage = lookupSourceTrust(run.store, 'NPC_C', 'NPC_B', 'village-events')
    const replayedVillage = lookupSourceTrust(replayed, 'NPC_C', 'NPC_B', 'village-events')
    expect(replayedVillage).toEqual(liveVillage)

    const liveMonster = lookupSourceTrust(run.store, 'NPC_C', 'NPC_B', 'monster-knowledge')
    const replayedMonster = lookupSourceTrust(replayed, 'NPC_C', 'NPC_B', 'monster-knowledge')
    expect(replayedMonster).toEqual(liveMonster)

    const liveDaren = lookupSourceTrust(run.store, 'NPC_C', 'NPC_D', 'village-events')
    const replayedDaren = lookupSourceTrust(replayed, 'NPC_C', 'NPC_D', 'village-events')
    expect(replayedDaren).toEqual(liveDaren)

    // P60 -- zero calls to mintReportResolution/deriveSourceTrustProjection's
    // live-mint entry point, and zero proposer/judge calls, during replay.
    expect(report.mintCalls).toBe(0)
    expect(report.judgeCalls).toBe(0)
    expect(mint.calls).toBe(0)
    expect(judge.calls).toBe(0)
  })

  it('P61 -- resolutions recorded under an unrecognized (hypothetical future) rule version materialize verbatim, never reinterpreted', () => {
    const run = buildSourceTrustLedgerRun()
    const judge = new JudgeProbe()
    const mint = new MintProbe()
    // Deliberately constructs a commit log entry carrying a rule version the
    // current schema's literal type does not admit -- this simulates a
    // hypothetical future `srt_v1` bump for replay's own version-mismatch
    // tolerance (P61), never something the live minting path could produce.
    const bumpedLog: typeof run.store.commitLog = run.store.commitLog.map((commit) =>
      commit.kind === 'resolution' ? { ...commit, resolution: { ...commit.resolution, ruleVersion: 'srt_v1' } as unknown as typeof commit.resolution } : commit,
    )

    const { store: replayed, report } = replaySourceTrustLog(universe, new Map(), run.store.conflict.commitLog, bumpedLog, judge, mint)

    // Every resolution is still materialized byte-for-byte (just flagged as a version mismatch), never dropped or recomputed.
    expect(replayed.resolutions).toHaveLength(run.store.resolutions.length)
    expect(report.ruleVersionMismatchedResolutions.length).toBe(run.store.resolutions.length)
    expect(report.materializedResolutions).toHaveLength(0)
  })

  it('P16 -- replay never rematches an old unresolved report (the Hag report stays unresolved)', () => {
    const run = buildSourceTrustLedgerRun()
    const judge = new JudgeProbe()
    const mint = new MintProbe()
    const { store: replayed } = replaySourceTrustLog(universe, new Map(), run.store.conflict.commitLog, run.store.commitLog, judge, mint)
    expect(replayed.resolutions.some((resolution) => resolution.reportRef === 'Bel_CoraHagReport1')).toBe(false)
  })
})

describe('F10/F11 -- structural absence of mintReportResolution from the replay import graph', () => {
  it('reportResolutionReplay.ts never imports mintReportResolution, commitReportResolution, or an LLM/proposal symbol', () => {
    const path = fileURLToPath(new URL('./reportResolutionReplay.ts', import.meta.url))
    // Strip block/line comments first -- the doc comments legitimately
    // *discuss* mintReportResolution (to explain why it is absent); what
    // must be structurally absent is an import or a call, not the word.
    const source = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(source).not.toMatch(/from '\.\/reportResolutionRules'/)
    expect(source).not.toMatch(/from '\.\/reportResolutionStore'/)
    expect(source).not.toMatch(/mintReportResolution\s*\(/)
    expect(source).not.toMatch(/commitReportResolution\s*\(/)
    expect(source).not.toMatch(/proposalKey|thetaKey|llmProposal/i)
  })
})
