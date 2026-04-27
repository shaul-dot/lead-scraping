import type { NextConfig } from 'next';

const isWindows = process.platform === 'win32';

const nextConfig: NextConfig = {
  // Next's standalone output uses symlinks during tracing which can fail on Windows
  // in non-admin / non-dev-mode environments (EPERM). Keep standalone by default
  // on non-Windows, and opt-in on Windows when symlinks are available.
  output: isWindows ? undefined : 'standalone',
  devIndicators: false,
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
};

export default nextConfig;
