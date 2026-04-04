import type { NextConfig } from "next";

// Parent `@engine` modules validate Supabase env at import time. CI / local `next build`
// without .env still needs these placeholders; Vercel/runtime must set real values.
if (!process.env.SUPABASE_URL?.trim()) {
  process.env.SUPABASE_URL = "https://placeholder.supabase.local";
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
  process.env.SUPABASE_SERVICE_ROLE_KEY = "placeholder-service-role";
}

const nextConfig: NextConfig = {
  experimental: {
    externalDir: true,
  },
};

export default nextConfig;
