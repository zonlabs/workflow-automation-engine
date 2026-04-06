import type { NextConfig } from "next";
import path from "node:path";

// Parent `@engine` modules validate Supabase env at import time. CI / local `next build`
// without .env still needs these placeholders; Vercel/runtime must set real values.
if (!process.env.SUPABASE_URL?.trim()) {
  process.env.SUPABASE_URL = "https://placeholder.supabase.local";
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "placeholder-service-role";
}

const nextConfig: NextConfig = {
  // Bundling the MCP SDK (Zod schemas, JSON-RPC types) breaks at runtime in dev/prod
  // ("Cannot read properties of undefined (reading 'code')"). Load it from node_modules.
  serverExternalPackages: [
    "@modelcontextprotocol/sdk",
    "@modelcontextprotocol/ext-apps",
    "ajv",
    "ajv-formats",
  ],
  experimental: {
    externalDir: true,
  },
  // Code under `../` (e.g. `src/lib/ai/provider-registry.ts`) resolves `node_modules` from the
  // engine tree first. On Vercel only `workflow-mcp-web/node_modules` is installed — prefer it.
  webpack: (config) => {
    const localModules = path.join(process.cwd(), "node_modules");
    const existing = config.resolve.modules;
    config.resolve.modules = [
      localModules,
      ...(Array.isArray(existing) ? existing : ["node_modules"]),
    ];
    return config;
  },
};

export default nextConfig;
