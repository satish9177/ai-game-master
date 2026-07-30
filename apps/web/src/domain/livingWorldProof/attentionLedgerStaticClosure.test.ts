import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { constructAttentionReadableSurface } from './attentionReadableBoundary'

/**
 * A2 / P1 — static forbidden-consumer and dependency-direction closure, plus
 * the import-graph half of S2.
 *
 * Source of authority — the read-only sibling research repository
 * `living-ai-worlds-research` @ fc0eadf0b8cdc672f2530d020376c8022f3bede1:
 *
 *  - `docs/experiments/attention-ledger-replay-v0.md`
 *    (§7 "S1 — P1 forbidden-consumer closure", §8 "S2 — A′-construction
 *    closure");
 *  - `docs/decisions/ADR-0013-consequence-bounded-narrative-attention.md`
 *    (D19 P1, D20 items 1-2);
 *  - `docs/architecture/implementation-plans/`
 *    `2026-07-16-attention-ledger-replay-stage-a-implementation-plan.md`
 *    (§5 A2 obligations, §9 A2 slice plan).
 *
 * This repository's own ADR-0013 ("World State & Event Log v0") is unrelated to
 * attention and is not the source of any rule asserted here.
 *
 * Evidence is mechanical, never manual. Module specifiers are extracted with
 * the repository's installed TypeScript compiler API rather than a regular
 * expression, because a regex over source text silently misses ordinary
 * TypeScript: double-quoted specifiers, `export ... from`, dynamic `import()`,
 * `require()`, and `import x = require()`. A parser sees all of them, and — as
 * importantly — sees that an import-shaped phrase inside a comment or an
 * ordinary string is not a dependency at all. Both properties are asserted
 * below rather than assumed, including negative controls that a forbidden
 * import is caught in every quote style and call form.
 *
 * Both directions are closed here:
 *   forward  — the Stage A modules import a closed allowlist of Stage A proof
 *              modules only, and name no authoritative reducer/event, world
 *              session/store, cognition, planner/action, scheduler/RNG,
 *              generic-envelope, provider, or ledger/diagnostic symbol;
 *   reverse  — no file anywhere in `apps/web/src` outside this proof directory
 *              imports a Stage A attention proof module, so no production
 *              reducer or runtime entry point can consume one;
 *   mint     — the accessor-origin mint is named only by the A1 contracts
 *              module that defines it and the A1 accessor that is allowed to
 *              call it, so no other module can forge an attention-readable view.
 *
 * This file carries the plan's A2 name (`attentionLedgerStaticClosure`); no
 * Attention Ledger module exists in A2 and none is created here.
 */

const STAGE_A_PROOF_MODULES = [
  'attentionQuestCandidateContracts.ts',
  'attentionQuestCandidateAccessor.ts',
  'attentionQuestCandidateScenario.ts',
  'attentionPatternEvidenceContracts.ts',
  'attentionPatternEvidenceAccessor.ts',
  'attentionPatternEvidenceScenario.ts',
  'attentionNarrativePatternContracts.ts',
  'attentionNarrativePatternIdentity.ts',
  'attentionNarrativePatternLifecycle.ts',
  'attentionNarrativePatternLibrary.ts',
  'attentionNarrativePatternMonitor.ts',
  'attentionNarrativePatternResourcePolicy.ts',
  'attentionNarrativePatternScenario.ts',
  'attentionReadableBoundary.ts',
  'attentionStageAQuestOnlyGolden.ts',
  'attentionCandidatePolicy.ts',
  'attentionCandidateIdentity.ts',
  'attentionCandidate.ts',
  'attentionCandidateOrdering.ts',
  'attentionCandidateCacheKey.ts',
  'attentionDirectEvidenceAssertion.ts',
  'attentionRevealPackage.ts',
  'attentionTemplate.ts',
  'attentionLedger.ts',
  'attentionZeroModelProbe.ts',
  'attentionTrace.ts',
  'attentionReplayResources.ts',
  'attentionReplay.ts',
  'attentionReplayScenario.ts',
  'attentionInferenceProvenancePolicy.ts',
  'attentionInferenceRuleLibrary.ts',
  'attentionInferenceProvenance.ts',
  'attentionAggregateLegitimacy.ts',
  'attentionInferenceScenario.ts',
  'attentionPrivateStateScenario.ts',
  'attentionScorePolicy.ts',
  'attentionClosedRelationCertificateContracts.ts',
  'attentionClosedRelationCertificateAccessor.ts',
  'attentionAbsencePredicateLibrary.ts',
  'attentionAbsenceWitnessProvenance.ts',
  'attentionAbsenceScenario.ts',
] as const

/**
 * The closed import allowlist: Stage A proof modules and nothing else.
 *
 * The A3 derived-candidate modules cannot name `attentionQuestCandidateContracts`
 * or `attentionQuestCandidateAccessor` at all — the raw `QuestCandidate`, the
 * proof snapshot, the `open | resolved` lifecycle, and the accessor-origin mint
 * all live behind those two specifiers, so their absence here is what proves A3
 * reads A-prime through `attentionReadableBoundary` and by no other path.
 *
 * `./canonicalSerialization` is the one non-attention specifier admitted. It is
 * the long-standing proof-local key-sorting/FNV helper the controlling A3 plan
 * section directs be "reused unchanged"; it is deliberately not added to
 * STAGE_A_PROOF_MODULES, because it is not a Stage A module and its own header
 * already records its proof-local, non-cryptographic limits.
 *
 * The A4 presentation and ledger modules extend the same discipline one step. The
 * reveal package reads the A3 normalized candidate and no earlier surface, so it
 * cannot name a raw `QuestCandidate`, a proof snapshot, or the accessor-origin
 * mint. The template reads only an already-approved package. The ledger reads the
 * normalized candidate and the presentation-result vocabulary, and — the
 * load-bearing direction — *nothing but the A5 harness and trace* import the
 * ledger: see `LEDGER_FORBIDDEN_MODULES` below for the mechanical form of
 * ADR-0013 D12 step 2, that *detection and A-prime construction* never read
 * surface C (the trace and replay harness sit downstream of it, recording an
 * outcome rather than feeding one back in).
 *
 * The A5 trace and replay modules extend the discipline one step further.
 * `attentionTrace.ts` reads only the A4 reveal-package result vocabulary and
 * canonical serialization — it never names a raw candidate, snapshot, view, or
 * mint. `attentionReplayResources.ts` names nothing Stage-A-specific at all: it
 * is the proof-local authoritative-domain stand-in P2 tests against, and its
 * only Stage A dependency is the shared canonicalization helper.
 * `attentionReplay.ts` is the one module authorized to import the complete A1-A4
 * chain plus the trace and the authoritative resources, because composing them
 * in the approved order is its entire job. `attentionReplayScenario.ts` builds
 * single-world replay-level fixtures and self-validates them against the prime
 * pipeline and the quest-candidate scenario module.
 */
const ALLOWED_IMPORT_SPECIFIERS: Record<string, readonly string[]> = {
  'attentionQuestCandidateContracts.ts': [],
  'attentionQuestCandidateAccessor.ts': ['./attentionQuestCandidateContracts'],
  'attentionQuestCandidateScenario.ts': ['./attentionQuestCandidateContracts', './attentionQuestCandidateAccessor'],
  'attentionPatternEvidenceContracts.ts': [],
  'attentionPatternEvidenceAccessor.ts': ['./attentionPatternEvidenceContracts'],
  'attentionPatternEvidenceScenario.ts': [
    './attentionPatternEvidenceContracts',
    './attentionPatternEvidenceAccessor',
  ],
  'attentionReadableBoundary.ts': [
    './attentionQuestCandidateContracts',
    './attentionPatternEvidenceContracts',
    './attentionPatternEvidenceAccessor',
    './attentionClosedRelationCertificateContracts',
    './attentionClosedRelationCertificateAccessor',
  ],
  'attentionNarrativePatternContracts.ts': [
    './attentionCandidatePolicy',
    './attentionPatternEvidenceContracts',
    './attentionPatternEvidenceAccessor',
    './attentionNarrativePatternIdentity',
  ],
  'attentionNarrativePatternIdentity.ts': [
    './canonicalSerialization',
    './attentionCandidatePolicy',
    './attentionNarrativePatternContracts',
  ],
  'attentionNarrativePatternLifecycle.ts': [
    './attentionCandidatePolicy',
    './attentionNarrativePatternContracts',
    './attentionNarrativePatternIdentity',
    './attentionPatternEvidenceContracts',
    './attentionPatternEvidenceAccessor',
  ],
  'attentionNarrativePatternLibrary.ts': [
    './attentionCandidatePolicy',
    './canonicalSerialization',
    './attentionNarrativePatternIdentity',
  ],
  'attentionNarrativePatternMonitor.ts': [
    './attentionCandidatePolicy',
    './canonicalSerialization',
    './attentionNarrativePatternContracts',
    './attentionNarrativePatternIdentity',
    './attentionPatternEvidenceContracts',
    './attentionPatternEvidenceAccessor',
    './attentionNarrativePatternLibrary',
    './attentionNarrativePatternLifecycle',
  ],
  // B6 leaves this entry exactly as committed at 9aa77e8e: the module stays
  // fixture-only and gains no specifier. The A-prime boundary -> reconstruction
  // -> retention -> normalizer chain lives in `attentionReplay.ts`, the one
  // authorized module that already holds every dependency it needs (plan §11.3,
  // §11.7).
  'attentionNarrativePatternScenario.ts': [
    './attentionPatternEvidenceContracts',
    './attentionPatternEvidenceAccessor',
    './attentionNarrativePatternMonitor',
  ],
  'attentionNarrativePatternResourcePolicy.ts': [
    './canonicalSerialization',
    './attentionPatternEvidenceContracts',
    './attentionNarrativePatternMonitor',
    './attentionNarrativePatternIdentity',
    './attentionNarrativePatternContracts',
  ],
  'attentionStageAQuestOnlyGolden.ts': [],
  'attentionCandidatePolicy.ts': [],
  'attentionCandidateIdentity.ts': ['./canonicalSerialization', './attentionCandidatePolicy'],
  'attentionCandidate.ts': [
    './attentionCandidatePolicy',
    './attentionCandidateIdentity',
    './attentionReadableBoundary',
    './attentionPatternEvidenceContracts',
    './attentionNarrativePatternContracts',
    './attentionNarrativePatternIdentity',
  ],
  'attentionCandidateOrdering.ts': [
    './attentionCandidatePolicy',
    './canonicalSerialization',
    './attentionCandidate',
    './attentionScorePolicy',
    './attentionClosedRelationCertificateAccessor',
    './attentionClosedRelationCertificateContracts',
  ],
  'attentionCandidateCacheKey.ts': [
    './canonicalSerialization',
    './attentionCandidatePolicy',
    './attentionReadableBoundary',
    './attentionPatternEvidenceContracts',
    './attentionNarrativePatternLibrary',
    './attentionNarrativePatternResourcePolicy',
    './attentionDirectEvidenceAssertion',
    './attentionInferenceProvenancePolicy',
    './attentionInferenceRuleLibrary',
    './attentionAggregateLegitimacy',
    './attentionScorePolicy',
    './attentionClosedRelationCertificateContracts',
    './attentionAbsencePredicateLibrary',
    './attentionAbsenceWitnessProvenance',
  ],
  'attentionDirectEvidenceAssertion.ts': [
    './canonicalSerialization',
    './attentionCandidatePolicy',
    './attentionNarrativePatternContracts',
    './attentionAbsenceWitnessProvenance',
  ],
  'attentionRevealPackage.ts': [
    './attentionCandidatePolicy',
    './attentionCandidate',
    './attentionDirectEvidenceAssertion',
    './attentionNarrativePatternResourcePolicy',
    './attentionAggregateLegitimacy',
    './attentionInferenceProvenance',
    './attentionInferenceProvenancePolicy',
  ],
  'attentionTemplate.ts': [
    './canonicalSerialization',
    './attentionCandidatePolicy',
    './attentionRevealPackage',
    './attentionDirectEvidenceAssertion',
    './attentionInferenceProvenance',
    './attentionInferenceProvenancePolicy',
  ],
  'attentionLedger.ts': [
    './canonicalSerialization',
    './attentionCandidatePolicy',
    './attentionCandidate',
    './attentionRevealPackage',
    './attentionDirectEvidenceAssertion',
    './attentionNarrativePatternResourcePolicy',
  ],
  'attentionZeroModelProbe.ts': [],
  'attentionTrace.ts': [
    './canonicalSerialization',
    './attentionCandidatePolicy',
    './attentionRevealPackage',
  ],
  'attentionReplayResources.ts': ['./canonicalSerialization'],
  'attentionReplay.ts': [
    './attentionQuestCandidateContracts',
    './attentionQuestCandidateAccessor',
    './attentionReadableBoundary',
    './attentionCandidate',
    './attentionCandidateOrdering',
    './attentionCandidatePolicy',
    './attentionNarrativePatternResourcePolicy',
    './attentionRevealPackage',
    './attentionTemplate',
    './attentionLedger',
    './attentionTrace',
    './attentionReplayResources',
    './canonicalSerialization',
    './attentionDirectEvidenceAssertion',
    './attentionNarrativePatternContracts',
    './attentionPatternEvidenceContracts',
    './attentionNarrativePatternMonitor',
    './attentionAggregateLegitimacy',
    './attentionInferenceRuleLibrary',
    './attentionScorePolicy',
    './attentionClosedRelationCertificateAccessor',
    './attentionClosedRelationCertificateContracts',
  ],
  'attentionReplayScenario.ts': [
    './attentionQuestCandidateContracts',
    './attentionCandidatePolicy',
    './attentionNarrativePatternScenario',
    './attentionPatternEvidenceContracts',
    './attentionReplay',
    './attentionReplayResources',
    './attentionQuestCandidateScenario',
  ],
  'attentionInferenceProvenancePolicy.ts': ['./canonicalSerialization'],
  'attentionInferenceRuleLibrary.ts': ['./canonicalSerialization'],
  'attentionInferenceProvenance.ts': [
    './canonicalSerialization',
    './attentionInferenceProvenancePolicy',
    './attentionInferenceRuleLibrary',
  ],
  'attentionAggregateLegitimacy.ts': [
    './canonicalSerialization',
    './attentionDirectEvidenceAssertion',
    './attentionInferenceProvenancePolicy',
    './attentionInferenceRuleLibrary',
    './attentionInferenceProvenance',
  ],
  'attentionInferenceScenario.ts': ['./attentionDirectEvidenceAssertion'],
  'attentionPrivateStateScenario.ts': [],
  'attentionScorePolicy.ts': ['./canonicalSerialization'],
  'attentionClosedRelationCertificateContracts.ts': ['./canonicalSerialization'],
  'attentionClosedRelationCertificateAccessor.ts': [
    './canonicalSerialization', './attentionClosedRelationCertificateContracts', './attentionPatternEvidenceContracts', './attentionPatternEvidenceAccessor',
  ],
  'attentionAbsencePredicateLibrary.ts': ['./canonicalSerialization', './attentionClosedRelationCertificateContracts'],
  'attentionAbsenceWitnessProvenance.ts': [
    './canonicalSerialization', './attentionClosedRelationCertificateContracts', './attentionAbsencePredicateLibrary',
  ],
  'attentionAbsenceScenario.ts': ['./attentionClosedRelationCertificateAccessor', './attentionPatternEvidenceContracts'],
}

