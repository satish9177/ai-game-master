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

function callArgumentCounts(source: string, marker: string): number[] {
  const value = stripComments(source)
  const counts: number[] = []
  let searchFrom = 0
  while (true) {
    const callAt = value.indexOf(marker, searchFrom)
    if (callAt < 0) return counts
    const stack = ['(']
    let commas = 0
    let hasArgument = false
    let quote: string | undefined
    let escaped = false
    let cursor = callAt + marker.length
    for (; cursor < value.length; cursor += 1) {
      const character = value[cursor]!
      if (quote !== undefined) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === quote) quote = undefined
        continue
      }
      if (character === '"' || character === "'" || character === '`') {
        quote = character
        hasArgument = true
        continue
      }
      if (character === '(' || character === '[' || character === '{') {
        stack.push(character)
        hasArgument = true
        continue
      }
      if (character === ')' || character === ']' || character === '}') {
        stack.pop()
        if (stack.length === 0) break
        continue
      }
      if (character === ',' && stack.length === 1) commas += 1
      else if (!/\s/.test(character)) hasArgument = true
    }
    counts.push(hasArgument ? commas + 1 : 0)
    searchFrom = cursor + 1
  }
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

  it('keeps production WorldSession construction on the default four-argument resolver path', () => {
    const files = productionSourceFiles(new URL('../', import.meta.url), trackedProductionPaths())
    const constructions = files.flatMap((file) =>
      callArgumentCounts(file.source, 'new WorldSession(').map((argumentCount) => ({
        relativePath: file.relativePath,
        argumentCount,
      })))
    expect(constructions).toEqual([
      { relativePath: 'App.tsx', argumentCount: 4 },
      { relativePath: 'evaluation/fixtures.ts', argumentCount: 4 },
      { relativePath: 'server/bootstrap.ts', argumentCount: 4 },
    ])
  }, 30_000)

  it('keeps structural binding and hidden authority data out of command schemas', () => {
    const files = productionSourceFiles(new URL('../', import.meta.url), trackedProductionPaths())
    const events = files.find((file) => file.relativePath === 'domain/world/events.ts')?.source ?? ''
    const commands = events.slice(
      events.indexOf('export const WorldCommandSchema'),
      events.indexOf('export type WorldEvent'),
    )
    for (const forbidden of [
      'binding',
      'offstageTruth',
      'initialContainerContents',
      'evidenceArtifacts',
      'toNpcId',
      'presentationRecipient',
      'actorId',
      'concealedActor',
      'concealed',
    ]) {
      expect(stripComments(commands), forbidden).not.toMatch(new RegExp(`\\b${forbidden}\\b`))
    }
  }, 30_000)

  it('exposes no per-call structural binding or resolver on the five authority methods', () => {
    const files = productionSourceFiles(new URL('../', import.meta.url), trackedProductionPaths())
    const worldSession = files.find(
      (file) => file.relativePath === 'world-session/WorldSession.ts',
    )?.source ?? ''
    const context = worldSession.slice(
      worldSession.indexOf('export type DefeasibleNpcActionContext'),
      worldSession.indexOf('type AppliedMeaningfulConsequences'),
    )
    expect(stripComments(context)).toMatch(
      /DefeasibleNpcActionContext\s*=\s*Readonly<\{\s*room:\s*LoadedRoom\s*\}>/,
    )
    expect(stripComments(context)).not.toMatch(/\bbinding\s*:/)

    for (const method of [
      'commitOffstageTruth',
      'commitEvidenceDiscovered',
      'commitEvidencePresented',
      'commitDefeasibleNpcAction',
      'commitNpcActionRetraction',
    ]) {
      const start = worldSession.indexOf(`async ${method}(`)
      const endMarker = '): Promise<AppendEventResult>'
      const end = worldSession.indexOf(endMarker, start) + endMarker.length
      const signature = stripComments(worldSession.slice(start, end))
      expect(start, method).toBeGreaterThanOrEqual(0)
      expect(signature, method).toContain('context: DefeasibleNpcActionContext')
      expect(signature, method).not.toMatch(/\bbinding\b|resolveDefeasibleBinding|options/)
    }

    const inputSchemas = worldSession.slice(
      worldSession.indexOf('const OffstageTruthInputSchema'),
      worldSession.indexOf('function sameNpcActionCommand'),
    )
    expect(stripComments(inputSchemas)).not.toMatch(
      /\bbinding\b|offstageTruth|initialContainerContents|evidenceArtifacts|toNpcId|actorId|concealed/,
    )
  }, 30_000)
})
