import { describe, expect, it } from 'vitest'
import type { ObjectAffordance, ObjectPurpose } from './contracts'
import { purposeGraphNodeId } from './purposeGraph'
import { validatePurposeGraph, type PurposeGraphReferenceCatalog } from './validatePurposeGraph'

const affordance = (id: string, overrides: Partial<ObjectAffordance> = {}): ObjectAffordance => ({ id, action: 'inspect', preconditions: [], effects: [], repeat: 'once', ...overrides })
const purpose = (objectId: string, affordances: ObjectAffordance[], overrides: Partial<ObjectPurpose> = {}): ObjectPurpose => ({ objectId, category: 'container', required: false, affordances, ...overrides })
const EMPTY_CATALOG: PurposeGraphReferenceCatalog = { objectIds: [], itemIds: [], objectiveIds: [], exitIds: [] }
const validate = (purposes: readonly ObjectPurpose[], requiredNodeIds: readonly string[] = [], initialAvailableNodeIds: readonly string[] = [], catalog: PurposeGraphReferenceCatalog = EMPTY_CATALOG) => validatePurposeGraph({ purposes, catalog, requiredNodeIds, initialAvailableNodeIds })
const codes = (value: ReturnType<typeof validate>): string[] => value.issues.map((issue) => issue.code)

