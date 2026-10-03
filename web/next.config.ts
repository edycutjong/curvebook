import type { NextConfig } from "next";

const config: NextConfig = {
  transpilePackages: ["@curvebook/core"],
  // core is TS source with NodeNext-style ".js" specifiers that point at ".ts" files.
  webpack: (cfg) => {
    cfg.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return cfg;
  },
};

export default config;
