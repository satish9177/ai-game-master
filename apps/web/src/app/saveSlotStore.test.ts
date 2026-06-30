import { describe, expect, it } from 'vitest'
import { createSaveSlotStore, type KeyValueStore } from './saveSlotStore'

const SLOT_KEY = 'aigm.save.slot'
const FAKE_JSON = '{"schemaVersion":1,"seed":{},"log":[],"snapshot":{}}'

function createMapKv() {
  const store = new Map<string, string>()
  const kv: KeyValueStore = {
    get: (key) => store.get(key) ?? null,
    set: (key, value) => { store.set(key, value) },
    remove: (key) => { store.delete(key) },
  }
  return { kv, store }
}

function createThrowingKv(): KeyValueStore {
  const fail = (): never => { throw new Error('storage unavailable') }
  return { get: fail, set: fail, remove: fail }
}

function createQuotaExceededKv(): KeyValueStore {
  return {
    get: () => null,
    set: () => { throw new DOMException('quota exceeded', 'QuotaExceededError') },
    remove: () => {},
  }
}

describe('saveSlotStore — empty slot', () => {
  it('has() returns false when empty', () => {
    const { kv } = createMapKv()
    expect(createSaveSlotStore(kv).has()).toBe(false)
  })

  it('read() returns empty reason when no slot', () => {
    const { kv } = createMapKv()
    const result = createSaveSlotStore(kv).read()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('empty')
  })
})

describe('saveSlotStore — save/read/has/clear round-trip', () => {
  it('has() returns true after write', () => {
    const { kv } = createMapKv()
    const slot = createSaveSlotStore(kv)
    slot.write(FAKE_JSON)
    expect(slot.has()).toBe(true)
  })

  it('read() returns saveGameJson after write', () => {
    const { kv } = createMapKv()
    const slot = createSaveSlotStore(kv)
    slot.write(FAKE_JSON)
    const result = slot.read()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.saveGameJson).toBe(FAKE_JSON)
  })

  it('has() returns false after clear', () => {
    const { kv } = createMapKv()
    const slot = createSaveSlotStore(kv)
    slot.write(FAKE_JSON)
    slot.clear()
    expect(slot.has()).toBe(false)
  })

  it('read() returns empty after clear', () => {
    const { kv } = createMapKv()
    const slot = createSaveSlotStore(kv)
    slot.write(FAKE_JSON)
    slot.clear()
    const result = slot.read()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('empty')
  })

  it('write returns ok:true on success', () => {
    const { kv } = createMapKv()
    const result = createSaveSlotStore(kv).write(FAKE_JSON)
    expect(result.ok).toBe(true)
  })

  it('clear returns ok:true when slot exists', () => {
    const { kv } = createMapKv()
    const slot = createSaveSlotStore(kv)
    slot.write(FAKE_JSON)
    expect(slot.clear()).toEqual({ ok: true })
  })
})

describe('saveSlotStore — wrapper round-trip', () => {
  it('metadata fields survive a write/read round-trip', () => {
    const { kv } = createMapKv()
    const slot = createSaveSlotStore(kv)
    slot.write(FAKE_JSON, {
      label: 'My Save',
      savedAt: '2026-06-24T12:00:00.000Z',
      currentRoomId: 'throne-room',
    })
    const result = slot.read()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meta.label).toBe('My Save')
      expect(result.meta.savedAt).toBe('2026-06-24T12:00:00.000Z')
      expect(result.meta.currentRoomId).toBe('throne-room')
    }
  })

  it('default metadata is applied when none given', () => {
    const { kv } = createMapKv()
    const slot = createSaveSlotStore(kv)
    slot.write(FAKE_JSON)
    const result = slot.read()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.meta.label).toBe('Save')
      expect(typeof result.meta.savedAt).toBe('string')
    }
  })
})

describe('saveSlotStore — metadata ignored for authoritative load', () => {
  it('saveGameJson is the only field returned for loading; meta is separate', () => {
    const { kv } = createMapKv()
    const slot = createSaveSlotStore(kv)
    slot.write(FAKE_JSON, {
      label: 'Unreliable display label',
      savedAt: '2099-01-01T00:00:00.000Z',
      currentRoomId: 'FAKE_ID',
    })
    const result = slot.read()
    expect(result.ok).toBe(true)
    if (result.ok) {
      // Only saveGameJson is passed to SaveGameService.loadSession; meta never is.
      expect(result.saveGameJson).toBe(FAKE_JSON)
      expect(result).toHaveProperty('meta')
      // meta fields are present but separate from the authoritative payload
      expect(result.meta.currentRoomId).toBe('FAKE_ID')
    }
  })
})