describe('validatePurposeGraph', () => {
  it('passes a document to clue chain', () => {
    const clue = purposeGraphNodeId.clue('map')
    expect(validate([purpose('document', [affordance('read', { action: 'read', effects: [{ kind: 'reveal-clue', clueId: 'map' }] })])], [clue])).toMatchObject({ valid: true, reachableNodeIds: expect.arrayContaining([clue]) })
  })

  it('passes a key/tool to chest to clue chain', () => {
    const key = purposeGraphNodeId.item('key'); const opened = purposeGraphNodeId.objectState('chest', 'open'); const clue = purposeGraphNodeId.clue('note')
    const result = validate([purpose('chest', [affordance('open', { action: 'open', preconditions: [{ kind: 'has-item', itemId: 'key' }], effects: [{ kind: 'set-object-state', objectId: 'chest', state: 'open' }] }), affordance('search', { action: 'search', preconditions: [{ kind: 'object-state', objectId: 'chest', state: 'open' }], effects: [{ kind: 'reveal-clue', clueId: 'note' }] })])], [clue], [key], { ...EMPTY_CATALOG, itemIds: ['key'] })
    expect(result).toMatchObject({ valid: true, reachableNodeIds: expect.arrayContaining([opened, clue]) })
  })

  const cyclePurposes = (): ObjectPurpose[] => [
    purpose('chest', [affordance('open', { action: 'open', preconditions: [{ kind: 'object-state', objectId: 'machine', state: 'activated' }], effects: [{ kind: 'set-object-state', objectId: 'chest', state: 'open' }, { kind: 'reveal-clue', clueId: 'answer' }] })]),
    purpose('crank', [affordance('take', { action: 'take', preconditions: [{ kind: 'object-state', objectId: 'chest', state: 'open' }], effects: [{ kind: 'add-item', item: { itemId: 'crank', name: 'Crank', quantity: 1 } }] })]),
    purpose('machine', [affordance('use', { action: 'use', preconditions: [{ kind: 'has-item', itemId: 'crank' }], effects: [{ kind: 'set-object-state', objectId: 'machine', state: 'activated' }] })]),
  ]

  it('reports an unreachable dependency cycle only when required content depends on it', () => {
    const result = validate(cyclePurposes(), [purposeGraphNodeId.clue('answer')], [], { ...EMPTY_CATALOG, itemIds: ['crank'] })
    expect(codes(result)).toEqual(expect.arrayContaining(['UNREACHABLE_REQUIRED_NODE', 'UNREACHABLE_DEPENDENCY_CYCLE']))
    expect(result.issues.find((issue) => issue.code === 'UNREACHABLE_DEPENDENCY_CYCLE')?.affordanceIds).toEqual(expect.arrayContaining(['affordance:chest:open', 'affordance:crank:take', 'affordance:machine:use']))
  })

  it('allows the same cycle when an external provider breaks it', () => {
    expect(validate(cyclePurposes(), [purposeGraphNodeId.clue('answer')], [purposeGraphNodeId.item('crank')], { ...EMPTY_CATALOG, itemIds: ['crank'] })).toMatchObject({ valid: true })
  })

  it('fails only required unreachable nodes', () => {
    expect(codes(validate([], [purposeGraphNodeId.clue('required')]))).toContain('UNREACHABLE_REQUIRED_NODE')
    expect(validate([], [])).toMatchObject({ valid: true })
  })

  it('rejects repeatable inventory and objective progress rewards', () => {
    expect(codes(validate([purpose('cache', [affordance('take', { action: 'take', repeat: 'always', effects: [{ kind: 'add-item', item: { itemId: 'coin', name: 'Coin', quantity: 1 } }] })])], [], [], { ...EMPTY_CATALOG, itemIds: ['coin'] }))).toContain('REPEATABLE_NON_IDEMPOTENT_EFFECT')
  })

  it('allows once-only duplicate clue and same-value flag providers', () => {
    const purposes = [
      purpose('one', [affordance('read', { effects: [{ kind: 'reveal-clue', clueId: 'same' }, { kind: 'set-room-flag', roomId: 'room', flag: 'open', value: true }] })]),
      purpose('two', [affordance('read', { effects: [{ kind: 'reveal-clue', clueId: 'same' }, { kind: 'set-room-flag', roomId: 'room', flag: 'open', value: true }] })]),
    ]
    expect(validate(purposes, [purposeGraphNodeId.clue('same')])).toMatchObject({ valid: true })
  })

  it('rejects conflicting reachable state transitions without ordering', () => {
    const result = validate([purpose('door', [affordance('open', { effects: [{ kind: 'set-object-state', objectId: 'door', state: 'open' }] }), affordance('lock', { effects: [{ kind: 'set-object-state', objectId: 'door', state: 'locked' }] })])])
    expect(codes(result)).toContain('CONFLICTING_STATE_TRANSITIONS')
  })

  it('scopes duplicate affordance identifiers per object', () => {
    const duplicate = validate([purpose('one', [affordance('same'), affordance('same')])])
    expect(codes(duplicate)).toContain('DUPLICATE_AFFORDANCE_ID')
    expect(validate([purpose('one', [affordance('same')]), purpose('two', [affordance('same')])])).toMatchObject({ valid: true })
  })

  it('enforces the three-affordance maximum for non-decorative objects', () => {
    expect(codes(validate([purpose('box', [affordance('a'), affordance('b'), affordance('c'), affordance('d')])]))).toContain('TOO_MANY_AFFORDANCES')
    expect(validate([purpose('box', [affordance('a'), affordance('b'), affordance('c')])])).toMatchObject({ valid: true })
  })

  it('reports unresolved object, item, objective, and exit references within the declared closure', () => {
    const references = purpose('known', [affordance('use', { preconditions: [{ kind: 'object-state', objectId: 'missing-object', state: 'open' }, { kind: 'has-item', itemId: 'missing-item' }, { kind: 'objective-stage', objectiveId: 'missing-objective', atLeast: 1 }], effects: [{ kind: 'set-object-state', objectId: 'missing-object', state: 'closed' }, { kind: 'progress-objective', objectiveId: 'missing-objective', toStage: 1 }, { kind: 'unlock-exit', exitId: 'missing-exit' }] })])
    expect(codes(validate([references]))).toEqual(expect.arrayContaining(['MISSING_OBJECT_REFERENCE', 'MISSING_ITEM_REFERENCE', 'MISSING_OBJECTIVE_REFERENCE', 'MISSING_EXIT_REFERENCE']))
  })

  it('reports an existing catalog item as unreachable rather than missing', () => {
    const item = purposeGraphNodeId.item('key')
    const result = validate([], [item], [], { ...EMPTY_CATALOG, itemIds: ['key'] })
    expect(codes(result)).toContain('UNREACHABLE_REQUIRED_NODE')
    expect(codes(result)).not.toContain('MISSING_ITEM_REFERENCE')
  })

  it('reports a missing catalog item even when initial state makes its node available', () => {
    const item = purposeGraphNodeId.item('key')
    const result = validate([], [], [item])
    expect(codes(result)).toContain('MISSING_ITEM_REFERENCE')
  })

  it('reports an existing objective as incompletable rather than missing', () => {
    const objective = purposeGraphNodeId.objectiveStage('escape', 1)
    const result = validate([], [objective], [], { ...EMPTY_CATALOG, objectiveIds: ['escape'] })
    expect(codes(result)).toEqual(expect.arrayContaining(['UNREACHABLE_REQUIRED_NODE', 'OBJECTIVE_INCOMPLETABLE']))
    expect(codes(result)).not.toContain('MISSING_OBJECTIVE_REFERENCE')
  })

  it('reports a missing objective reference when required outcomes name it', () => {
    const objective = purposeGraphNodeId.objectiveStage('escape', 1)
    expect(codes(validate([], [objective]))).toContain('MISSING_OBJECTIVE_REFERENCE')
  })

  it('reports an existing exit as unreachable rather than missing', () => {
    const exit = purposeGraphNodeId.exit('north-door')
    const result = validate([], [exit], [], { ...EMPTY_CATALOG, exitIds: ['north-door'] })
    expect(codes(result)).toContain('UNREACHABLE_REQUIRED_NODE')
    expect(codes(result)).not.toContain('MISSING_EXIT_REFERENCE')
  })

  it('reports a missing exit reference when required outcomes name it', () => {
    const exit = purposeGraphNodeId.exit('north-door')
    expect(codes(validate([], [exit]))).toContain('MISSING_EXIT_REFERENCE')
  })

  it('accepts an object declared by ObjectPurpose when it is omitted from catalog.objectIds', () => {
    const result = validate([purpose('chest', [affordance('open', { effects: [{ kind: 'set-object-state', objectId: 'chest', state: 'open' }] })])])
    expect(result).toMatchObject({ valid: true })
    expect(codes(result)).not.toContain('MISSING_OBJECT_REFERENCE')
  })

  it('fails closed when callers bypass single-object validation', () => {
    const invalid = { objectId: 'x', category: 'container', required: false, affordances: [{ id: 'bad', action: 'dance', preconditions: [{ kind: 'unknown' }], effects: [{ kind: 'unknown' }], repeat: 'once' }] } as unknown as ObjectPurpose
    expect(codes(validate([invalid]))).toEqual(expect.arrayContaining(['INVALID_CONTRACT', 'UNKNOWN_ACTION', 'UNKNOWN_PRECONDITION', 'UNKNOWN_EFFECT']))
  })

  it('is deterministic for issue and canonical walkthrough ordering', () => {
    const purposes = [purpose('z', [affordance('z', { effects: [{ kind: 'reveal-clue', clueId: 'z' }] })]), purpose('a', [affordance('a', { effects: [{ kind: 'reveal-clue', clueId: 'a' }] })])]
    expect(validate(purposes)).toEqual(validate([...purposes].reverse()))
    expect(validate(purposes).walkthroughAffordanceIds).toEqual(['affordance:a:a', 'affordance:z:z'])
  })

  it('keeps invalid issue ordering deterministic when input purposes are reordered', () => {
    const invalid = [purpose('z', [affordance('z', { preconditions: [{ kind: 'has-item', itemId: 'z' }] })]), purpose('a', [affordance('a', { preconditions: [{ kind: 'has-item', itemId: 'a' }] })])]
    expect(validate(invalid).issues).toEqual(validate([...invalid].reverse()).issues)
  })

  it('does not mutate frozen caller input', () => {
    const purposes = Object.freeze([Object.freeze(purpose('paper', [Object.freeze(affordance('read', { effects: Object.freeze([{ kind: 'reveal-clue', clueId: 'clue' }]) as ObjectAffordance['effects'] }))]))])
    const initial = Object.freeze([]); const required = Object.freeze([purposeGraphNodeId.clue('clue')])
    expect(() => validate(purposes, required, initial)).not.toThrow()
    expect(validate(purposes, required, initial)).toMatchObject({ valid: true })
  })

  it('allows an empty decorative object but rejects a purposeless required non-decorative object', () => {
    expect(validate([purpose('vase', [], { category: 'decorative' })])).toMatchObject({ valid: true })
    expect(codes(validate([purpose('box', [affordance('inspect')], { required: true })]))).toContain('PURPOSELESS_REQUIRED_OBJECT')
  })

  it('detects duplicate reachable non-idempotent rewards', () => {
    const result = validate([purpose('one', [affordance('take', { effects: [{ kind: 'add-item', item: { itemId: 'coin', name: 'Coin', quantity: 1 } }] })]), purpose('two', [affordance('take', { effects: [{ kind: 'add-item', item: { itemId: 'coin', name: 'Coin', quantity: 1 } }] })])], [], [], { ...EMPTY_CATALOG, itemIds: ['coin'] })
    expect(codes(result)).toContain('DUPLICATE_NON_IDEMPOTENT_REWARD')
  })
})
