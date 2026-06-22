import type { IdGenerator } from '../../domain/ports/IdGenerator'

export class UuidGenerator implements IdGenerator {
  newId(): string {
    return crypto.randomUUID()
  }
}
