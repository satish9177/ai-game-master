import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { applyReportConfidenceCap } from './reportConfidenceCap'
import type { SourceTrustLookup } from './sourceTrustProjection'

/**
 * Consumer unit tests (research vault ADR-0012 D11, spec §6.1). Covers the
 * cap/reject table exhaustively (P45-P49), trust-never-lifts (P46/F24),
 * reject-preserves-assertion documentation (P41/F23, exercised at the
 * scenario level), and the single-trust-authority structural closure
 * (P50-P54, D14 item 17, F19-F22): this module's own source text is
 * scanned to prove it never imports the old static-trust symbols, mirroring
 * the mechanical (never manual) discipline the spec requires.
 */

const unknown: SourceTrustLookup = { tier: 'unknown' }
const resolvedLow: SourceTrustLookup = { tier: 'resolved', confirmed: 0, refuted: 1, competence: 'low', certainty: 'low' }
const resolvedHighMedium: SourceTrustLookup = { tier: 'resolved', confirmed: 3, refuted: 0, competence: 'high', certainty: 'medium' }
const resolvedMediumMedium: SourceTrustLookup = { tier: 'resolved', confirmed: 2, refuted: 1, competence: 'medium', certainty: 'medium' }
const resolvedLowMedium: SourceTrustLookup = { tier: 'resolved', confirmed: 0, refuted: 3, competence: 'low', certainty: 'medium' }
const resolvedHighHigh: SourceTrustLookup = { tier: 'resolved', confirmed: 9, refuted: 0, competence: 'high', certainty: 'high' }

describe('applyReportConfidenceCap (§6.1) -- the cap/reject table', () => {
  it('unknown source -- caps at the unknown-source default', () => {
    expect(applyReportConfidenceCap({ preCapConfidence: 'high', trust: unknown })).toEqual({ verdict: 'cap', confidence: 'medium' })
    expect(applyReportConfidenceCap({ preCapConfidence: 'low', trust: unknown })).toEqual({ verdict: 'cap', confidence: 'low' })
  })

  it('resolved, low certainty -- caps identically to unknown (not yet established), regardless of competence', () => {
    expect(applyReportConfidenceCap({ preCapConfidence: 'high', trust: resolvedLow })).toEqual({ verdict: 'cap', confidence: 'medium' })
  })

  it('resolved, medium/high certainty, high competence -- caps at medium', () => {
    expect(applyReportConfidenceCap({ preCapConfidence: 'high', trust: resolvedHighMedium })).toEqual({ verdict: 'cap', confidence: 'medium' })
    expect(applyReportConfidenceCap({ preCapConfidence: 'high', trust: resolvedHighHigh })).toEqual({ verdict: 'cap', confidence: 'medium' })
  })

  it('resolved, medium/high certainty, medium competence -- caps at low', () => {
    expect(applyReportConfidenceCap({ preCapConfidence: 'high', trust: resolvedMediumMedium })).toEqual({ verdict: 'cap', confidence: 'low' })
  })

  it('resolved, medium/high certainty, low competence -- rejects (an established low-competence source), never a floor-confidence cap', () => {
    expect(applyReportConfidenceCap({ preCapConfidence: 'high', trust: resolvedLowMedium })).toEqual({ verdict: 'reject' })
  })

  it('P51/P52 -- same pre-cap confidence, different competence tiers produce different final confidence', () => {
    const highCompetenceCap = applyReportConfidenceCap({ preCapConfidence: 'medium', trust: resolvedHighMedium })
    const mediumCompetenceCap = applyReportConfidenceCap({ preCapConfidence: 'medium', trust: resolvedMediumMedium })
    expect(highCompetenceCap).toEqual({ verdict: 'cap', confidence: 'medium' })
    expect(mediumCompetenceCap).toEqual({ verdict: 'cap', confidence: 'low' })
    expect(highCompetenceCap).not.toEqual(mediumCompetenceCap)
  })

  it('F24/P46 -- a cap never raises preCapConfidence above what the evidence hierarchy already produced', () => {
    expect(applyReportConfidenceCap({ preCapConfidence: 'low', trust: resolvedHighMedium })).toEqual({ verdict: 'cap', confidence: 'low' })
    expect(applyReportConfidenceCap({ preCapConfidence: 'low', trust: unknown })).toEqual({ verdict: 'cap', confidence: 'low' })
  })

  it('P49 -- rejection is a distinct operation, never a third cap tier', () => {
    const outcome = applyReportConfidenceCap({ preCapConfidence: 'high', trust: resolvedLowMedium })
    expect(outcome.verdict).toBe('reject')
    expect('confidence' in outcome).toBe(false)
  })
})

