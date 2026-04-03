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

function buildPythonScript() {
  return [
    "import json",
    "import subprocess",
    "import sys",
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
    "output = None",
    "with open('script_body.py', 'r') as f:",
    "    code = f.read()",
    "exec(compile(code, 'script_body.py', 'exec'), globals(), locals())",
    "",
    "with open('output.json', 'w') as f:",
    "    json.dump({'output': output}, f, default=str)",
    "",
  ].join("\n");
}

function buildNodeScript() {
  return [
    "const fs = require('fs');",
    "const { execSync } = require('child_process');",
    "",
    "const payload = JSON.parse(fs.readFileSync('input.json', 'utf8'));",
    "const params = payload.params || {};",
    "const context = payload.context || {};",
    "const helperUrl = payload.helper_url;",
    "const helperToken = payload.helper_token;",
    "",
    "async function _post(path, body) {",
    "  if (!helperUrl) throw new Error('helper_url is not available');",
    "  const res = await fetch(helperUrl + path, {",
    "    method: 'POST',",
    "    headers: {",
    "      'Content-Type': 'application/json',",
    "      ...(helperToken ? { Authorization: `Bearer ${helperToken}` } : {})",
    "    },",
    "    body: JSON.stringify(body)",
    "  });",
    "  const text = await res.text();",
    "  let parsed = {};",
    "  try { parsed = text ? JSON.parse(text) : {}; } catch { parsed = {}; }",
    "  if (parsed && parsed.error) throw new Error(parsed.error);",
    "  return parsed;",
    "}",
    "",
    "async function run_tool(tool_slug, arguments_) {",
    "  const result = await _post('/script-helper/tool', { tool_slug, arguments: arguments_, context });",
    "  return result.output;",
    "}",
    "",
    "async function invoke_llm(prompt, reasoning_effort='low') {",
    "  const result = await _post('/script-helper/llm', { prompt, reasoning_effort, context });",
    "  return result.output;",
    "}",
    "",
    "function remote_bash(command) {",
    "  try {",
    "    const stdout = execSync(command, { stdio: ['ignore', 'pipe', 'pipe'] }).toString();",
    "    return { stdout, stderr: '', code: 0 };",
    "  } catch (err) {",
    "    return { stdout: '', stderr: String(err?.stderr || err?.message || err), code: 1 };",
    "  }",
    "}",
    "",
    "function upload_artifact(_path) {",
    "  throw new Error('upload_artifact is not available in this runner');",
    "}",
    "",
    "const vm = require('vm');",
    "const userCode = fs.readFileSync('script_body.js', 'utf8');",
    "const moduleObj = { exports: {} };",
    "const exportsObj = moduleObj.exports;",
    "const wrapper = `(async function(module, exports, require, run_tool, invoke_llm, remote_bash, upload_artifact, params, context){\\n${userCode}\\n})`;",
    "",
    "(async () => {",
    "  const fn = vm.runInThisContext(wrapper);",
    "  let maybeExport = await fn(moduleObj, exportsObj, require, run_tool, invoke_llm, remote_bash, upload_artifact, params, context);",
    "  let mainFn = null;",
    "  if (typeof maybeExport === 'function') mainFn = maybeExport;",
    "  else if (moduleObj.exports && typeof moduleObj.exports === 'function') mainFn = moduleObj.exports;",
    "  else if (moduleObj.exports && typeof moduleObj.exports.main === 'function') mainFn = moduleObj.exports.main;",
    "  else if (typeof global.main === 'function') mainFn = global.main;",
    "",
    "  let output = null;",
    "  if (mainFn) {",
    "    output = await mainFn(params, context);",
    "  } else if (typeof global.output !== 'undefined') {",
    "    output = global.output;",
    "  }",
    "",
    "  fs.writeFileSync('output.json', JSON.stringify({ output }, null, 2));",
    "})();",
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
      ? process.env.VERCEL_SANDBOX_RUNTIME_NODE ?? "nodejs20"
      : process.env.VERCEL_SANDBOX_RUNTIME_PYTHON ?? process.env.VERCEL_SANDBOX_RUNTIME ?? "python3.13";
  const timeout = Number(process.env.VERCEL_SANDBOX_TIMEOUT_MS ?? "240000");
  const helperUrl = process.env.WORKFLOW_SCRIPT_HELPER_URL;
  const helperToken = process.env.WORKFLOW_SCRIPT_HELPER_TOKEN;

  if (!helperUrl) {
    throw new Error("WORKFLOW_SCRIPT_HELPER_URL is not configured");
  }

  const sandbox = await Sandbox.create({ runtime, timeout });

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
        content: Buffer.from(language === "node" ? buildNodeScript() : buildPythonScript()),
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
