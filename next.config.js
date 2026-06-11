/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "picsum.photos" },
      { protocol: "https", hostname: "images.unsplash.com" },
      // Vercel Blob URLs
      { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
      { protocol: "https", hostname: "*.vercel-storage.com" },
    ],
  },

  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },

  // Sharp uses native binaries — tell webpack not to bundle it
  webpack: (config, { isServer }) => {
    if (isServer) {
      const externals = Array.isArray(config.externals) ? config.externals : [];
      config.externals = [...externals, "sharp"];
    }
    return config;
  },
};

module.exports = nextConfig;
