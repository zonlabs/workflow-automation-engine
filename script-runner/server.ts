import http from "http";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawn } from "child_process";
import { MCPClient } from "@mcp-ts/sdk/server";
import { generateText } from "ai";
import { resolveModel } from "../src/lib/ai/provider-registry";

type RunRequest = {
  script_code: string;
  script_runtime?: Record<string, unknown> | null;
  params?: Record<string, unknown>;
  context?: Record<string, unknown>;
};

function jsonResponse(res: http.ServerResponse, status: number, body: object) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function buildPythonScript(userCode: string) {
  return [
    "import json",
    "import sys",
    "import urllib.request",
    "",
    "with open('input.json', 'r') as f:",
    "    _payload = json.load(f)",
    "params = _payload.get('params', {})",
    "context = _payload.get('context', {})",
    "runner_url = _payload.get('runner_url')",
    "",
    "def _post(path, payload):",
    "    if not runner_url:",
    "        raise Exception('runner_url is not available')",
    "    data = json.dumps(payload).encode('utf-8')",
    "    req = urllib.request.Request(runner_url + path, data=data, headers={'Content-Type': 'application/json'})",
    "    with urllib.request.urlopen(req) as resp:",
    "        body = resp.read().decode('utf-8')",
    "    parsed = json.loads(body) if body else {}",
    "    if isinstance(parsed, dict) and parsed.get('error'):",
    "        raise Exception(parsed.get('error'))",
    "    return parsed",
    "",
    "def run_tool(tool_slug, arguments):",
    "    return _post('/tool', {'tool_slug': tool_slug, 'arguments': arguments, 'context': context}).get('output')",
    "",
    "def invoke_llm(prompt, reasoning_effort='low'):",
    "    return _post('/llm', {'prompt': prompt, 'reasoning_effort': reasoning_effort, 'context': context}).get('output')",
    "",
    "def remote_bash(command):",
    "    return _post('/bash', {'command': command, 'context': context}).get('output')",
    "",
    "def upload_artifact(path):",
    "    raise Exception('upload_artifact is not available in this runner')",
    "",
    userCode,
    "",
    "_output = locals().get('output', None)",
    "with open('output.json', 'w') as f:",
    "    json.dump({'output': _output}, f, default=str)",
    "",
  ].join("\n");
}

function buildNodeScript(userCode: string) {
  return [
    "const fs = require('fs');",
    "const { execSync } = require('child_process');",
    "",
    "const payload = JSON.parse(fs.readFileSync('input.json', 'utf8'));",
    "const params = payload.params || {};",
    "const context = payload.context || {};",
    "const runnerUrl = payload.runner_url;",
    "",
    "async function _post(path, body) {",
    "  if (!runnerUrl) throw new Error('runner_url is not available');",
    "  const res = await fetch(runnerUrl + path, {",
    "    method: 'POST',",
    "    headers: { 'Content-Type': 'application/json' },",
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
    "  const result = await _post('/tool', { tool_slug, arguments: arguments_, context });",
    "  return result.output;",
    "}",
    "",
    "async function invoke_llm(prompt, reasoning_effort='low') {",
    "  const result = await _post('/llm', { prompt, reasoning_effort, context });",
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
    "const moduleObj = { exports: {} };",
    "const exportsObj = moduleObj.exports;",
    `const userCode = ${JSON.stringify(userCode)};`,
    "const fn = new Function('module','exports','require','run_tool','invoke_llm','remote_bash','upload_artifact','params','context',",
    "  `return (async () => {\\n${userCode}\\n})();`",
    ");",
    "",
    "(async () => {",
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

function runPythonScript(
  scriptCode: string,
  payload: { params?: Record<string, unknown>; context?: Record<string, unknown>; runner_url: string },
  timeoutMs: number
): Promise<{ output: unknown; stdout: string; stderr: string }> {
  const tempDir = mkdtempSync(join(tmpdir(), "workflow-script-"));
  const inputPath = join(tempDir, "input.json");
  const scriptPath = join(tempDir, "script.py");
  const outputPath = join(tempDir, "output.json");

  writeFileSync(inputPath, JSON.stringify(payload ?? {}), "utf8");
  writeFileSync(scriptPath, buildPythonScript(scriptCode), "utf8");

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("python", ["-u", scriptPath], {
      cwd: tempDir,
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Script execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) {
          reject(new Error(stderr || `Script exited with code ${code}`));
          return;
        }
        const output = existsSync(outputPath)
          ? JSON.parse(readFileSync(outputPath, "utf8")).output
          : null;
        resolve({ output, stdout, stderr });
      } catch (err) {
        reject(err);
      } finally {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      }
    });
  });
}

