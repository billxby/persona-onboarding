import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Prompt and mock-inbox files are read with fs at runtime; make sure the
  // serverless bundles on Vercel carry them.
  outputFileTracingIncludes: {
    "/api/**": ["./prompts/**", "./data/**"],
    "/summary/**": ["./prompts/**"],
  },
};

export default nextConfig;
