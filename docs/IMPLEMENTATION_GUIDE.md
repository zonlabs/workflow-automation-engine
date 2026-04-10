# 🚀 Workflow Automation Engine - Rube-Like Enhancement Guide

> **Honest Note:** This guide is based on:
> - ✅ **Verified**: Rube's actual tool descriptions and capabilities
> - ⚠️ **Inferred**: Best architectural practices (not Rube's exact internals)
> - ❌ **NOT Claimed**: Exact implementation details of Rube's system

---

## Overview

This guide explains how to add **Workbench**, **Memory**, and **LLM Planning** capabilities to your workflow engine, inspired by similar patterns in automation tools like Rube.

**Target Timeline:** 6-10 weeks (Phase by Phase)

---

## 📊 Current vs. Target Architecture

### What You Have Now ✅
```
┌─────────────────────┐
│   API/Routes        │
└────────┬────────────┘
         │
┌────────▼─────────────────────┐
│   Workflow Executor           │
│  (MCP Tool Execution)         │
└────────┬──────────────────────┘
         │
┌────────▼─────────────────────┐
│   BullMQ Job Queue + Redis    │
│   + Cron Scheduler            │
└────────┬──────────────────────┘
         │
┌────────▼─────────────────────┐
│   Supabase PostgreSQL         │
│   (Logs, History)             │
└──────────────────────────────┘
```

### What to Add ✨
```
┌──────────────────────────────────┐
│   API/Routes                     │
│  + /workflows/generate (NEW)     │
└────────┬─────────────────────────┘
         │
    ┌────▼──────────────────────────────┐
    │   Workflow Executor               │
    │  - MCP Tool Execution             │
    │  + Workbench Execution (NEW)      │
    │  + Memory Resolution (NEW)        │
    │  + LLM Planning (NEW)             │
    └────┬───────────────────────────────┘
         │
    ┌────▼──────────────────────────────┐
    │   Job Handlers                    │
    │  - workflow-worker                │
    │  - scheduler                      │
    │  + workbench-worker (NEW)         │
    │  + memory-cleanup-worker (NEW)    │
    └────┬───────────────────────────────┘
         │
    ┌────▼──────────────────────────────┐
    │   Data & Context                  │
    │  - BullMQ Queue + Redis           │
    │  + Python Sandbox (NEW)           │
    │  + Memory KV Store (NEW)          │
    │  + S3/Storage for Artifacts (NEW) │
    └────┬───────────────────────────────┘
         │
    ┌────▼──────────────────────────────┐
    │   Supabase PostgreSQL             │
    │  - execution_logs                 │
    │  - scheduled_workflows            │
    │  + workflow_memory (NEW)          │
    │  + workbench_executions (NEW)     │
    └──────────────────────────────────┘
```

---

## 🎯 Key Capabilities You'll Unlock

### 1. Workbench (Complex Analysis)
**Problem:** Can only call single tools  
**Solution:** Execute complex Python analysis with data processing

```json
{
  "step": "Analyze 100 emails with AI",
  "type": "workbench",
  "code": "emails = context['steps'][0]['output']...analysis = invoke_llm(...)",
  "result": "Detailed insights from all data"
}
```

### 2. Memory (Context Persistence)
**Problem:** Every workflow run starts from scratch  
**Solution:** Remember facts across runs to optimize API calls

```typescript
// Run 1: Save
await memory.set('slack_general_id', 'C123')

// Run 2-365: Reuse
const channelId = await memory.get('slack_general_id')
// ✅ No API call needed
```

### 3. LLM Planning (Intelligent Automation)
**Problem:** Workflows are manually designed  
**Solution:** AI generates workflows from natural language goals

```
User: "Create daily report and send to Slack"
AI: [Auto-generates multi-step workflow]
```

---

## 📋 3-Phase Implementation Plan

### Phase 1: Workbench (1-2 weeks)
Goal: Enable complex data processing and parallel execution

**Architecture:**
- TypeScript spawns isolated Python process
- Pass context via JSON file
- Execute Python code
- Capture output
- Cleanup temp files

**Key Decision:** File artifact handling
- Simple: Return only JSON results (no file persistence)
- Advanced: Upload files to S3 for sharing

**Files to Create:**
- ✨ `src/lib/workbench.ts` - Python sandbox executor
- ✨ `src/workers/workbench-worker.ts` - Job handler
- 📝 Update `src/lib/workflow-executor.ts` - Add workbench step support

---

### Phase 2: Memory (2-3 weeks)
Goal: Enable context persistence and optimization

**Architecture:**
- Store key-value pairs in Supabase JSONB
- Scoped per workflow (workflow_id is key)
- Load at start, save after steps

**Key Decision:** What to remember
- Entity IDs (expensive lookups)
- User preferences (consistent behavior)
- Workflow state (progress tracking)

**Files to Create:**
- ✨ `src/lib/memory.ts` - MemoryManager class
- 📝 Update `database.sql` - workflow_memory table
- 📝 Update `src/lib/variable-resolver.ts` - memory variable support

---

### Phase 3: Planning/Agent (3-4 weeks)
Goal: Enable intelligent workflow generation from goals

**Architecture:**
- Send goal + available tools to Claude
- Claude generates workflow JSON
- Validate before execution
- Execute generated workflow

**Key Decision:** LLM Provider
- Anthropic Claude (fast, accurate)
- OpenAI GPT (alternative)
- Open source models (cost-effective)

**Files to Create:**
- ✨ `src/lib/agent.ts` - LLM-based planner
- ✨ `src/api/agent.ts` - Agent API routes
- 📝 Update `src/lib/validator.ts` - Workflow validation

---

## ⚠️ Important: Verify Before Copying Rube Exactly

### How Rube Actually Works
✅ **Verified from Rube's tool descriptions:**
- Has a Python sandbox (COMPOSIO_REMOTE_WORKBENCH)
- Supports file upload (`upload_local_file()` → S3/R2)
- Has memory parameter (app_name → string arrays)
- Supports LLM calls (`invoke_llm()` helper)
- 4-minute timeout on executions
- Parallel execution (ThreadPoolExecutor)

⚠️ **NOT verified (implementation details we DON'T know):**
- Exact database schema for persistence
- Exact file cleanup process
- Whether memory is in-DB or in-memory
- Exact LLM planning prompt format
- When artifacts are uploaded automatically vs manually

### Recommendation
**Don't try to match Rube exactly.** Instead:
1. Use verified patterns (Python sandbox, S3 uploads)
2. Design based on YOUR needs (not Rube's internals)
3. Test your implementation empirically
4. Document YOUR design decisions clearly

---

## 💡 Design Decisions for Your Engine

### Decision 1: Workbench Execution Model
**Option A: Subprocess (Recommended)**
- Pros: Isolated, simple, standard
- Cons: Process overhead per execution
- Use: Most workflows

**Option B: Persistent Process**
- Pros: Faster execution
- Cons: Complex state management
- Use: High-frequency, low-latency needs

### Decision 2: File Artifact Handling
**Option A: Temp Files Only**
- Cleanup after execution
- Return only JSON results
- No S3 needed
- Use: Internal analysis

**Option B: Upload to S3**
- Keep files in cloud storage
- Return shareable URLs
- Requires S3/storage service
- Use: Share with users/systems

### Decision 3: Memory Storage
**Option A: Database (Recommended for you)**
- Persistent across workflows
- You already have Supabase
- Easy to query and manage
- Use: Multi-run optimization

**Option B: In-Memory Only**
- Faster during execution
- Lost on restart
- Simpler implementation
- Use: Single-run optimization

### Decision 4: LLM Provider
**Option A: Anthropic Claude**
- Fast, reliable
- Good at planning
- Moderate cost

**Option B: OpenAI GPT**
- Widely used
- Strong at reasoning
- Higher cost

**Option C: Open Source**
- Ollama, Llama2
- Free/self-hosted
- Requires GPU

---

## 🚀 Quick Start (Phase 1 - Today)

### Minimal Viable Workbench

**1. Create executor** (`src/lib/workbench.ts`):
```typescript
export async function executeWorkbench(code: string, context: any) {
  // Write code to file
  // Execute Python
  // Return output
  // Cleanup
}
```

**2. Update workflow executor** to support `type: 'workbench'`

**3. Test with simple workflow**

**Time: 2-3 hours**

---

## 📁 File Structure (After All Phases)

```
src/
├── lib/
│   ├── mcp-executor.ts           ✓ (EXISTS)
│   ├── workflow-executor.ts       ✓ (EXISTS → UPDATE)
│   ├── variable-resolver.ts      ✓ (EXISTS → UPDATE)
│   ├── memory.ts                 ✨ NEW (Phase 2)
│   ├── workbench.ts              ✨ NEW (Phase 1)
│   ├── agent.ts                  ✨ NEW (Phase 3)
│   └── validator.ts              ✨ NEW (Phase 3)
│
├── workers/
│   ├── workflow-worker.ts        ✓ (EXISTS → UPDATE)
│   ├── scheduler.ts              ✓ (EXISTS)
│   ├── workbench-worker.ts       ✨ NEW (Phase 1)
│   └── memory-cleanup-worker.ts  ✨ NEW (Phase 2)
│
└── api/
    ├── routes.ts                 ✓ (EXISTS → UPDATE)
    ├── agent.ts                  ✨ NEW (Phase 3)
    └── memory.ts                 ✨ NEW (Phase 2)
```

---

## 🧪 Testing Strategy

### Unit Tests
```typescript
// Test workbench execution
const result = await executeWorkbench('output = 2 + 2', {})
assert(result === 4)

// Test memory
await memory.set('test', 'key', 'value')
const retrieved = await memory.get('test', 'key')
assert(retrieved === 'value')

// Test agent
const workflow = await generateWorkflow('send daily report')
assert(workflow.workflow.length > 0)
```

### Integration Tests
```typescript
// Test full workflow with all phases
const execution = await executeWorkflow({
  workflow: [
    { step_number: 1, type: 'workbench', code: '...' },
    { step_number: 2, toolkit: 'slack', ... }
  ],
  workflowId: 'test-123'
})
assert(execution.status === 'success')
```

### End-to-End Tests
```bash
# Test via API
POST /api/workflows/generate
{ "goal": "Create daily report" }

# Verify output
assert(response.workflow.length > 0)
```

---

## ⚠️ Security Considerations

### Workbench Isolation
- ✅ Runs as separate process
- ✅ Timeout protection (4 min)
- ❓ Filesystem access restrictions (implement as needed)
- ❓ Network restrictions (implement as needed)

### Memory Access Control
- ✅ Scoped to workflow owner
- ⚠️ Add audit logging
- ⚠️ Implement TTL on sensitive data

### LLM Planning Safety
- ✅ Validate workflow schema before execution
- ⚠️ Tool whitelist (only approved tools)
- ⚠️ Dry-run option (preview before executing)

---

## 🚦 Deployment Checklist

### Pre-Deployment
- [ ] All tests passing
- [ ] Code reviewed
- [ ] Database migrations tested
- [ ] Load testing done
- [ ] Security review passed

### Deployment
- [ ] Backup database
- [ ] Run migrations
- [ ] Deploy to staging
- [ ] Smoke tests pass
- [ ] Monitor error rates

### Post-Deployment
- [ ] Monitor workbench execution times
- [ ] Monitor memory growth
- [ ] Check LLM accuracy
- [ ] Gather user feedback

---

## 📚 Additional Resources

- **STARTER_CODE.md** - Copy-paste ready code
- **ANALYSIS.md** - Detailed gap analysis
- **VERIFICATION.md** - How to test Rube's actual behavior

---

## 🤝 Questions & Verification

### How to Verify Behavior
1. Test with Rube's actual workflows
2. Check tool descriptions for "what's possible"
3. Don't assume exact internals
4. Design YOUR system based on YOUR needs

### Getting Help
- Check Rube's tool descriptions for verified facts
- Test behavior empirically
- Ask Rube directly about its implementation
- Document YOUR design decisions

---

**Last Updated:** April 1, 2026  
**Status:** Verified facts only  
**Note:** Based on Rube's confirmed capabilities, not its internal implementation