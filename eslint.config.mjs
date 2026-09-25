import js from '@eslint/js'
import babelParser from '@babel/eslint-parser'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'

/**
 * Flat config, split by Electron process. The split exists for the globals set: main and
 * preload get node and no DOM, the renderer gets the browser and no node. A `document` in
 * main, or a `require` in the renderer, is then a lint error instead of a runtime surprise.
 *
 * The parser is Babel, not typescript-eslint: this project is on TypeScript 7 (the native
 * compiler) and typescript-eslint 8.x throws on import against it — every entry point, not
 * just the type-aware rules. See docs/decisions.md. Consequence: types are erased before the
 * rules see the code, so type-only imports look unused. `no-unused-vars` is therefore off
 * here; tsc covers it with noUnusedLocals/noUnusedParameters, which is type-aware and right.
 */

const babelOptions = {
  requireConfigFile: false,
  babelOptions: {
    babelrc: false,
    configFile: false,
    presets: [['@babel/preset-typescript', { isTSX: true, allExtensions: true }]],
  },
}

const tsFiles = ['**/*.ts', '**/*.tsx']

export default [
  { ignores: ['out/**', 'release/**', 'dist/**', 'node_modules/**', '.worktrees/**', 'src/renderer/src/env.d.ts'] },

  {
    files: tsFiles,
    languageOptions: {
      parser: babelParser,
      parserOptions: { ...babelOptions, ecmaVersion: 2022, sourceType: 'module' },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Babel erases type annotations, so every type-only import reads as unused here.
      // tsc's noUnusedLocals/noUnusedParameters already covers this, type-aware.
      'no-unused-vars': 'off',
      // same reason: identifiers in type position are not resolved by this parser, so the
      // rule reports every interface member. Undefined names are tsc's job anyway.
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-fallthrough': 'error',
      // Both fire on terminal-handling code where the pattern is deliberate: an \x1b in the
      // ANSI-stripping regex, and a combined emoji range in the title cleaner. Left visible
      // rather than switched off, so a rewrite of either regex still gets a second look.
      'no-control-regex': 'warn',
      'no-misleading-character-class': 'warn',
    },
  },

  // main + shared: node, no DOM. Nothing here forbids DOM globals by name — `no-undef` and
  // `no-restricted-globals` both resolve identifiers, and this parser does not erase type
  // positions, so `window: () => BrowserWindow` in an interface reads as a use of `window`.
  // The boundary for main is enforced by type instead: tsconfig.node.json has no DOM lib.
  {
    files: ['src/main/**/*.ts', 'src/shared/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },

  // preload straddles the fence on purpose: contextBridge needs the window it exposes onto
  {
    files: ['src/preload/**/*.ts'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // renderer: browser, no node
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ...babelOptions, ecmaFeatures: { jsx: true } },
    },
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['node:*'], message: 'The renderer has no node access. Add an IPC call in preload instead.' },
            {
              group: ['electron', 'electron/*'],
              message: 'The renderer reaches main only through window.api (preload).',
            },
          ],
          paths: ['fs', 'path', 'child_process', 'os', 'crypto'].map((name) => ({
            name,
            message: 'The renderer has no node access. Add an IPC call in preload instead.',
          })),
        },
      ],
    },
  },
  {
    files: ['src/renderer/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.flat['recommended-latest'].rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // The React Compiler rules that shipped in eslint-plugin-react-hooks 6/7 land on ~50
      // places in code written before they existed. They are worth fixing, but they are a
      // backlog, not a gate: as errors they would make the pre-commit hook and CI red on
      // day one, and a check that is always red stops being read. They stay reported.
      // Raise each back to 'error' as its file is cleaned up — see docs/open-questions.md.
      'react-hooks/refs': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/immutability': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/static-components': 'warn',
      'react-hooks/preserve-manual-memoization': 'warn',

      // these two are not style: they are the rules whose violation is a bug
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // tests: node, and vitest globals are imported explicitly rather than declared
  {
    files: ['tests/**/*.ts', 'src/**/__tests__/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
]
