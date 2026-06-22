import type { DatabaseSync } from 'node:sqlite'
import { up as up0001 } from './0001_init'

/** A forward-only numbered migration. SQL lives only in `up`. */
export interface Migration {
  version: number
  name: string
  up(db: DatabaseSync): void
}

/** Ordered list of migrations applied by `runMigrations` (db.ts). */
export const migrations: readonly Migration[] = [
  { version: 1, name: 'init', up: up0001 },
]
