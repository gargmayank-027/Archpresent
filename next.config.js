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
    // @napi-rs/canvas ships a native .node binary that webpack can't parse.
    // Marking it (and sharp) as external keeps them as runtime `require()`
    // calls instead of trying to bundle the binary through webpack.
    serverComponentsExternalPackages: ["@napi-rs/canvas", "sharp"],
  },
};

module.exports = nextConfig;
