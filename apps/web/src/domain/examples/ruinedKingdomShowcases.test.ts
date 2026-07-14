import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../loadRoomSpec'
import { projectObjectPresentationState } from '../visuals/objectPresentationState'
import { validateRoom } from '../validateRoom'
import {
  cryptEntranceShowcase,
  ruinedKingdomShowcases,
  ruinedTavernShowcase,
  villageSquareShowcase,
} from './ruinedKingdomShowcases'

function objectById(room: ReturnType<typeof loadRoomSpec>, id: string) {
  const object = room.objects.find((candidate) => candidate.id === id)
  if (object === undefined) throw new Error(`missing showcase object: ${id}`)
  return object
}

describe('Ruined Kingdom Survival showcase fixtures', () => {
  it.each(Object.entries(ruinedKingdomShowcases))(
    '%s is closed semantic RoomSpec data that loads and validates cleanly',
    (_id, fixture) => {
      const loaded = loadRoomSpec(structuredClone(fixture))

      expect(loaded.skipped).toEqual([])
      expect(loaded.warnings).toEqual([])
      expect(loaded.objects).toHaveLength(fixture.objects.length)
      expect(validateRoom(loaded).issues).toEqual([])
    },
  )

  it('keeps the village square rich and broadly reusable rather than showcase-only', () => {
    const loaded = loadRoomSpec(structuredClone(villageSquareShowcase))
    const types = new Set<string>(loaded.objects.map((object) => object.type))
    const architectureKinds = new Set<string>(
      loaded.objects
        .filter((object) => object.type === 'architecture')
        .map((object) => object.kind),
    )

    expect(loaded.objects.length).toBeGreaterThan(180)
    for (const type of ['architecture', 'furniture', 'clutter', 'vegetation', 'light-fixture', 'npc']) {
      expect(types.has(type)).toBe(true)
    }
    for (const kind of ['floor-section', 'fence', 'wall-straight', 'roof', 'window', 'well', 'fountain']) {
      expect(architectureKinds.has(kind)).toBe(true)
    }
    expect(loaded.objects.filter((object) => object.type === 'npc')).toHaveLength(6)
    expect(loaded.objects.some((object) => object.type === 'prop')).toBe(false)
  })

  it('gives village interactions gameplay effects and visible projected states', () => {
    const loaded = loadRoomSpec(structuredClone(villageSquareShowcase))
    const notice = objectById(loaded, 'village-notice')
    const supplies = objectById(loaded, 'village-relief-supplies')
    const merchant = objectById(loaded, 'village-merchant')

    expect('interaction' in notice && notice.interaction?.effect).toEqual({
      kind: 'inspect',
      flag: 'village-notice-read',
    })
    expect(projectObjectPresentationState(notice, { resolved: true }).interactionState).toBe('read')
    expect('interaction' in supplies && supplies.interaction?.effect?.kind).toBe('take-item')
    expect(projectObjectPresentationState(supplies).interactionState).toBe('closed')
    expect(projectObjectPresentationState(supplies, { resolved: true }).interactionState).toBe('looted')
    expect('interaction' in merchant && merchant.interaction?.dialogue).toBeDefined()
  })

  it('combines burned static conditions with live looted/read states in the tavern', () => {
    const loaded = loadRoomSpec(structuredClone(ruinedTavernShowcase))
    const footlocker = objectById(loaded, 'tavern-footlocker')
    const ledger = objectById(loaded, 'tavern-ledger')

    expect(projectObjectPresentationState(footlocker)).toMatchObject({
      condition: 'damaged', interactionState: 'closed', resolved: false,
    })
    expect(projectObjectPresentationState(footlocker, { resolved: true })).toMatchObject({
      condition: 'damaged', interactionState: 'looted', resolved: true,
    })
    expect(projectObjectPresentationState(ledger, { resolved: true })).toMatchObject({
      condition: 'burned', interactionState: 'read', resolved: true,
    })
    expect(loaded.objects.some((object) => object.type === 'zombie')).toBe(true)
  })

  it('lets the authoritative gate projection lock and open the crypt entrance', () => {
    const loaded = loadRoomSpec(structuredClone(cryptEntranceShowcase))
    const altar = objectById(loaded, 'crypt-rune-altar')
    const gate = objectById(loaded, 'crypt-iron-gate')

    expect('interaction' in altar && altar.interaction?.effect).toEqual({
      kind: 'inspect',
      flag: 'crypt-runes-read',
    })
    expect(projectObjectPresentationState(gate, {
      exitGateResult: { gated: true },
    }).interactionState).toBe('locked')
    expect(projectObjectPresentationState(gate, {
      exitGateResult: { gated: false },
    }).interactionState).toBe('open')
    expect(loaded.objects.filter((object) => object.type === 'zombie')).toHaveLength(2)
  })
})
