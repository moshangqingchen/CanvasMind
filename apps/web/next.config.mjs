/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  transpilePackages: [
    "@super-canvas/core",
    "@super-canvas/db",
    "@super-canvas/providers",
    "@super-canvas/runtime",
    "@super-canvas/storage",
  ],
  typedRoutes: false,
  ...(process.env.API_PROXY_BASE_URL
    ? {
        async rewrites() {
          const baseUrl = new URL(process.env.API_PROXY_BASE_URL);
          if (baseUrl.protocol !== "http:" && baseUrl.protocol !== "https:") {
            throw new Error("API_PROXY_BASE_URL must use http or https");
          }
          return {
            beforeFiles: [
              {
                source: "/api/:path*",
                destination: `${baseUrl.href.replace(/\/$/u, "")}/api/:path*`,
              },
            ],
          };
        },
      }
    : {}),
};

export default nextConfig;
