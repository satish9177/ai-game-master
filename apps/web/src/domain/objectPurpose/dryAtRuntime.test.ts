import { describe, expect, it } from 'vitest'
import ts from 'typescript'

function importModuleSpecifiers(source: string): string[] {
  const sourceFile = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  const specifiers: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined && ts.isStringLiteralLike(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text)
    }
    if (ts.isCallExpression(node) && node.arguments.length > 0) {
      const argument = node.arguments[0]
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require'
      if ((isDynamicImport || isRequire) && argument !== undefined && ts.isStringLiteralLike(argument)) specifiers.push(argument.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specifiers
}

function targetsObjectPurpose(specifier: string): boolean {
  return specifier.replaceAll('\\', '/').split('/').includes('objectPurpose')
}

describe('object purpose contract and validator are dry at runtime', () => {
  const sourceModules = import.meta.glob(['../../**/*.ts', '../../**/*.tsx'], { eager: true, query: '?raw', import: 'default' }) as Record<string, string>

  it('matches only module specifiers that target the Slice A directory', () => {
    const source = `
      import type { ObjectPurpose } from 'domain/objectPurpose'
      import purposeGraph from './objectPurpose'
      export { validateObjectPurpose } from '../objectPurpose/contracts'
      const validator = import('@/domain/objectPurpose/validatePurposeGraph')
      const graph = require('apps/web/src/domain/objectPurpose/purposeGraph')
      const generatedRoomObjectPurpose = 'ObjectPurposeResult'
      assignGeneratedObjectPurpose(generatedRoomObjectPurpose)
    `
    expect(importModuleSpecifiers(source).filter(targetsObjectPurpose)).toEqual([
      'domain/objectPurpose',
      './objectPurpose',
      '../objectPurpose/contracts',
      '@/domain/objectPurpose/validatePurposeGraph',
      'apps/web/src/domain/objectPurpose/purposeGraph',
    ])
    expect(['generatedRoomObjectPurpose', 'assignGeneratedObjectPurpose', 'ObjectPurposeResult'].some(targetsObjectPurpose)).toBe(false)
  })

  it('has no production runtime or composition importer', () => {
    const references = Object.entries(sourceModules).flatMap(([path, source]) => {
      const normalizedPath = path.replaceAll('\\', '/')
      const isTest = normalizedPath.endsWith('.test.ts') || normalizedPath.endsWith('.test.tsx')
      const isObjectPurposeFile = normalizedPath.startsWith('./') || normalizedPath.includes('/objectPurpose/')
      if (isTest || isObjectPurposeFile) return []
      return importModuleSpecifiers(source).filter(targetsObjectPurpose).map((specifier) => ({ path, specifier }))
    })
    expect(references).toEqual([])
  })
})
