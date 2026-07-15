import { describe, expect, it } from 'vitest'
import { validateObjectPurpose } from './contracts'

const valid = () => ({ objectId: 'document', category: 'lore', required: true, affordances: [{ id: 'read', action: 'read', preconditions: [], effects: [{ kind: 'reveal-clue', clueId: 'clue' }], repeat: 'once' }] })

describe('validateObjectPurpose', () => {
  it('strictly parses a valid bounded affordance contract', () => expect(validateObjectPurpose(valid())).toEqual(valid()))
  it('fails closed for unknown actions, preconditions, and effects', () => {
    expect(validateObjectPurpose({ ...valid(), affordances: [{ ...valid().affordances[0], action: 'dance' }] })).toBeNull()
    expect(validateObjectPurpose({ ...valid(), affordances: [{ ...valid().affordances[0], preconditions: [{ kind: 'weather' }] }] })).toBeNull()
    expect(validateObjectPurpose({ ...valid(), affordances: [{ ...valid().affordances[0], effects: [{ kind: 'spawn' }] }] })).toBeNull()
  })
  it('fails closed for extra, missing, and wrongly typed data', () => {
    expect(validateObjectPurpose({ ...valid(), extra: true })).toBeNull()
    expect(validateObjectPurpose({ ...valid(), objectId: '' })).toBeNull()
    expect(validateObjectPurpose({ ...valid(), required: 'yes' })).toBeNull()
    expect(validateObjectPurpose(null)).toBeNull()
  })
  it('reuses the closed object interaction state vocabulary', () => {
    expect(validateObjectPurpose({ ...valid(), affordances: [{ ...valid().affordances[0], preconditions: [{ kind: 'object-state', objectId: 'document', state: 'flying' }] }] })).toBeNull()
  })
})