/**
 * ADR-0013 D12 step 2 and replay spec §24 L1: detection and A-prime construction
 * may not read the Attention Ledger (surface C). The mechanical form of that rule
 * is that no Stage A module imports `./attentionLedger` — asserted below against
 * the allowlist itself, so a later slice that added the import would have to edit
 * this list in the open rather than reach C quietly.
 */
const LEDGER_SPECIFIER = './attentionLedger'

/** ADR-0013 D19 P1's closed forbidden-consumer list, plus its bypass vectors. */
const FORBIDDEN_SOURCE_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['authoritative event/command/state union', /\b(WorldEvent|WorldCommand|WorldState|SaveGame)\b/],
  ['authoritative reducer', /\b(applyEvent|appendEvent|validateEventLog|jsonDeepEqual)\b/],
  ['authoritative session/store/port', /\b(WorldSession|WorldStore|InMemoryWorldStore|SqliteWorldStore|IdGenerator|Clock)\b/],
  ['consequence reducer', /\b(consequenceReplay|meaningfulObjectConsequences|applyConsequence|evaluateQuest|questSpec)\b/],
  ['perception/memory/belief/relationship rules', /\b(beliefProjection|beliefUpdate|observationScope|npcMemory|roomMemory|perception|sourceTrustProjection|reportResolution\w*)\b/],
  ['goal/intention/planner/routine/action rules', /\b(intentionPipeline|intentionActions|intentionRules|intentionStore|planBody\w*|actionSelect\w*|routine)\b/],
  ['attribution/conflict/compaction cognition modules', /\b(attributionRules|attributionStore|attributionBuilder|conflictStore|conflictReplay|compactionPass)\b/],
  ['scheduler / wall clock', /\b(setTimeout|setInterval|queueMicrotask|performance\.now|Date\.now)\b|\bnew Date\b/],
  ['RNG / id minting', /\b(Math\.random|randomUUID|crypto)\b/],
  ['generic envelope, round-trip, reflection, dynamic dispatch', /\b(JSON\.parse|JSON\.stringify|structuredClone|Reflect\.|globalThis|process\.env)\b|\b(eval|require|import)\s*\(|\bnew Function\s*\(/],
  ['network / provider / model call', /\bfetch\s*\(|XMLHttpRequest|WebSocket|\b(openai|anthropic|llm|provider|model)\b/i],
  ['console logging', /\bconsole\s*\./],
  // The capability line moves exactly one slice at a time, and only when an
  // approved slice creates the capability. `attentionCandidatePolicy` was
  // forbidden here through A2 and moved to the import allowlist when A3 created
  // it; the reveal package, template, and ledger were forbidden here through A3
  // and moved when A4 created them. The complete trace, the replay runner, its
  // resources and scenarios, and the P2/P3 harnesses were forbidden here through
  // A4 and move now, because A5 is the approved slice that creates them — there
  // is no next-slice capability line left to forbid in this proof.
  ['authoritative interface aliasing', /\bimplements\b|\binterface\s+\w+\s+extends\b/],
  ['type escape hatch', /\bas\s+any\b|:\s*any\b/],
]

/**
 * Forbidden dependency *paths*, matched against parsed module specifiers rather
 * than raw source text, so quote style and import form cannot evade them.
 */
const FORBIDDEN_SPECIFIER_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['authoritative/consequence module path', /\/(world|world-session|quests|objectPurpose|interactions|encounters|persistence|server)\//],
  ['renderer / React / UI import', /^(react|react-dom|three)$|\/renderer\//],
  ['node built-in import', /^node:/],
]

/** Raw A-domain vocabulary that must never appear in the A-prime constructor. */
const FORBIDDEN_BOUNDARY_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['raw candidate constructor', /\b(createProofQuestCandidate|createProofQuestCandidateSnapshot)\b/],
  ['raw candidate/snapshot type', /\b(QuestCandidate|QuestCandidateInput|QuestCandidateStatus|QuestCandidateOpeningProvenance|ProofQuestCandidateSnapshot|ProofQuestCandidateSnapshotInput)\b/],
  ['accessor invocation (A-prime never reads the raw store itself)', /\breadAttentionReadableQuestCandidateViews\b/],
  ['view mint (A-prime never mints its own views)', /\bmintAttentionReadableQuestCandidateView\b/],
  ['raw candidate field', /\b(privateParties|secretOpeningDetail|openingProvenance|openedAtLsn|candidates|status)\b/],
  ['candidate lifecycle vocabulary', /\b(open|resolved)\b/],
  ['raw pattern-evidence constructor', /\b(createProofPatternEvidenceRecord|createProofPatternEvidenceSnapshot)\b/],
  ['raw pattern-evidence type', /\b(ProofPatternEvidenceRecord|ProofPatternEvidenceRecordInput|ProofPatternEvidenceSnapshot|ProofPatternEvidenceSnapshotInput|PatternEvidenceVisibilityProvenance)\b/],
  ['pattern accessor invocation', /\breadAttentionReadablePatternEvidenceViews\b/],
  ['pattern view mint', /\bmintAttentionReadablePatternEvidenceView\b/],
  ['raw pattern-evidence field', /\b(visibilityProvenance|records)\b/],
]

/**
 * The accessor-origin mint (A1). Only the contracts module that defines it and
 * the accessor that may call it are allowed to name it anywhere in the app.
 */
const VIEW_MINT_IDENTIFIER = 'mintAttentionReadableQuestCandidateView'
const MINT_AUTHORIZED_FILES = [
  'domain/livingWorldProof/attentionQuestCandidateAccessor.ts',
  'domain/livingWorldProof/attentionQuestCandidateContracts.ts',
] as const

/**
 * B4 — the quest opening-coordinate sidecar mint (RN019 §4.3). It has its own
 * independent module-private marker, and — exactly like the legal view's mint —
 * only the contracts module that defines it and the quest accessor that may
 * call it are allowed to name it anywhere in the app. That is the mechanical
 * form of "the sidecar is minted only by the existing quest accessor".
 */
const OPENING_COORDINATE_MINT_IDENTIFIER = 'mintAttentionReadableQuestOpeningCoordinateView'
const OPENING_COORDINATE_MINT_AUTHORIZED_FILES = [
  'domain/livingWorldProof/attentionQuestCandidateAccessor.ts',
  'domain/livingWorldProof/attentionQuestCandidateContracts.ts',
] as const

const PATTERN_VIEW_MINT_IDENTIFIER = 'mintAttentionReadablePatternEvidenceView'
const PATTERN_MINT_CALLER_FILES = [
  'domain/livingWorldProof/attentionPatternEvidenceAccessor.ts',
] as const

const PATTERN_CONTRACTS_ALLOWED_EXPORTS = [
  'ATTENTION_PATTERN_EVIDENCE_ACCESSOR_VERSION',
  'ATTENTION_PATTERN_EVIDENCE_WINDOW_LIMIT',
  'AttentionPatternEvidenceAccessRefusal',
  'AttentionPatternEvidenceAccessRequest',
  'AttentionPatternEvidenceAccessResult',
  'AttentionReadablePatternEvidenceView',
  'AttentionReadablePatternEvidenceViewFields',
  'ObservableActionEvidenceViewFields',
  'PatternEvidenceVisibilityProvenance',
  'ProofPatternEvidenceRecord',
  'ProofPatternEvidenceRecordInput',
  'ProofPatternEvidenceSnapshot',
  'ProofPatternEvidenceSnapshotInput',
  'ValidatedPublicCommunicationEvidenceViewFields',
  'WorldObservableAvailabilityEvidenceViewFields',
  'createProofPatternEvidenceRecord',
  'createProofPatternEvidenceSnapshot',
  'isStructurallyValidAttentionReadablePatternEvidenceView',
  'isStructurallyValidProofPatternEvidenceRecord',
] as const

const PATTERN_ACCESSOR_ALLOWED_EXPORTS = [
  'isAttentionReadablePatternEvidenceViewFromAccessor',
  'readAttentionReadablePatternEvidenceViews',
] as const

const SRC_ROOT = fileURLToPath(new URL('../../', import.meta.url))
const PROOF_DIRECTORY = 'domain/livingWorldProof'

// ---------------------------------------------------------------------------
// Parser-backed source inspection
// ---------------------------------------------------------------------------

function parse(fileName: string, source: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
}

function staticLiteralText(node: ts.Node | undefined): string | null {
  if (node === undefined) return null
  // A template literal counts only when it has no substitutions: a computed
  // specifier is not a statically known dependency.
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  return null
}

/**
 * Every statically resolvable module specifier in a file: `import ... from`,
 * bare `import`, `export ... from`, dynamic `import()`, `require()`, and
 * `import x = require()`, in any quote style. Comments and ordinary strings are
 * not dependencies and are never reported, because the parser distinguishes
 * them structurally rather than by pattern.
 */
function moduleSpecifiers(fileName: string, source: string): string[] {
  const specifiers: string[] = []

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const specifier = staticLiteralText(node.moduleSpecifier)
      if (specifier !== null) specifiers.push(specifier)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      const specifier = staticLiteralText(node.moduleReference.expression)
      if (specifier !== null) specifiers.push(specifier)
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if (isDynamicImport || isRequire) {
        const specifier = staticLiteralText(node.arguments[0])
        if (specifier !== null) specifiers.push(specifier)
      }
    }
    ts.forEachChild(node, visit)
  }

  visit(parse(fileName, source))
  return specifiers
}

function scanTokens(source: string, onToken: (token: ts.SyntaxKind, text: string) => void): void {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source)
  let previousPosition = -1
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    const position = scanner.getTokenEnd()
    // Defensive: never spin if the scanner cannot make progress.
    if (position <= previousPosition) break
    previousPosition = position
    onToken(token, scanner.getTokenText())
  }
}

/**
 * Blank out comments while preserving every other byte and the line structure,
 * using the compiler's own scanner. Unlike a regex stripper it cannot mistake
 * `//` or `/*` inside a string or regular-expression literal for a comment.
 */
