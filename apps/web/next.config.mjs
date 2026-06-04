/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  // Hide the dev-mode build-activity indicator (the small spinning logo in the
  // corner during `next dev`). Cosmetic; never rendered in production anyway.
  devIndicators: false,
  transpilePackages: ['@eventpulse/shared-types', '@eventpulse/shared-utils'],
  // ESM-typed workspace packages (`"type": "module"`) use `.js`
  // extensions in their relative imports per TS5+ NodeNext convention,
  // but the source files are `.ts`. Webpack's default ESM resolver
  // looks for the literal `.js` file and fails. `extensionAlias` tells
  // it to try `.ts` / `.tsx` when a `.js` import doesn't exist on disk.
  // Required as of Sprint 2 Day 16 PR 3 when the shared-types index
  // started re-exporting from frontend-consumed sibling files.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    }
    return config
  },
}

export default nextConfig
