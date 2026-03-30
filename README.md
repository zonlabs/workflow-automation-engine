# Workflow Automation Engine

Production-ready BullMQ + Node.js workflow automation engine with Supabase integration. Create, schedule, and execute complex workflows with cron jobs.

## Features

✅ **BullMQ Job Queue** - Reliable job processing with Redis  
✅ **Cron Scheduling** - Schedule workflows with cron expressions  
✅ **Supabase Integration** - Store workflows, schedules, and execution logs  
✅ **MCP Support** - Execute tools across GitHub, Slack, Gmail, Notion, etc.  
✅ **Workflow Engine** - Complex multi-step workflows with dependencies  
✅ **Error Handling** - Automatic retries with exponential backoff  
✅ **Audit Logging** - Complete execution history and debugging  
✅ **Webhook Triggers** - Manual execution via webhooks  

## Architecture

```
Next.js App (Vercel)
    ↓
Supabase (PostgreSQL)
    ↓
Redis (BullMQ Queue)
    ├→ Worker Process
    └→ Scheduler (checks every 60s)
    ↓
MCP Services (GitHub, Slack, Gmail, etc.)
```

## Quick Start

### 1. Prerequisites

- Node.js 18+
- Redis (local or cloud)
- Supabase account
- Git

### 2. Clone & Setup

```bash
git clone https://github.com/Avyakta000/recipe-automation-engine.git
cd recipe-automation-engine

npm install
cp .env.example .env
```

### 3. Configure Environment

Edit `.env` with your credentials:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
SUPABASE_URL=your-url
SUPABASE_SERVICE_KEY=your-key
```

### 4. Database Setup

```bash
# Create tables in Supabase
psql -U postgres -d postgres -f database.sql
```

### 5. Start Worker

```bash
# Terminal 1: Start Redis
docker run -d -p 6379:6379 redis:7-alpine

# Terminal 2: Start worker
npm run worker

# Terminal 3: Start scheduler
npm run scheduler
```

## Project Structure

```
├── lib/
│   ├── redis.ts              # Redis connection
│   ├── supabase.ts           # Supabase client
│   ├── queue.ts              # BullMQ queues
│   ├── mcp-executor.ts       # MCP tool execution
│   └── workflow-executor.ts  # Workflow engine
├── workers/
│   ├── workflow-worker.ts    # Job processor
│   └── scheduler.ts          # Cron scheduler
├── database.sql              # PostgreSQL schema
├── worker.ts                 # Main entry point
└── docker-compose.yml        # Local development
```

## Database Schema

The system uses Supabase PostgreSQL with the following tables:

- **workflows** - Workflow definitions
- **scheduled_workflows** - Cron schedules
- **execution_logs** - Execution history
- **workflow_steps** - Workflow steps
- **mcp_credentials** - Encrypted MCP tokens
- **webhook_triggers** - Manual execution hooks
- **audit_logs** - Activity logging

See `database.sql` for complete schema.

## Workflow Example

```typescript
// Workflow: Create GitHub issue + post to Slack
const workflow = [
  {
    step_number: 1,
    toolkit: 'github',
    tool_slug: 'GITHUB_CREATE_AN_ISSUE',
    tool_arguments: {
      owner: '{{params.repo_owner}}',
      repo: '{{params.repo_name}}',
      title: '{{params.issue_title}}',
      body: '{{params.issue_body}}'
    }
  },
  {
    step_number: 2,
    toolkit: 'slack',
    tool_slug: 'SLACK_SEND_MESSAGE',
    tool_arguments: {
      channel: '{{params.slack_channel}}',
      text: 'Issue created: {{steps.1.data.html_url}}'
    }
  }
];
```

## Monitoring

### View Job Status
```bash
# Check Redis queue
redis-cli
> KEYS workflow*
> HGETALL bull:workflows:...
```

### View Logs
```bash
# Check execution logs in Supabase
SELECT * FROM execution_logs 
WHERE status = 'failed' 
ORDER BY created_at DESC;
```

## Troubleshooting

### Jobs Not Processing
1. Check Redis connection: `redis-cli ping`
2. Verify worker is running: `npm run worker`
3. Check Supabase connectivity

### MCP Execution Failing
1. Verify credentials in Redis/Supabase
2. Check MCP server is accessible
3. Review execution logs for error details

### High Memory Usage
1. Increase Redis memory limits
2. Reduce WORKER_CONCURRENCY
3. Check for memory leaks in MCP tools

## Production Deployment

### Docker Deployment

```bash
docker build -t workflow-engine .
docker run -d \
  -e REDIS_HOST=redis-prod \
  -e SUPABASE_URL=prod-url \
  -e SUPABASE_SERVICE_KEY=prod-key \
  workflow-engine
```

### Kubernetes

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: workflow-engine
spec:
  replicas: 3
  selector:
    matchLabels:
      app: workflow-engine
  template:
    metadata:
      labels:
        app: workflow-engine
    spec:
      containers:
      - name: worker
        image: workflow-engine:latest
        env:
        - name: REDIS_HOST
          value: redis.default.svc.cluster.local
```

## Contributing

1. Create a feature branch
2. Make your changes
3. Run tests & linting
4. Submit a pull request

## License

MIT - See LICENSE file

## Support

- Documentation: ./docs
- Issues: https://github.com/Avyakta000/recipe-automation-engine/issues
- Discussions: https://github.com/Avyakta000/recipe-automation-engine/discussions

---

Built with love by Avyakta000
