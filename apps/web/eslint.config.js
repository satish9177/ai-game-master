import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Architecture boundaries are documented in docs/architecture/BOUNDARIES.md and
// the ADRs. The rules below make the most important ones mechanical. The
// generation, world-session, and interactions boundaries are encoded now that
// those folders exist. Real persistence/backend boundaries remain deferred.
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

  // Boundary: renderer/engine must not import React (ADR-0002).
  {
    files: ['src/renderer/engine/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'renderer/engine must not import React — the engine is framework-independent (ADR-0002).' },
            { name: 'react-dom', message: 'renderer/engine must not import React — the engine is framework-independent (ADR-0002).' },
          ],
          patterns: [
            { group: ['**/world-session/**'], message: 'renderer/engine emits intent and must not import world-session (ADR-0014).' },
            { group: ['**/interactions/**'], message: 'renderer/engine emits intent and must not import interaction application/domain internals (ADR-0014).' },
            { group: ['**/encounters/**'], message: 'renderer/engine emits intent and must not import encounter application/domain internals (ADR-0015).' },
            { group: ['**/dialogue/**'], message: 'renderer/engine emits intent and must not import dialogue application/domain internals (ADR-0017).' },
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
          ],
          patterns: [
            { group: ['three/*'], message: 'renderer/ui must not import Three.js (ADR-0002).' },
            { group: ['**/engine/**'], message: 'renderer/ui must not import engine internals; import shared view-model types from domain (ADR-0002, BOUNDARIES.md).' },
          ],
        },
      ],
    },
  },

  // Boundary: domain must stay the pure, dependency-light contract. It must not
  // import React, Three.js, the renderer, UI, or the platform logger. Future
  // backend/DB/generation imports are also forbidden but not glob-enforced until
  // those folders exist (BOUNDARIES.md, ADR-0005).
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
          ],
          patterns: [
            { group: ['three/*'], message: 'domain must not import Three.js (BOUNDARIES.md).' },
            { group: ['**/renderer/**'], message: 'domain must not import renderer or UI (BOUNDARIES.md).' },
            { group: ['**/platform/**'], message: 'domain must not import the platform logger or other adapters; it returns problems as data (ADR-0003, BOUNDARIES.md).' },
          ],
        },
      ],
    },
  },

  // Boundary: generation turns a prompt into RoomSpec *data* (ADR-0001, ADR-0007).
  // It may depend on the domain (schema, ports, loadRoomSpec) but must stay free
  // of React, Three.js, the renderer/UI, and platform adapters — it never renders
  // and never logs directly (the caller logs; ADR-0003). no-console stays enforced
  // by the global rule above: generation is deliberately NOT exempted.
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
          ],
          patterns: [
            { group: ['three/*'], message: 'generation must not import Three.js (ADR-0001, BOUNDARIES.md).' },
            { group: ['**/renderer/**'], message: 'generation must not import the renderer or UI; its output is validated at the loadRoomSpec boundary (BOUNDARIES.md).' },
            { group: ['**/platform/**'], message: 'generation must not import platform adapters such as the logger; it returns data and the caller logs (ADR-0003, BOUNDARIES.md).' },
          ],
        },
      ],
    },
  },

  // Boundary: world-session is the headless application layer for authoritative
  // gameplay truth (ADR-0013). It may use domain contracts/ports and the Logger
  // interface, but it must not reach into React, Three.js, or renderer internals.
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
          ],
          patterns: [
            { group: ['three/*'], message: 'world-session must not import Three.js (ADR-0013).' },
            { group: ['**/renderer/**'], message: 'world-session must not import renderer or UI internals (ADR-0013, BOUNDARIES.md).' },
          ],
        },
      ],
    },
  },

  // Boundary: interactions resolves pure effect plans through WorldSession. It
  // is headless application code and must not reach into React or the renderer.
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
          ],
          patterns: [
            { group: ['three/*'], message: 'interactions must not import Three.js (ADR-0014).' },
            { group: ['**/renderer/**'], message: 'interactions must not import renderer or UI internals (ADR-0014, BOUNDARIES.md).' },
          ],
        },
      ],
    },
  },

  // Boundary: encounters resolves pure encounter plans through WorldSession
  // (ADR-0015), mirroring the interactions block. Headless application code: it
  // may use domain contracts, world-session, and the Logger interface, but must
  // not reach into React or the renderer.
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
          ],
          patterns: [
            { group: ['three/*'], message: 'encounters must not import Three.js (ADR-0015).' },
            { group: ['**/renderer/**'], message: 'encounters must not import renderer or UI internals (ADR-0015, BOUNDARIES.md).' },
          ],
        },
      ],
    },
  },

  // Boundary: dialogue reads WorldSession context and calls a provider port
  // (ADR-0017). It is headless and must not reach into React or the renderer.
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
          ],
          patterns: [
            { group: ['three/*'], message: 'dialogue must not import Three.js (ADR-0017).' },
            { group: ['**/renderer/**'], message: 'dialogue must not import renderer or UI internals (ADR-0017, BOUNDARIES.md).' },
          ],
        },
      ],
    },
  },
])
