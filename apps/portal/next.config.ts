import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages export raw TypeScript.
  transpilePackages: ["@bill-fighter/db", "@bill-fighter/shared"],
  serverExternalPackages: ["pg"],
};

export default config;
