import { buildVercelSandboxNodeRunnerFile } from "./workflow-node-script-bootstrap";

export interface ScriptRunPayload {
  workflowId: string;
  executionLogId: string;
  userId: string;
  sessionId: string;
  triggeredBy: string;
  scriptCode: string;
  scriptRuntime?: Record<string, unknown> | null;
  params: Record<string, unknown>;
}

export interface ScriptRunResult {
  output: unknown;
  logs?: unknown;
  artifacts?: unknown;
}

function buildVercelPythonRunnerScript() {
  return [
    "import json",
    "import inspect",
    "import subprocess",
    "import urllib.request",
    "",
    "with open('input.json', 'r') as f:",
    "    _payload = json.load(f)",
    "params = _payload.get('params', {})",
    "context = _payload.get('context', {})",
    "helper_url = _payload.get('helper_url')",
    "helper_token = _payload.get('helper_token')",
    "",
    "def _post(path, payload):",
    "    if not helper_url:",
    "        raise Exception('helper_url is not available')",
    "    data = json.dumps(payload).encode('utf-8')",
    "    headers = {'Content-Type': 'application/json'}",
    "    if helper_token:",
    "        headers['Authorization'] = f'Bearer {helper_token}'",
    "    req = urllib.request.Request(helper_url + path, data=data, headers=headers)",
    "    with urllib.request.urlopen(req) as resp:",
    "        body = resp.read().decode('utf-8')",
    "    parsed = json.loads(body) if body else {}",
    "    if isinstance(parsed, dict) and parsed.get('error'):",
    "        raise Exception(parsed.get('error'))",
    "    return parsed",
    "",
    "def run_tool(tool_slug, arguments):",
    "    return _post('/script-helper/tool', {'tool_slug': tool_slug, 'arguments': arguments, 'context': context}).get('output')",
    "",
    "def tool_result_rows(output):",
    "    if output is None:",
    "        return []",
    "    if isinstance(output, list):",
    "        return output",
    "    if not isinstance(output, dict):",
    "        return []",
    "    for k in ('results', 'data', 'items', 'rows', 'emails', 'records', 'messages'):",
    "        v = output.get(k)",
    "        if isinstance(v, list):",
    "            return v",
    "    content = output.get('content')",
    "    if isinstance(content, list):",
    "        for block in content:",
    "            if isinstance(block, dict) and block.get('type') == 'text':",
    "                t = (block.get('text') or '').strip()",
    "                if not t or t[0] not in '{[':",
    "                    continue",
    "                try:",
    "                    parsed = json.loads(t)",
    "                    if isinstance(parsed, list):",
    "                        return parsed",
    "                    if isinstance(parsed, dict):",
    "                        for k in ('results', 'data', 'items', 'rows', 'emails', 'records', 'messages'):",
    "                            v = parsed.get(k)",
    "                            if isinstance(v, list):",
    "                                return v",
    "                except Exception:",
    "                    pass",
    "    return []",
    "",
    "class _Mcp:",
    "    @staticmethod",
    "    def callTool(tool_slug, arguments):",
    "        return run_tool(tool_slug, arguments)",
    "",
    "mcp = _Mcp()",
    "",
    "def invoke_llm(prompt, reasoning_effort='low'):",
    "    return _post('/script-helper/llm', {'prompt': prompt, 'reasoning_effort': reasoning_effort, 'context': context}).get('output')",
    "",
    "def remote_bash(command):",
    "    result = subprocess.run(command, shell=True, capture_output=True, text=True)",
    "    return {'stdout': result.stdout, 'stderr': result.stderr, 'code': result.returncode}",
    "",
    "def upload_artifact(path):",
    "    raise Exception('upload_artifact is not available in this runner')",
    "",
    "_g = {",
    "    'params': params,",
    "    'context': context,",
    "    'run_tool': run_tool,",
    "    'tool_result_rows': tool_result_rows,",
    "    'mcp': mcp,",
    "    'invoke_llm': invoke_llm,",
    "    'remote_bash': remote_bash,",
    "    'upload_artifact': upload_artifact,",
    "}",
    "",
    "with open('script_body.py', 'r') as f:",
    "    _code = f.read()",
    "exec(compile(_code, 'script_body.py', 'exec'), _g, _g)",
    "",
    "_out = None",
    "_fn = None",
    "for _name in ('main', 'execute_workflow'):",
    "    if callable(_g.get(_name)):",
    "        _fn = _g[_name]",
    "        break",
    "if _fn is not None:",
    "    _maybe = _fn(params, context)",
    "    if inspect.isawaitable(_maybe):",
    "        import asyncio",
    "        _out = asyncio.run(_maybe)",
    "    else:",
    "        _out = _maybe",
    "elif 'output' in _g:",
    "    _out = _g['output']",
    "else:",
    "    raise Exception(",
    "        'WORKFLOW_SCRIPT_NO_ENTRY_POINT: define def main(params, context) or def execute_workflow(params, context), or set output. '",
    "        'Use run_tool(tool_slug, arguments) or mcp.callTool(tool_slug, arguments) for MCP tools.'",
    "    )",
    "",
    "with open('output.json', 'w') as f:",
    "    json.dump({'output': _out}, f, default=str)",
    "",
  ].join("\n");
}

