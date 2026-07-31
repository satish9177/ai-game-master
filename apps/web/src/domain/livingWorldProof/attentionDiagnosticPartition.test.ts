import { readFileSync } from 'node:fs'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import {
  ATTENTION_GENERIC_OBSERVABLE_OUTCOMES,
  ATTENTION_INTERNAL_REFUSAL_LITERALS,
  ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS,
  ATTENTION_RUNTIME_DIAGNOSTIC_OUTCOME,
  ATTENTION_RUNTIME_REFUSAL_OWNER,
  ATTENTION_RUNTIME_REFUSALS_BY_GROUP,
  ATTENTION_RUNTIME_REFUSALS_BY_OBSERVABLE_OUTCOME,
  ATTENTION_TYPE_A_DIAGNOSTIC_CODES,
  ATTENTION_TYPE_B_DIAGNOSTIC_CODES,
  classifyAttentionDiagnostic,
  classifyAttentionRuntimeRefusal,
} from './attentionDiagnosticPartition'

const here = fileURLToPath(new URL('.', import.meta.url))

/** C2's constructor and C3-C6's composition root are the bounded Stage C
 * runtime roots. Their relative runtime-import closure includes package,
 * template, ledger, replay, absence, legality, validator, proposal, and
 * delivery code without walking arbitrary application modules. */
const STAGE_C_RUNTIME_ROOTS = Object.freeze([
  'attentionAbsenceWitnessProvenance.ts',
  'attentionReplay.ts',
] as const)

const REFUSAL_PROPERTY_NAMES = new Set(['refusal', 'refusalReason', 'refusalDetail'])
const TYPED_REFUSAL_UNIONS = new Set([
  'AttentionPatternPresentationRevalidationReason',
  'AttentionRevealScopeRevalidation',
  'AttentionTraceRevalidationOutcome',
])

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined
}

function literalStrings(type: ts.TypeNode): string[] {
  if (ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)) return [type.literal.text]
  if (ts.isUnionTypeNode(type)) return type.types.flatMap(literalStrings)
  return []
}