function stripComments(source: string): string {
  let stripped = ''
  scanTokens(source, (token, text) => {
    stripped += token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia
      ? text.replace(/[^\r\n]/g, ' ')
      : text
  })
  return stripped
}

/** Complete AST identifier traversal: never prose/string text and never truncated by templates. */
function identifierNames(source: string, fileName = 'identifier-scan.ts'): Set<string> {
  const names = new Set<string>()
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) names.add(node.text)
    ts.forEachChild(node, visit)
  }
  visit(parse(fileName, source))
  return names
}

type ExportEntryKind =
  | 'declaration'
  | 'named-export'
  | 're-export'
  | 'export-star'
  | 'namespace-export'
  | 'default-export'

interface ExportEntry {
  readonly kind: ExportEntryKind
  readonly exportedName: string
  readonly localName: string | null
  readonly identifiers: readonly string[]
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false)
}

function hasDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node)
    && (ts.getModifiers(node)?.some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword) ?? false)
}

function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text]
  return name.elements.flatMap((element) => (
    ts.isOmittedExpression(element) ? [] : bindingNames(element.name)
  ))
}

function identifiersWithin(node: ts.Node): readonly string[] {
  const names = new Set<string>()
  const visit = (child: ts.Node): void => {
    if (ts.isIdentifier(child)) names.add(child.text)
    ts.forEachChild(child, visit)
  }
  visit(node)
  return [...names].sort()
}

/**
 * Complete public-export surface, including declarations, aliases, default
 * exports, re-exports, export-star, and namespace exports. TypeScript's parser
 * owns template-literal state, so declarations after nested/interpolated
 * templates cannot disappear from this oracle.
 */
function exportedEntries(fileName: string, source: string): readonly ExportEntry[] {
  const entries: ExportEntry[] = []
  const sourceFile = parse(fileName, source)

  const visit = (node: ts.Node): void => {
    if (ts.isExportAssignment(node)) {
      entries.push({
        kind: 'default-export',
        exportedName: 'default',
        localName: ts.isIdentifier(node.expression) ? node.expression.text : null,
        identifiers: identifiersWithin(node.expression),
      })
    } else if (ts.isExportDeclaration(node)) {
      const moduleSpecifier = staticLiteralText(node.moduleSpecifier)
      if (node.exportClause === undefined) {
        entries.push({
          kind: 'export-star',
          exportedName: '*',
          localName: moduleSpecifier,
          identifiers: [],
        })
      } else if (ts.isNamespaceExport(node.exportClause)) {
        entries.push({
          kind: 'namespace-export',
          exportedName: node.exportClause.name.text,
          localName: moduleSpecifier,
          identifiers: [node.exportClause.name.text],
        })
      } else {
        for (const element of node.exportClause.elements) {
          const localName = element.propertyName?.text ?? element.name.text
          entries.push({
            kind: moduleSpecifier === null ? 'named-export' : 're-export',
            exportedName: element.name.text,
            localName,
            identifiers: [localName, element.name.text],
          })
        }
      }
    } else if (ts.isVariableStatement(node) && hasExportModifier(node)) {
      for (const declaration of node.declarationList.declarations) {
        for (const name of bindingNames(declaration.name)) {
          entries.push({
            kind: hasDefaultModifier(node) ? 'default-export' : 'declaration',
            exportedName: hasDefaultModifier(node) ? 'default' : name,
            localName: name,
            identifiers: identifiersWithin(declaration),
          })
        }
      }
    } else if (
      (
        ts.isFunctionDeclaration(node)
        || ts.isClassDeclaration(node)
        || ts.isInterfaceDeclaration(node)
        || ts.isTypeAliasDeclaration(node)
        || ts.isEnumDeclaration(node)
        || ts.isModuleDeclaration(node)
      )
      && hasExportModifier(node)
    ) {
      const localName = node.name === undefined
        ? null
        : ts.isIdentifier(node.name)
          ? node.name.text
          : node.name.text
      entries.push({
        kind: hasDefaultModifier(node) ? 'default-export' : 'declaration',
        exportedName: hasDefaultModifier(node) ? 'default' : (localName ?? '<anonymous>'),
        localName,
        identifiers: identifiersWithin(node),
      })
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return entries
}

function publicExportNames(fileName: string, source: string): readonly string[] {
  return [...new Set(exportedEntries(fileName, source).map((entry) => entry.exportedName))].sort()
}

function exportedMintAuthorityRisks(fileName: string, source: string): readonly ExportEntry[] {
  return exportedEntries(fileName, source).filter((entry) => (
    entry.kind === 'export-star'
    || entry.kind === 'namespace-export'
    || entry.kind === 'default-export'
    || [entry.exportedName, entry.localName, ...entry.identifiers]
      .some((name) => typeof name === 'string' && /mint/i.test(name))
  ))
}

/**
 * Every Stage A attention proof module, by specifier shape. The A3 derived
 * candidate modules are `attentionCandidate*`, which the A1/A2 pattern alone
 * would not have caught, so the reverse dependency-direction scan below would
 * have silently stopped covering the newest modules without this alternative.
 * The A4 presentation modules are `attentionRevealPackage`, `attentionTemplate`,
 * and `attentionZeroModelProbe`, none of which any earlier alternative matches,
 * so each is named here for the same reason.
 */
const ATTENTION_MODULE_SPECIFIER =
  /attention(QuestCandidate|PatternEvidence|NarrativePattern|ReadableBoundary|StageAQuestOnlyGolden|Candidate|Ledger|RevealPackage|Template|ZeroModelProbe|Trace|Replay)/

/**
 * Sound pre-filter for the whole-tree scans. Every token's text is a substring
 * of the file's text, so a file whose text lacks the literal needle cannot
 * produce a matching specifier or identifier. Skipping those files can only
 * skip ones that provably cannot match: it narrows the work, never the
 * guarantee. Without it, parsing every file in `apps/web/src` is slow enough to
 * make this evidence flaky, and a flaky proof is not a proof.
 */
function mayContain(source: string, needle: string): boolean {
  return source.includes(needle)
}

/** Does this file reach a Stage A attention proof module by any import form? */
function importsAttentionProofModule(fileName: string, source: string): boolean {
  if (!mayContain(source, 'attention')) return false
  return moduleSpecifiers(fileName, source).some((specifier) => ATTENTION_MODULE_SPECIFIER.test(specifier))
}

/** Does this file name the accessor-origin mint as an identifier? */
function namesViewMint(source: string): boolean {
  if (!mayContain(source, VIEW_MINT_IDENTIFIER)) return false
  return identifierNames(source).has(VIEW_MINT_IDENTIFIER)
}

function namesPatternViewMint(source: string): boolean {
  if (!mayContain(source, PATTERN_VIEW_MINT_IDENTIFIER)) return false
  return identifierNames(source).has(PATTERN_VIEW_MINT_IDENTIFIER)
}

/** Does this file name the sidecar mint as an identifier? */
function namesOpeningCoordinateMint(source: string): boolean {
  if (!mayContain(source, OPENING_COORDINATE_MINT_IDENTIFIER)) return false
  return identifierNames(source).has(OPENING_COORDINATE_MINT_IDENTIFIER)
}

function readProofSource(fileName: string): string {
  return readFileSync(fileURLToPath(new URL(`./${fileName}`, import.meta.url)), 'utf8')
}

function readStrippedSource(fileName: string): string {
  return stripComments(readProofSource(fileName))
}

function proofModuleSpecifiers(fileName: string): string[] {
  return moduleSpecifiers(fileName, readProofSource(fileName))
}

// ---------------------------------------------------------------------------
// Source tree discovery
// ---------------------------------------------------------------------------

function listSourceFiles(directory: string, relative: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryRelative = relative === '' ? entry.name : `${relative}/${entry.name}`
    if (entry.isDirectory()) {
      return entryRelative === PROOF_DIRECTORY ? [] : listSourceFiles(`${directory}${entry.name}/`, entryRelative)
    }
    return /\.tsx?$/.test(entry.name) ? [entryRelative] : []
  })
}

/**
 * Named files and roots that must appear in any honest walk of `apps/web/src`.
 * A path, name, or recursion mistake that quietly shrinks the scan is caught
 * here by name, not by a bare count that a partial walk could still satisfy.
 */
const REQUIRED_SCAN_WITNESSES = [
  'App.tsx',
  'main.tsx',
  'domain/world/applyEvent.ts',
  'domain/quests/evaluateQuest.ts',
  'world-session/WorldSession.ts',
  'persistence/SqliteWorldStore.ts',
  'server/main.ts',
] as const

const REQUIRED_SCAN_ROOTS = [
  'app', 'dialogue', 'domain', 'encounters', 'generation', 'interactions',
  'memory', 'persistence', 'platform', 'renderer', 'room', 'server', 'world-session',
] as const

const MINIMUM_SCANNED_FILES = 400

describe('A2 evidence mechanism — parser-backed extraction separates dependencies from prose', () => {
  const ALL_IMPORT_FORMS = [
    "import { a } from './single-quoted'",
    'import { b } from "./double-quoted"',
    "import './bare-single'",
    'import "./bare-double"',
    "export { c } from './export-from-single'",
    'export * from "./export-from-double"',
    "const d = await import('./dynamic-single')",
    'const e = await import("./dynamic-double")',
    'const f = await import(`./dynamic-template`)',
    "const g = require('./require-single')",
    'const h = require("./require-double")',
    'const i = require(`./require-template`)',
    "import j = require('./import-equals-single')",
    'import k = require("./import-equals-double")',
  ].join('\n')

  it('detects every static, dynamic, export-from, require, and import-equals form in both quote styles', () => {
    expect(moduleSpecifiers('forms.ts', ALL_IMPORT_FORMS)).toEqual([
      './single-quoted',
      './double-quoted',
      './bare-single',
      './bare-double',
      './export-from-single',
      './export-from-double',
      './dynamic-single',
      './dynamic-double',
      './dynamic-template',
      './require-single',
      './require-double',
      './require-template',
      './import-equals-single',
      './import-equals-double',
    ])
  })

  it('ignores import-shaped text in comments and in ordinary strings', () => {
    const prose = [
      '/* Documentation may discuss WorldEvent, applyEvent, and Math.random() freely,',
      "   and may quote import { applyEvent } from '../world/applyEvent' verbatim. */",
      "// import { appendEvent } from '../world/appendEvent'",
      "const documentation = \"import { x } from './not-a-dependency'\"",
      "const alsoProse = 'require(\\'./also-not-a-dependency\\')'",
      "import { legal } from './attentionQuestCandidateContracts'",
    ].join('\n')

    expect(moduleSpecifiers('prose.ts', prose)).toEqual(['./attentionQuestCandidateContracts'])
  })

  it('does not treat a computed template specifier as a statically known dependency', () => {
    const computed = 'const mod = await import(`./module-${name}`)'

    expect(moduleSpecifiers('computed.ts', computed)).toEqual([])
  })

  it('strips comments without mistaking comment markers inside strings or regexes', () => {
    const source = [
      '/* WorldEvent and applyEvent named in prose */',
      '// Math.random() named in prose',
      "const url = 'https://example.com/not-a-comment'",
      'const pattern = /\\/\\*not-a-comment\\*\\//',
      'const roll = Math.random()',
    ].join('\n')
    const stripped = stripComments(source)

    expect(stripped).not.toMatch(/\bWorldEvent\b/)
    expect(stripped).not.toMatch(/\bapplyEvent\b/)
    expect(stripped).toContain('https://example.com/not-a-comment')
    expect(stripped).toContain('not-a-comment')
    expect(stripped).toMatch(/\bMath\.random\b/)
    // Line structure is preserved so any reported offset still lines up.
    expect(stripped.split('\n')).toHaveLength(source.split('\n').length)
  })

  it('collects AST identifiers without picking up names in comments or strings', () => {
    const source = [
      '// mintAttentionReadableQuestCandidateView named in a comment',
      "const label = 'mintAttentionReadableQuestCandidateView in a string'",
      'const used = realIdentifier',
    ].join('\n')
    const names = identifierNames(source)

    expect(names.has(VIEW_MINT_IDENTIFIER)).toBe(false)
    expect(names.has('realIdentifier')).toBe(true)
  })

  it.each([
    [
      'template before exported mint',
      [
        'const label = `before ${value}`',
        'export function mintPatternView() { return {} }',
      ].join('\n'),
    ],
    [
      'multiple template expressions before exported mint',
      [
        'const label = `before ${first} middle ${second}`',
        'export const mintPatternView = () => ({})',
      ].join('\n'),
    ],
    [
      'nested template before exported mint',
      [
        'const label = `outer ${`inner ${value}`}`',
        'export class MintPatternView {}',
      ].join('\n'),
    ],
    [
      'aliased exported mint',
      [
        'const mintPatternView = () => ({})',
        'export { mintPatternView as apparentlySafe }',
      ].join('\n'),
    ],
    [
      'exported variable assigned to mint function',
      [
        'const mintPatternView = () => ({})',
        'export const apparentlySafe = mintPatternView',
      ].join('\n'),
    ],
    [
      'single-quoted re-export',
      "export { mintPatternView as apparentlySafe } from './mint-source'",
    ],
    [
      'double-quoted re-export',
      'export { mintPatternView as apparentlySafe } from "./mint-source"',
    ],
    [
      'export-star',
      "export * from './mint-source'",
    ],
    [
      'namespace export',
      'export * as mintNamespace from "./mint-source"',
    ],
    [
      'default export',
      [
        'const apparentlySafe = () => ({})',
        'export default apparentlySafe',
      ].join('\n'),
    ],
  ])('detects the complete exported authority surface: %s', (_label, source) => {
    expect(exportedMintAuthorityRisks('adversarial-export.ts', source).length).toBeGreaterThan(0)
  })

  it('keeps real module code after stripping that module\'s doc comments', () => {
    const contracts = readStrippedSource('attentionQuestCandidateContracts.ts')
    const boundary = readStrippedSource('attentionReadableBoundary.ts')

    expect(contracts).toMatch(/export interface QuestCandidate\b/)
    expect(contracts).not.toMatch(/not a production quest API/)
    expect(boundary).toMatch(/export function constructAttentionReadableSurface\b/)
    expect(boundary).not.toMatch(/Attention Ledger Replay v0/)
  })
})

