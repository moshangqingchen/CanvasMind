import rootPackage from "../../package.json" with { type: "json" };
const applicationVersion =
  process.env.NEXT_PUBLIC_APP_VERSION || rootPackage.version || "0.1.0";

/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Turbopack production chunk names can stay stable across local live builds.
  // Attach the source fingerprint so browsers never keep executing a previous
  // deployment's immutable JavaScript after the manager switches slots.
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || undefined,
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  experimental: {
    // Proxy buffers request bodies before route handlers. Keep this aligned
    // with MAX_PROXY_UPLOAD_BYTES so large local image/video uploads are not
    // silently truncated at Next.js's 10 MB default.
    proxyClientMaxBodySize: "500mb",
  },
  transpilePackages: [
    "@super-canvas/core",
    "@super-canvas/db",
    "@super-canvas/providers",
    "@super-canvas/runtime",
    "@super-canvas/storage",
  ],
  typedRoutes: false,
  env: {
    NEXT_PUBLIC_APP_VERSION: applicationVersion,
  },
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
