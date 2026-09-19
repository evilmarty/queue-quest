import { defineConfig } from 'vite'

// GitHub Pages serves project sites from /<repo>/, so assets need that prefix.
// The workflow sets GITHUB_PAGES_BASE; local builds keep the root base so
// `vite dev` and `vite preview` continue to work unchanged.
export default defineConfig({
  base: process.env.GITHUB_PAGES_BASE ?? '/',
})
