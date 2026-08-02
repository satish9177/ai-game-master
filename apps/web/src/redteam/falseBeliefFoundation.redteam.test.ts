import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

type SourceFile = { relativePath: string; source: string }

const DEFINITION_ONLY_FILES = new Set([
  'domain/world/events.ts',
  'domain/npcBelief/beliefVersions.ts',
])

function productionSourceFiles(
  directoryUrl: URL,
  relativeDirectory = '',
): SourceFile[] {
  const directory = fileURLToPath(directoryUrl)
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = `${relativeDirectory}${entry.name}`
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) {
      return productionSourceFiles(
        new URL(`${entry.name}/`, directoryUrl),
        `${relativePath}/`,
      )
    }
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    return [{ relativePath, source: readFileSync(path, 'utf8') }]
  })
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
}

describe('falseBeliefFoundation production emission guard', () => {
  it('finds no production V2 belief value constructor or event-stamping path', () => {
    const files = productionSourceFiles(new URL('../', import.meta.url))
    const foundPaths = new Set(files.map((file) => file.relativePath))
    for (const definitionPath of DEFINITION_ONLY_FILES) {
      expect(foundPaths.has(definitionPath), definitionPath).toBe(true)
    }

    const possibleEmitters = files.filter(
      (file) => !DEFINITION_ONLY_FILES.has(file.relativePath),
    )
    for (const file of possibleEmitters) {
      expect(stripComments(file.source), file.relativePath)
        .not.toMatch(/\bbeliefSchemaVersion\s*:\s*2\b/)
    }
  }, 30_000)
})
