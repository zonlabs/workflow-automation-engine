/**
 * Single source of truth for workflow JavaScript execution (Node).
 * Used by the local script-runner HTTP service and the Vercel sandbox path in script-runner.ts.
 */

/** Thrown as substring in Error.message when user script has no callable entry point. */
export const WORKFLOW_SCRIPT_NO_ENTRY_POINT = "WORKFLOW_SCRIPT_NO_ENTRY_POINT";

const ENTRY_POINT_HELP =
  "Export async function main(params, context) { ... }, or set module.exports.main, " +
  "module.exports.executeWorkflow, module.exports.default (function), or global.output. " +
  "Call MCP tools with run_tool(tool_slug, arguments) or mcp.callTool(tool_slug, arguments). " +
  "For Zapier/MCP list payloads use toolResultRows(await run_tool(...)) when iterating. " +
  "`context` is execution metadata (workflow_id, session_id, user_id, …) only, not an MCP client.";

/** Injected into runners; normalizes { results }, raw arrays, and MCP { content: [{text}] } shapes. */
const TOOL_RESULT_ROWS_JS = [
  "function toolResultRows(output) {",
  "  if (output == null) return [];",
  "  if (Array.isArray(output)) return output;",
  "  if (typeof output !== 'object') return [];",
  "  const o = output;",
  "  for (const k of ['results', 'data', 'items', 'rows', 'emails', 'records', 'messages']) {",
  "    if (Array.isArray(o[k])) return o[k];",
  "  }",
  "  const content = o.content;",
  "  if (Array.isArray(content)) {",
  "    for (const block of content) {",
  "      if (block && block.type === 'text' && typeof block.text === 'string') {",
  "        const t = block.text.trim();",
  "        if (!t) continue;",
  "        try {",
  "          if (t[0] === '{' || t[0] === '[') {",
  "            const parsed = JSON.parse(t);",
  "            if (Array.isArray(parsed)) return parsed;",
  "            if (parsed && typeof parsed === 'object') {",
  "              for (const k of ['results', 'data', 'items', 'rows', 'emails', 'records', 'messages']) {",
  "                if (Array.isArray(parsed[k])) return parsed[k];",
  "              }",
  "            }",
  "          }",
  "        } catch (_) {}",
  "      }",
  "    }",
  "  }",
  "  return [];",
  "}",
].join("\n");

const ENTRY_ERROR_JS = `${WORKFLOW_SCRIPT_NO_ENTRY_POINT}: ${ENTRY_POINT_HELP}`.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

/** Injected before `_post` in Node runners; keeps sandbox/local behavior in sync. */
const FORMAT_SCRIPT_HELPER_ERROR_JS = [
  "function formatScriptHelperError(parsed, text, status) {",
  "  if (parsed != null && typeof parsed === 'object' && parsed.error != null) {",
  "    const e = parsed.error;",
  "    if (typeof e === 'string') return e;",
  "    if (typeof e === 'object' && e !== null) {",
  "      const m = e.message ?? e.detail ?? e.description ?? e.title;",
  "      if (typeof m === 'string' && m) return m;",
  "      try { return JSON.stringify(e); } catch (_) { return String(e); }",
  "    }",
  "  }",
  "  const t = (text || '').trim();",
  "  if (t) return t.length > 800 ? t.slice(0, 800) + '…' : t;",
  "  return 'HTTP ' + status;",
  "}",
].join("\n");

function resolveMainAndRunLines(invokeFnLine: string): string[] {
  return [
    invokeFnLine,
    "  let mainFn = null;",
    "  if (typeof maybeExport === 'function') mainFn = maybeExport;",
    "  else if (moduleObj.exports && typeof moduleObj.exports === 'function') mainFn = moduleObj.exports;",
    "  else if (moduleObj.exports && typeof moduleObj.exports.default === 'function') mainFn = moduleObj.exports.default;",
    "  else if (moduleObj.exports && typeof moduleObj.exports.main === 'function') mainFn = moduleObj.exports.main;",
    "  else if (moduleObj.exports && typeof moduleObj.exports.executeWorkflow === 'function') mainFn = moduleObj.exports.executeWorkflow;",
    "  else if (typeof global.main === 'function') mainFn = global.main;",
    "",
    "  let output = null;",
    "  if (mainFn) {",
    "    output = await mainFn(params, context);",
    "  } else if (typeof global.output !== 'undefined') {",
    "    output = global.output;",
    "  } else {",
    `    throw new Error('${ENTRY_ERROR_JS}');`,
    "  }",
    "",
    "  fs.writeFileSync('output.json', JSON.stringify({ output }, null, 2));",
  ];
}

function nodeInnerAsyncBody(userCode: string): string {
  return (
    "return (async () => {\n" +
    userCode +
    "\n  if (typeof main === 'function' && typeof module.exports !== 'function' && typeof module.exports.main !== 'function') { module.exports.main = main; }\n" +
    "  if (typeof executeWorkflow === 'function' && typeof module.exports !== 'function' && typeof module.exports.executeWorkflow !== 'function') { module.exports.executeWorkflow = executeWorkflow; }\n" +
    "})();"
  );
}

