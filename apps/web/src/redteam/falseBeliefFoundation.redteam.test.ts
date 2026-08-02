import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type SourceFile = { relativePath: string; source: string }

function productionSourceFiles(
  directoryUrl: URL,
  trackedPaths: ReadonlySet<string>,
  relativeDirectory = '',
): SourceFile[] {
  const directory = fileURLToPath(directoryUrl)
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDirectory}${entry.name}`
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      return productionSourceFiles(
        new URL(`${entry.name}/`, directoryUrl),
        trackedPaths,
        `${relativePath}/`,
      )
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    if (!trackedPaths.has(relativePath)) return []
    return [{ relativePath, source: readFileSync(path, 'utf8') }]
  })
}

function trackedProductionPaths(): Set<string> {
  const repositoryRoot = fileURLToPath(new URL('../../../../', import.meta.url))
  const tracked = execFileSync('git', ['ls-files', '--', 'apps/web/src'], {
    cwd: repositoryRoot, encoding: 'utf8',
  })
  const untracked = execFileSync(
    'git',
    ['ls-files', '--others', '--exclude-standard', '--', 'apps/web/src'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )
  const protectedPaths = new Set([
    'domain/quests/generatedObjectiveExitBinding.ts',
    'domain/quests/generatedObjectiveExitBinding.test.ts',
    'spike-claim-mapper/lexicon.ts',
    'spike-claim-mapper/strength.ts',
    'spike-claim-mapper/vocabulary.ts',
  ])
  return new Set(`${tracked}\n${untracked}`
    .split(/\r?\n/)
    .filter((path) => path.length > 0)
    .map((path) => path.replace(/^apps\/web\/src\//, ''))
    .filter((path) => !protectedPaths.has(path)))
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('falseBeliefFoundation production emission guard', () => {
  it('allows the serialized V2 schema only at its definition and authorized serializer import', () => {
    const files = productionSourceFiles(
      new URL('../', import.meta.url),
      trackedProductionPaths(),
    )
    const importers = files.filter((file) => {
      const imports = stripComments(file.source)
        .match(/import[\s\S]*?from\s+['"][^'"]+['"]/g) ?? []
      return imports.some((statement) => statement.includes('SerializedBeliefV2Schema'))
    }).map((file) => file.relativePath)
    expect(importers).toEqual(['world-session/serializeCommittedBelief.ts'])

    const discriminatorFiles = files.filter((file) =>
      /\bbeliefSchemaVersion\b/.test(stripComments(file.source)))
      .map((file) => file.relativePath)
    expect(discriminatorFiles).toEqual([
      'domain/world/events.ts',
      'world-session/serializeCommittedBelief.ts',
    ])
  }, 30_000)

  it('gives the serializer exactly one production importer and one V2-capable authority route', () => {
    const files = productionSourceFiles(new URL('../', import.meta.url), trackedProductionPaths())
    const importers = files.filter((file) =>
      /from\s+['"][^'"]*serializeCommittedBelief['"]/.test(stripComments(file.source)))
      .map((file) => file.relativePath)
    expect(importers).toEqual(['world-session/WorldSession.ts'])

    const worldSession = files.find(
      (file) => file.relativePath === 'world-session/WorldSession.ts',
    )?.source ?? ''
    const baseline = worldSession.slice(
      worldSession.indexOf('async commitNpcAction('),
      worldSession.indexOf('async commitOffstageTruth('),
    )
    const defeasible = worldSession.slice(
      worldSession.indexOf('async commitDefeasibleNpcAction('),
      worldSession.indexOf('async commitNpcActionRetraction('),
    )
    expect(baseline).not.toContain('serializeCommittedBelief(')
    expect(defeasible.match(/serializeCommittedBelief\(/g)).toHaveLength(1)
  }, 30_000)
})
