import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge would otherwise float inside the simulated phone and the embedded App Clip.
  devIndicators: false,
  // Prompt and mock-inbox files are read with fs at runtime; make sure the
  // serverless bundles on Vercel carry them.
  outputFileTracingIncludes: {
    "/api/**": ["./prompts/**", "./data/**"],
    "/summary/**": ["./prompts/**"],
  },
  // Apple fetches the App Clip association file at this exact path; a dot-folder route
  // breaks Next's type generation, so it lives at /api/aasa and is rewritten here.
  async rewrites() {
    return [{ source: "/.well-known/apple-app-site-association", destination: "/api/aasa" }];
  },
};

export default nextConfig;
