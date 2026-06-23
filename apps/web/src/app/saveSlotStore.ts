/**
 * Browser save-slot store (session-save-load-v0).
 *
 * localStorage is the physical medium but is NEVER truth. Only `saveGameJson`
 * is authoritative; metadata (label/savedAt/currentRoomId) is display-only
 * and is never fed to SaveGameService or trusted for restore.
 *
 * The logic is tested over an in-memory KeyValueStore fake; the thin
 * LocalStorageSaveSlotStore binding is exercised manually in the running app.
 */

export type SlotMeta = {
  label: string
  savedAt: string
  currentRoomId?: string
}

type SlotWrapper = SlotMeta & {
  saveGameJson: string
}

export type SlotReadResult =
  | { ok: true; saveGameJson: string; meta: SlotMeta }
  | { ok: false; reason: 'empty' | 'corrupt' | 'unavailable' }

export type SlotWriteResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' | 'quota-exceeded' }

export type SlotClearResult =
  | { ok: true }
  | { ok: false; reason: 'unavailable' }

export interface SaveSlotStore {
  /** Read the slot. Returns saveGameJson (the only authoritative field) + display-only meta. */
  read(): SlotReadResult
  /** Write saveGameJson to the slot with optional display-only metadata. */
  write(saveGameJson: string, meta?: Partial<SlotMeta>): SlotWriteResult
  /** True when a slot is present (best-effort; false if storage is unavailable). */
  has(): boolean
  /** Remove the slot. */
  clear(): SlotClearResult
}

/** Minimal seam that makes the store logic testable without a real browser. */
export interface KeyValueStore {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

const SLOT_KEY = 'aigm.save.slot'

function isSlotWrapper(value: unknown): value is SlotWrapper {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.saveGameJson === 'string' &&
    typeof v.label === 'string' &&
    typeof v.savedAt === 'string'
  )
}

function isQuotaExceeded(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  )
}

function createSaveSlotStoreImpl(kv: KeyValueStore): SaveSlotStore {
  return {
    read(): SlotReadResult {
      let raw: string | null
      try {
        raw = kv.get(SLOT_KEY)
      } catch {
        return { ok: false, reason: 'unavailable' }
      }
      if (raw === null) return { ok: false, reason: 'empty' }

      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        return { ok: false, reason: 'corrupt' }
      }

      if (!isSlotWrapper(parsed)) return { ok: false, reason: 'corrupt' }

      const meta: SlotMeta = {
        label: parsed.label,
        savedAt: parsed.savedAt,
        ...(parsed.currentRoomId !== undefined ? { currentRoomId: parsed.currentRoomId } : {}),
      }
      // Only saveGameJson is returned for authoritative loading; meta is display-only.
      return { ok: true, saveGameJson: parsed.saveGameJson, meta }
    },

    write(saveGameJson: string, meta: Partial<SlotMeta> = {}): SlotWriteResult {
      const wrapper: SlotWrapper = {
        label: meta.label ?? 'Save',
        savedAt: meta.savedAt ?? new Date().toISOString(),
        ...(meta.currentRoomId !== undefined ? { currentRoomId: meta.currentRoomId } : {}),
        saveGameJson,
      }
      try {
        kv.set(SLOT_KEY, JSON.stringify(wrapper))
        return { ok: true }
      } catch (error) {
        if (isQuotaExceeded(error)) return { ok: false, reason: 'quota-exceeded' }
        return { ok: false, reason: 'unavailable' }
      }
    },

    has(): boolean {
      try {
        return kv.get(SLOT_KEY) !== null
      } catch {
        return false
      }
    },

    clear(): SlotClearResult {
      try {
        kv.remove(SLOT_KEY)
        return { ok: true }
      } catch {
        return { ok: false, reason: 'unavailable' }
      }
    },
  }
}

/** Create a SaveSlotStore over a given KeyValueStore (for tests). */
export function createSaveSlotStore(kv: KeyValueStore): SaveSlotStore {
  return createSaveSlotStoreImpl(kv)
}

/** Production binding: one named localStorage slot. */
export class LocalStorageSaveSlotStore implements SaveSlotStore {
  private readonly impl: SaveSlotStore

  constructor() {
    this.impl = createSaveSlotStoreImpl({
      get: (key) => localStorage.getItem(key),
      set: (key, value) => localStorage.setItem(key, value),
      remove: (key) => localStorage.removeItem(key),
    })
  }

  read(): SlotReadResult {
    return this.impl.read()
  }

  write(json: string, meta?: Partial<SlotMeta>): SlotWriteResult {
    return this.impl.write(json, meta)
  }

  has(): boolean {
    return this.impl.has()
  }

  clear(): SlotClearResult {
    return this.impl.clear()
  }
}
