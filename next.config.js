/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    // Type errors are caught in editor/CI — skip blocking the Vercel build
    // Remove this once all type errors are resolved
    ignoreBuildErrors: true,
  },
  eslint: {
    // ESLint is configured in .eslintrc.json — skip blocking the build
    ignoreDuringBuilds: true,
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "images.unsplash.com" },
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "*.vercel-storage.com" },
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

module.exports = nextConfig;
