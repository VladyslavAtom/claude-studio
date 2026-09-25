import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

/**
 * Aliases are declared here and in tsconfig.base.json's `paths`. Both are needed: the
 * tsconfig teaches the typechecker, this teaches the bundler. Declaring one without the
 * other gives a build that resolves what tsc rejects, or the reverse.
 *
 * `@renderer` is deliberately absent from the main and preload blocks — those processes
 * have no business importing renderer code, and a missing alias says so at build time.
 */
const shared = { '@shared': resolve(__dirname, 'src/shared') }
const nodeAlias = { ...shared, '@main': resolve(__dirname, 'src/main') }
const webAlias = { ...shared, '@renderer': resolve(__dirname, 'src/renderer/src') }

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: nodeAlias },
    build: { rollupOptions: { input: resolve(__dirname, 'src/main/index.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: nodeAlias },
    build: { rollupOptions: { input: resolve(__dirname, 'src/preload/index.ts') } },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    resolve: { alias: webAlias },
    build: { rollupOptions: { input: resolve(__dirname, 'src/renderer/index.html') } },
    plugins: [react()],
  },
})
