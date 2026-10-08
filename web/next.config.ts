import type { NextConfig } from "next";

const config: NextConfig = {
  // e2e and Lighthouse build into their own dir so they never clobber a running `next dev` (.next).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  transpilePackages: ["@curvebook/core"],
  // Landing page + pitch deck (copied from ../docs by scripts/copy-landing.mjs at build time).
  async rewrites() {
    return [
      { source: "/landing", destination: "/landing/index.html" },
      { source: "/pitch", destination: "/landing/pitch/index.html" },
    ];
  },
  // core is TS source with NodeNext-style ".js" specifiers that point at ".ts" files.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return cfg;
  },
};

export default config;