function detectLanguage(
  scriptCode: string,
  runtime?: Record<string, unknown> | null
): "python" | "node" {
  const raw = String(runtime?.language ?? runtime?.runtime ?? runtime?.lang ?? "").toLowerCase();
  if (raw.includes("python")) return "python";
  if (raw.includes("node") || raw.includes("javascript") || raw.includes("js")) return "node";

  const code = scriptCode.trim();
  const pythonPattern = new RegExp("\\bdef\\s+\\w+\\s*\\(|\\bimport\\s+\\w+|\\bfrom\\s+\\w+\\s+import\\b");
  if (pythonPattern.test(code)) {
    return "python";
  }
  return "node";
}

async function runViaVercelSandbox(payload: ScriptRunPayload): Promise<ScriptRunResult> {
  const { Sandbox } = await import("@vercel/sandbox");
  const language = detectLanguage(payload.scriptCode, payload.scriptRuntime);
  const runtime =
    language === "node"
      ? process.env.VERCEL_SANDBOX_RUNTIME_NODE ?? "node24"
      : process.env.VERCEL_SANDBOX_RUNTIME_PYTHON ?? process.env.VERCEL_SANDBOX_RUNTIME ?? "python3.13";
  const timeout = Number(process.env.VERCEL_SANDBOX_TIMEOUT_MS ?? "240000");
  const helperUrl = process.env.WORKFLOW_SCRIPT_HELPER_URL;
  const helperToken = process.env.WORKFLOW_SCRIPT_HELPER_TOKEN;

  if (!helperUrl) {
    throw new Error("WORKFLOW_SCRIPT_HELPER_URL is not configured");
  }

  const teamId = process.env.VERCEL_TEAM_ID?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  const vercelToken = process.env.VERCEL_TOKEN?.trim();
  const vercelCreds =
    teamId && projectId && vercelToken
      ? { teamId, projectId, token: vercelToken }
      : {};

  const sandbox = await Sandbox.create({
    runtime,
    timeout,
    ...vercelCreds,
  });

  try {
    const inputPayload = {
      params: payload.params,
      context: {
        workflow_id: payload.workflowId,
        execution_log_id: payload.executionLogId,
        user_id: payload.userId,
        session_id: payload.sessionId,
        triggered_by: payload.triggeredBy,
      },
      helper_url: helperUrl,
      helper_token: helperToken ?? "",
    };

    await sandbox.writeFiles([
      { path: "input.json", content: Buffer.from(JSON.stringify(inputPayload)) },
      {
        path: language === "node" ? "runner.js" : "runner.py",
        content: Buffer.from(
          language === "node" ? buildVercelSandboxNodeRunnerFile() : buildVercelPythonRunnerScript()
        ),
      },
      {
        path: language === "node" ? "script_body.js" : "script_body.py",
        content: Buffer.from(payload.scriptCode),
      },
    ]);

    const result =
      language === "node"
        ? await sandbox.runCommand("node", ["runner.js"])
        : await sandbox.runCommand("python3", ["runner.py"]);
    const stdout = await result.stdout();
    const stderr = await result.stderr();

    const outputBuffer = await sandbox.readFileToBuffer({ path: "output.json" });
    const output = outputBuffer
      ? JSON.parse(outputBuffer.toString("utf8")).output
      : null;

    return {
      output,
      logs: { stdout, stderr },
      artifacts: null,
    };
  } finally {
    await sandbox.stop();
  }
}

export async function runScriptWorkflow(
  payload: ScriptRunPayload
): Promise<ScriptRunResult> {
  if (process.env.WORKFLOW_SCRIPT_RUNNER_MODE === "vercel") {
    return await runViaVercelSandbox(payload);
  }

  const runnerUrl = process.env.WORKFLOW_SCRIPT_RUNNER_URL;
  if (!runnerUrl) {
    throw new Error("WORKFLOW_SCRIPT_RUNNER_URL is not configured");
  }

  const res = await fetch(`${runnerUrl}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      script_code: payload.scriptCode,
      script_runtime: payload.scriptRuntime ?? undefined,
      params: payload.params,
      context: {
        workflow_id: payload.workflowId,
        execution_log_id: payload.executionLogId,
        user_id: payload.userId,
        session_id: payload.sessionId,
        triggered_by: payload.triggeredBy,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Script runner returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = (await res.json()) as ScriptRunResult;
  return data;
}
