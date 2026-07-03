import type { DatabaseSync } from 'node:sqlite'
import { up as up0001 } from './0001_init'
import { up as up0002 } from './0002_npc_memories'
import { up as up0003 } from './0003_room_memories'
import { up as up0004 } from './0004_memory_dedupe_key'
import { up as up0005 } from './0005_memory_fts'

/** A forward-only numbered migration. SQL lives only in `up`. */
export interface Migration {
  version: number
  name: string
  up(db: DatabaseSync): void
}

/** Ordered list of migrations applied by `runMigrations` (db.ts). */
export const migrations: readonly Migration[] = [
  { version: 1, name: 'init', up: up0001 },
  { version: 2, name: 'npc_memories', up: up0002 },
  { version: 3, name: 'room_memories', up: up0003 },
  { version: 4, name: 'memory_dedupe_key', up: up0004 },
  { version: 5, name: 'memory_fts', up: up0005 },
]