function runNodeScript(
  scriptCode: string,
  payload: { params?: Record<string, unknown>; context?: Record<string, unknown>; runner_url: string },
  timeoutMs: number
): Promise<{ output: unknown; stdout: string; stderr: string }> {
  const tempDir = mkdtempSync(join(tmpdir(), "workflow-script-"));
  const inputPath = join(tempDir, "input.json");
  const scriptPath = join(tempDir, "script.js");
  const outputPath = join(tempDir, "output.json");

  writeFileSync(inputPath, JSON.stringify(payload ?? {}), "utf8");
  writeFileSync(scriptPath, buildNodeScript(scriptCode), "utf8");

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("node", [scriptPath], {
      cwd: tempDir,
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Script execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      try {
        if (code !== 0) {
          reject(new Error(stderr || `Script exited with code ${code}`));
          return;
        }
        const output = existsSync(outputPath)
          ? JSON.parse(readFileSync(outputPath, "utf8")).output
          : null;
        resolve({ output, stdout, stderr });
      } catch (err) {
        reject(err);
      } finally {
        try {
          rmSync(tempDir, { recursive: true, force: true });
        } catch {}
      }
    });
  });
}

const port = Number(process.env.WORKFLOW_SCRIPT_RUNNER_PORT ?? "7071");
const timeoutMs = Number(process.env.WORKFLOW_SCRIPT_TIMEOUT_MS ?? "240000");
const maxBodyBytes = 2 * 1024 * 1024;

async function readJsonBody(req: http.IncomingMessage, res: http.ServerResponse) {
  let body = "";
  return new Promise<any>((resolve, reject) => {
    req.on("data", (chunk) => {
      body += chunk.toString();
      if (body.length > maxBodyBytes) {
        res.writeHead(413);
        res.end();
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
  });
}

async function handleToolCall(payload: any) {
  const toolSlug = String(payload?.tool_slug ?? "");
  if (!toolSlug) throw new Error("tool_slug is required");
  const context = (payload?.context ?? {}) as Record<string, unknown>;
  const userId = String(context.user_id ?? "");
  const sessionId = String(context.session_id ?? "");
  if (!userId || !sessionId) {
    throw new Error("context.user_id and context.session_id are required");
  }

  const client = new MCPClient({ identity: userId, sessionId });
  try {
    await client.connect();
    const result = await client.callTool(toolSlug, payload?.arguments ?? {});
    return result;
  } finally {
    try {
      await client.disconnect("script-runner-tool-call");
    } catch {}
    try {
      client.dispose();
    } catch {}
  }
}

async function handleLlmCall(payload: any) {
  const prompt = String(payload?.prompt ?? "");
  if (!prompt) throw new Error("prompt is required");

  const modelSlug = String(payload?.model ?? "");
  const { model } = resolveModel(modelSlug);

  const result = await generateText({
    model,
    prompt,
    maxRetries: 2,
  });

  return result.text;
}

async function runShellCommand(command: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const isWin = process.platform === "win32";
    const shell = isWin ? "powershell.exe" : "bash";
    const args = isWin ? ["-Command", command] : ["-lc", command];

    const child = spawn(shell, args, { env: { ...process.env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method !== "POST") {
    jsonResponse(res, 405, { error: "Method not allowed" });
    return;
  }

  if (req.url === "/tool") {
    try {
      const payload = await readJsonBody(req, res);
      const output = await handleToolCall(payload);
      jsonResponse(res, 200, { output });
    } catch (err) {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : "Tool call failed" });
    }
    return;
  }

  if (req.url === "/llm") {
    try {
      const payload = await readJsonBody(req, res);
      const output = await handleLlmCall(payload);
      jsonResponse(res, 200, { output });
    } catch (err) {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : "LLM call failed" });
    }
    return;
  }

  if (req.url === "/bash") {
    try {
      const payload = await readJsonBody(req, res);
      const command = String(payload?.command ?? "");
      if (!command) {
        jsonResponse(res, 400, { error: "command is required" });
        return;
      }
      const output = await runShellCommand(command);
      jsonResponse(res, 200, { output });
    } catch (err) {
      jsonResponse(res, 500, { error: err instanceof Error ? err.message : "Bash command failed" });
    }
    return;
  }

  if (req.url !== "/run") {
    jsonResponse(res, 404, { error: "Not found" });
    return;
  }

  try {
    const payload = (await readJsonBody(req, res)) as RunRequest;

    if (!payload.script_code?.trim()) {
      jsonResponse(res, 400, { error: "script_code is required" });
      return;
    }

    const language = detectLanguage(payload.script_code, payload.script_runtime);
    const runnerPayload = {
      params: payload.params ?? {},
      context: payload.context ?? {},
      runner_url: `http://127.0.0.1:${port}`,
    };
    const result =
      language === "node"
        ? await runNodeScript(payload.script_code, runnerPayload, timeoutMs)
        : await runPythonScript(payload.script_code, runnerPayload, timeoutMs);
    jsonResponse(res, 200, {
      output: result.output,
      logs: { stdout: result.stdout, stderr: result.stderr },
      artifacts: null,
    });
  } catch (err) {
    jsonResponse(res, 500, {
      error: err instanceof Error ? err.message : "Script execution failed",
    });
  }
});

server.listen(port, () => {
  console.log(`[script-runner] listening on port ${port}`);
});
