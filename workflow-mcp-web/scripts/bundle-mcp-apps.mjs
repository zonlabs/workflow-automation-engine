import * as esbuild from "esbuild";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");

const bundles = [
  { entry: "dashboard.ts", out: "mcp-app-dashboard.iife.js" },
  { entry: "execution-chart.ts", out: "mcp-app-execution-chart.iife.js" },
];

for (const { entry, out } of bundles) {
  const outfile = join(root, "public", out);
  await esbuild.build({
    entryPoints: [join(root, "src", "mcp-app", entry)],
    bundle: true,
    format: "iife",
    platform: "browser",
    outfile,
    minify: true,
    logLevel: "info",
    define: {
      "process.env.NODE_ENV": JSON.stringify("production"),
    },
  });
  console.log("MCP app bundle:", outfile);
}