describe('A2 / P1 — negative controls: a forbidden import is caught in every syntax', () => {
  const BOUNDARY_SPECIFIER = /attention(ReadableBoundary|QuestCandidate|Ledger)/

  const forbiddenProductionImports: [string, string][] = [
    ['single-quoted static', "import { constructAttentionReadableSurface } from '../livingWorldProof/attentionReadableBoundary'"],
    ['double-quoted static', 'import { constructAttentionReadableSurface } from "../livingWorldProof/attentionReadableBoundary"'],
    ['export-from', "export { constructAttentionReadableSurface } from '../livingWorldProof/attentionReadableBoundary'"],
    ['export-star double-quoted', 'export * from "../livingWorldProof/attentionReadableBoundary"'],
    ['dynamic import single-quoted', "const m = await import('../livingWorldProof/attentionReadableBoundary')"],
    ['dynamic import double-quoted', 'const m = await import("../livingWorldProof/attentionReadableBoundary")'],
    ['dynamic import template', 'const m = await import(`../livingWorldProof/attentionReadableBoundary`)'],
    ['require single-quoted', "const m = require('../livingWorldProof/attentionReadableBoundary')"],
    ['require double-quoted', 'const m = require("../livingWorldProof/attentionReadableBoundary")'],
    ['import-equals require', "import m = require('../livingWorldProof/attentionReadableBoundary')"],
  ]

  it.each(forbiddenProductionImports)('a production file reaching A-prime by %s is detected', (_label, source) => {
    // Exercises the exact predicate the whole-tree reverse scan uses, so the
    // controls cover its pre-filter too, not a parallel simplified path.
    expect(importsAttentionProofModule('domain/quests/offender.ts', source)).toBe(true)
    expect(moduleSpecifiers('domain/quests/offender.ts', source).some((s) => BOUNDARY_SPECIFIER.test(s))).toBe(true)
  })

  it('does not flag a production file that only mentions the proof modules in prose', () => {
    const innocent = [
      "// This module deliberately does not import attentionReadableBoundary.",
      "const note = 'see attentionLedgerStaticClosure for the closure evidence'",
      "import { evaluateQuest } from './evaluateQuest'",
    ].join('\n')

    expect(importsAttentionProofModule('domain/quests/innocent.ts', innocent)).toBe(false)
  })

  const forbiddenBoundaryImports: [string, string][] = [
    ['single-quoted static', "import { stableHash32 } from '../stableHash'"],
    ['double-quoted static', 'import { stableHash32 } from "../stableHash"'],
    ['export-from', "export { stableHash32 } from '../stableHash'"],
    ['dynamic import', 'const h = await import("../stableHash")'],
    ['require', "const h = require('../stableHash')"],
    ['import-equals require', 'import h = require("../stableHash")'],
  ]

  it.each(forbiddenBoundaryImports)('a Stage A module importing ../stableHash by %s breaks the allowlist', (_label, source) => {
    const allowed = ALLOWED_IMPORT_SPECIFIERS['attentionReadableBoundary.ts'] ?? []
    const specifiers = moduleSpecifiers('attentionReadableBoundary.ts', stripComments(source))

    expect(specifiers).toContain('../stableHash')
    expect(specifiers.filter((specifier) => !allowed.includes(specifier))).not.toEqual([])
  })

  it('a Stage A module reaching an authoritative path is caught whatever the quote style', () => {
    for (const source of [
      "import { applyEvent } from '../world/applyEvent'",
      'import { applyEvent } from "../world/applyEvent"',
      'const m = await import("../world/applyEvent")',
    ]) {
      const specifiers = moduleSpecifiers('attentionReadableBoundary.ts', stripComments(source))
      const [, pattern] = FORBIDDEN_SPECIFIER_PATTERNS[0]!
      expect(specifiers.some((specifier) => pattern.test(specifier))).toBe(true)
    }
  })
})

describe('A2 / P1 — Stage A proof modules import a closed Stage A allowlist only', () => {
  it.each(STAGE_A_PROOF_MODULES)('%s imports nothing outside its allowlist', (fileName) => {
    const allowed = ALLOWED_IMPORT_SPECIFIERS[fileName] ?? []
    const specifiers = proofModuleSpecifiers(fileName)

    expect(specifiers.filter((specifier) => !allowed.includes(specifier))).toEqual([])
  })

  it.each(STAGE_A_PROOF_MODULES)('%s names no forbidden authoritative, cognitive, planner, scheduler, RNG, envelope, provider, or ledger surface', (fileName) => {
    const source = readStrippedSource(fileName)

    for (const [label, pattern] of FORBIDDEN_SOURCE_PATTERNS) {
      expect({ file: fileName, label, matched: pattern.test(source) })
        .toEqual({ file: fileName, label, matched: false })
    }
  })

  it.each(STAGE_A_PROOF_MODULES)('%s depends on no forbidden module path', (fileName) => {
    const specifiers = proofModuleSpecifiers(fileName)

    for (const [label, pattern] of FORBIDDEN_SPECIFIER_PATTERNS) {
      const offending = specifiers.filter((specifier) => pattern.test(specifier))
      expect({ file: fileName, label, offending }).toEqual({ file: fileName, label, offending: [] })
    }
  })

  it('every Stage A module has an allowlist entry, so a new module cannot be scanned against nothing', () => {
    expect([...STAGE_A_PROOF_MODULES].sort()).toEqual(Object.keys(ALLOWED_IMPORT_SPECIFIERS).sort())
  })

  it('covers exactly every attention-prefixed, non-test proof module on disk', () => {
    const discovered = readdirSync(fileURLToPath(new URL('./', import.meta.url)))
      .filter((name) => /^attention.*\.tsx?$/.test(name))
      .filter((name) => !/\.test\.tsx?$/.test(name))
      .sort()
    expect(discovered).toEqual([...STAGE_A_PROOF_MODULES].sort())
  })
})

/**
 * ADR-0013 D12 step 2 / replay spec §24 L1 scope this rule to *detection and
 * A-prime construction* — A1 through A3's ordering/cache-key modules. The A5
 * trace and replay harness sit downstream of the ledger append step (D12 step
 * 14): recording an outcome is not reading the ledger back into detection, so
 * `attentionReplay.ts` is deliberately excluded here, exactly as `attentionLedger.ts`
 * itself already was (a module cannot "read itself" in the sense this rule closes).
 */
const DETECTION_AND_CONSTRUCTION_MODULES = STAGE_A_PROOF_MODULES.filter((fileName) => (
  fileName !== 'attentionLedger.ts' && fileName !== 'attentionReplay.ts'
))

describe('A4 / D12 step 2 — detection and A-prime construction never read the Attention Ledger (surface C)', () => {
  it.each(DETECTION_AND_CONSTRUCTION_MODULES)('%s does not import the ledger', (fileName) => {
    expect(proofModuleSpecifiers(fileName)).not.toContain(LEDGER_SPECIFIER)
  })

  it('is not merely an allowlist claim: no detection/construction allowlist entry admits the ledger either', () => {
    const admitting = Object.entries(ALLOWED_IMPORT_SPECIFIERS)
      .filter(([fileName]) => (DETECTION_AND_CONSTRUCTION_MODULES as readonly string[]).includes(fileName))
      .filter(([, allowed]) => allowed.includes(LEDGER_SPECIFIER))
      .map(([fileName]) => fileName)

    expect(admitting).toEqual([])
  })

  it('is named by exactly one module beyond the ledger itself: the A5 replay harness, which records a ledger append result rather than feeding one back into detection', () => {
    const admitting = Object.entries(ALLOWED_IMPORT_SPECIFIERS)
      .filter(([, allowed]) => allowed.includes(LEDGER_SPECIFIER))
      .map(([fileName]) => fileName)

    expect(admitting.sort()).toEqual(['attentionReplay.ts'])
    expect(proofModuleSpecifiers('attentionReplay.ts')).toContain(LEDGER_SPECIFIER)
  })

  it('detects a ledger import if one were added, in any import form', () => {
    for (const source of [
      "import { appendAttentionLedgerRecord } from './attentionLedger'",
      'export { createAttentionLedger } from "./attentionLedger"',
      "const c = await import('./attentionLedger')",
      'const d = require("./attentionLedger")',
    ]) {
      expect(moduleSpecifiers('attentionCandidate.ts', stripComments(source))).toContain(LEDGER_SPECIFIER)
    }
  })
})

describe('A4 / P1 — the reverse scan covers the A4 module names too', () => {
  const A4_SPECIFIERS = [
    '../livingWorldProof/attentionRevealPackage',
    '../livingWorldProof/attentionTemplate',
    '../livingWorldProof/attentionLedger',
    '../livingWorldProof/attentionZeroModelProbe',
  ] as const

  it.each(A4_SPECIFIERS)('a production file importing %s is detected', (specifier) => {
    // The A4 names do not match the A1/A2/A3 specifier alternatives, so without
    // their own alternatives the whole-tree reverse scan would have silently
    // stopped covering the newest modules.
    expect(importsAttentionProofModule('domain/quests/offender.ts', `import { x } from '${specifier}'`)).toBe(true)
  })
})

describe('A5 / P1 — the reverse scan covers the A5 module names too', () => {
  const A5_SPECIFIERS = [
    '../livingWorldProof/attentionTrace',
    '../livingWorldProof/attentionReplayResources',
    '../livingWorldProof/attentionReplay',
    '../livingWorldProof/attentionReplayScenario',
  ] as const

  it.each(A5_SPECIFIERS)('a production file importing %s is detected', (specifier) => {
    // Neither the A1/A2/A3 nor the A4 specifier alternatives match "Trace" or
    // "Replay", so without their own alternative the whole-tree reverse scan
    // would have silently stopped covering the A5 modules.
    expect(importsAttentionProofModule('domain/quests/offender.ts', `import { x } from '${specifier}'`)).toBe(true)
  })
})

describe('B1 / S2 — the common A-prime constructor names no raw A-domain surface', () => {
  it('imports only the approved view contracts and read-only origin verifiers', () => {
    const specifiers = proofModuleSpecifiers('attentionReadableBoundary.ts')

    expect(specifiers.length).toBeGreaterThan(0)
    expect([...new Set(specifiers)].sort()).toEqual([
      './attentionClosedRelationCertificateAccessor',
      './attentionClosedRelationCertificateContracts',
      './attentionPatternEvidenceAccessor',
      './attentionPatternEvidenceContracts',
      './attentionQuestCandidateContracts',
    ])
  })

  it('never names a raw quest/pattern record, snapshot, accessor call, mint, private field, or lifecycle value', () => {
    const source = readStrippedSource('attentionReadableBoundary.ts')

    for (const [label, pattern] of FORBIDDEN_BOUNDARY_PATTERNS) {
      expect({ label, matched: pattern.test(source) }).toEqual({ label, matched: false })
    }
  })

  it('exposes exactly one five-parameter constructor: request and the four admitted view collections', () => {
    // B4 adds a parameter and a surface-schema version to the one existing
    // constructor. It does not add a second A-prime boundary: this file's
    // `ALLOWED_IMPORT_SPECIFIERS` admits exactly one boundary module, and the
    // reverse scan below proves nothing outside the rig reaches it.
    expect(constructAttentionReadableSurface.length).toBe(4)
  })
})

