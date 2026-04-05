import Image from "next/image";
import Link from "next/link";

const tools = [
  { name: "workflow_list", blurb: "Browse your workflows" },
  { name: "workflow_get", blurb: "Load full workflow detail" },
  { name: "workflow_upsert_script", blurb: "Create or update script workflows" },
  { name: "schedule_upsert", blurb: "Manage schedules" },
  { name: "workflow_run", blurb: "Enqueue a run" },
  { name: "execution_log_list", blurb: "Recent execution history" },
  { name: "execution_log_get", blurb: "Single execution details" },
] as const;

/** Same base as OAuth `resource` / `withMcpAuth` — see `WORKFLOW_MCP_RESOURCE_URL`. */
function publicMcpUrls() {
  const base = process.env.WORKFLOW_MCP_RESOURCE_URL?.trim().replace(/\/$/, "") ?? "";
  if (!base) {
    return {
      endpoint: "/api/mcp",
      resourceMetadata: "/api/mcp/.well-known/oauth-protected-resource",
      isAbsolute: false,
    };
  }
  return {
    endpoint: base,
    resourceMetadata: `${base}/.well-known/oauth-protected-resource`,
    isAbsolute: true,
  };
}

function EndpointRow({
  label,
  path,
  hint,
}: {
  label: string;
  path: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-4 py-3 shadow-sm backdrop-blur-sm">
      <span className="text-xs font-medium uppercase tracking-wider text-[var(--muted)]">
        {label}
      </span>
      <code className="font-mono text-sm text-[var(--logo-ink)] dark:text-[var(--logo-line)]">
        {path}
      </code>
      {hint ? <span className="text-xs text-[var(--muted)]">{hint}</span> : null}
    </div>
  );
}

export default function Home() {
  const urls = publicMcpUrls();

  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Soft highlight in logo line color (wireframe accent) */}
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(232,232,232,0.14),transparent)] dark:bg-[radial-gradient(ellipse_120%_80%_at_50%_-20%,rgba(232,232,232,0.08),transparent)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-0 -z-10 bg-[var(--background)]"
        aria-hidden
      />

      <div className="mx-auto flex max-w-4xl flex-col gap-14 px-6 py-16 sm:gap-16 sm:py-24">
        <header className="grid grid-cols-1 justify-items-center gap-10 sm:grid-cols-[7.5rem_1fr] sm:items-start sm:justify-items-start sm:gap-x-10 sm:gap-y-0">
          <Image
            src="/logo.svg"
            alt="Workflow Automation MCP"
            width={120}
            height={120}
            className="block h-[7.5rem] w-[7.5rem] shrink-0 rounded-xl shadow-[0_0_48px_-12px_rgba(232,232,232,0.25)] ring-1 ring-[var(--card-border)] dark:shadow-[0_0_40px_-8px_rgba(232,232,232,0.12)]"
            priority
          />
          <div className="min-w-0 w-full max-w-full space-y-6 text-center sm:space-y-8 sm:text-left sm:pt-1">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--muted)]">
              <a
                href="https://modelcontextprotocol.io/introduction"
                target="_blank"
                rel="noopener noreferrer"
                className="underline decoration-[var(--muted)] underline-offset-4 transition-colors hover:text-[var(--foreground)] hover:decoration-[var(--foreground)]"
              >
                Model Context Protocol
              </a>
            </p>
            <h1 className="text-balance text-3xl font-semibold tracking-tight text-[var(--foreground)] sm:text-4xl md:text-[2.75rem] md:leading-[1.12]">
              Workflow Automation MCP
            </h1>
            <p className="mx-auto max-w-2xl text-pretty text-base leading-[1.7] text-[var(--muted)] sm:mx-0 sm:text-lg sm:leading-relaxed">
              Connect your AI assistant to the workflow engine to list workflows, inspect definitions,
              manage schedules, trigger runs, and review execution logs—all through standard MCP tools
              over streamable HTTP.
            </p>
            <div className="flex flex-col items-stretch gap-3 pt-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-start sm:gap-4 sm:pt-1">
              <Link
                href="#connection"
                className="inline-flex items-center justify-center rounded-full bg-[var(--foreground)] px-6 py-3 text-sm font-medium text-[var(--background)] transition-opacity hover:opacity-90"
              >
                Connection details
              </Link>
              <Link
                href="#tools"
                className="inline-flex items-center justify-center rounded-full border border-[var(--card-border)] bg-[var(--card)] px-6 py-3 text-sm font-medium text-[var(--foreground)] shadow-sm backdrop-blur-sm transition-colors hover:border-[var(--logo-line)] dark:hover:border-neutral-500"
              >
                Browse tools
              </Link>
            </div>
          </div>
        </header>

        <section id="connection" className="scroll-mt-8 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            Connection
          </h2>
          <p className="text-sm leading-relaxed text-[var(--muted)]">
            For OAuth or MCP auth you need a{" "}
            <strong className="font-medium text-[var(--foreground)]">workflow API key</strong>{" "}
            (<code className="rounded bg-[var(--card)] px-1 py-0.5 font-mono text-xs">wfmcp_…</code>).
            Create or copy one in{" "}
            <a
              href="https://mcp-assistant.in/settings/api-keys"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--foreground)] underline decoration-[var(--muted)] underline-offset-4 transition-colors hover:decoration-[var(--foreground)]"
            >
              MCP Assistant → Settings → API keys
            </a>
            .
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <EndpointRow
              label="MCP endpoint"
              path={urls.endpoint}
              hint={
                urls.isAbsolute
                  ? "Streamable HTTP. Use this full URL in your MCP client; it matches the OAuth resource identifier."
                  : "Streamable HTTP; use your client’s MCP URL field with this path on this host."
              }
            />
            <EndpointRow
              label="Protected resource metadata"
              path={urls.resourceMetadata}
              hint="OAuth protected-resource discovery (RFC 9728). Clients fetch this to find the authorization server."
            />
          </div>
        </section>

        <section id="tools" className="scroll-mt-8 space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-[var(--muted)]">
            Tools exposed to clients
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {tools.map((t) => (
              <li
                key={t.name}
                className="flex flex-col gap-0.5 rounded-xl border border-[var(--card-border)] bg-[var(--card)] px-4 py-3 shadow-sm backdrop-blur-sm transition-colors hover:border-[var(--logo-line)] dark:hover:border-neutral-500"
              >
                <code className="font-mono text-sm font-medium text-[var(--foreground)]">
                  {t.name}
                </code>
                <span className="text-sm text-[var(--muted)]">{t.blurb}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
