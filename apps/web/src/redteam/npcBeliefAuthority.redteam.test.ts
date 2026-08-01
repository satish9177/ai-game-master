import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { throneRoom } from '../domain/examples/throneRoom'
import { loadRoomSpec } from '../domain/loadRoomSpec'
import type { Logger, LogContext } from '../platform/logger/Logger'
import { runBeliefGatedNpcActionReaction } from '../app/npcBeliefActionReaction'

function sourceFiles(directoryUrl: URL): { path: string; source: string }[] {
  const directory = fileURLToPath(directoryUrl)
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`
    if (entry.isDirectory()) return sourceFiles(new URL(`${entry.name}/`, directoryUrl))
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name)) return []
    return [{ path, source: readFileSync(path, 'utf8') }]
  })
}

describe('NPC belief authority redteam', () => {
  it('T49 keeps the belief domain deterministic and side-effect free', () => {
    const forbidden = /Math\s*\.\s*random|Date\s*\.\s*now|new\s+Date|\bcrypto\b|\bfetch\b|setTimeout|setInterval|requestAnimationFrame|\bconsole\s*\./
    for (const file of sourceFiles(new URL('../domain/npcBelief/', import.meta.url))) {
      expect(file.source, file.path).not.toMatch(forbidden)
    }
  }, 30_000)

  it('T50 keeps forbidden layers out of the belief domain imports', () => {
    const forbidden = /(?:memory|dialogue|generation|persistence|server|world-session|renderer|react|three|livingWorldProof)/i
    for (const file of sourceFiles(new URL('../domain/npcBelief/', import.meta.url))) {
      const specifiers = [...file.source.matchAll(/from\s*['"]([^'"]+)['"]/g)]
        .map((match) => match[1] ?? '')
      expect(specifiers.filter((specifier) => forbidden.test(specifier)), file.path).toEqual([])
    }
  }, 30_000)

  it('T51 exports no belief-domain function returning WorldEvent', () => {
    for (const file of sourceFiles(new URL('../domain/npcBelief/', import.meta.url))) {
      expect(file.source, file.path).not.toMatch(
        /export\s+function[\s\S]*?\)\s*:\s*(?:Promise\s*<\s*)?WorldEvent/,
      )
    }
  }, 30_000)

  it('T52 keeps identities and thrown exception text out of reaction logs', async () => {
    const entries: [string, LogContext | undefined][] = []
    const logger: Logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: (message, context) => { entries.push([message, context]) },
      child: () => logger,
    }
    const exceptionMarker = 'EXCEPTION_TEXT_MARKER'
    await runBeliefGatedNpcActionReaction({
      enabled: true,
      sessionId: '10000000-0000-4000-8000-000000000000',
      room: loadRoomSpec(throneRoom),
      state: {
        schemaVersion: 1,
        worldId: '20000000-0000-4000-8000-000000000000',
        sessionId: '10000000-0000-4000-8000-000000000000',
        currentRoomId: 'throne-room',
        player: { health: { current: 100, max: 100 }, status: [] },
        inventory: [],
        roomStates: { 'throne-room': { visited: true } },
        revision: 1,
        updatedAt: '2026-07-24T00:00:00.000Z',
      },
      session: {
        getEventLog: async () => { throw new Error(exceptionMarker) },
        commitNpcAction: async () => { throw new Error('must not commit') },
      } as never,
      logger,
    })
    const serialized = JSON.stringify(entries)
    for (const marker of ['Asha', 'Gold Coin', 'Throne Room', exceptionMarker]) {
      expect(serialized).not.toContain(marker)
    }
  }, 30_000)

  it('T53 keeps NPC cognition and action gates out of renderer imports', () => {
    const forbidden = /(?:^|\/)domain\/npcBelief(?:\/|$)|(?:^|\/)app\/(?:npcBeliefActionReaction|npcActionExitGate)(?:\.tsx?)?$/
    for (const file of sourceFiles(new URL('../renderer/', import.meta.url))) {
      const specifiers = [
        ...file.source.matchAll(/\b(?:from\s*|import\s*(?:\(\s*)?)['"]([^'"]+)['"]/g),
      ].map((match) => match[1] ?? '')
      expect(specifiers.filter((specifier) => forbidden.test(specifier)), file.path).toEqual([])
    }
  }, 30_000)
})