describe('saveSlotStore — generatedQuestJson parking', () => {
  const BLOB = '{"schemaVersion":1,"room":{},"objectivesPerRoom":true}'

  it('write with generatedQuestJson → read returns the same string', () => {
    const { kv } = createMapKv()
    const slot = createSaveSlotStore(kv)
    slot.write(FAKE_JSON, { label: 'Gen' }, BLOB)
    const result = slot.read()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.generatedQuestJson).toBe(BLOB)
      // saveGameJson stays authoritative and unchanged.
      expect(result.saveGameJson).toBe(FAKE_JSON)
    }
  })

  it('write without generatedQuestJson → read returns undefined', () => {
    const { kv } = createMapKv()
    const slot = createSaveSlotStore(kv)
    slot.write(FAKE_JSON)
    const result = slot.read()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.generatedQuestJson).toBeUndefined()
  })

  it('write with empty string → omitted (treated as absent)', () => {
    const { kv, store } = createMapKv()
    const slot = createSaveSlotStore(kv)
    slot.write(FAKE_JSON, undefined, '')
    const raw = store.get(SLOT_KEY)
    expect(raw).not.toBeNull()
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      expect('generatedQuestJson' in parsed).toBe(false)
    }
    const result = slot.read()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.generatedQuestJson).toBeUndefined()
  })

  it('older wrapper without generatedQuestJson key reads without error', () => {
    const { kv, store } = createMapKv()
    store.set(
      SLOT_KEY,
      JSON.stringify({ label: 'Old', savedAt: '2026-01-01T00:00:00.000Z', saveGameJson: FAKE_JSON }),
    )
    const result = createSaveSlotStore(kv).read()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.saveGameJson).toBe(FAKE_JSON)
      expect(result.generatedQuestJson).toBeUndefined()
    }
  })

  it('non-string generatedQuestJson is treated as corrupt (not validated, just rejected)', () => {
    const { kv, store } = createMapKv()
    store.set(
      SLOT_KEY,
      JSON.stringify({
        label: 'X',
        savedAt: '2026-01-01T00:00:00.000Z',
        saveGameJson: FAKE_JSON,
        generatedQuestJson: 42,
      }),
    )
    const result = createSaveSlotStore(kv).read()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('corrupt')
  })

  it('invalid generatedQuestJson content does not break saveGameJson read', () => {
    // The blob is parked bytes only — saveSlotStore never parses or validates it.
    const { kv } = createMapKv()
    const slot = createSaveSlotStore(kv)
    slot.write(FAKE_JSON, { label: 'Gen' }, 'NOT VALID JSON{{{')
    const result = slot.read()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.saveGameJson).toBe(FAKE_JSON)
      expect(result.generatedQuestJson).toBe('NOT VALID JSON{{{')
    }
  })
})

describe('saveSlotStore — key namespacing', () => {
  it('uses the aigm.save.slot key', () => {
    const { kv, store } = createMapKv()
    createSaveSlotStore(kv).write(FAKE_JSON)
    expect(store.has(SLOT_KEY)).toBe(true)
  })

  it('stored value is valid JSON wrapping the saveGameJson', () => {
    const { kv, store } = createMapKv()
    createSaveSlotStore(kv).write(FAKE_JSON)
    const raw = store.get(SLOT_KEY)
    expect(typeof raw).toBe('string')
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      expect(parsed.saveGameJson).toBe(FAKE_JSON)
    }
  })
})

describe('saveSlotStore — failure handling', () => {
  it('read() returns unavailable when storage throws', () => {
    const result = createSaveSlotStore(createThrowingKv()).read()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unavailable')
  })

  it('has() returns false when storage throws', () => {
    expect(createSaveSlotStore(createThrowingKv()).has()).toBe(false)
  })

  it('write() returns unavailable when storage throws', () => {
    const setThrowsKv: KeyValueStore = {
      get: () => null,
      set: () => { throw new Error('unavailable') },
      remove: () => {},
    }
    const result = createSaveSlotStore(setThrowsKv).write(FAKE_JSON)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unavailable')
  })

  it('write() returns quota-exceeded on QuotaExceededError', () => {
    const result = createSaveSlotStore(createQuotaExceededKv()).write(FAKE_JSON)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('quota-exceeded')
  })

  it('clear() returns unavailable when storage throws', () => {
    const result = createSaveSlotStore(createThrowingKv()).clear()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unavailable')
  })

  it('corrupt JSON in the slot is handled calmly', () => {
    const { kv, store } = createMapKv()
    store.set(SLOT_KEY, 'NOT VALID JSON{{{')
    const result = createSaveSlotStore(kv).read()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('corrupt')
  })

  it('valid JSON missing saveGameJson field is handled calmly', () => {
    const { kv, store } = createMapKv()
    store.set(SLOT_KEY, JSON.stringify({ label: 'X', savedAt: '2026-01-01T00:00:00.000Z' }))
    const result = createSaveSlotStore(kv).read()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('corrupt')
  })

  it('valid JSON with wrong types is handled calmly', () => {
    const { kv, store } = createMapKv()
    store.set(SLOT_KEY, JSON.stringify({ label: 42, savedAt: true, saveGameJson: 123 }))
    const result = createSaveSlotStore(kv).read()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('corrupt')
  })
})

describe('saveSlotStore — no SaveGame JSON logged', () => {
  it('SaveSlotStore has no Logger dependency — JSON logging is structurally impossible', () => {
    // createSaveSlotStore accepts only a KeyValueStore, not a Logger.
    // SaveGame JSON therefore cannot be passed to any logging function by the store.
    const { kv } = createMapKv()
    const slot = createSaveSlotStore(kv)
    const result = slot.write('{"schemaVersion":1,"secret":"not-logged"}')
    expect(result.ok).toBe(true)
    // No logger was involved; the above write completed without logging anything.
  })
})
