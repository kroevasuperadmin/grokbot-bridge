import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  outputFileTracingIncludes: {
    "/context": ["./context/**"],
    "/context/view": ["./context/**"],
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
