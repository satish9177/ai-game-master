import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { constructAttentionReadableSurface } from './attentionQuestCandidateBoundary'

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
  'attentionQuestCandidateBoundary.ts',
  'attentionCandidatePolicy.ts',
  'attentionCandidateIdentity.ts',
  'attentionCandidate.ts',
  'attentionCandidateOrdering.ts',
  'attentionCandidateCacheKey.ts',
  'attentionRevealPackage.ts',
  'attentionTemplate.ts',
  'attentionLedger.ts',
  'attentionZeroModelProbe.ts',
  'attentionTrace.ts',
  'attentionReplayResources.ts',
  'attentionReplay.ts',
  'attentionReplayScenario.ts',
] as const

/**
 * The closed import allowlist: Stage A proof modules and nothing else.
 *
 * The A3 derived-candidate modules cannot name `attentionQuestCandidateContracts`
 * or `attentionQuestCandidateAccessor` at all — the raw `QuestCandidate`, the
 * proof snapshot, the `open | resolved` lifecycle, and the accessor-origin mint
 * all live behind those two specifiers, so their absence here is what proves A3
 * reads A-prime through `attentionQuestCandidateBoundary` and by no other path.
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
  'attentionQuestCandidateBoundary.ts': ['./attentionQuestCandidateContracts'],
  'attentionCandidatePolicy.ts': [],
  'attentionCandidateIdentity.ts': ['./canonicalSerialization', './attentionCandidatePolicy'],
  'attentionCandidate.ts': [
    './attentionCandidatePolicy',
    './attentionCandidateIdentity',
    './attentionQuestCandidateBoundary',
  ],
  'attentionCandidateOrdering.ts': ['./attentionCandidatePolicy', './attentionCandidate'],
  'attentionCandidateCacheKey.ts': ['./canonicalSerialization', './attentionCandidatePolicy'],
  'attentionRevealPackage.ts': ['./attentionCandidatePolicy', './attentionCandidate'],
  'attentionTemplate.ts': [
    './canonicalSerialization',
    './attentionCandidatePolicy',
    './attentionRevealPackage',
  ],
  'attentionLedger.ts': [
    './canonicalSerialization',
    './attentionCandidatePolicy',
    './attentionCandidate',
    './attentionRevealPackage',
  ],
  'attentionZeroModelProbe.ts': [],
  'attentionTrace.ts': ['./canonicalSerialization', './attentionRevealPackage'],
  'attentionReplayResources.ts': ['./canonicalSerialization'],
  'attentionReplay.ts': [
    './attentionQuestCandidateContracts',
    './attentionQuestCandidateAccessor',
    './attentionQuestCandidateBoundary',
    './attentionCandidate',
    './attentionCandidateOrdering',
    './attentionCandidatePolicy',
    './attentionRevealPackage',
    './attentionTemplate',
    './attentionLedger',
    './attentionTrace',
    './attentionReplayResources',
    './canonicalSerialization',
  ],
  'attentionReplayScenario.ts': [
    './attentionQuestCandidateContracts',
    './attentionCandidatePolicy',
    './attentionReplay',
    './attentionReplayResources',
    './attentionQuestCandidateScenario',
  ],
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

/** Identifier tokens only: never a name that merely appears in prose or a string. */
function identifierNames(source: string): Set<string> {
  const names = new Set<string>()
  scanTokens(source, (token, text) => {
    if (token === ts.SyntaxKind.Identifier) names.add(text)
  })
  return names
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
  /attention(QuestCandidate|Candidate|Ledger|RevealPackage|Template|ZeroModelProbe|Trace|Replay)/

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

  it('collects identifier tokens without picking up names in comments or strings', () => {
    const source = [
      '// mintAttentionReadableQuestCandidateView named in a comment',
      "const label = 'mintAttentionReadableQuestCandidateView in a string'",
      'const used = realIdentifier',
    ].join('\n')
    const names = identifierNames(source)

    expect(names.has(VIEW_MINT_IDENTIFIER)).toBe(false)
    expect(names.has('realIdentifier')).toBe(true)
  })

  it('keeps real module code after stripping that module\'s doc comments', () => {
    const contracts = readStrippedSource('attentionQuestCandidateContracts.ts')
    const boundary = readStrippedSource('attentionQuestCandidateBoundary.ts')

    expect(contracts).toMatch(/export interface QuestCandidate\b/)
    expect(contracts).not.toMatch(/not a production quest API/)
    expect(boundary).toMatch(/export function constructAttentionReadableSurface\b/)
    expect(boundary).not.toMatch(/Attention Ledger Replay v0/)
  })
})

