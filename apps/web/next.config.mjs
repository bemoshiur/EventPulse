/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  typedRoutes: true,
  transpilePackages: ['@eventpulse/shared-types', '@eventpulse/shared-utils'],
}

export default nextConfig
