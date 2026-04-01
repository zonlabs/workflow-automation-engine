# WORKFLOW ENGINE - STARTER CODE (Phase 1)

## 1️⃣  Add Memory Support (START HERE - 1 HOUR)

### Step A: Create Database Table
```sql
-- Add to database.sql
CREATE TABLE workflow_memory (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workflow_id UUID NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value JSONB NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(workflow_id, key)
);

CREATE INDEX idx_workflow_memory_workflow_id ON workflow_memory(workflow_id);
CREATE INDEX idx_workflow_memory_key ON workflow_memory(key);
```

### Step B: Create Memory Manager
```typescript
// src/lib/memory.ts
import { supabase } from './supabase'

export class MemoryManager {
  async set(workflowId: string, key: string, value: any): Promise<void> {
    const { error } = await supabase
      .from('workflow_memory')
      .upsert({
        workflow_id: workflowId,
        key,
        value,
        updated_at: new Date().toISOString()
      })
    
    if (error) {
      console.error(`Failed to save memory ${key}:`, error)
      throw error
    }
  }

  async get(workflowId: string, key?: string): Promise<Record<string, any>> {
    let query = supabase
      .from('workflow_memory')
      .select('key, value')
      .eq('workflow_id', workflowId)
    
    if (key) {
      query = query.eq('key', key)
      const { data, error } = await query.single()
      return { [key]: data?.value }
    }
    
    const { data, error } = await query
    
    if (error) {
      console.error(`Failed to load memory for ${workflowId}:`, error)
      return {}
    }
    
    return data?.reduce((acc, item) => {
      acc[item.key] = item.value
      return acc
    }, {} as Record<string, any>) || {}
  }

  async delete(workflowId: string, key: string): Promise<void> {
    const { error } = await supabase
      .from('workflow_memory')
      .delete()
      .eq('workflow_id', workflowId)
      .eq('key', key)
    
    if (error) {
      console.error(`Failed to delete memory ${key}:`, error)
      throw error
    }
  }

  async clear(workflowId: string): Promise<void> {
    const { error } = await supabase
      .from('workflow_memory')
      .delete()
      .eq('workflow_id', workflowId)
    
    if (error) {
      console.error(`Failed to clear memory for ${workflowId}:`, error)
      throw error
    }
  }
}

export const memoryManager = new MemoryManager()
```

### Step C: Update Workflow Executor
```typescript
// src/lib/workflow-executor.ts - Update the execute function

import { memoryManager } from './memory'

export async function executeWorkflow(
  workflow: any,
  workflowId: string,
  params: Record<string, any>,
  scheduledWorkflowId?: string
) {
  // Load memory at start
  const memory = await memoryManager.get(workflowId)
  
  const context = {
    params,
    steps: [] as any[],
    memory,
    scheduled_workflow_id: scheduledWorkflowId
  }

  // ... existing step execution loop ...
  for (const step of workflow.workflow) {
    // ... execute step ...
    
    // If step has save_to_memory directive, save outputs
    if (step.save_to_memory) {
      for (const [key, valueExpr] of Object.entries(step.save_to_memory)) {
        const value = resolveVariable(valueExpr as string, context)
        await memoryManager.set(workflowId, key, value)
      }
    }
    
    // Add step output to context for next steps
    context.steps.push({
      number: step.step_number,
      status: 'completed',
      output: stepOutput,
      data: stepOutput
    })
  }
  
  return context
}
```

### Step D: Update Variable Resolver
```typescript
// src/lib/variable-resolver.ts - Add memory support

export function resolveVariable(expr: string, context: any): any {
  // Handle {{memory.key}} pattern
  if (expr.startsWith('memory.')) {
    const key = expr.replace('memory.', '')
    return context.memory[key]
  }
  
  // Handle {{params.xxx}} pattern
  if (expr.startsWith('params.')) {
    const key = expr.replace('params.', '')
    return getValue(context.params, key)
  }
  
  // Handle {{steps.N.output.xxx}} pattern
  if (expr.startsWith('steps.')) {
    return getValue(context.steps, expr.replace('steps.', ''))
  }
  
  // Handle {{now}} for timestamp
  if (expr === 'now') {
    return new Date().toISOString()
  }
  
  return expr
}

function getValue(obj: any, path: string): any {
  return path.split('.').reduce((current, part) => {
    if (current == null) return undefined
    return current[part]
  }, obj)
}
```

---

## 2️⃣  Add Workbench Support (1.5 HOURS)

### Step A: Create Workbench Executor
```typescript
// src/lib/workbench.ts
import { execSync } from 'child_process'
import * as fs from 'fs/promises'
import * as path from 'path'
import { v4 as uuid } from 'uuid'

export interface WorkbenchContext {
  params: Record<string, any>
  steps: any[]
  memory: Record<string, any>
}

export async function executeWorkbench(
  code: string,
  context: WorkbenchContext,
  timeoutMs: number = 60000
): Promise<any> {
  const executionId = uuid()
  const tmpDir = `/tmp/workbench_${executionId}`
  const dataFile = path.join(tmpDir, 'context.json')
  const codeFile = path.join(tmpDir, 'code.py')
  const outputFile = path.join(tmpDir, 'output.json')

  try {
    // Create temp directory
    await fs.mkdir(tmpDir, { recursive: true })

    // Write context to file
    await fs.writeFile(dataFile, JSON.stringify(context))

    // Create Python script with helper functions
    const pythonCode = `
import json
import sys

# Load context
with open('${dataFile}', 'r') as f:
    context = json.load(f)

