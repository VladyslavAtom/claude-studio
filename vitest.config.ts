import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

/**
 * Unit tests only: pure parsers and the state file. Nothing here starts Electron, spawns a
 * pty or touches a real repository — the machine is rationed and the app's own build and
 * smoke runs are the user's job.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/**/__tests__/**/*.test.ts'],
    // few workers on purpose: this runs next to the user's editor and their builds
    pool: 'threads',
    maxWorkers: 2,
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
})