function resolveRelativeRuntimeClosure(): readonly string[] {
  const resolved = new Set<string>()
  const visit = (fileName: string): void => {
    const absolute = resolve(here, fileName)
    if (resolved.has(absolute)) return
    resolved.add(absolute)
    const source = ts.createSourceFile(absolute, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true)
    const inspect = (node: ts.Node): void => {
      const typeOnly = ts.isImportDeclaration(node)
        ? node.importClause?.isTypeOnly === true
        : ts.isExportDeclaration(node) && node.isTypeOnly
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
        && node.moduleSpecifier !== undefined
        && ts.isStringLiteral(node.moduleSpecifier)
        && node.moduleSpecifier.text.startsWith('.')
        && !typeOnly) {
        const base = resolve(dirname(absolute), node.moduleSpecifier.text)
        for (const candidate of [`${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) {
          try {
            readFileSync(candidate, 'utf8')
            visit(relative(here, candidate))
            break
          } catch {
            // A relative specifier may resolve to a declaration-only or absent
            // candidate. It is not a Stage C runtime module in this scan.
          }
        }
      }
      ts.forEachChild(node, inspect)
    }
    inspect(source)
  }
  STAGE_C_RUNTIME_ROOTS.forEach(visit)
  return Object.freeze([...resolved].sort())
}

function collectStageCRuntimeRefusalLiterals(files: readonly string[]): ReadonlySet<string> {
  const literals = new Set<string>()
  for (const absolute of files) {
    const source = ts.createSourceFile(absolute, readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true)
    const visit = (node: ts.Node): void => {
      if (ts.isObjectLiteralExpression(node)) {
        const properties = new Map(node.properties.flatMap((property) => {
          if (!ts.isPropertyAssignment(property)) return []
          const name = propertyName(property.name)
          return name === undefined ? [] : [[name, property.initializer] as const]
        }))
        const kind = properties.get('kind')
        const reason = properties.get('reason')
        if (kind !== undefined && ts.isStringLiteral(kind) && kind.text === 'refused'
          && reason !== undefined && ts.isStringLiteral(reason)) {
          literals.add(reason.text)
        }
        for (const property of REFUSAL_PROPERTY_NAMES) {
          const value = properties.get(property)
          if (value !== undefined && ts.isStringLiteral(value)) literals.add(value.text)
          if (property === 'refusal' && value !== undefined && ts.isObjectLiteralExpression(value)) {
            for (const nested of value.properties) {
              if (!ts.isPropertyAssignment(nested) || propertyName(nested.name) !== 'reason') continue
              if (ts.isStringLiteral(nested.initializer)) literals.add(nested.initializer.text)
            }
          }
        }
      }
      if (ts.isTypeAliasDeclaration(node)) {
        if (node.name.text.endsWith('Refusal')) {
          literalStrings(node.type).forEach((literal) => literals.add(literal))
        }
        if (TYPED_REFUSAL_UNIONS.has(node.name.text)) {
          literalStrings(node.type)
            .filter((literal) => literal !== 'still-legal')
            .forEach((literal) => literals.add(literal))
        }
      }
      if (ts.isTypeLiteralNode(node)) {
        for (const member of node.members) {
          if (!ts.isPropertySignature(member) || member.type === undefined) continue
          const name = propertyName(member.name)
          if (name === 'reason' || REFUSAL_PROPERTY_NAMES.has(name ?? '')) {
            literalStrings(member.type)
              .filter((literal) => literal !== 'still-legal')
              .forEach((literal) => literals.add(literal))
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  return literals
}

function normalizedCode(code: string): string {
  return code.replace(/[-_]/g, '')
}

describe('C7 diagnostic partition', () => {
  it('maps every closed internal literal exactly once and reaches every D11 type-A code', () => {
    const classifications = ATTENTION_INTERNAL_REFUSAL_LITERALS.map((code) => classifyAttentionDiagnostic(code))
    expect(classifications).toHaveLength(new Set(ATTENTION_INTERNAL_REFUSAL_LITERALS).size)
    expect(classifications.filter((entry) => entry.resultType === 'PlayerObservableAttentionResult').map((entry) => entry.code).sort())
      .toEqual([...ATTENTION_TYPE_A_DIAGNOSTIC_CODES].sort())
    expect(classifications.filter((entry) => entry.resultType === 'EngineOnlyAttentionDiagnostic').map((entry) => entry.code).sort())
      .toEqual([...ATTENTION_TYPE_B_DIAGNOSTIC_CODES].sort())
  })

  it('keeps all nine provenance causes behind the same observable fallback', () => {
    const provenance = ATTENTION_TYPE_B_DIAGNOSTIC_CODES.filter((code) => code.includes('provenance') || code.startsWith('absence_'))
    expect(provenance).toHaveLength(9)
    expect(provenance.map((code) => classifyAttentionDiagnostic(code).fallback)).toEqual(Array(9).fill('provenance_missing'))
  })

  it('owns every runtime refusal exactly once and generates complete reverse owner and outcome evidence', () => {
    const runtimeLiterals = Object.keys(ATTENTION_RUNTIME_REFUSAL_OWNER)
    const byGroup = Object.values(ATTENTION_RUNTIME_REFUSALS_BY_GROUP).flat()
    const byOutcome = Object.values(ATTENTION_RUNTIME_REFUSALS_BY_OBSERVABLE_OUTCOME).flat()
    expect([...byGroup].sort()).toEqual([...runtimeLiterals].sort())
    expect(new Set(byGroup).size).toBe(byGroup.length)
    expect([...byOutcome].sort()).toEqual([...runtimeLiterals].sort())
    expect(new Set(byOutcome).size).toBe(byOutcome.length)
    expect(Object.keys(ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS).sort())
      .toEqual(Object.keys(ATTENTION_RUNTIME_REFUSALS_BY_GROUP).sort())

    for (const runtime of runtimeLiterals) {
      const typedRuntime = runtime as keyof typeof ATTENTION_RUNTIME_REFUSAL_OWNER
      const classification = classifyAttentionRuntimeRefusal(typedRuntime)
      const owner = ATTENTION_RUNTIME_REFUSAL_OWNER[typedRuntime]
      if (owner === undefined) throw new Error(`unowned C7 runtime literal: ${runtime}`)
      expect(classification.owner).toBe(owner)
      expect(ATTENTION_RUNTIME_REFUSALS_BY_GROUP[owner]).toContain(runtime)
      expect(classification.code).toBe(ATTENTION_RUNTIME_DIAGNOSTIC_GROUPS[owner])
      expect(classification.observableOutcome).toBe(ATTENTION_RUNTIME_DIAGNOSTIC_OUTCOME[owner])
      expect(ATTENTION_RUNTIME_REFUSALS_BY_OBSERVABLE_OUTCOME[classification.observableOutcome]).toContain(runtime)

      // C7 cannot merely restyle a runtime subtype. The internal owner and the
      // emitted observable outcome must both be genuine generic classifications.
      expect(normalizedCode(classification.owner)).not.toBe(normalizedCode(runtime))
      expect(normalizedCode(classification.observableOutcome)).not.toBe(normalizedCode(runtime))
      if (ATTENTION_RUNTIME_REFUSALS_BY_GROUP[owner].length === 1) {
        expect(ATTENTION_GENERIC_OBSERVABLE_OUTCOMES).toContain(classification.observableOutcome)
      }
    }
  })

  it('fails until every runtime Stage C refusal shape in the bounded composed closure is classified', () => {
    const files = resolveRelativeRuntimeClosure()
    const fileNames = files.map((file) => basename(file))
    expect(fileNames).toEqual(expect.arrayContaining([
      'attentionAbsenceWitnessProvenance.ts',
      'attentionClosedRelationCertificateAccessor.ts',
      'attentionRevealerLegality.ts',
      'attentionDiegeticAggregateLegitimacy.ts',
      'attentionEligibilityVerdict.ts',
      'attentionDiegeticRevealProposal.ts',
      'communicationValidator.ts',
      'attentionDiegeticDelivery.ts',
      'attentionReplay.ts',
      'attentionRevealPackage.ts',
      'attentionTemplate.ts',
      'attentionLedger.ts',
    ]))
    const runtimeRefusals = collectStageCRuntimeRefusalLiterals(files)
    expect([...runtimeRefusals].sort()).toEqual(Object.keys(ATTENTION_RUNTIME_REFUSAL_OWNER).sort())
    expect([...runtimeRefusals].sort()).toEqual(expect.arrayContaining([
      // Direct `kind: 'refused'` result objects.
      'absence_relation_not_closed',
      'missing-direct-evidence-assertions',
      'direct-evidence-source-mismatch',
      'too-many-direct-evidence-assertions',
      'unrenderable-result-tag',
      'template-version-mismatch',
      'unsupported-outcome',
      // Nested `refusal`, trace `refusalReason`, and trace `refusalDetail`.
      'missing-pattern-presentation-input',
      'no_legal_channel',
      'unsupported-source-family',
      // A typed validator result and dynamic typed refusal union.
      'invalid-communication-command',
      'provenance_cycle',
      'reveal_scope_expansion_attempt',
    ]))
  })
})
