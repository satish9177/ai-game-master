import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Architecture boundaries are documented in docs/architecture/BOUNDARIES.md and
// the ADRs. The rules below make the most important ones mechanical. Persistence/
// backend/generation boundaries are intentionally NOT encoded yet — those folders
// don't exist, so enforcing them now would be speculative (see BOUNDARIES.md).
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
        },
      ],
    },
  },

  // Boundary: renderer/ui must not import Three.js (ADR-0002). UI is
  // presentational and talks to the engine only via the host interface.
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
          ],
        },
      ],
    },
  },

  // Boundary: domain (roomspec) must not import React, Three.js, the renderer,
  // or UI. It is the pure, dependency-light contract (BOUNDARIES.md, ADR-0005).
  {
    files: ['src/roomspec/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'react', message: 'domain (roomspec) must not import React (BOUNDARIES.md).' },
            { name: 'react-dom', message: 'domain (roomspec) must not import React (BOUNDARIES.md).' },
            { name: 'three', message: 'domain (roomspec) must not import Three.js (BOUNDARIES.md).' },
          ],
          patterns: [
            { group: ['three/*'], message: 'domain (roomspec) must not import Three.js (BOUNDARIES.md).' },
            { group: ['**/renderer/**'], message: 'domain (roomspec) must not import renderer or UI (BOUNDARIES.md).' },
          ],
        },
      ],
    },
  },
])
