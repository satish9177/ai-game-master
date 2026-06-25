import { describe, expect, it } from 'vitest'
import { repairGeneratedObjectTransforms } from './generatedRoomObjectTransforms'

function envelope(objects: unknown[]): Record<string, unknown> {
  return {
    schemaVersion: 1,
    id: 'test',
    name: 'Test',
    shell: { dimensions: { width: 18, depth: 18, height: 4 } },
    spawn: { position: [0, 1.7, 0] },
    objects,
  }
}

function entry(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'book',
    position: [1, 0, 1],
    color: '#aabbcc',
    interaction: { key: 'E', prompt: 'Inspect' },
    size: [0.7, 0.14, 0.5],
    ...extras,
  }
}

function objectsOf(value: unknown): unknown[] {
  return (value as Record<string, unknown>)['objects'] as unknown[]
}

describe('repairGeneratedObjectTransforms', () => {
  it.each([
    '45deg',
    null,
    true,
    { degrees: 45 },
    [45],
    NaN,
    Infinity,
    -Infinity,
  ])('removes malformed rotationY value: %s', (rotationY) => {
    const input = envelope([entry({ rotationY })])
    const { value, count } = repairGeneratedObjectTransforms(input)
    const repaired = objectsOf(value)[0] as Record<string, unknown>

    expect(count).toBe(1)
    expect(repaired).not.toBe((input['objects'] as unknown[])[0])
    expect('rotationY' in repaired).toBe(false)
  })

  it.each([
    'large',
    null,
    false,
    { value: 1 },
    [1],
    NaN,
    Infinity,
    -Infinity,
    0,
    -1,
  ])('removes malformed scale value: %s', (scale) => {
    const input = envelope([entry({ scale })])
    const { value, count } = repairGeneratedObjectTransforms(input)
    const repaired = objectsOf(value)[0] as Record<string, unknown>

    expect(count).toBe(1)
    expect(repaired).not.toBe((input['objects'] as unknown[])[0])
    expect('scale' in repaired).toBe(false)
  })

  it.each([0, -90, 720])('preserves valid rotationY value: %s', (rotationY) => {
    const input = envelope([entry({ rotationY })])
    const { value, count } = repairGeneratedObjectTransforms(input)

    expect(value).toBe(input)
    expect(count).toBe(0)
    expect(((input['objects'] as Record<string, unknown>[])[0]!)['rotationY']).toBe(rotationY)
  })

  it.each([0.5, 1, 2])('preserves valid scale value: %s', (scale) => {
    const input = envelope([entry({ scale })])
    const { value, count } = repairGeneratedObjectTransforms(input)

    expect(value).toBe(input)
    expect(count).toBe(0)
    expect(((input['objects'] as Record<string, unknown>[])[0]!)['scale']).toBe(scale)
  })

  it('absent transform fields return unchanged with count 0', () => {
    const input = envelope([entry()])
    const { value, count } = repairGeneratedObjectTransforms(input)

    expect(value).toBe(input)
    expect(count).toBe(0)
  })

  it('does not touch position, interaction, type, color, dimensions, or other fields', () => {
    const original = entry({
      type: 'machine',
      position: [3, 0, -2],
      interaction: { key: 'E', prompt: 'Inspect machine', body: 'Validated body.' },
      color: '#112233',
      size: [1.6, 1.2, 1],
      custom: { keep: true },
      rotationY: 'bad',
      scale: 'bad',
    })
    const { value, count } = repairGeneratedObjectTransforms(envelope([original]))
    const repaired = objectsOf(value)[0] as Record<string, unknown>

    expect(count).toBe(1)
    expect(repaired['type']).toBe(original['type'])
    expect(repaired['position']).toBe(original['position'])
    expect(repaired['interaction']).toBe(original['interaction'])
    expect(repaired['color']).toBe(original['color'])
    expect(repaired['size']).toBe(original['size'])
    expect(repaired['custom']).toBe(original['custom'])
    expect('rotationY' in repaired).toBe(false)
    expect('scale' in repaired).toBe(false)
  })

  it('does not mutate input envelope, objects array, or entries', () => {
    const object = entry({ rotationY: 'bad', scale: 'bad' })
    const input = envelope([object])
    const before = JSON.parse(JSON.stringify(input))

    repairGeneratedObjectTransforms(input)

    expect(input).toEqual(before)
    expect((input['objects'] as unknown[])[0]).toBe(object)
    expect(object['rotationY']).toBe('bad')
    expect(object['scale']).toBe('bad')
  })

  it.each([
    null,
    'not an object',
    42,
    [{ type: 'book', rotationY: 'bad' }],
  ])('non-object top-level input returns unchanged and count 0: %s', (input) => {
    const { value, count } = repairGeneratedObjectTransforms(input)
    expect(value).toBe(input)
    expect(count).toBe(0)
  })

  it.each([
    { schemaVersion: 1 },
    { schemaVersion: 1, objects: null },
    { schemaVersion: 1, objects: 'not an array' },
  ])('missing or non-array objects returns unchanged and count 0', (input) => {
    const { value, count } = repairGeneratedObjectTransforms(input)
    expect(value).toBe(input)
    expect(count).toBe(0)
  })

  it('non-object entries do not throw and count 0', () => {
    const input = envelope([null, 42, 'x', ['array']])
    const { value, count } = repairGeneratedObjectTransforms(input)

    expect(value).toBe(input)
    expect(count).toBe(0)
  })

  it('multiple objects aggregate count per repaired object', () => {
    const first = entry({ rotationY: 'bad' })
    const second = entry({ scale: 0 })
    const third = entry({ rotationY: 45, scale: 1 })
    const input = envelope([first, second, third])
    const { value, count } = repairGeneratedObjectTransforms(input)
    const objects = objectsOf(value)

    expect(count).toBe(2)
    expect(objects[0]).not.toBe(first)
    expect(objects[1]).not.toBe(second)
    expect(objects[2]).toBe(third)
  })

  it('one object with both bad rotationY and bad scale counts once', () => {
    const input = envelope([entry({ rotationY: 'bad', scale: 0 })])
    const { value, count } = repairGeneratedObjectTransforms(input)
    const repaired = objectsOf(value)[0] as Record<string, unknown>

    expect(count).toBe(1)
    expect('rotationY' in repaired).toBe(false)
    expect('scale' in repaired).toBe(false)
  })

  it('untouched sibling entries retain identity where practical', () => {
    const changed = entry({ rotationY: 'bad' })
    const untouched = entry({ type: 'pillar', rotationY: 0, scale: 1 })
    const input = envelope([changed, untouched])
    const { value } = repairGeneratedObjectTransforms(input)
    const objects = objectsOf(value)

    expect(objects[0]).not.toBe(changed)
    expect(objects[1]).toBe(untouched)
  })
})
