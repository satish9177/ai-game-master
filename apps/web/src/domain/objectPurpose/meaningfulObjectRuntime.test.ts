import { describe, expect, it } from 'vitest'
import { loadRoomSpec } from '../loadRoomSpec'
import {
  deriveMeaningfulObjectView,
  meaningfulObjectStateFlagKey,
} from './meaningfulObjectRuntime'

function object(raw: unknown) {
  return loadRoomSpec({
    schemaVersion: 1,
    id: 'generated-room',
    name: 'Generated',
    shell: { dimensions: { width: 10, depth: 10, height: 4 } },
    spawn: { position: [0, 1, 0] },
    objects: [raw],
  }).objects[0]!
}

describe('meaningful object runtime evaluator', () => {
  it('derives document choices from authoritative read state', () => {
    const document = object({
      id: 'note',
      type: 'paper',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
    })
    expect(deriveMeaningfulObjectView({ object: document, generatedPlay: true })?.choices)
      .toEqual([{ id: 'inspect', label: 'Inspect' }, { id: 'read', label: 'Read' }])
    expect(deriveMeaningfulObjectView({
      object: document,
      generatedPlay: true,
      roomState: { visited: true, flags: { [meaningfulObjectStateFlagKey('note', 'read')]: true } },
    })?.choices).toEqual([{ id: 'inspect', label: 'Inspect' }])
  })

  it('derives closed, open, and looted container choices', () => {
    const container = object({
      id: 'crate',
      type: 'crate',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    })
    const view = (flags?: Record<string, boolean>) => deriveMeaningfulObjectView({
      object: container,
      generatedPlay: true,
      roomState: { visited: true, ...(flags ? { flags } : {}) },
    })
    expect(view()?.choices.map((choice) => choice.id)).toEqual(['inspect', 'open'])
    expect(view({ [meaningfulObjectStateFlagKey('crate', 'open')]: true })?.choices.map((choice) => choice.id))
      .toEqual(['inspect', 'search'])
    expect(view({
      [meaningfulObjectStateFlagKey('crate', 'open')]: true,
      [meaningfulObjectStateFlagKey('crate', 'looted')]: true,
    })?.choices.map((choice) => choice.id)).toEqual(['inspect'])
  })

  it('derives remains search once and treats generic inspect as non-terminal', () => {
    const remains = object({
      id: 'corpse',
      type: 'corpse',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    })
    expect(deriveMeaningfulObjectView({
      object: remains,
      generatedPlay: true,
      roomState: { visited: true, flags: { 'interaction:corpse': true } },
    })?.choices.map((choice) => choice.id)).toEqual(['inspect', 'search'])
  })

  it('maps only an equivalent completed take-item reward to legacy looted', () => {
    const container = object({
      id: 'cache',
      type: 'chest',
      position: [0, 0, 0],
      interaction: {
        key: 'E',
        prompt: 'Take',
        effect: { kind: 'take-item', item: { itemId: 'key', name: 'Key', quantity: 1 } },
      },
    })
    expect(deriveMeaningfulObjectView({
      object: container,
      generatedPlay: true,
      roomState: { visited: true, flags: { 'interaction:cache': true } },
    })?.state).toBe('looted')
  })

  it.each(['colon:id', 'slash/id', 'percent%id', 'space id', '雪'])(
    'uses collision-safe keys for %s',
    (id) => {
      expect(meaningfulObjectStateFlagKey(id, 'looted'))
        .toBe(`meaningful-object:${encodeURIComponent(id)}:looted`)
    },
  )

  it('fails closed for authored mode, unsupported objects, missing ids, and precedence interactions', () => {
    const eligible = object({
      id: 'book',
      type: 'book',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
    })
    const unsupported = object({
      id: 'table',
      type: 'table',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Inspect', effect: { kind: 'inspect' } },
    })
    const missing = object({
      type: 'book',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Read', effect: { kind: 'inspect' } },
    })
    const exit = object({
      id: 'map',
      type: 'map',
      position: [0, 0, 0],
      interaction: { key: 'E', prompt: 'Leave', effect: { kind: 'inspect' }, exit: { toRoomId: 'next' } },
    })
    expect(deriveMeaningfulObjectView({ object: eligible, generatedPlay: false })).toBeUndefined()
    expect(deriveMeaningfulObjectView({ object: unsupported, generatedPlay: true })).toBeUndefined()
    expect(deriveMeaningfulObjectView({ object: missing, generatedPlay: true })).toBeUndefined()
    expect(deriveMeaningfulObjectView({ object: exit, generatedPlay: true })).toBeUndefined()
  })
})