describe('A2 / P1 — negative controls: a forbidden import is caught in every syntax', () => {
  const BOUNDARY_SPECIFIER = /attention(QuestCandidate|Ledger)/

  const forbiddenProductionImports: [string, string][] = [
    ['single-quoted static', "import { constructAttentionReadableSurface } from '../livingWorldProof/attentionQuestCandidateBoundary'"],
    ['double-quoted static', 'import { constructAttentionReadableSurface } from "../livingWorldProof/attentionQuestCandidateBoundary"'],
    ['export-from', "export { constructAttentionReadableSurface } from '../livingWorldProof/attentionQuestCandidateBoundary'"],
    ['export-star double-quoted', 'export * from "../livingWorldProof/attentionQuestCandidateBoundary"'],
    ['dynamic import single-quoted', "const m = await import('../livingWorldProof/attentionQuestCandidateBoundary')"],
    ['dynamic import double-quoted', 'const m = await import("../livingWorldProof/attentionQuestCandidateBoundary")'],
    ['dynamic import template', 'const m = await import(`../livingWorldProof/attentionQuestCandidateBoundary`)'],
    ['require single-quoted', "const m = require('../livingWorldProof/attentionQuestCandidateBoundary')"],
    ['require double-quoted', 'const m = require("../livingWorldProof/attentionQuestCandidateBoundary")'],
    ['import-equals require', "import m = require('../livingWorldProof/attentionQuestCandidateBoundary')"],
  ]

  it.each(forbiddenProductionImports)('a production file reaching A-prime by %s is detected', (_label, source) => {
    // Exercises the exact predicate the whole-tree reverse scan uses, so the
    // controls cover its pre-filter too, not a parallel simplified path.
    expect(importsAttentionProofModule('domain/quests/offender.ts', source)).toBe(true)
    expect(moduleSpecifiers('domain/quests/offender.ts', source).some((s) => BOUNDARY_SPECIFIER.test(s))).toBe(true)
  })

  it('does not flag a production file that only mentions the proof modules in prose', () => {
    const innocent = [
      "// This module deliberately does not import attentionQuestCandidateBoundary.",
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
    const allowed = ALLOWED_IMPORT_SPECIFIERS['attentionQuestCandidateBoundary.ts'] ?? []
    const specifiers = moduleSpecifiers('attentionQuestCandidateBoundary.ts', stripComments(source))

    expect(specifiers).toContain('../stableHash')
    expect(specifiers.filter((specifier) => !allowed.includes(specifier))).not.toEqual([])
  })

  it('a Stage A module reaching an authoritative path is caught whatever the quote style', () => {
    for (const source of [
      "import { applyEvent } from '../world/applyEvent'",
      'import { applyEvent } from "../world/applyEvent"',
      'const m = await import("../world/applyEvent")',
    ]) {
      const specifiers = moduleSpecifiers('attentionQuestCandidateBoundary.ts', stripComments(source))
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

describe('A2 / S2 — the A-prime constructor names no raw A-domain surface', () => {
  it('imports only the Stage A contracts module', () => {
    const specifiers = proofModuleSpecifiers('attentionQuestCandidateBoundary.ts')

    expect(specifiers.length).toBeGreaterThan(0)
    expect([...new Set(specifiers)]).toEqual(['./attentionQuestCandidateContracts'])
  })

  it('never names a raw QuestCandidate, snapshot, accessor call, mint, private field, or lifecycle value', () => {
    const source = readStrippedSource('attentionQuestCandidateBoundary.ts')

    for (const [label, pattern] of FORBIDDEN_BOUNDARY_PATTERNS) {
      expect({ label, matched: pattern.test(source) }).toEqual({ label, matched: false })
    }
  })

  it('exposes exactly one two-parameter constructor: a pinned request and a legal-view list', () => {
    // Structural: there is no third parameter through which a raw candidate,
    // snapshot, ledger record, or diagnostic could be threaded in.
    expect(constructAttentionReadableSurface.length).toBe(2)
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
    expect(identifierNames(readProofSource('attentionQuestCandidateBoundary.ts')).has(VIEW_MINT_IDENTIFIER)).toBe(false)
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

  it('no production reducer, application layer, or runtime entry point imports attentionQuestCandidate*/attentionLedger*', () => {
    const files = listSourceFiles(SRC_ROOT, '')

    const offenders = files.filter((file) => (
      importsAttentionProofModule(file, readFileSync(`${SRC_ROOT}${file}`, 'utf8'))
    ))

    expect(offenders).toEqual([])
  })
})
