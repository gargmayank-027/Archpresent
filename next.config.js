/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow serving images from picsum.photos placeholder (moodboard stubs)
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
    ],
  },

  // Increase the body size limit for file uploads (default is 4MB)
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

module.exports = nextConfig;