describe('B4 / S2 — the quest opening-coordinate sidecar has accessor-only mint authority', () => {
  // Documented test-local timeout (plan §10 "Static-closure timeout handling").
  //
  // This assertion synchronously reads and parses every .ts/.tsx file under
  // `apps/web/src` to prove the sidecar mint is named nowhere outside the two
  // authorized files. Measured on this tree: 522ms when the file runs alone,
  // but 6526ms — past Vitest's 5000ms default — when the whole repository suite
  // runs and dozens of sibling files contend for the same disk and worker
  // pool. The failure mode was confirmed to be wall clock only: the identical
  // scan and the identical assertion pass in isolation, so nothing here is a
  // scan-coverage or logic regression being papered over.
  //
  // The budget below therefore buys time for exactly the same complete result.
  // It scans no less, retries nothing, skips nothing, and leaves the
  // suite-wide default untouched; it is scoped to this one `it`, and the
  // sibling tests in this block keep the default.
  it('is named by the defining contracts module and the quest accessor, and by nothing else', () => {
    const files = listSourceFiles(SRC_ROOT, '')
      .concat(readdirSync(`${SRC_ROOT}${PROOF_DIRECTORY}/`).map((name) => `${PROOF_DIRECTORY}/${name}`))
      .filter((file) => /\.tsx?$/.test(file))
      // This evidence file necessarily names the mint as the subject of the assertion.
      .filter((file) => !file.endsWith('attentionLedgerStaticClosure.test.ts'))

    const namingFiles = files.filter((file) => (
      namesOpeningCoordinateMint(readFileSync(`${SRC_ROOT}${file}`, 'utf8'))
    ))

    expect([...namingFiles].sort()).toEqual([...OPENING_COORDINATE_MINT_AUTHORIZED_FILES].sort())
  }, 10_000)

  it('keeps its nominal marker module-private and independent of the legal view marker', () => {
    const contracts = readStrippedSource('attentionQuestCandidateContracts.ts')

    expect(contracts).toMatch(/^const OPENING_COORDINATE_MINT_MARKER: unique symbol = Symbol\(/m)
    expect(contracts).not.toMatch(/export\s+(const|declare const)\s+OPENING_COORDINATE_MINT_MARKER\b/)
    // Two distinct symbols, so neither contract's authority check can be
    // satisfied by the other contract's minted value.
    expect(contracts).toMatch(/^const ACCESSOR_MINT_MARKER: unique symbol = Symbol\(/m)
  })

  it('is not named by the A-prime boundary or the candidate normalizer, which receive minted sidecars rather than making them', () => {
    for (const fileName of ['attentionReadableBoundary.ts', 'attentionCandidate.ts', 'attentionCandidateOrdering.ts']) {
      expect(identifierNames(readProofSource(fileName)).has(OPENING_COORDINATE_MINT_IDENTIFIER)).toBe(false)
    }
  })

  it('is not credited to a file that only mentions it in a comment or a string', () => {
    expect(namesOpeningCoordinateMint('// mintAttentionReadableQuestOpeningCoordinateView is not called here')).toBe(false)
    expect(namesOpeningCoordinateMint("const note = 'mintAttentionReadableQuestOpeningCoordinateView'")).toBe(false)
    expect(namesOpeningCoordinateMint('const s = mintAttentionReadableQuestOpeningCoordinateView(fields)')).toBe(true)
  })
})

describe('B4 / P1 — no raw QuestCandidate reaches candidate ordering, identity, or the cache key', () => {
  const DOWNSTREAM_MODULES = [
    'attentionCandidate.ts',
    'attentionCandidateIdentity.ts',
    'attentionCandidateOrdering.ts',
    'attentionCandidateCacheKey.ts',
  ] as const

  it.each(DOWNSTREAM_MODULES)('%s cannot name the raw quest contracts or accessor module', (fileName) => {
    const specifiers = proofModuleSpecifiers(fileName)

    // The raw `QuestCandidate`, the proof snapshot, the `open | resolved`
    // lifecycle, and both accessor mints all live behind these two specifiers.
    // Their absence is what proves these modules read A-prime and nothing else —
    // including the sidecar, which they reach only as a re-export of the one
    // common boundary.
    expect(specifiers).not.toContain('./attentionQuestCandidateContracts')
    expect(specifiers).not.toContain('./attentionQuestCandidateAccessor')
  })

  it('the ordering module names no provenance-derived ordering coordinate and no raw candidate surface', () => {
    const ordering = readStrippedSource('attentionCandidateOrdering.ts')

    // The corrected key 7 is the numeric `openedAtLsn` / `lastProgressLsn`. The
    // defective provenance adapter is gone, and no textual comparison of
    // provenance can be reintroduced without breaking one of these.
    expect(ordering).not.toMatch(/\bderiveQuestSourceCommittedLsnCoordinate\b/)
    expect(ordering).not.toMatch(/\bparseInt\b|\bparseFloat\b|\bNumber\s*\(/)
    expect(ordering).toMatch(/\bopenedAtLsn\b/)
    expect(ordering).toMatch(/\blastProgressLsn\b/)
    // `openingProvenanceId` may not appear in the ordering module at all: it is
    // neither an ordering coordinate nor a value this module has any use for.
    expect(ordering).not.toMatch(/\bopeningProvenanceId\b/)
  })

  it('the canonical derivation cache key reads its dependencies from an explicit bundle, not module ambient state', () => {
    const cacheKey = readStrippedSource('attentionCandidateCacheKey.ts')

    // Both canonical key functions take their bundle as a parameter. The pinned
    // constants are reachable only through the default-bundle factory, so a
    // dependency a test cannot vary cannot reach the key bytes.
    expect(cacheKey).toMatch(/export function deriveAttentionCandidateDerivationCacheKey\(\s*bundle: AttentionCandidateDerivationDependencyBundle,?\s*\)/)
    expect(cacheKey).toMatch(/export function deriveAttentionCandidateRankingCacheKey\(\s*bundle: AttentionCandidateRankingDependencyBundle,?\s*\)/)
  })
})

describe('B4 / P1 — the trusted trace and replay path stay singular and pattern-presentation-free', () => {
  it('there is exactly one trace module, one replay composition seam, and one reveal-package module', () => {
    const proofFiles = readdirSync(fileURLToPath(new URL('./', import.meta.url)))
      .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.test.ts'))

    expect(proofFiles.filter((name) => /^attentionTrace/.test(name))).toEqual(['attentionTrace.ts'])
    expect(proofFiles.filter((name) => /^attentionReplay\.ts$/.test(name))).toEqual(['attentionReplay.ts'])
    expect(proofFiles.filter((name) => /^attentionRevealPackage/.test(name))).toEqual(['attentionRevealPackage.ts'])
    expect(proofFiles.filter((name) => /^attentionCandidateIdentity/.test(name))).toEqual(['attentionCandidateIdentity.ts'])
    expect(proofFiles.filter((name) => /^attentionCandidateOrdering/.test(name))).toEqual(['attentionCandidateOrdering.ts'])
    expect(proofFiles.filter((name) => /^attentionCandidateCacheKey/.test(name))).toEqual(['attentionCandidateCacheKey.ts'])
    expect(proofFiles.filter((name) => /^attentionReadableBoundary/.test(name))).toEqual(['attentionReadableBoundary.ts'])
  })

  it('no stale four-key ordering narration survives in the trace or replay modules', () => {
    for (const fileName of ['attentionTrace.ts', 'attentionReplay.ts']) {
      const source = readProofSource(fileName)
      expect({ fileName, stale: /four-key|four literals|four-literal/i.test(source) })
        .toEqual({ fileName, stale: false })
    }
  })

  it('the B5 reveal package has a direct-only pattern branch', () => {
    const revealPackage = readStrippedSource('attentionRevealPackage.ts')

    expect(revealPackage).toMatch(/ATTENTION_PATTERN_REVEAL_PACKAGE_SCHEMA_VERSION/)
    expect(revealPackage).toMatch(/ATTENTION_PATTERN_DIRECT_EVIDENCE_TEMPLATE_VERSION/)
    expect(revealPackage).not.toMatch(/narrativeAnnotation|patternType|motive|friend|trust/i)
  })

  it('the B5 pattern helper is the only one-candidate composition and the B6 evaluator is the sole mixed-family seam', () => {
    const replaySource = readStrippedSource('attentionReplay.ts')

    // The B5 wrapper delegates its one-candidate work to the extracted helper;
    // the helper owns each family-specific operation and no loop/cap/trace.
    expect(replaySource).toMatch(/function runAttentionPatternPresentationPass/)
    expect(replaySource).toMatch(/function attemptAttentionPatternPresentation/)
    const helperStart = replaySource.indexOf('function attemptAttentionPatternPresentation')
    const helperBody = replaySource.slice(helperStart, helperStart + 8000)
    expect(helperBody).toMatch(/revalidateAttentionPatternPresentation\s*\(/)
    expect(helperBody).toMatch(/buildAttentionDirectEvidenceAssertions\s*\(/)
    expect(helperBody).toMatch(/buildAttentionRevealPackage\s*\(/)
    expect(helperBody).toMatch(/renderAttentionRevealPackage\s*\(/)
    expect(helperBody).toMatch(/appendAttentionLedgerRecord\s*\(/)
    expect(replaySource.match(/function runAttentionMixedFamilyEvaluation/g) ?? []).toHaveLength(1)
    expect(replaySource.match(/applyMixedFamilyCandidateCap\s*\(/g) ?? []).toHaveLength(2)
  })

  /**
   * B6 / plan §11.6 item 15, §12 — the complete static-closure obligation for the
   * one mixed-family orchestration seam and the two per-family attempt helpers.
   *
   * The assertion is deliberately "exactly one **mixed-family orchestration
   * seam**", never "exactly one function capable of presenting": `attentionReplay.ts`
   * exports five functions that drive or perform a presentation (plan §12's
   * table), and the latter assertion would be false by construction.
   */
  describe('B6 / P1 — one mixed-family orchestration seam, two non-seam attempt helpers', () => {
    const replaySource = readStrippedSource('attentionReplay.ts')

    /**
     * The one pure pattern-prime derivation's name, held as a value rather than
     * written as a literal in the assertions below. `readStrippedSource` leaves
     * comment text in place, so a scanner that spelled the symbol out would match
     * its own prose and, worse, report itself as a second declaring module.
     */
    const DERIVATION_NAME = 'deriveAttentionPatternPrimeCandidates'

    /** The committed §11.2A steps 3-7 chain, in its authorized order. */
    const CHAIN_STEPS = [
      'constructAttentionReadableSurface',
      'reconstructNarrativePatternInstances',
      'applyNarrativePatternStructuralRetention',
      'normalizeAttentionCandidates',
    ] as const

    /** The source of one exported function, up to the start of the next top-level one. */
    function functionBody(name: string): string {
      const start = replaySource.indexOf(`export function ${name}`)
      expect({ name, found: start >= 0 }).toEqual({ name, found: true })
      const after = replaySource.slice(start + 1)
      const nextTop = after.search(/\n(?:export )?(?:function|interface|type|const) /)
      return nextTop < 0 ? after : after.slice(0, nextTop)
    }

    /** The same, for a module-private (non-exported) top-level function. */
    function privateFunctionBody(name: string): string {
      const start = replaySource.indexOf(`\nfunction ${name}`)
      expect({ name, found: start >= 0 }).toEqual({ name, found: true })
      const after = replaySource.slice(start + 1)
      const nextTop = after.search(/\n(?:export )?(?:function|interface|type|const) /)
      return nextTop < 0 ? after : after.slice(0, nextTop)
    }

    it.each(['attemptAttentionQuestPresentation', 'attemptAttentionPatternPresentation'] as const)(
      '%s exists exactly once, attempts one candidate, and owns no loop, ledger creation, ordering, cap, or success slot',
      (helper) => {
        // Exists exactly once -- no second, parallel per-family attempt body.
        expect(replaySource.match(new RegExp(`function ${helper}\\b`, 'g')) ?? []).toHaveLength(1)

        const body = functionBody(helper)
        // Attempts exactly one candidate: no candidate loop of any form.
        expect(body).not.toMatch(/\bfor\s*\(/)
        expect(body).not.toMatch(/\bwhile\s*\(/)
        expect(body).not.toMatch(/\.forEach\s*\(/)
        expect(body).not.toMatch(/\.map\s*\(\s*\(?\s*candidate/)
        // No ledger creation: it threads the caller's ledger and never mints one.
        expect(body).not.toMatch(/createAttentionLedger\s*\(/)
        // No ordering and no cap.
        expect(body).not.toMatch(/orderAttentionCandidates\s*\(/)
        expect(body).not.toMatch(/applyMixedFamilyCandidateCap\s*\(/)
        expect(body).not.toMatch(/mixedFamilyCandidatesAfterOrdering/)
        // No success-slot state, and no trace assembly.
        expect(body).not.toMatch(/successfulPresentations|slotConsumed|presentationsPerEvaluation/)
        expect(body).not.toMatch(/buildAttentionTrace\s*\(/)
        // It does use the existing append route.
        expect(body).toMatch(/appendAttentionLedgerRecord\s*\(/)
      },
    )

    it('runAttentionP3PairedWorldCheck still delegates only to the frozen quest-only pass', () => {
      const body = functionBody('runAttentionP3PairedWorldCheck')
      expect(body).toMatch(/runAttentionQuestCandidateReplayPass\s*\(/)
      expect(body).not.toMatch(/runAttentionMixedFamilyEvaluation\s*\(/)
      expect(body).not.toMatch(/attemptAttentionPatternPresentation\s*\(/)
      expect(body).not.toMatch(/reconstructNarrativePatternInstances\s*\(/)
    })

    it('exactly one mixed-family orchestration seam and exactly one mixed candidate loop exist', () => {
      // One seam, declared once and exported once.
      expect(replaySource.match(/function runAttentionMixedFamilyEvaluation\b/g) ?? []).toHaveLength(1)
      // Its single candidate loop over the capped retained sequence.
      const seam = functionBody('runAttentionMixedFamilyEvaluation')
      const candidateLoops = seam.match(/for\s*\(let rankPosition = 0; rankPosition < retainedCandidates\.length/g) ?? []
      expect(candidateLoops).toHaveLength(1)
      // No *second* loop walks the ordered or capped candidate sequence. The
      // seam's only other loop builds the revalidation-coordinate lookup map,
      // which iterates freshly normalized revalidation candidates, not the
      // ranked sequence being arbitrated.
      expect(seam.match(/for\s*\([^)]*\bof\s+(?:retainedCandidates|ordered\.orderedCandidates)\b/g) ?? []).toHaveLength(0)
      expect(seam.match(/\bfor\s*\(/g) ?? []).toHaveLength(2)
      expect(seam).toMatch(/for \(const candidate of revalidatedPatternCandidates\.attentionCandidates\)/)
      // No second family-priority rule anywhere in the module.
      expect(replaySource).not.toMatch(/fairness|roundRobin|round_robin|rotation|familyQuota|antiStarvation|scoreWeight/i)
    })

    /**
     * B6 / RN019 §9.4.2 and plan §11.2A — the mixed evaluator's
     * **revalidation-coordinate** pattern chain. Two properties are structural,
     * not incidental, and neither is expressed as a line number:
     *
     *  1. the A′ boundary runs BEFORE reconstruction, and reconstruction consumes
     *     the boundary's re-emitted accepted views, never the raw input list;
     *  2. a refusal anywhere in that chain is handled by omission -- it never
     *     produces an evaluation-level return, and it never gates the quest
     *     branch, because only the quest construction rows 7-9 fail closed.
     */
    it('the revalidation-coordinate pattern chain is boundary -> reconstruction -> retention, and its refusal never fails the evaluation', () => {
      const seam = functionBody('runAttentionMixedFamilyEvaluation')

      // (1) The raw revalidation input list reaches the A′ boundary and nothing
      //     else, so no later step can consume unvalidated views.
      const rawUses = seam.match(/input\.revalidationPatternEvidenceViews/g) ?? []
      expect(rawUses).toHaveLength(1)
      const boundaryCall = seam.indexOf('const revalidatedPatternSurface = constructAttentionReadableSurface(')
      expect(boundaryCall).toBeGreaterThanOrEqual(0)
      // That single raw use sits inside the boundary call, not after it.
      const rawUseAt = seam.indexOf('input.revalidationPatternEvidenceViews')
      expect(rawUseAt).toBeGreaterThan(boundaryCall)

      // (2) Boundary strictly before reconstruction, and reconstruction consumes
      //     the accepted surface views. Located structurally rather than by an
      //     exact source literal: `\s*` spans the intervening line break under
      //     both LF and CRLF, so this holds on any fresh checkout as well as in
      //     an already-materialised tree (the repository sets core.autocrlf=true
      //     and carries no .gitattributes, so a clean checkout of
      //     attentionReplay.ts is CRLF; a hard-coded "\n" here silently matched
      //     nothing and reported -1).
      const reconstructionConsumesAcceptedViews =
        /reconstructRetainedPatterns\(\s*revalidatedPatternSurface\.surface\.patternEvidenceViews/
      const reconstructAt = seam.search(reconstructionConsumesAcceptedViews)
      expect(seam).toMatch(reconstructionConsumesAcceptedViews)
      expect(reconstructAt).toBeGreaterThan(boundaryCall)

      // (3) Retention follows reconstruction (proven inside the committed helper).
      const helperBody = privateFunctionBody('reconstructRetainedPatterns')
      expect(helperBody.indexOf('reconstructNarrativePatternInstances('))
        .toBeLessThan(helperBody.indexOf('applyNarrativePatternStructuralRetention('))

      // (4) The chain is entered on boundary SUCCESS; there is no
      //     `!== 'ok'` refusal branch for it at all.
      expect(seam).toMatch(/if \(revalidatedPatternSurface\.kind === 'ok'\)/)
      expect(seam).not.toMatch(/revalidatedPatternSurface\.kind !== 'ok'/)

      // (5) No evaluation-level return occurs anywhere between the revalidation
      //     boundary call and the arbitration loop -- so a refusing revalidation
      //     A′ construction cannot fail the evaluation closed.
      const loopAt = seam.indexOf('for (let rankPosition = 0;')
      expect(loopAt).toBeGreaterThan(boundaryCall)
      const betweenBoundaryAndLoop = seam.slice(boundaryCall, loopAt)
      expect(betweenBoundaryAndLoop).not.toMatch(/return\s*\{/)

      // (6) The quest branch is not gated by pattern revalidation material: its
      //     body names none of the revalidation-pattern bindings.
      const questBranchAt = seam.indexOf("if (candidate.sourceKind === 'quest_candidate')")
      const patternBranchAt = seam.indexOf('const patternInput = presentationInputByCandidateId.get(')
      expect(questBranchAt).toBeGreaterThan(loopAt)
      expect(patternBranchAt).toBeGreaterThan(questBranchAt)
      const questBranch = seam.slice(questBranchAt, patternBranchAt)
      for (const binding of ['revalidatedPatternSurface', 'revalidationPatternById', 'revalidatedPatternCandidates']) {
        expect({ binding, namedInQuestBranch: questBranch.includes(binding) })
          .toEqual({ binding, namedInQuestBranch: false })
      }

      // (7) The exact-candidateId lookup is unconditional: an absent entry is the
      //     committed candidate-disappeared path, never a sibling substitution.
      expect(seam).toMatch(/revalidatedCandidate: revalidationPatternById\.get\(candidate\.candidateId\)/)
    })

    it('presentationsPerEvaluation is read by the mixed evaluator and by no attempt helper', () => {
      const seam = functionBody('runAttentionMixedFamilyEvaluation')
      expect(seam).toMatch(/policy\.presentationsPerEvaluation/)
      // The budget is the policy value, never a literal comparison at this call site.
      expect(seam).not.toMatch(/successfulPresentations\s*>=\s*1\b/)
      // It is the mixed evaluator's own read. No attempt helper and neither
      // family-specific pass reads it, so the shared budget is owned in exactly
      // one place. (The two helper bodies are asserted free of it above.)
      expect(functionBody('runAttentionPatternPresentationPass')).not.toMatch(/policy\.presentationsPerEvaluation/)
      expect(functionBody('runAttentionQuestCandidateReplayPass')).not.toMatch(/policy\.presentationsPerEvaluation/)
      expect(replaySource.match(/policy\.presentationsPerEvaluation/g) ?? []).toHaveLength(1)
    })

    /**
     * B6 / plan §11.7 — `attentionReplayScenario.ts`'s import boundary is exactly
     * the authorized one. It reaches the pattern-prime derivation through its
     * pre-existing `./attentionReplay` dependency, so the four derivation modules
     * that chain touches are never imported here directly.
     */
    describe('B6 / P1 — the replay scenario module delegates pattern derivation instead of importing it', () => {
      const FORBIDDEN_FOR_REPLAY_SCENARIO = [
        './attentionCandidate',
        './attentionReadableBoundary',
        './attentionNarrativePatternMonitor',
        './attentionNarrativePatternResourcePolicy',
      ] as const

      it.each(FORBIDDEN_FOR_REPLAY_SCENARIO)('attentionReplayScenario.ts has no direct import from %s', (specifier) => {
        expect(proofModuleSpecifiers('attentionReplayScenario.ts')).not.toContain(specifier)
        // Nor does its allowlist admit one, so the boundary is not merely a
        // current-source fact that a later edit could quietly widen.
        expect(ALLOWED_IMPORT_SPECIFIERS['attentionReplayScenario.ts'] ?? []).not.toContain(specifier)
      })

      it('it consumes the pattern-prime derivation through ./attentionReplay and names no chain step of its own', () => {
        const source = readStrippedSource('attentionReplayScenario.ts')
        // The call exists, exactly once, and the binding is imported from the
        // pre-existing `./attentionReplay` specifier -- not from a chain module.
        expect(source.match(new RegExp(`${DERIVATION_NAME}\\s*\\(`, 'g')) ?? []).toHaveLength(1)
        const importBlock = source.slice(0, source.indexOf('export const'))
        expect(importBlock).toMatch(
          new RegExp(`import\\s*\\{[^}]*\\b${DERIVATION_NAME}\\b[^}]*\\}\\s*from\\s*'\\./attentionReplay'`, 's'),
        )
        // It defines no derivation of its own and reimplements no chain step.
        expect(source).not.toMatch(new RegExp(`function ${DERIVATION_NAME}\\b`))
        for (const step of CHAIN_STEPS) {
          expect({ step, named: source.includes(step) }).toEqual({ step, named: false })
        }
      })

      it('its only new B6 scenario dependency is ./attentionNarrativePatternScenario', () => {
        const specifiers = proofModuleSpecifiers('attentionReplayScenario.ts')
        expect(specifiers).toContain('./attentionNarrativePatternScenario')
        // The committed Stage A set plus exactly the two authorized B6 additions.
        expect([...new Set(specifiers)].sort()).toEqual([
          './attentionCandidatePolicy',
          './attentionNarrativePatternScenario',
          './attentionPatternEvidenceContracts',
          './attentionQuestCandidateContracts',
          './attentionQuestCandidateScenario',
          './attentionReplay',
          './attentionReplayResources',
        ])
      })

      it('./attentionPatternEvidenceContracts is retained type-only', () => {
        const source = readStrippedSource('attentionReplayScenario.ts')
        const importLines = source.split('\n').filter((line) => line.includes('./attentionPatternEvidenceContracts'))
        expect(importLines).toHaveLength(1)
        expect(importLines[0]).toMatch(/^import type /)
        // No value binding from that module survives into emitted code.
        expect(source).not.toMatch(/import\s+\{[^}]*\}\s+from\s+'\.\/attentionPatternEvidenceContracts'/)
      })

      it('no equivalent indirect bypass was introduced: no dynamic import, require, or indirect module lookup', () => {
        const source = readStrippedSource('attentionReplayScenario.ts')
        expect(source).not.toMatch(/\bimport\s*\(/)
        expect(source).not.toMatch(/\brequire\s*\(/)
        expect(source).not.toMatch(/\beval\s*\(/)
        expect(source).not.toMatch(/createRequire|module\.constructor|Function\s*\(/)
        // The derivation is delegated, not re-implemented: none of the four
        // owned entry points is named anywhere in this module.
        for (const owned of [
          'normalizeAttentionCandidates', 'constructAttentionReadableSurface',
          'reconstructNarrativePatternInstances', 'applyNarrativePatternStructuralRetention',
        ]) {
          expect({ owned, named: source.includes(owned) }).toEqual({ owned, named: false })
        }
      })

      it('the pattern scenario module stays fixture-only and its allowlist entry is unchanged from 9aa77e8e', () => {
        const owner = readStrippedSource('attentionNarrativePatternScenario.ts')

        // It defines no derivation function and reimplements no chain step. The
        // pre-existing monitor convenience wrapper is the one committed
        // exception, so the monitor call is expected exactly where it was.
        expect(owner).not.toMatch(new RegExp(`function ${DERIVATION_NAME}\\b`))
        expect(owner).not.toMatch(new RegExp(`${DERIVATION_NAME}\\s*\\(`))
        expect(owner).not.toMatch(/buildB6PatternPresentationInputs\s*[(:]/)
        for (const forbidden of [
          'applyNarrativePatternStructuralRetention',
          'constructAttentionReadableSurface',
          'normalizeAttentionCandidates',
        ]) {
          expect({ forbidden, named: owner.includes(forbidden) }).toEqual({ forbidden, named: false })
        }
        // No A-prime surface, ledger, trace, or replay orchestration work.
        expect(owner).not.toMatch(/createAttentionLedger|appendAttentionLedgerRecord|buildAttentionTrace/)
        expect(owner).not.toMatch(/runAttentionMixedFamilyEvaluation|rankingCacheKey|revalidationCacheKey/)

        // Its allowlist entry is byte-for-byte the committed 9aa77e8e set: B6
        // grants this module no specifier at all.
        expect(ALLOWED_IMPORT_SPECIFIERS['attentionNarrativePatternScenario.ts']).toEqual([
          './attentionPatternEvidenceContracts',
          './attentionPatternEvidenceAccessor',
          './attentionNarrativePatternMonitor',
        ])
        expect([...new Set(proofModuleSpecifiers('attentionNarrativePatternScenario.ts'))].sort()).toEqual([
          './attentionNarrativePatternMonitor',
          './attentionPatternEvidenceAccessor',
          './attentionPatternEvidenceContracts',
        ])
      })

      it('no proof module outside attentionReplay.ts reproduces the derivation chain', () => {
        // `attentionReplay.ts` is the one legal home: the evaluator runs these
        // committed steps itself, and the pure derivation runs them once more
        // over pattern-only input by design (plan §11.3).
        const duplicatingModules = STAGE_A_PROOF_MODULES.filter((fileName) => (
          fileName !== 'attentionReplay.ts'
          && CHAIN_STEPS.every((step) => readStrippedSource(fileName).includes(`${step}(`))
        ))
        expect(duplicatingModules).toEqual([])
      })
    })

    /**
     * B6 / plan §11.3 and §11.6 item 15 — the one **pure** pattern-prime
     * derivation function: where it lives, that there is exactly one of it, that
     * it runs the committed §11.2A steps 3-7 in order, and that it is not a
     * second orchestration seam.
     *
     * The "no candidate-evaluation loop" obligation is asserted here through the
     * *evaluation-specific* markers, deliberately **not** through the two attempt
     * helpers' blanket "no `for`/`while`/`forEach`" rule: §11.3 authorizes one
     * bounded pure map/indexing pass for the `candidateId` ->
     * `directEvidenceAssertionInputs` association, and that pass is legal and
     * expected. Reusing the helpers' rule verbatim here would reject it.
     */
    describe('B6 / P1 — exactly one pure pattern-prime derivation function, in attentionReplay.ts', () => {
      const DERIVATION = DERIVATION_NAME

      it('exactly one such function exists, and it is declared in attentionReplay.ts', () => {
        // Every proof-directory file, tests included, except this scanner: it is
        // the module doing the reading and necessarily names the symbol it looks
        // for, so including it would make the scan report itself.
        const proofFiles = readdirSync(fileURLToPath(new URL('./', import.meta.url)))
          .filter((name) => /\.tsx?$/.test(name) && name !== 'attentionLedgerStaticClosure.test.ts')
        const declaringFiles = proofFiles.filter((name) => (
          new RegExp(`function ${DERIVATION}\\b`).test(readStrippedSource(name))
        ))
        expect(declaringFiles).toEqual(['attentionReplay.ts'])

        // Exactly one declaration inside that module, exported once.
        expect(replaySource.match(new RegExp(`function ${DERIVATION}\\b`, 'g')) ?? []).toHaveLength(1)
        expect(replaySource).toMatch(new RegExp(`export function ${DERIVATION}\\(`))

        // No second pattern-prime derivation under another name. The pattern
        // half of the chain has exactly two call sites in this module: this
        // derivation, and the committed `reconstructRetainedPatterns` helper the
        // mixed evaluator runs at both of its coordinates.
        for (const step of ['reconstructNarrativePatternInstances', 'applyNarrativePatternStructuralRetention']) {
          expect({ step, callSites: (replaySource.match(new RegExp(`${step}\\s*\\(`, 'g')) ?? []).length })
            .toEqual({ step, callSites: 2 })
        }
        const derivationBody = functionBody(DERIVATION)
        const outsideDerivation = replaySource.replace(derivationBody, '')
        for (const step of ['reconstructNarrativePatternInstances', 'applyNarrativePatternStructuralRetention']) {
          expect({ step, callSites: (outsideDerivation.match(new RegExp(`${step}\\s*\\(`, 'g')) ?? []).length })
            .toEqual({ step, callSites: 1 })
        }
        expect(outsideDerivation).toMatch(/function reconstructRetainedPatterns/)
      })

      it('it runs the committed §11.2A steps 3-7 in exactly that order, A-prime construction first', () => {
        const body = functionBody(DERIVATION)
        const at = (step: string) => {
          const index = body.indexOf(`${step}(`)
          expect({ step, found: index >= 0 }).toEqual({ step, found: true })
          return index
        }
        // 1 boundary -> 2 reconstruction -> 3 retention -> 4 normalization.
        expect(at('constructAttentionReadableSurface')).toBeLessThan(at('reconstructNarrativePatternInstances'))
        expect(at('reconstructNarrativePatternInstances')).toBeLessThan(at('applyNarrativePatternStructuralRetention'))
        expect(at('applyNarrativePatternStructuralRetention')).toBeLessThan(at('normalizeAttentionCandidates'))
        // Each committed step is invoked exactly once, and none is reimplemented.
        for (const step of CHAIN_STEPS) {
          expect({ step, calls: (body.match(new RegExp(`${step}\\s*\\(`, 'g')) ?? []).length })
            .toEqual({ step, calls: 1 })
        }
        for (const step of CHAIN_STEPS) {
          expect({ step, redefined: new RegExp(`function ${step}\\b`).test(body) }).toEqual({ step, redefined: false })
        }
      })

      it('reconstruction consumes surface.patternEvidenceViews, never the raw input view list', () => {
        const body = functionBody(DERIVATION)
        // The reconstruction argument is the boundary's re-emitted accepted list.
        expect(body).toMatch(/patternEvidenceViews:\s*surface\.surface\.patternEvidenceViews/)
        // The raw list is passed to the A-prime boundary and nowhere else, so a
        // refusal the boundary owns can never be reached at a later step.
        expect(body.match(/input\.patternEvidenceViews/g) ?? []).toHaveLength(1)
        expect(body).not.toMatch(/patternEvidenceViews:\s*input\.patternEvidenceViews/)
      })

      it('the one bounded association pass is present and is not a candidate-evaluation or arbitration loop', () => {
        const body = functionBody(DERIVATION)

        // Present: the permitted map/indexing pass that pairs each normalized
        // pattern candidateId with its existing directEvidenceAssertionInputs.
        expect(body).toMatch(/new Map\(/)
        expect(body).toMatch(/directEvidenceAssertionInputs/)

        // Not an evaluation: none of the markers that make a body an evaluation
        // or arbitration loop appears. This is what "no candidate-evaluation
        // loop" means at this boundary (§11.6 item 15).
        expect(body).not.toMatch(/attemptAttentionPatternPresentation\s*\(/)
        expect(body).not.toMatch(/attemptAttentionQuestPresentation\s*\(/)
        expect(body).not.toMatch(/revalidateAttentionPatternPresentation\s*\(/)
        expect(body).not.toMatch(/evaluateAttentionPatternPresentationPolicy\s*\(/)
        expect(body).not.toMatch(/successfulPresentations|presentationSlotConsumed|slotConsumed/)
        expect(body).not.toMatch(/presentationsPerEvaluation/)
        expect(body).not.toMatch(/\bcontinued\b|arbitrationAttempts|rankPosition/)
      })

      it('it creates no ledger, ordering, cap, presentation, trace, or cache identity, and calls no provider', () => {
        const body = functionBody(DERIVATION)

        // No ledger container and no append.
        expect(body).not.toMatch(/createAttentionLedger\s*\(/)
        expect(body).not.toMatch(/appendAttentionLedgerRecord\s*\(/)
        // No mixed ordering and no cap.
        expect(body).not.toMatch(/orderAttentionCandidates\s*\(/)
        expect(body).not.toMatch(/applyMixedFamilyCandidateCap\s*\(/)
        expect(body).not.toMatch(/mixedFamilyCandidatesAfterOrdering/)
        // No presentation and no trace assembly.
        expect(body).not.toMatch(/buildAttentionRevealPackage\s*\(/)
        expect(body).not.toMatch(/renderAttentionRevealPackage\s*\(/)
        expect(body).not.toMatch(/buildAttentionTrace\s*\(/)
        // No cache-key derivation and no cache-key value construction (§11.7).
        expect(body).not.toMatch(/deriveAttentionCandidateRankingCacheKey/)
        expect(body).not.toMatch(/rankingCacheKey/)
        expect(body).not.toMatch(/revalidationCacheKey/)
        // Pure: no clock, RNG, I/O, provider/model call, or mutable module state.
        expect(body).not.toMatch(/Date\.|Date\s*\(|performance\.now|Math\.random/)
        expect(body).not.toMatch(/\bfetch\s*\(|readFileSync|writeFileSync|process\./)
        expect(body).not.toMatch(/provider|generateText|complete\s*\(|model/i)
        // It writes no authority or NPC-cognition state.
        expect(body).not.toMatch(/authoritative|npcCognition|worldState|commitEvent/i)
      })

      it('it is not a second orchestration seam: the sole-seam contract is unweakened', () => {
        // The derivation is not the mixed evaluator, and the mixed evaluator does
        // not delegate any part of an evaluation to it -- it still runs steps 3-7
        // itself over its own mixed inputs.
        expect(replaySource.match(/function runAttentionMixedFamilyEvaluation\b/g) ?? []).toHaveLength(1)
        const seam = functionBody('runAttentionMixedFamilyEvaluation')
        expect(seam).not.toMatch(new RegExp(`${DERIVATION}\\s*\\(`))

        // The seam runs the committed chain itself. Two steps appear directly in
        // its body; the other two are run by the committed, module-private
        // `reconstructRetainedPatterns` helper. Each is asserted against its own
        // owner -- deliberately NOT with a blanket "or the helper is mentioned"
        // alternative, which would be satisfied for every step at once and so
        // would assert nothing about any individual step.
        for (const step of ['constructAttentionReadableSurface', 'normalizeAttentionCandidates'] as const) {
          expect({ step, ranDirectlyBySeam: new RegExp(`${step}\\s*\\(`).test(seam) })
            .toEqual({ step, ranDirectlyBySeam: true })
        }
        expect(seam).toMatch(/reconstructRetainedPatterns\s*\(/)
        const helperBody = privateFunctionBody('reconstructRetainedPatterns')
        for (const step of ['reconstructNarrativePatternInstances', 'applyNarrativePatternStructuralRetention'] as const) {
          expect({ step, ranByHelper: new RegExp(`${step}\\s*\\(`).test(helperBody) })
            .toEqual({ step, ranByHelper: true })
        }
        // Retention follows reconstruction inside that helper, never precedes it.
        expect(helperBody.indexOf('reconstructNarrativePatternInstances('))
          .toBeLessThan(helperBody.indexOf('applyNarrativePatternStructuralRetention('))
        // And the derivation drives no seam of its own.
        const body = functionBody(DERIVATION)
        expect(body).not.toMatch(/runAttentionMixedFamilyEvaluation\s*\(/)
        expect(body).not.toMatch(/runAttentionPatternPresentationPass\s*\(/)
        expect(body).not.toMatch(/runAttentionQuestCandidateReplayPass\s*\(/)
      })

      it('the closed import allowlist grew by exactly the four authorized B6 additions', () => {
        // The committed 9aa77e8e entries for the three modules B6 touches.
        const COMMITTED_AT_BASELINE: Record<string, readonly string[]> = {
          'attentionReplay.ts': [
            './attentionQuestCandidateContracts', './attentionQuestCandidateAccessor',
            './attentionReadableBoundary', './attentionCandidate', './attentionCandidateOrdering',
            './attentionCandidatePolicy', './attentionRevealPackage', './attentionTemplate',
            './attentionLedger', './attentionTrace', './attentionReplayResources',
            './attentionNarrativePatternResourcePolicy', './canonicalSerialization',
            './attentionDirectEvidenceAssertion', './attentionNarrativePatternContracts',
          ],
          'attentionReplayScenario.ts': [
            './attentionQuestCandidateContracts', './attentionCandidatePolicy',
            './attentionReplay', './attentionReplayResources', './attentionQuestCandidateScenario',
          ],
          'attentionNarrativePatternScenario.ts': [
            './attentionPatternEvidenceContracts', './attentionPatternEvidenceAccessor',
            './attentionNarrativePatternMonitor',
          ],
        }
        const additions = Object.entries(COMMITTED_AT_BASELINE).flatMap(([fileName, committed]) => (
          (ALLOWED_IMPORT_SPECIFIERS[fileName] ?? [])
            .filter((specifier) => !committed.includes(specifier))
            .map((specifier) => `${fileName} -> ${specifier}`)
        ))
        expect(additions.sort()).toEqual([
          'attentionReplay.ts -> ./attentionAggregateLegitimacy',
          'attentionReplay.ts -> ./attentionClosedRelationCertificateAccessor',
          'attentionReplay.ts -> ./attentionClosedRelationCertificateContracts',
          'attentionReplay.ts -> ./attentionInferenceRuleLibrary',
          'attentionReplay.ts -> ./attentionNarrativePatternMonitor',
          'attentionReplay.ts -> ./attentionPatternEvidenceContracts',
          'attentionReplay.ts -> ./attentionScorePolicy',
          'attentionReplayScenario.ts -> ./attentionNarrativePatternScenario',
          'attentionReplayScenario.ts -> ./attentionPatternEvidenceContracts',
        ])
        // No entry lost a committed specifier either.
        for (const [fileName, committed] of Object.entries(COMMITTED_AT_BASELINE)) {
          expect({ fileName, missing: committed.filter((s) => !(ALLOWED_IMPORT_SPECIFIERS[fileName] ?? []).includes(s)) })
            .toEqual({ fileName, missing: [] })
        }
        // No barrel, dynamic import, require, eval, or indirect module lookup
        // was introduced in the derivation's own module.
        expect(replaySource).not.toMatch(/\bimport\s*\(/)
        expect(replaySource).not.toMatch(/\brequire\s*\(/)
        expect(replaySource).not.toMatch(/\beval\s*\(/)
        expect(replaySource).not.toMatch(/createRequire|module\.constructor/)
      })
    })

    it('applyMixedFamilyCandidateCap remains the only cap enforcement route, and the separate ranking dependency read remains', () => {
      // The evaluator invokes the committed cap function and neither reads the
      // numeric policy field directly nor reimplements the slice.
      const seam = functionBody('runAttentionMixedFamilyEvaluation')
      expect(seam).toMatch(/applyMixedFamilyCandidateCap\s*\(/)
      expect(seam).not.toMatch(/mixedFamilyCandidatesAfterOrdering/)
      expect(seam).not.toMatch(/\.slice\s*\(\s*0\s*,/)
      // Only the committed cap function enforces the cap.
      const capOwner = readStrippedSource('attentionNarrativePatternResourcePolicy.ts')
      expect(capOwner).toMatch(/function applyMixedFamilyCandidateCap/)
      expect(replaySource).not.toMatch(/function applyMixedFamilyCandidateCap/)

      // RN019 §9.3's declared ranking dependency read is a *second legitimate*
      // read of the same value. This suite deliberately does NOT assert one
      // repository-wide reader: that claim is false at the committed baseline
      // and would force deleting a required dependency (plan §11.5, §11.6 item 15).
      const rankingState = readStrippedSource('attentionCandidateCacheKey.ts')
      expect(rankingState).toMatch(/attentionCandidateRankingEligibilityResourceState/)
      expect(rankingState).toMatch(/mixedFamilyCandidatesAfterOrdering/)
    })
  })
})

describe('A2 / D2 — only the A1 accessor may mint an attention-readable view', () => {
  it('is named by the defining contracts module and the A1 accessor, and by nothing else', () => {
    const files = listSourceFiles(SRC_ROOT, '')
      .concat(readdirSync(`${SRC_ROOT}${PROOF_DIRECTORY}/`).map((name) => `${PROOF_DIRECTORY}/${name}`))
      .filter((file) => /\.tsx?$/.test(file))
      // This evidence file necessarily names the mint as the subject of the assertion.
      .filter((file) => !file.endsWith('attentionLedgerStaticClosure.test.ts'))

    const namingFiles = files.filter((file) => namesViewMint(readFileSync(`${SRC_ROOT}${file}`, 'utf8')))

    expect([...namingFiles].sort()).toEqual([...MINT_AUTHORIZED_FILES].sort())
  })

  it('is not credited to a file that only mentions it in a comment or a string', () => {
    expect(namesViewMint('// mintAttentionReadableQuestCandidateView is deliberately not called here')).toBe(false)
    expect(namesViewMint("const note = 'mintAttentionReadableQuestCandidateView'")).toBe(false)
    expect(namesViewMint('const view = mintAttentionReadableQuestCandidateView(fields)')).toBe(true)
  })

  it('is not named by the A-prime boundary, which receives minted views rather than making them', () => {
    expect(identifierNames(readProofSource('attentionReadableBoundary.ts')).has(VIEW_MINT_IDENTIFIER)).toBe(false)
  })

  it('is not exported through the marker itself, which stays module-private to the contracts seam', () => {
    const contracts = readStrippedSource('attentionQuestCandidateContracts.ts')

    // The nominal marker is declared `const` and never exported: no other
    // module can name the key, so none can satisfy the branded type.
    expect(contracts).toMatch(/^const ACCESSOR_MINT_MARKER: unique symbol = Symbol\(/m)
    expect(contracts).not.toMatch(/export\s+(const|declare const)\s+ACCESSOR_MINT_MARKER\b/)
    expect(proofModuleSpecifiers('attentionQuestCandidateContracts.ts')).toEqual([])
  })
})

describe('B1 / D2 — only the pattern-evidence accessor may mint a pattern view', () => {
  it('names the private mint only in the sole pattern accessor', () => {
    const files = listSourceFiles(SRC_ROOT, '')
      .concat(readdirSync(`${SRC_ROOT}${PROOF_DIRECTORY}/`).map((name) => `${PROOF_DIRECTORY}/${name}`))
      .filter((file) => /\.tsx?$/.test(file))
      .filter((file) => !file.endsWith('attentionLedgerStaticClosure.test.ts'))
    const namingFiles = files.filter((file) => (
      namesPatternViewMint(readFileSync(`${SRC_ROOT}${file}`, 'utf8'))
    ))

    expect([...namingFiles].sort()).toEqual([...PATTERN_MINT_CALLER_FILES].sort())
    expect(readProofSource('attentionPatternEvidenceContracts.ts'))
      .not.toMatch(/\bmintAttentionReadablePatternEvidenceView\b/)
  })

  it('pins the exact contracts and accessor public export surfaces', () => {
    const contracts = readProofSource('attentionPatternEvidenceContracts.ts')
    const accessor = readProofSource('attentionPatternEvidenceAccessor.ts')

    expect(publicExportNames('attentionPatternEvidenceContracts.ts', contracts))
      .toEqual([...PATTERN_CONTRACTS_ALLOWED_EXPORTS].sort())
    expect(publicExportNames('attentionPatternEvidenceAccessor.ts', accessor))
      .toEqual([...PATTERN_ACCESSOR_ALLOWED_EXPORTS].sort())
    expect(exportedMintAuthorityRisks('attentionPatternEvidenceContracts.ts', contracts)).toEqual([])
  })

  it('keeps the pattern marker and authority registry module-private and requires both origin predicates', () => {
    const accessor = readStrippedSource('attentionPatternEvidenceAccessor.ts')
    const boundaryNames = identifierNames(readProofSource('attentionReadableBoundary.ts'))

    expect(accessor).toMatch(/^const ACCESSOR_MINT_MARKER: unique symbol =/m)
    expect(accessor).toMatch(/^const ACCESSOR_MINTED_PATTERN_EVIDENCE_VIEWS = new WeakSet<object>\(\)/m)
    expect(accessor).not.toMatch(/export\s+(const|declare const)\s+ACCESSOR_MINT_MARKER\b/)
    expect(accessor).not.toMatch(/export\s+(const|declare const)\s+ACCESSOR_MINTED_PATTERN_EVIDENCE_VIEWS\b/)
    expect(boundaryNames.has(PATTERN_VIEW_MINT_IDENTIFIER)).toBe(false)
    expect(boundaryNames.has('isAccessorMintedAttentionReadableQuestCandidateView')).toBe(true)
    expect(boundaryNames.has('isAttentionReadablePatternEvidenceViewFromAccessor')).toBe(true)
  })

  it('keeps evidence admission upstream of ledger, trace, and presentation modules', () => {
    const forbidden = [
      './attentionLedger',
      './attentionTrace',
      './attentionRevealPackage',
      './attentionTemplate',
    ]
    for (const fileName of [
      'attentionPatternEvidenceContracts.ts',
      'attentionPatternEvidenceAccessor.ts',
      'attentionPatternEvidenceScenario.ts',
      'attentionReadableBoundary.ts',
    ]) {
      expect(proofModuleSpecifiers(fileName).filter((specifier) => forbidden.includes(specifier)))
        .toEqual([])
    }
  })
})

describe('B1 boundary rename closure', () => {
  const OLD_BOUNDARY_FILE = 'attentionQuestCandidateBoundary.ts'
  const OLD_BOUNDARY_SPECIFIER = 'attentionQuestCandidateBoundary'

  it('the old boundary file is absent and no parsed import/export/require form reaches it', () => {
    const proofFiles = readdirSync(fileURLToPath(new URL('./', import.meta.url)))
      .filter((name) => /\.tsx?$/.test(name))
    expect(proofFiles).not.toContain(OLD_BOUNDARY_FILE)

    const allFiles = listSourceFiles(SRC_ROOT, '')
      .concat(proofFiles.map((name) => `${PROOF_DIRECTORY}/${name}`))
    const offenders = allFiles.filter((file) => {
      const source = readFileSync(`${SRC_ROOT}${file}`, 'utf8')
      return source.includes(OLD_BOUNDARY_SPECIFIER)
        && moduleSpecifiers(file, source)
          .some((specifier) => specifier.includes(OLD_BOUNDARY_SPECIFIER))
    })
    expect(offenders).toEqual([])
  })
})

describe('B5 — branch-specific ledger contracts remain closed', () => {
  it('has no global v2 quest-ledger identity and exposes one disjoint pattern-record identity', () => {
    const policy = readStrippedSource('attentionCandidatePolicy.ts')
    const ledger = readStrippedSource('attentionLedger.ts')

    expect(policy).not.toMatch(/(?:export\s+)?const\s+ATTENTION_LEDGER_POLICY_VERSION\s*=\s*['"]attention-ledger-policy-v2['"]/)
    expect(policy).toMatch(/export\s+const\s+ATTENTION_LEDGER_POLICY_VERSION\s*=\s*['"]attention-ledger-policy-v1['"]/)
    expect(policy).toMatch(/export\s+const\s+ATTENTION_PATTERN_PRESENTATION_LEDGER_POLICY_VERSION\s*=\s*['"]attention-pattern-presentation-ledger-policy-v1['"]/)
    expect(ledger).toMatch(/sourceKind\s*===\s*['"]quest_candidate['"]|sourceKind:\s*['"]quest_candidate['"]/)
    expect(ledger).toMatch(/sourceKind\s*===\s*['"]narrative_pattern_instance['"]|sourceKind:\s*['"]narrative_pattern_instance['"]/)
    expect(ledger).toMatch(/patternPresentationLedgerPolicyVersion/)
  })
})

describe('A2 / P1 — dependency direction: nothing outside the proof rig imports a Stage A attention module', () => {
  it('walks the whole of apps/web/src, evidenced by named roots and witness files', () => {
    const files = listSourceFiles(SRC_ROOT, '')
    const discoveredRoots = new Set(files.map((file) => file.split('/')[0]))

    const summary = {
      missingWitnesses: REQUIRED_SCAN_WITNESSES.filter((witness) => !files.includes(witness)),
      missingRoots: REQUIRED_SCAN_ROOTS.filter((root) => !discoveredRoots.has(root)),
      belowFloor: files.length < MINIMUM_SCANNED_FILES,
      discoveredFileCount: files.length,
      discoveredRootCount: discoveredRoots.size,
    }

    // A partial walk fails by name here, not merely by a count it could still
    // satisfy; the actual figures are reported so a regression is legible.
    expect(summary).toEqual({
      missingWitnesses: [],
      missingRoots: [],
      belowFloor: false,
      discoveredFileCount: files.length,
      discoveredRootCount: discoveredRoots.size,
    })
    expect(files.length).toBeGreaterThanOrEqual(MINIMUM_SCANNED_FILES)
    expect(files.every((file) => !file.startsWith(PROOF_DIRECTORY))).toBe(true)
  })

  it('no production reducer, application layer, or runtime entry point imports any attention proof module', () => {
    const files = listSourceFiles(SRC_ROOT, '')

    const offenders = files.filter((file) => (
      importsAttentionProofModule(file, readFileSync(`${SRC_ROOT}${file}`, 'utf8'))
    ))

    expect(offenders).toEqual([])
  })
})
