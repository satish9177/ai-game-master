import type { WorldStore } from '../domain/ports/WorldStore'
import { projectWorldState } from '../domain/world/applyEvent'
import { jsonDeepEqual } from '../domain/world/jsonDeepEqual'
import { SaveGameSchema, SaveGameVersionEnvelopeSchema } from '../domain/world/saveGame'
import type { SaveGame } from '../domain/world/saveGame'
import { validateEventLog } from '../domain/world/validateEventLog'
import type { Logger } from '../platform/logger/Logger'

export type SaveGameErrorCode =
  | 'not-found'
  | 'already-exists'
  | 'invalid-json'
  | 'invalid-schema'
  | 'unsupported-version'
  | 'integrity-mismatch'

export type SaveGameError = { code: SaveGameErrorCode; message: string }

export type SaveSessionResult =
  | { ok: true; json: string }
  | { ok: false; error: SaveGameError }

export type LoadSaveGameResult =
  | { ok: true; saveGame: SaveGame }
  | { ok: false; error: SaveGameError }

export type LoadSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; error: SaveGameError }

export function loadSaveGame(json: string): LoadSaveGameResult {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return fail('invalid-json')
  }

  const envelope = SaveGameVersionEnvelopeSchema.safeParse(raw)
  if (!envelope.success) return fail('invalid-schema')
  if (envelope.data.schemaVersion !== 1) return fail('unsupported-version')

  const parsed = SaveGameSchema.safeParse(raw)
  if (!parsed.success) return fail('invalid-schema')
  if (!hasValidIntegrity(parsed.data)) return fail('integrity-mismatch')
  return { ok: true, saveGame: parsed.data }
}

export class SaveGameService {
  private readonly store: WorldStore
  private readonly log: Logger

  constructor(store: WorldStore, logger: Logger) {
    this.store = store
    this.log = logger
  }

  async saveSession(sessionId: string): Promise<SaveSessionResult> {
    const snapshot = await this.store.getSnapshot(sessionId)
    if (!snapshot) {
      this.log.warn('world session save failed', { sessionId, code: 'not-found' })
      return fail('not-found')
    }
    const log = await this.store.listEvents(sessionId)
    const first = log[0]
    if (first?.type !== 'session-started') {
      this.log.error('world session save failed', { sessionId, code: 'integrity-mismatch' })
      return fail('integrity-mismatch')
    }

    const parsed = SaveGameSchema.safeParse({
      schemaVersion: 1,
      seed: first.payload.seed,
      log,
      snapshot,
    })
    if (!parsed.success || !hasValidIntegrity(parsed.data)) {
      this.log.error('world session save failed', { sessionId, code: 'integrity-mismatch' })
      return fail('integrity-mismatch')
    }

    this.log.info('world session saved', {
      sessionId,
      revision: snapshot.revision,
      eventCount: log.length,
    })
    return { ok: true, json: JSON.stringify(parsed.data) }
  }

  async loadSession(json: string): Promise<LoadSessionResult> {
    const loaded = loadSaveGame(json)
    if (!loaded.ok) {
      this.log.warn('world session load failed', { code: loaded.error.code })
      return loaded
    }

    const { log, snapshot } = loaded.saveGame
    const restored = await this.store.restoreSession({
      sessionId: snapshot.sessionId,
      log,
      snapshot,
    })
    if (!restored.ok) {
      this.log.warn('world session load failed', {
        sessionId: snapshot.sessionId,
        code: restored.error.code,
      })
      return fail(restored.error.code === 'already-exists' ? 'already-exists' : 'integrity-mismatch')
    }

    this.log.info('world session loaded', {
      sessionId: snapshot.sessionId,
      revision: snapshot.revision,
      eventCount: log.length,
    })
    return { ok: true, sessionId: snapshot.sessionId }
  }
}

function hasValidIntegrity(saveGame: SaveGame): boolean {
  const logValidation = validateEventLog(saveGame.log)
  if (!logValidation.ok) return false
  const first = saveGame.log[0]
  if (first?.type !== 'session-started') return false
  if (!jsonDeepEqual(first.payload.seed, saveGame.seed)) return false
  try {
    return jsonDeepEqual(projectWorldState(saveGame.log), saveGame.snapshot)
  } catch {
    return false
  }
}

function fail(code: SaveGameErrorCode): { ok: false; error: SaveGameError } {
  return { ok: false, error: { code, message: ERROR_MESSAGES[code] } }
}

const ERROR_MESSAGES: Record<SaveGameErrorCode, string> = {
  'not-found': 'World session was not found.',
  'already-exists': 'World session already exists.',
  'invalid-json': 'Save game is not valid JSON.',
  'invalid-schema': 'Save game does not match the current schema.',
  'unsupported-version': 'Save game schema version is not supported.',
  'integrity-mismatch': 'Save game failed its integrity check.',
}