/** Local script-runner: user code injected via JSON.stringify + new Function (child process). */
export function buildLocalNodeRunnerFile(userCode: string): string {
  const innerBody = nodeInnerAsyncBody(userCode);
  const inner = resolveMainAndRunLines(
    "  let maybeExport = await fn(moduleObj, exportsObj, require, run_tool, toolResultRows, invoke_llm, remote_bash, upload_artifact, mcp, params, context);"
  );
  return [
    "const fs = require('fs');",
    "const { execSync } = require('child_process');",
    "",
    "const payload = JSON.parse(fs.readFileSync('input.json', 'utf8'));",
    "const params = payload.params || {};",
    "const context = payload.context || {};",
    "const runnerUrl = payload.runner_url;",
    "",
    FORMAT_SCRIPT_HELPER_ERROR_JS,
    "",
    "async function _post(path, body) {",
    "  if (!runnerUrl) throw new Error('runner_url is not available');",
    "  const res = await fetch(runnerUrl + path, {",
    "    method: 'POST',",
    "    headers: { 'Content-Type': 'application/json' },",
    "    body: JSON.stringify(body)",
    "  });",
    "  const text = await res.text();",
    "  let parsed = null;",
    "  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }",
    "  const obj = parsed !== null && typeof parsed === 'object' ? parsed : null;",
    "  if (!res.ok) throw new Error(formatScriptHelperError(obj, text, res.status));",
    "  if (obj != null && obj.error != null) throw new Error(formatScriptHelperError(obj, text, res.status));",
    "  return obj || {};",
    "}",
    "",
    "async function run_tool(tool_slug, arguments_) {",
    "  const result = await _post('/tool', { tool_slug, arguments: arguments_, context });",
    "  return result.output;",
    "}",
    "",
    TOOL_RESULT_ROWS_JS,
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
    "const mcp = { callTool: (toolSlug, arguments_) => run_tool(toolSlug, arguments_) };",
    "",
    "const moduleObj = { exports: {} };",
    "const exportsObj = moduleObj.exports;",
    `const fn = new Function('module','exports','require','run_tool','toolResultRows','invoke_llm','remote_bash','upload_artifact','mcp','params','context', ${JSON.stringify(innerBody)});`,
    "",
    "(async () => {",
    ...inner,
    "})();",
    "",
  ].join("\n");
}

/** Vercel sandbox: reads user code from script_body.js; posts to WORKFLOW_SCRIPT_HELPER_URL. */
export function buildVercelSandboxNodeRunnerFile(): string {
  const inner = resolveMainAndRunLines(
    [
      "  const userCode = fs.readFileSync('script_body.js', 'utf8');",
      "  const hooked = userCode +",
      "    '\\n  if (typeof main === \\'function\\' && typeof module.exports !== \\'function\\' && typeof module.exports.main !== \\'function\\') { module.exports.main = main; }\\n' +",
      "    '\\n  if (typeof executeWorkflow === \\'function\\' && typeof module.exports !== \\'function\\' && typeof module.exports.executeWorkflow !== \\'function\\') { module.exports.executeWorkflow = executeWorkflow; }\\n';",
      "  const wrapper = '(async function(module, exports, require, run_tool, toolResultRows, invoke_llm, remote_bash, upload_artifact, mcp, params, context){\\n' + hooked + '\\n})';",
      "  const fn = vm.runInThisContext(wrapper);",
      "  let maybeExport = await fn(moduleObj, exportsObj, require, run_tool, toolResultRows, invoke_llm, remote_bash, upload_artifact, mcp, params, context);",
    ].join("\n")
  );
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
    FORMAT_SCRIPT_HELPER_ERROR_JS,
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
    "  let parsed = null;",
    "  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }",
    "  const obj = parsed !== null && typeof parsed === 'object' ? parsed : null;",
    "  if (!res.ok) throw new Error(formatScriptHelperError(obj, text, res.status));",
    "  if (obj != null && obj.error != null) throw new Error(formatScriptHelperError(obj, text, res.status));",
    "  return obj || {};",
    "}",
    "",
    "async function run_tool(tool_slug, arguments_) {",
    "  const result = await _post('/script-helper/tool', { tool_slug, arguments: arguments_, context });",
    "  return result.output;",
    "}",
    "",
    TOOL_RESULT_ROWS_JS,
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
    "const mcp = { callTool: (toolSlug, arguments_) => run_tool(toolSlug, arguments_) };",
    "",
    "const vm = require('vm');",
    "const moduleObj = { exports: {} };",
    "const exportsObj = moduleObj.exports;",
    "",
    "(async () => {",
    ...inner,
    "})();",
    "",
  ].join("\n");
}
