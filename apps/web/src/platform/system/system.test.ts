import { describe, expect, it } from 'vitest'
import { UtcIsoDateTimeSchema, UuidSchema } from '../../domain/world/worldState'
import { SystemClock } from './clock'
import { UuidGenerator } from './idGenerator'

describe('system clock and id adapters', () => {
  it('satisfies the domain UTC and UUID formats', () => {
    expect(UtcIsoDateTimeSchema.safeParse(new SystemClock().now()).success).toBe(true)
    expect(UuidSchema.safeParse(new UuidGenerator().newId()).success).toBe(true)
  })
})
