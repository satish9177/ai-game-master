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
  const output = execFileSync(
    'git',
    ['ls-files', '--', 'apps/web/src'],
    { cwd: repositoryRoot, encoding: 'utf8' },
  )
  return new Set(output
    .split(/\r?\n/)
    .filter((path) => path.length > 0)
    .map((path) => path.replace(/^apps\/web\/src\//, '')))
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('falseBeliefFoundation production emission guard', () => {
  // Temporary: S4 must replace this broad ban with an exact authorized-emitter allowlist.
  it('permits in-memory NpcBeliefV2 construction but forbids production stamping of serialized beliefSchemaVersion: 2 payloads', () => {
    const files = productionSourceFiles(
      new URL('../', import.meta.url),
      trackedProductionPaths(),
    )
    const eventsSource = files.find((file) => file.relativePath === 'domain/world/events.ts')?.source
    const versionsSource = files.find(
      (file) => file.relativePath === 'domain/npcBelief/beliefVersions.ts',
    )?.source
    expect(eventsSource).toMatch(/export const SerializedBeliefV2Schema/)
    expect(eventsSource).toMatch(/beliefSchemaVersion\s*:\s*z\.literal\(2\)/)
    expect(versionsSource).toMatch(/export type NpcBeliefV2/)

    for (const file of files) {
      const withoutDefinition = stripComments(file.source)
        .replace(/\bbeliefSchemaVersion\s*:\s*z\.literal\(\s*2\s*\)/g, '')
      expect(withoutDefinition, file.relativePath)
        .not.toMatch(/\bbeliefSchemaVersion\s*:\s*2\b/)
    }
  }, 30_000)
})
