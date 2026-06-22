import type { Clock } from '../../domain/ports/Clock'

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString()
  }
}