# Mock invoke_llm for now (user can override)
def invoke_llm(query, reasoning_effort='low'):
    # For now, just return empty - will integrate with actual LLM
    return f"LLM would analyze: {query[:100]}...", ""

# Execute user code
output = None
try:
    ${code.split('\n').map(line => '    ' + line).join('\n')}
except Exception as e:
    output = {'error': str(e), 'type': type(e).__name__}

# Write output
with open('${outputFile}', 'w') as f:
    json.dump({'output': output, 'context': context}, f)
`

    await fs.writeFile(codeFile, pythonCode)

    // Execute Python script
    try {
      execSync(`python3 ${codeFile}`, {
        timeout: timeoutMs,
        stdio: 'pipe'
      })
    } catch (error: any) {
      console.error('Workbench execution error:', error.message)
      throw new Error(`Workbench execution failed: ${error.message}`)
    }

    // Read output
    const outputJson = await fs.readFile(outputFile, 'utf-8')
    const result = JSON.parse(outputJson)

    return result.output

  } finally {
    // Cleanup
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch (error) {
      console.warn('Failed to cleanup workbench temp directory:', error)
    }
  }
}
```

### Step B: Add Workbench Step Type to Workflow Executor
```typescript
// src/lib/workflow-executor.ts - Add to step execution

import { executeWorkbench } from './workbench'

// Inside the step execution loop:
if (step.type === 'workbench') {
  console.log(`[STEP ${step.step_number}] Executing workbench: ${step.description}`)
  
  try {
    stepOutput = await executeWorkbench(
      step.code,
      context,
      (step.timeout_seconds || 60) * 1000
    )
  } catch (error) {
    console.error(`Workbench execution failed:`, error)
    
    if (step.retry_on_failure) {
      // Handle retries
    }
    
    throw error
  }
}
```

---

## 3️⃣  Add LLM Planning (30 MINS)

### Step A: Create Agent
```typescript
// src/lib/agent.ts
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
})

export async function generateWorkflow(goal: string): Promise<any> {
  const message = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: `
You are a workflow automation expert. Generate a workflow JSON definition to accomplish this goal:

Goal: ${goal}

Available Tools/Toolkits:
- github (GITHUB_CREATE_ISSUE, GITHUB_GET_REPOSITORY, etc)
- slack (SLACK_SEND_MESSAGE, SLACK_FETCH_MESSAGES, etc)
- gmail (GMAIL_FETCH_EMAILS, GMAIL_SEND_EMAIL, etc)
- workbench (for analysis and data processing)

Return ONLY valid JSON without markdown formatting. Structure:
{
  "name": "workflow name",
  "description": "what this workflow does",
  "input_schema": {"type": "object", "properties": {}, "required": []},
  "workflow": [
    {
      "step_number": 1,
      "toolkit": "name",
      "tool_slug": "TOOL_NAME",
      "tool_arguments": {}
    }
  ]
}
`
      }
    ]
  })

  const content = message.content[0]
  if (content.type !== 'text') {
    throw new Error('Unexpected response type from Claude')
  }

  return JSON.parse(content.text)
}
```

### Step B: Add API Endpoint
```typescript
// src/api/routes.ts

import { generateWorkflow } from '../lib/agent'

app.post('/api/workflows/generate', async (req, res) => {
  try {
    const { goal } = req.body
    
    if (!goal) {
      return res.status(400).json({ error: 'Goal is required' })
    }
    
    console.log(`[API] Generating workflow for goal: ${goal}`)
    
    const workflow = await generateWorkflow(goal)
    
    res.json({
      success: true,
      workflow,
      message: 'Workflow generated. You can now schedule it or execute immediately.'
    })
  } catch (error: any) {
    console.error('Workflow generation error:', error)
    res.status(500).json({ error: error.message })
  }
})
```

---

## 🧪 TESTING YOUR IMPLEMENTATION

### Test 1: Memory
```typescript
import { memoryManager } from './lib/memory'

// Save
await memoryManager.set('workflow-123', 'user_timezone', 'Asia/Kolkata')
await memoryManager.set('workflow-123', 'email_count', 42)

// Retrieve
const memory = await memoryManager.get('workflow-123')
console.log(memory) // { user_timezone: 'Asia/Kolkata', email_count: 42 }
```

### Test 2: Workbench
```typescript
import { executeWorkbench } from './lib/workbench'

const result = await executeWorkbench(
  `
output = 2 + 2
  `,
  { params: {}, steps: [], memory: {} }
)
console.log(result) // 4
```

### Test 3: Agent
```typescript
import { generateWorkflow } from './lib/agent'

const workflow = await generateWorkflow(
  'Create a GitHub issue with a summary of today\'s Slack messages'
)
console.log(workflow)
```

---

## 📋 CHECKLIST TO COMPLETE

- [ ] Add `workflow_memory` table to Supabase
- [ ] Create `src/lib/memory.ts` with MemoryManager
- [ ] Update `src/lib/workflow-executor.ts` to support memory
- [ ] Update `src/lib/variable-resolver.ts` for memory variables
- [ ] Create `src/lib/workbench.ts` with executeWorkbench
- [ ] Update workflow executor to support `type: 'workbench'` steps
- [ ] Create `src/lib/agent.ts` with generateWorkflow
- [ ] Add `/api/workflows/generate` endpoint
- [ ] Test memory save/load
- [ ] Test workbench execution
- [ ] Test agent workflow generation
- [ ] Update documentation with examples

Once complete, you'll have a Rube-like engine! 🚀