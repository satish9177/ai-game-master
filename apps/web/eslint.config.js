import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Architecture boundaries are documented in docs/architecture/BOUNDARIES.md and
// the ADRs. The rules below make the most important ones mechanical. The
// generation, world-session, interactions, encounters, dialogue, and now the
// node-only persistence boundaries are encoded as those folders exist.

// Reciprocal persistence ban (ADR-0018, ADR-0004): server-side SQLite must never
// enter the browser bundle. These two restrictions are shared by every
// non-persistence boundary block so flat-config last-match-wins never drops a
// folder's existing restriction. The browser/composition surface must not import
// node:sqlite or any persistence module.
const noSqliteImport = {
  name: 'node:sqlite',
  message: 'SQLite is server-side only; the browser bundle must never import it (AGENTS rule 6, ADR-0004, ADR-0018).',
}
const noPersistenceImport = {
  group: ['**/persistence/**'],
  message: 'UI/renderer/app/domain code must not import persistence; data access is server-side behind ports (ADR-0004, ADR-0018).',
}
// Reciprocal browser → server ban (ADR-0019): the Node-only HTTP edge must never
// enter the browser bundle. Shared by every non-server, non-persistence boundary
// block so flat-config last-match-wins never drops a folder's restriction. The
// server is reached over HTTP (fetch) only, never by importing its code.
const noServerImport = {
  group: ['**/server/**'],
  message: 'The HTTP API is Node-only; reach it over HTTP, never by importing src/server (ADR-0019).',
}
const noHttpImport = {
  name: 'node:http',
  message: 'node:http is server-side only; the browser bundle must never import it (ADR-0019).',
}

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // All logging must go through the Logger abstraction (ADR-0003). console.*
      // is allowed only in the browser logger adapter (override below).
      'no-console': 'error',
    },
  },

  // The browser console adapter is the single approved place to call console.*
  // (ADR-0003). Everywhere else logs through the Logger interface.
  {
    files: ['src/platform/logger/consoleLogger.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Boundary: renderer/engine must not import React (ADR-0002) or persistence.
  {
    files: ['src/renderer/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'renderer/engine must not import React — the engine is framework-independent (ADR-0002).' },
            { name: 'react-dom', message: 'renderer/engine must not import React — the engine is framework-independent (ADR-0002).' },
            noSqliteImport,
            noHttpImport,
          ],
          patterns: [
            { group: ['**/world-session/**'], message: 'renderer/engine emits intent and must not import world-session (ADR-0014).' },
            { group: ['**/interactions/**'], message: 'renderer/engine emits intent and must not import interaction application/domain internals (ADR-0014).' },
            { group: ['**/encounters/**'], message: 'renderer/engine emits intent and must not import encounter application/domain internals (ADR-0015).' },
            { group: ['**/dialogue/**'], message: 'renderer/engine emits intent and must not import dialogue application/domain internals (ADR-0017).' },
            { group: ['**/memory/**'], message: 'renderer/engine emits intent and must not import the NPC memory layer (npc-memory-persistence-v0).' },
            noPersistenceImport,
            noServerImport,
          ],
        },
      ],
    },
  },

  // Boundary: renderer/ui must not import Three.js or engine internals
  // (ADR-0002). UI is presentational; it talks to the engine only via the host
  // interface and imports shared view-model types from the neutral domain module.
  {
    files: ['src/renderer/ui/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'three', message: 'renderer/ui must not import Three.js — use the engine host interface (ADR-0002).' },
            noSqliteImport,
            noHttpImport,
          ],
          patterns: [
            { group: ['three/*'], message: 'renderer/ui must not import Three.js (ADR-0002).' },
            { group: ['**/engine/**'], message: 'renderer/ui must not import engine internals; import shared view-model types from domain (ADR-0002, BOUNDARIES.md).' },
            noPersistenceImport,
            noServerImport,
          ],
        },
      ],
    },
  },

  // Boundary: domain must stay the pure, dependency-light contract. It must not
  // import React, Three.js, the renderer, UI, the platform logger, or persistence.
  // Future backend/DB/generation imports are also forbidden but not glob-enforced
  // until those folders exist (BOUNDARIES.md, ADR-0005).
  {
    files: ['src/domain/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'domain must not import React (BOUNDARIES.md).' },
            { name: 'react-dom', message: 'domain must not import React (BOUNDARIES.md).' },
            { name: 'three', message: 'domain must not import Three.js (BOUNDARIES.md).' },
            noSqliteImport,
            noHttpImport,
          ],
          patterns: [
            { group: ['three/*'], message: 'domain must not import Three.js (BOUNDARIES.md).' },
            { group: ['**/renderer/**'], message: 'domain must not import renderer or UI (BOUNDARIES.md).' },
            { group: ['**/platform/**'], message: 'domain must not import the platform logger or other adapters; it returns problems as data (ADR-0003, BOUNDARIES.md).' },
            noPersistenceImport,
            noServerImport,
          ],
        },
      ],
    },
  },

  // Boundary: generation turns a prompt into RoomSpec *data* (ADR-0001, ADR-0007).
  // It may depend on the domain (schema, ports, loadRoomSpec) but must stay free
  // of React, Three.js, the renderer/UI, platform adapters, and persistence — it
  // never renders and never logs directly (the caller logs; ADR-0003). no-console
  // stays enforced by the global rule above: generation is deliberately NOT exempted.
  {
    files: ['src/generation/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'generation must not import React — it emits RoomSpec data, not UI (BOUNDARIES.md).' },
            { name: 'react-dom', message: 'generation must not import React — it emits RoomSpec data, not UI (BOUNDARIES.md).' },
            { name: 'three', message: 'generation must not import Three.js — it emits data, never renders (ADR-0001, BOUNDARIES.md).' },
            noSqliteImport,
            noHttpImport,
          ],
          patterns: [
            { group: ['three/*'], message: 'generation must not import Three.js (ADR-0001, BOUNDARIES.md).' },
            { group: ['**/renderer/**'], message: 'generation must not import the renderer or UI; its output is validated at the loadRoomSpec boundary (BOUNDARIES.md).' },
            { group: ['**/platform/**'], message: 'generation must not import platform adapters such as the logger; it returns data and the caller logs (ADR-0003, BOUNDARIES.md).' },
            noPersistenceImport,
            noServerImport,
          ],
        },
      ],
    },
  },

  // Boundary: world-session is the headless application layer for authoritative
  // gameplay truth (ADR-0013). It may use domain contracts/ports and the Logger
  // interface, but it must not reach into React, Three.js, renderer internals, or
  // persistence (the SQLite adapter implements its WorldStore port, not vice versa).
  {
    files: ['src/world-session/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'world-session is headless and must not import React (ADR-0013, BOUNDARIES.md).' },
            { name: 'react-dom', message: 'world-session is headless and must not import React (ADR-0013, BOUNDARIES.md).' },
            { name: 'three', message: 'world-session holds neutral world data and must not import Three.js (ADR-0013).' },
            noSqliteImport,
            noHttpImport,
          ],
          patterns: [
            { group: ['three/*'], message: 'world-session must not import Three.js (ADR-0013).' },
            { group: ['**/renderer/**'], message: 'world-session must not import renderer or UI internals (ADR-0013, BOUNDARIES.md).' },
            noPersistenceImport,
            noServerImport,
          ],
        },
      ],
    },
  },

  // Boundary: interactions resolves pure effect plans through WorldSession. It
  // is headless application code and must not reach into React, the renderer, or
  // persistence.
  {
    files: ['src/interactions/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'interactions is headless and must not import React (ADR-0014).' },
            { name: 'react-dom', message: 'interactions is headless and must not import React (ADR-0014).' },
            { name: 'three', message: 'interactions holds neutral data and must not import Three.js (ADR-0014).' },
            noSqliteImport,
            noHttpImport,
          ],
          patterns: [
            { group: ['three/*'], message: 'interactions must not import Three.js (ADR-0014).' },
            { group: ['**/renderer/**'], message: 'interactions must not import renderer or UI internals (ADR-0014, BOUNDARIES.md).' },
            noPersistenceImport,
            noServerImport,
          ],
        },
      ],
    },
  },

  // Boundary: encounters resolves pure encounter plans through WorldSession
  // (ADR-0015), mirroring the interactions block. Headless application code: it
  // may use domain contracts, world-session, and the Logger interface, but must
  // not reach into React, the renderer, or persistence.
  {
    files: ['src/encounters/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'encounters is headless and must not import React (ADR-0015).' },
            { name: 'react-dom', message: 'encounters is headless and must not import React (ADR-0015).' },
            { name: 'three', message: 'encounters holds neutral data and must not import Three.js (ADR-0015).' },
            noSqliteImport,
            noHttpImport,
          ],
          patterns: [
            { group: ['three/*'], message: 'encounters must not import Three.js (ADR-0015).' },
            { group: ['**/renderer/**'], message: 'encounters must not import renderer or UI internals (ADR-0015, BOUNDARIES.md).' },
            noPersistenceImport,
            noServerImport,
          ],
        },
      ],
    },
  },

  // Boundary: dialogue reads WorldSession context and calls a provider port
  // (ADR-0017). It is headless and must not reach into React, the renderer, or
  // persistence.
  {
    files: ['src/dialogue/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'dialogue is headless and must not import React (ADR-0017).' },
            { name: 'react-dom', message: 'dialogue is headless and must not import React (ADR-0017).' },
            { name: 'three', message: 'dialogue holds neutral data and must not import Three.js (ADR-0017).' },
            noSqliteImport,
            noHttpImport,
          ],
          patterns: [
            { group: ['three/*'], message: 'dialogue must not import Three.js (ADR-0017).' },
            { group: ['**/renderer/**'], message: 'dialogue must not import renderer or UI internals (ADR-0017, BOUNDARIES.md).' },
            noPersistenceImport,
            noServerImport,
          ],
        },
      ],
    },
  },

  // Boundary: the headless NPC memory layer (npc-memory-persistence-v0,
  // memory-firewall-v0). Mirrors the dialogue block but STRICTER — it also
  // forbids importing world-session (and the other gameplay-truth application
  // layers), the lint-level enforcement of "memory has no path to truth". It may
  // import pure domain contracts/ports (incl. domain/memory) and the Logger
  // interface, but never React, Three.js, the renderer, or any write-path layer.
  {
    files: ['src/memory/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'memory is headless and must not import React (npc-memory-persistence-v0).' },
            { name: 'react-dom', message: 'memory is headless and must not import React (npc-memory-persistence-v0).' },
            { name: 'three', message: 'memory holds neutral data and must not import Three.js (npc-memory-persistence-v0).' },
            noSqliteImport,
            noHttpImport,
          ],
          patterns: [
            { group: ['three/*'], message: 'memory must not import Three.js (npc-memory-persistence-v0).' },
            { group: ['**/renderer/**'], message: 'memory must not import renderer or UI internals (npc-memory-persistence-v0).' },
            { group: ['**/world-session/**'], message: 'memory has no path to truth: it must not import world-session (memory-firewall-v0).' },
            { group: ['**/interactions/**'], message: 'memory must not import interaction write-path internals (memory-firewall-v0).' },
            { group: ['**/encounters/**'], message: 'memory must not import encounter write-path internals (memory-firewall-v0).' },
            { group: ['**/dialogue/**'], message: 'memory must not import dialogue application internals (memory-firewall-v0).' },
            noPersistenceImport,
            noServerImport,
          ],
        },
      ],
    },
  },

  // Boundary (reciprocal browser → persistence ban, ADR-0018, ADR-0004): the
  // composition root and any other non-persistence source file not covered by a
  // boundary block above (App.tsx, RoomViewer.tsx, app/**, room/**, platform/**,
  // main.tsx) must not import node:sqlite or any persistence module either. The
  // foldered blocks above are ignored here so their richer restrictions are not
  // clobbered (flat-config last-match-wins).
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/persistence/**',
      'src/server/**',
      'src/renderer/engine/**',
      'src/renderer/ui/**',
      'src/domain/**',
      'src/generation/**',
      'src/world-session/**',
      'src/interactions/**',
      'src/encounters/**',
      'src/dialogue/**',
      'src/memory/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [noSqliteImport, noHttpImport],
          patterns: [noPersistenceImport, noServerImport],
        },
      ],
    },
  },

  // Boundary (persistence-self wall, ADR-0018): persistence is headless Node
  // code. It may import only pure domain contracts and the Logger types; it must
  // not import React, Three.js, the renderer/UI, or any application layer.
  {
    files: ['src/persistence/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'persistence is headless Node code and must not import React (ADR-0018).' },
            { name: 'react-dom', message: 'persistence is headless Node code and must not import React (ADR-0018).' },
            { name: 'three', message: 'persistence holds neutral JSON and must not import Three.js (ADR-0008, ADR-0018).' },
          ],
          patterns: [
            { group: ['three/*'], message: 'persistence must not import Three.js (ADR-0018).' },
            { group: ['**/renderer/**'], message: 'persistence must not import the renderer or UI (ADR-0018).' },
            { group: ['**/generation/**', '**/world-session/**', '**/interactions/**', '**/encounters/**', '**/dialogue/**', '**/room/**', '**/app/**', '**/server/**'], message: 'persistence may import only pure domain contracts and logger types (ADR-0004, ADR-0018, ADR-0019).' },
            // Persistence may implement the NpcMemoryStore port over pure domain
            // contracts (src/domain/memory) but must not import the headless memory
            // application layer (src/memory) — the negation re-includes domain/memory.
            { group: ['**/memory/**', '!**/domain/memory/**'], message: 'persistence must not import the headless memory application layer; implement the NpcMemoryStore port over pure domain contracts only (npc-memory-persistence-v0).' },
          ],
        },
      ],
    },
  },

  // Boundary (server-self wall, ADR-0019): the HTTP API edge is a Node-only
  // composition layer over the existing stores. It may import the domain, the
  // persistence adapters, world-session, and platform adapters (and node:http /
  // node:sqlite), but it must not import React, Three.js, or the renderer/UI —
  // it is reached from the browser over HTTP, never by importing browser code.
  {
    files: ['src/server/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'server is headless Node code and must not import React (ADR-0019).' },
            { name: 'react-dom', message: 'server is headless Node code and must not import React (ADR-0019).' },
            { name: 'three', message: 'server holds neutral data and must not import Three.js (ADR-0008, ADR-0019).' },
          ],
          patterns: [
            { group: ['three/*'], message: 'server must not import Three.js (ADR-0019).' },
            { group: ['**/renderer/**'], message: 'server must not import the renderer or UI; it is reached over HTTP (ADR-0019).' },
          ],
        },
      ],
    },
  },
])
