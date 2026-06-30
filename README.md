# 🛡️ Frontend Guardian

AI-powered frontend monitoring that detects errors, performance issues, and scalability anti-patterns — then tells you exactly how to fix them.

[![npm version](https://img.shields.io/npm/v/@frontend-guardian/sdk)](https://www.npmjs.com/package/@frontend-guardian/sdk)
[![CI](https://github.com/YOUR_USERNAME/frontend-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/YOUR_USERNAME/frontend-guardian/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## What it does

Install the SDK into any web app. It captures:

- **Errors** — `window.onerror`, unhandled rejections, stack traces
- **Performance** — LCP, FID, CLS, slow API calls, long tasks, memory growth
- **Scalability** — over-fetching, large payloads, missing pagination, polling patterns

Events are sent to your Guardian server, which runs 33 detection rules across 6 categories (Error, Performance, Scalability, React, Angular, Next.js) and produces a **Health Score** with actionable fixes.

```
Project Health: 91 / 100

🟢 Errors       — Excellent
🟡 Performance  — 2 Suggestions
🔵 Scalability  — 4 Suggestions
🟢 Architecture — Excellent
```

---

## Quick Start

### 1. Run the server & dashboard

The server and dashboard are distributed as Docker images.

```bash
# Download the config template
curl -o .env https://raw.githubusercontent.com/YOUR_USERNAME/frontend-guardian/main/.env.guardian

# Generate a secure API key and paste it into .env
openssl rand -hex 32

# Edit .env  →  set GUARDIAN_API_KEY=<the key you just generated>
nano .env

# Start everything
curl -o docker-compose.yml https://raw.githubusercontent.com/YOUR_USERNAME/frontend-guardian/main/docker-compose.yml
docker compose up -d
```

| Service   | URL                    |
|-----------|------------------------|
| Dashboard | http://localhost:3000  |
| API       | http://localhost:4000  |

### 2. Install the SDK

```bash
npm install @frontend-guardian/sdk
```

### 3. Initialize in your app

```ts
import { initFrontendGuardian } from "@frontend-guardian/sdk";

initFrontendGuardian({
  apiUrl:                  "http://localhost:4000",   // your Guardian server
  apiKey:                  "your-secret-api-key-here",
  environment:             "production",
  enabled:                 true,
  enablePerformanceTracking: true,
});
```

That's it. Open **http://localhost:3000** to see your Health Score.

---

## SDK Configuration

| Option | Type | Default | Description |
|---|---|---|---|
| `apiUrl` | `string` | — | **Required.** URL of your Guardian server |
| `apiKey` | `string` | `""` | Must match `GUARDIAN_API_KEY` on the server |
| `environment` | `"dev" \| "prod"` | `"dev"` | Tags every event with the environment |
| `enabled` | `boolean` | `true` | Master switch — set `false` to disable in local dev |
| `enablePerformanceTracking` | `boolean` | `true` | Web Vitals, long tasks, memory monitoring |

### Manual capture

```ts
import { initFrontendGuardian } from "@frontend-guardian/sdk";

const guardian = initFrontendGuardian({ ... });

// Capture a custom error
guardian.captureError(new Error("Payment failed"), { userId: "u_123" });

// Capture a message
guardian.captureMessage("Checkout completed", "info");
```

---

## Dashboard API

The server exposes a REST API you can query directly:

```bash
# Health score (instant, no AI)
curl http://localhost:4000/health/score

# Drill into one category
curl http://localhost:4000/health/score/scalability

# List recent events
curl http://localhost:4000/events?page=1&pageSize=20

# AI-generated health summary (requires AI_ENABLED=true)
curl http://localhost:4000/health/ai
```

---

## Updating

When a new version of Frontend Guardian is released:

**SDK** — bump the version in your app's `package.json`:
```bash
npm update @frontend-guardian/sdk
```

**Server + Dashboard** — pull the latest Docker images:
```bash
docker compose pull
docker compose up -d
```

---

## AI Analysis (optional)

Frontend Guardian can use an LLM to explain issues in plain English and generate Cursor AI prompts to fix them.

Set these in your `.env`:

```bash
AI_ENABLED=true
AI_PROVIDER=openai        # openai | claude | gemini | ollama
AI_API_KEY=sk-...
```

| Provider | `AI_PROVIDER` | Free tier |
|---|---|---|
| OpenAI GPT-4o | `openai` | No (pay-per-use) |
| Anthropic Claude | `claude` | No |
| Google Gemini | `gemini` | Yes (1M tokens/day) |
| Ollama (local) | `ollama` | Yes (runs on your machine) |

Gemini or Ollama are recommended for getting started for free.

---

## Self-hosting on a server

To make the dashboard accessible to your whole team, deploy to a VPS or cloud provider:

```bash
# On your server
git clone https://github.com/YOUR_USERNAME/frontend-guardian
cd frontend-guardian
cp .env.guardian .env
# Edit .env with your API key and domain

docker compose up -d
```

Then point the SDK to your server's public URL:

```ts
initFrontendGuardian({
  apiUrl: "https://guardian.yourdomain.com",
  apiKey: "your-secret-api-key",
});
```

---

## Monorepo structure

```
frontend-guardian/
├── packages/
│   ├── types/       # Shared TypeScript types  →  npm: @frontend-guardian/types
│   ├── sdk/         # Browser SDK              →  npm: @frontend-guardian/sdk
│   ├── server/      # Node.js analysis server  →  Docker
│   └── dashboard/   # React dashboard UI       →  Docker (nginx)
├── .github/
│   └── workflows/
│       ├── ci.yml       # Run on every PR
│       └── publish.yml  # Publish to npm on git tag
└── docker-compose.yml
```

---

## Contributing & releasing

```bash
# Make your changes, then tag a release:
git tag v0.2.0
git push origin v0.2.0
```

GitHub Actions will automatically:
1. Build `@frontend-guardian/types` and `@frontend-guardian/sdk`
2. Publish both to npm
3. Create a GitHub Release with auto-generated notes

---

## License

MIT © Frontend Guardian Contributors
