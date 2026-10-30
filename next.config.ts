import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // LAN clients reach the dev server through the host's IP address.
  allowedDevOrigins: ['*.local', '10.*', '172.*', '192.168.*'],
  webpack(config, { isServer }) {
    if (!isServer) {
      // Server-only modules must never end up in the browser bundle.
      config.resolve.alias = { ...config.resolve.alias, '@prisma/client': false, ws: false };
    }
    return config;
  },
};

export default nextConfig;
