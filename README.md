# Workflow Automation Engine

Production-ready BullMQ + Node.js workflow automation engine with Supabase integration. Create, schedule, and execute complex multi-step workflows with cron jobs, error handling, and retry logic.

**GitHub Repository:** [Avyakta000/workflow-automation-engine](https://github.com/Avyakta000/workflow-automation-engine)

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Database Schema](#database-schema)
- [Quick Start](#quick-start)
- [How Workflows Work](#how-workflows-work)
- [API Reference](#api-reference)
- [Configuration](#configuration)
- [Development Guide](#development-guide)
- [Deployment](#deployment)
- [Troubleshooting](#troubleshooting)

## Overview

This project is a **workflow automation engine** that allows users to:

1. **Create Workflows** - Define multi-step automation with various tools (GitHub, Slack, Gmail, etc.)
2. **Schedule Workflows** - Run automatically on cron schedules
3. **Execute Workflows** - Process jobs reliably with BullMQ queue
4. **Monitor Execution** - Track execution logs, errors, and retry attempts
5. **Integrate with MCPs** - Connect to 100+ apps via MCP (Model Context Protocol)

**Example Use Case:** Create a daily GitHub issue with AI-generated description and post notification to Slack.

## Features

✅ **Job Queue System** - BullMQ with Redis for reliable job processing  
✅ **Cron Scheduling** - Schedule workflows using cron expressions  
✅ **Multi-Step Workflows** - Support for sequential steps with dependencies  
✅ **Error Handling** - Automatic retries with exponential backoff  
✅ **Script Workflows** - Execute JavaScript or Python workflow scripts with `params`, `context`, and MCP helper functions  
✅ **MCP Integration** - Execute tools across GitHub, Slack, Gmail, Notion, etc.  
✅ **Execution Logging** - Complete history with status, duration, and errors  
✅ **Webhook Triggers** - Manual execution via webhooks  
✅ **Rate Limiting** - Built-in rate limiting and backoff strategies  
✅ **TypeScript** - Full type safety across the codebase  

## Architecture

```
┌─────────────────────────────┐
│    Next.js Web App          │
│  (Recipe UI, Chat)          │
└────────────┬────────────────┘
             │ HTTP API
             ▼
┌─────────────────────────────┐
│    Supabase (PostgreSQL)    │
│  - workflows                │
│  - scheduled_workflows      │
│  - execution_logs           │
│  - mcp_credentials          │
└────────────┬────────────────┘
             │
             ▼
   ┌─────────────────┐
   │  Redis Queue    │
   │   (BullMQ)      │
   └────────┬────────┘
            │
    ┌───────┴──────────┐
    │                  │
    ▼                  ▼
┌──────────┐    ┌─────────────────┐
│Scheduler │    │ Job Worker      │
│(Every    │    │ Processes steps │
│ 60sec)   │    │ Executes MCPs   │
└──────────┘    └────────┬────────┘
                         │
                         ▼
            ┌────────────────────────┐
            │  MCP Services          │
            │ (GitHub, Slack, Gmail, │
            │  Notion, etc.)         │
            └────────────────────────┘
```

## Tech Stack

The runtime is organized into four internal layers:

- `src/domain` - workflow, schedule, execution, and error types
- `src/application` - orchestration services for execution, scheduling, MCP tools, and script helpers
- `src/infrastructure` - Supabase, BullMQ, Redis, and MCP session adapters
- `mcp-server` / `workers` / `script-runner` / `workflow-mcp-web` - transport and host-specific entrypoints

- **Runtime:** Node.js 18+
- **Language:** TypeScript
- **Job Queue:** BullMQ (with Redis)
- **Database:** Supabase (PostgreSQL)
- **Job Scheduling:** node-cron-parser
- **HTTP Framework:** (Ready for Express/Fastify integration)
- **Authentication:** Supabase Auth (via parent Next.js app)
- **Deployment:** Docker, Docker Compose, Kubernetes ready

## Project Structure

```
workflow-automation-engine/
├── lib/
│   ├── redis.ts                 # Redis connection setup
│   ├── supabase.ts              # Supabase client initialization
│   ├── queue.ts                 # BullMQ queue configuration
│   ├── mcp-executor.ts          # MCP tool execution module
│   └── workflow-executor.ts     # Core workflow engine logic
├── workers/
│   ├── workflow-worker.ts       # Job processor (handles execution)
│   └── scheduler.ts             # Cron scheduler (checks every 60s)
├── database.sql                 # PostgreSQL schema & functions
├── worker.ts                    # Main entry point for workers
├── docker-compose.yml           # Local development setup
├── Dockerfile                   # Production Docker image
├── package.json                 # Dependencies
├── tsconfig.json                # TypeScript configuration
└── README.md                    # This file
```

Current source of truth for the refactored runtime:

- `src/application/workflow/workflow-execution-service.ts` - workflow orchestration
- `src/application/scheduling/execution-enqueue-service.ts` - shared manual + scheduled enqueue path
- `src/application/mcp/workflow-tool-service.ts` - MCP-facing workflow and execution-log services
- `src/infrastructure/supabase/*` - database repositories
- `workers/workflow-worker.ts` / `workers/scheduler.ts` - thin BullMQ entrypoints

## Database Schema

### Core Tables

#### `workflows`
Defines workflow templates.

```sql
id                    UUID      -- Unique workflow ID
user_id               UUID      -- Owner (from auth.users)
name                  TEXT      -- Workflow name
description           TEXT      -- Description
input_schema          JSONB     -- Input parameter schema (JSON Schema)
output_schema         JSONB     -- Expected output schema
workflow              JSONB     -- Workflow definition (array of steps)
defaults_for_required_parameters JSONB  -- Default input values
toolkit_ids           TEXT[]    -- List of MCP toolkits used
is_active             BOOLEAN   -- Is workflow active?
is_public             BOOLEAN   -- Can others see it?
created_at            TIMESTAMP
updated_at            TIMESTAMP
```

#### `scheduled_workflows`
Schedules for periodic execution.

```sql
id                    UUID      -- Schedule ID
workflow_id           UUID      -- FK to workflows
user_id               UUID      -- Owner
name                  TEXT      -- Schedule name
cron_expression       TEXT      -- Cron expression (e.g., "0 13 * * *")
cron_timezone         TEXT      -- Timezone (e.g., "Asia/Calcutta")
status                TEXT      -- 'active' | 'paused' | 'disabled'
is_enabled            BOOLEAN   -- Master on/off switch
last_run_at           TIMESTAMP -- When it last executed
next_run_at           TIMESTAMP -- When it will run next
total_runs            INTEGER   -- Total execution count
successful_runs       INTEGER   -- Successful execution count
failed_runs           INTEGER   -- Failed execution count
params                JSONB     -- Override input parameters
created_at            TIMESTAMP
updated_at            TIMESTAMP
```

#### `execution_logs`
Execution history and status.

```sql
id                      UUID      -- Log ID
scheduled_workflow_id   UUID      -- FK to scheduled_workflows
workflow_id             UUID      -- FK to workflows
user_id                 UUID      -- Owner
status                  TEXT      -- 'pending'|'running'|'success'|'failed'|'timeout'|'cancelled'
input_data              JSONB     -- Input parameters passed
output_data             JSONB     -- Final output/results
error_message           TEXT      -- Error description if failed
error_code              TEXT      -- Error code
error_stack             JSONB     -- Stack trace
started_at              TIMESTAMP -- When execution started
completed_at            TIMESTAMP -- When execution completed
duration_ms             INTEGER   -- Execution duration in milliseconds
triggered_by            TEXT      -- 'scheduler' | 'manual' | 'webhook'
job_id                  TEXT      -- BullMQ job identifier
retry_count             INTEGER   -- Number of retries attempted
created_at              TIMESTAMP
```

#### `mcp_credentials`
Encrypted MCP tool credentials.

```sql
id                      UUID      -- Credential ID
user_id                 UUID      -- Owner
toolkit                 TEXT      -- Tool ("github", "slack", etc.)
credential_name         TEXT      -- Credential identifier
encrypted_credential    BYTEA     -- Encrypted credential data
encryption_key_version  INTEGER   -- Encryption key version
is_active               BOOLEAN   -- Is this credential active?
last_used_at            TIMESTAMP -- Last usage timestamp
created_at              TIMESTAMP
updated_at              TIMESTAMP
```

#### Other Tables

- **`webhook_triggers`** - Webhook URLs for manual execution
- **`audit_logs`** - Activity logging for compliance

### Key Functions

```sql
increment_successful_runs(schedule_id UUID)
  -- Increments successful_runs, total_runs, updates last_run_at

increment_failed_runs(schedule_id UUID)
  -- Increments failed_runs, total_runs, updates last_run_at
```

## How Workflows Work

### 1. Workflow Definition

Workflows are JSON definitions with steps:

```typescript
{
  name: "Create GitHub Issue + Slack Notification",
  description: "Create a daily issue and notify Slack",
  input_schema: {
    type: "object",
    properties: {
      repo_owner: { type: "string", description: "GitHub owner" },
      repo_name: { type: "string", description: "Repository name" },
      issue_title: { type: "string", description: "Issue title" },
      slack_channel: { type: "string", description: "Slack channel" }
    },
    required: ["repo_owner", "repo_name", "issue_title"]
  },
  output_schema: {
    type: "object",
    properties: {
      issue_url: { type: "string", description: "Created issue URL" },
      notification_sent: { type: "boolean" }
    }
  },
  workflow: [
    {
      step_number: 1,
      toolkit: "github",
      tool_slug: "GITHUB_CREATE_AN_ISSUE",
      tool_arguments: {
        owner: "{{params.repo_owner}}",
        repo: "{{params.repo_name}}",
        title: "{{params.issue_title}}",
        body: "Daily task created at {{params.timestamp}}"
      },
      max_retries: 3,
      timeout_seconds: 30
    },
    {
      step_number: 2,
      toolkit: "slack",
      tool_slug: "SLACK_SEND_MESSAGE",
      tool_arguments: {
        channel: "{{params.slack_channel}}",
        text: "Issue created: {{steps.1.data.html_url}}"
      },
      max_retries: 2
    }
  ]
}
```

### 2. Scheduling

Create a schedule with cron expression:

```typescript
{
  workflow_id: "uuid-xxx",
  name: "Daily 1:05 PM",
  cron_expression: "5 13 * * *",  // Runs at 1:05 PM every day
  cron_timezone: "Asia/Calcutta",
  params: {
    repo_owner: "Avyakta000",
    repo_name: "portfolio-assistant",
    issue_title: "Daily Task",
    slack_channel: "#general"
  }
}
```

### 3. Execution Flow

1. **Scheduler** checks every 60 seconds for workflows to execute
2. **Creates execution log** in Supabase (status: pending)
3. **Queues job** in BullMQ with workflow details
4. **Worker picks up** the job from queue
5. **Updates log** to "running" status
6. **For each step:**
   - Resolves variables (params, previous step outputs)
   - Calls MCP tool with arguments
   - Stores output for next step
   - Retries on failure with exponential backoff
7. **On completion:**
   - Updates log with "success" status and output
   - Updates schedule statistics
8. **On failure:**
   - Updates log with "failed" status and error
   - Retries entire workflow (up to 3 times by default)

## API Reference

### Workflows

```bash
# Create a workflow
POST /api/workflows
{
  "name": "...",
  "description": "...",
  "input_schema": {...},
  "output_schema": {...},
  "workflow": [...],
  "defaults_for_required_parameters": {...}
}

# List workflows
GET /api/workflows?limit=20&offset=0

# Get workflow details
GET /api/workflows/:workflow_id

# Update workflow
PATCH /api/workflows/:workflow_id

# Delete workflow
DELETE /api/workflows/:workflow_id
```

### Scheduled Workflows

```bash
# Create schedule
POST /api/scheduled-workflows
{
  "workflow_id": "uuid",
  "name": "...",
  "cron_expression": "0 13 * * *",
  "cron_timezone": "Asia/Calcutta",
  "params": {...}
}

# List schedules
GET /api/scheduled-workflows?limit=20

# Get schedule details
GET /api/scheduled-workflows/:schedule_id

# Update schedule
PATCH /api/scheduled-workflows/:schedule_id

# Trigger manually (run now)
POST /api/scheduled-workflows/:schedule_id/trigger

# Pause schedule
POST /api/scheduled-workflows/:schedule_id/pause

# Resume schedule
POST /api/scheduled-workflows/:schedule_id/resume

# Delete schedule
DELETE /api/scheduled-workflows/:schedule_id
```

### Execution Logs

```bash
# Get execution history
GET /api/execution-logs?scheduled_workflow_id=uuid&limit=50&status=success

# Get execution details
GET /api/execution-logs/:execution_id

# Retry a failed execution
POST /api/execution-logs/:execution_id/retry
```

## Configuration

### Environment Variables

```bash
# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=

# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-key
SUPABASE_ANON_KEY=your-anon-key

# MCP
MCP_CREDENTIALS_REDIS_PREFIX=mcp_creds:
MCP_SERVER_URL=http://localhost:3001

# Worker Configuration
WORKER_CONCURRENCY=5          # Number of parallel jobs
WORKER_MAX_ATTEMPTS=3          # Retry attempts
WORKER_BACKOFF_DELAY=5000      # Initial backoff delay (ms)
WORKER_JOB_TIMEOUT=600000      # Job timeout (10 min)

# Logging
LOG_LEVEL=info
NODE_ENV=development
```

## Quick Start

### Prerequisites

- Node.js 18+
- Redis (local or cloud)
- Supabase account
- Git

### Installation

```bash
# Clone the repository
git clone https://github.com/Avyakta000/workflow-automation-engine.git
cd workflow-automation-engine

# Install dependencies
npm install

# Copy environment template
cp .env.example .env

# Edit .env with your credentials
nano .env
```

### Database Setup

```bash
# Create tables in Supabase
psql -U postgres -d postgres -f database.sql
# OR import via Supabase SQL editor
```

### Local Development

```bash
# Terminal 1: Start Redis
docker run -d -p 6379:6379 redis:7-alpine

# Terminal 2: Start the worker
npm run worker

# Terminal 3: Start the scheduler
npm run scheduler

# OR use Docker Compose for everything
docker-compose up
```

### Verify Installation

```bash
# Check Redis connection
redis-cli ping
# Output: PONG

# Check worker is running
# You should see: "Scheduler started (checks every 60s)"
# and "Listening for jobs"
```

## Development Guide

### For AI Coding Agents

When working with this codebase:

1. **Understand the Flow:**
   - Workflows are stored as JSON in Supabase
   - Scheduler checks every 60 seconds
   - Worker processes jobs from BullMQ queue
   - Application services orchestrate execution, scheduling, MCP tools, and helper calls

2. **Key Files to Modify:**
   - `src/application/workflow/workflow-execution-service.ts` - workflow orchestration
   - `src/application/scheduling/execution-enqueue-service.ts` - shared enqueue path
   - `src/application/mcp/workflow-tool-service.ts` - MCP-facing workflow and execution-log logic
   - `src/infrastructure/supabase/*` - repository boundaries
   - `workers/workflow-worker.ts` / `workers/scheduler.ts` - thin transport entrypoints

3. **Script Execution Pattern:**
   - `{{params.xxx}}` → Gets from input params
   - Scripts receive `params` and `context`
   - Scripts call MCP tools through `run_tool(...)` or `mcp.callTool(...)`

4. **Error Handling:**
   - Script runs still use job-level retry handling for transient failures
   - Exponential backoff: 1s → 2s → 4s
   - Failed jobs are logged with full error stack

5. **Common Tasks:**

   **Add a new MCP toolkit support:**
   ```typescript
   // In src/application/workflow/workflow-execution-service.ts
   async function executeMCPTool(options: ExecuteOptions): Promise<any> {
     // Script workflows call MCP tools dynamically through run_tool(...)
     // Just need to add credentials in mcp_credentials table
   }
   ```

   **Add workflow validation:**
   ```typescript
   // In src/application/workflow/workflow-execution-service.ts
   // Validate input_schema against params before execution
   ```

   **Add script lifecycle hooks:**
   ```typescript
   // Extend script execution with custom logic
   ```

6. **Testing Locally:**
   ```bash
   # Create a test workflow in Supabase
   # Create a schedule
   # Monitor logs in execution_logs table
   # Check Redis queue: redis-cli
   ```

## Deployment

### Docker Deployment

```bash
# Build image
docker build -t workflow-engine .

# Run container
docker run -d \
  -e REDIS_HOST=redis-prod \
  -e SUPABASE_URL=your-url \
  -e SUPABASE_SERVICE_ROLE_KEY=your-key \
  -e WORKER_CONCURRENCY=10 \
  workflow-engine
```

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Increase `WORKER_CONCURRENCY` (10-20)
- [ ] Configure Redis for persistence
- [ ] Enable Supabase backups
- [ ] Set up monitoring/alerting
- [ ] Use strong `SUPABASE_SERVICE_ROLE_KEY`
- [ ] Enable RLS on database tables
- [ ] Set up log aggregation
- [ ] Configure rate limiting
- [ ] Test failover scenarios

## Troubleshooting

### Jobs Not Processing

```bash
# Check Redis is running
redis-cli ping

# Check worker is connected
# Look for "[OK] Scheduler started" in logs

# Check queue status
redis-cli
> KEYS bull:*
> LLEN bull:workflows:*
```

### MCP Execution Failing

1. Verify credentials in `mcp_credentials` table
2. Check MCP server is accessible from worker
3. Review `error_stack` in execution logs
4. Test MCP call manually with credentials

### High Memory Usage

1. Reduce `WORKER_CONCURRENCY`
2. Check for memory leaks in MCP tools
3. Increase Redis memory limits
4. Monitor with `redis-cli INFO memory`

### Cron Not Triggering

1. Check `scheduled_workflows.is_enabled = true`
2. Verify `cron_expression` is valid
3. Check `cron_timezone` matches server timezone
4. Look for errors in scheduler logs

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Make your changes
4. Write tests
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to the branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## License

MIT - See LICENSE file

## Support & Community

- **Issues:** [GitHub Issues](https://github.com/Avyakta000/workflow-automation-engine/issues)
- **Discussions:** [GitHub Discussions](https://github.com/Avyakta000/workflow-automation-engine/discussions)
- **Documentation:** See docs/ folder

---

**Built with ❤️ by Avyakta000**

For AI agents: This is a production-grade workflow automation system. Use the database schema and API reference as your source of truth. Always validate inputs against schemas. Handle errors gracefully with proper logging.
