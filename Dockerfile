# syntax=docker/dockerfile:1
# Builder needs devDependencies (TypeScript). Runtime image is production-only + dist/.
FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Python workflows use `spawn("python", ...)` in script-runner/server.ts
RUN apk add --no-cache python3 && ln -sf python3 /usr/bin/python

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Script workflows: worker calls http://127.0.0.1:7071/run (local script-runner).
# Set WORKFLOW_SCRIPT_RUNNER_URL=http://127.0.0.1:7071 on the service (see .env.example).
# Do not set WORKFLOW_SCRIPT_RUNNER_MODE=vercel to use this path instead of Vercel Sandbox.
CMD ["sh", "-c", "node dist/script-runner/server.js & exec node dist/worker.js"]