describe('Single trust authority (D11/D14 item 17, §3.5) -- mechanical, not manual', () => {
  it('P50/P54/F19-F22 -- reportConfidenceCap.ts never imports TrustRegistry/trustOf/TRUST_TO_CAP', () => {
    const path = fileURLToPath(new URL('./reportConfidenceCap.ts', import.meta.url))
    // Strip comments first -- the doc comments legitimately *discuss*
    // TrustRegistry/trustOf/TRUST_TO_CAP (to explain why they are absent);
    // what must be structurally absent is an import, not the word.
    const source = readFileSync(path, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(source).not.toMatch(/\bTrustRegistry\b/)
    expect(source).not.toMatch(/\btrustOf\b/)
    expect(source).not.toMatch(/\bTRUST_TO_CAP\b/)
    expect(source).not.toMatch(/from '\.\/attributionContracts'|from '\.\/attributionRules'/)
  })

  it('P50 -- the function signature has no parameter that could carry a per-speaker trust value', () => {
    // Structural: calling with only {preCapConfidence, trust: SourceTrustLookup}
    // type-checks; there is no third parameter to pass a TrustRegistry into.
    expect(applyReportConfidenceCap.length).toBe(1)
  })
})

// ---- Mechanical source scans over all eight new implementation files ------
// (P51 expansion, P66) -- both blocks below deliberately scan the SAME file
// list, listed once here so the two concerns can never silently drift apart.

const NEW_IMPLEMENTATION_FILES = [
  'reportResolutionContracts.ts',
  'reportResolutionRules.ts',
  'reportResolutionStore.ts',
  'sourceTrustProjection.ts',
  'reportConfidenceCap.ts',
  'reportResolutionReplay.ts',
  'reportResolutionCompactionAdapter.ts',
  'reportResolutionScenario.ts',
] as const

function readStrippedSource(fileName: string): string {
  const path = fileURLToPath(new URL(`./${fileName}`, import.meta.url))
  // Strip block/line comments first -- doc comments legitimately *discuss*
  // forbidden symbols/behaviors (to explain why they are absent); what must
  // be structurally absent is the code itself, not the word.
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('P51 expanded -- static trust authority scan over all eight new source files (D11/D14 item 17)', () => {
  it.each(NEW_IMPLEMENTATION_FILES)('%s never imports or reads TrustRegistry/trustOf/TRUST_TO_CAP', (fileName) => {
    const source = readStrippedSource(fileName)
    // The existing, untouched ADR-0011 attribution implementation
    // (attributionContracts.ts/attributionRules.ts) legitimately defines and
    // uses these symbols for its own, different, already-accepted consumer
    // (ascribeFromAssertion). Those two files are deliberately outside this
    // scan's file list (NEW_IMPLEMENTATION_FILES above) and outside
    // ADR-0012's consumer scope entirely -- never themselves asserted absent
    // of these symbols. `reportResolutionScenario.ts` legitimately imports
    // OTHER exports from `attributionRules.ts` (`epSpeakerAct`, the reused,
    // unmodified report-minting path, D6 item 1) and from
    // `attributionBuilder.ts` (`innerCanonicalKeyOf`) -- this check is
    // therefore scoped to the three specific trust-authority symbols
    // themselves, never a blanket rejection of importing from those files.
    expect(source).not.toMatch(/\bTrustRegistry\b/)
    expect(source).not.toMatch(/\btrustOf\b/)
    expect(source).not.toMatch(/\bTRUST_TO_CAP\b/)
  })
})

describe('P66 -- no console logging, raw trust-count logging, private-trust explanation output, or network/provider/model calls (§16)', () => {
  it.each(NEW_IMPLEMENTATION_FILES)('%s contains no console logging', (fileName) => {
    const source = readStrippedSource(fileName)
    expect(source).not.toMatch(/\bconsole\s*\./)
  })

  it.each(NEW_IMPLEMENTATION_FILES)('%s contains no explanation-assembly / holder-or-source trust text output', (fileName) => {
    const source = readStrippedSource(fileName)
    // No explanation-assembly surface exists anywhere in this rig at all
    // (P66 is vacuously true because unbuilt, not because a built one was
    // checked) -- this asserts that absence stays structural: no exported
    // function whose name suggests one, and no template-literal construction
    // of holder/source-facing trust text (the shape `conflictScope.ts`'s
    // `explainTransition`/`ExplanationClause` uses for the sibling record
    // families this rig deliberately does not replicate).
    expect(source).not.toMatch(/\bexplain[A-Za-z]*\s*\(/i)
    expect(source).not.toMatch(/ExplanationClause/)
  })

  it.each(NEW_IMPLEMENTATION_FILES)('%s makes no network/provider/model/random/time call', (fileName) => {
    const source = readStrippedSource(fileName)
    expect(source).not.toMatch(/\bfetch\s*\(/)
    expect(source).not.toMatch(/XMLHttpRequest/)
    expect(source).not.toMatch(/\bDate\.now\s*\(/)
    expect(source).not.toMatch(/\bMath\.random\s*\(/)
    expect(source).not.toMatch(/process\.env/)
    expect(source).not.toMatch(/\b(openai|anthropic|llmProposal|proposalKey|thetaKey)\b/i)
  })
})
