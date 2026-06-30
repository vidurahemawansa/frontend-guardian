# 🛡️ Frontend Guardian

> AI-powered frontend monitoring that detects errors, performance issues, and scalability anti-patterns — then tells you exactly how to fix them.

[![npm version](https://img.shields.io/npm/v/frontend-guardian)](https://www.npmjs.com/package/frontend-guardian)
[![CI](https://github.com/vidurahemawansa/frontend-guardian/actions/workflows/ci.yml/badge.svg)](https://github.com/vidurahemawansa/frontend-guardian/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## Get started in 3 steps

### Step 1 — Start the server & dashboard

> Requires [Docker Desktop](https://www.docker.com/products/docker-desktop). One-time install.

```bash
npx frontend-guardian@latest init
```

This single command will:
- ✅ Check Docker is running
- ✅ Auto-generate a secure API key
- ✅ Write `docker-compose.yml` and `.env`
- ✅ Start the server and dashboard
- ✅ Print the exact code snippet to paste into your app

| Service   | URL                   |
|-----------|-----------------------|
| Dashboard | http://localhost:3000 |
| API       | http://localhost:4000 |

---

### Step 2 — Install the SDK

```bash
npm install frontend-guardian
```

---

### Step 3 — Add one line to your app

```ts
import { initFrontendGuardian } from "frontend-guardian";

initFrontendGuardian({
  apiUrl:      "http://localhost:4000",   // shown after Step 1
  apiKey:      "your-generated-api-key", // shown after Step 1
  environment: "production",
});
```

Open **http://localhost:3000** — your Health Score dashboard is live. 🎉

---

## What you get

```
Project Health: 91 / 100

🟢 Errors       — Excellent        (0 Critical)
🟡 Performance  — 2 Suggestions
🔵 Scalability  — 4 Suggestions
🟢 Architecture — Excellent
```

Click any category to see the exact issue and recommended fix:

```
🔵 Scalability — Detailed Issues

⚠ WARNING  ×3
You loaded 3,200 records without pagination.

Recommended Fix:
▸ Implement server-side pagination
▸ Add virtual scrolling (react-window)
▸ Cache results with React Query
```

Frontend Guardian captures:

| Category | What it detects |
|---|---|
| **Errors** | `window.onerror`, unhandled rejections, stack traces |
| **Performance** | LCP, FID, CLS, slow API calls, long tasks, memory growth |
| **Scalability** | Over-fetching, large payloads, missing pagination, polling |
| **Architecture** | React, Angular, Next.js anti-patterns (33 built-in rules) |

---

## Identify users

```ts
// After login — attaches user context to every event
guardian.setUser({
  id:       "u_123",
  email:    "alice@example.com",
  username: "alice",
});

// After logout
guardian.clearUser();
```

---

## Alerting

Get notified on Slack or any webhook when critical issues are detected.

Add to your `.env` (in the `guardian/` folder created by `init`):

```bash
# Slack
ALERT_SLACK_WEBHOOK=https://hooks.slack.com/services/T.../B.../...

# Or any generic webhook (Discord, PagerDuty, etc.)
ALERT_WEBHOOK_URL=https://your-service.com/hooks/guardian

# Only alert on error + critical (default)
ALERT_MIN_SEVERITY=error
```

Then restart:
```bash
docker compose -f guardian/docker-compose.yml up -d
```

---

## AI-powered explanations (optional)

Enable AI to get plain-English explanations and Cursor AI prompts for every issue.

```bash
# In guardian/.env
AI_ENABLED=true
AI_PROVIDER=gemini    # openai | claude | gemini | ollama
AI_API_KEY=your-key
```

| Provider | `AI_PROVIDER` | Free tier |
|---|---|---|
| Google Gemini | `gemini` | ✅ Yes (1M tokens/day) |
| Ollama (local) | `ollama` | ✅ Yes (runs on your machine) |
| OpenAI GPT-4o | `openai` | ❌ Pay-per-use |
| Anthropic Claude | `claude` | ❌ Pay-per-use |

---

## SDK configuration

```ts
initFrontendGuardian({
  apiUrl:                    "http://localhost:4000", // required
  apiKey:                    "your-api-key",          // required
  environment:               "production",            // "dev" | "prod"
  enabled:                   true,                    // master switch
  enablePerformanceTracking: true,                    // Web Vitals + long tasks
});
```

---

## Updating

**SDK** — get the latest version:
```bash
npm update frontend-guardian
```

**Server & Dashboard** — pull new Docker images:
```bash
docker compose -f guardian/docker-compose.yml pull
docker compose -f guardian/docker-compose.yml up -d
```

---

## Share with your team

By default the dashboard runs on `localhost` — only you can see it.

To give your whole team access, deploy the server to a cloud host and point the SDK at the public URL:

```ts
initFrontendGuardian({
  apiUrl: "https://guardian.yourcompany.com", // your deployed server
  apiKey: "your-api-key",
});
```

See [self-hosting guide →](https://github.com/vidurahemawansa/frontend-guardian/wiki/Self-Hosting) for Railway, Render, and VPS instructions.

---

## Monorepo structure

```
frontend-guardian/
├── packages/
│   ├── guardian/    # Meta-package → npm: frontend-guardian
│   ├── sdk/         # Browser SDK  → npm: @frontend-guardian/sdk
│   ├── types/       # Shared types → npm: @frontend-guardian/types
│   ├── server/      # Analysis server            (Docker)
│   └── dashboard/   # React dashboard (nginx)    (Docker)
└── .github/workflows/
    ├── ci.yml        # Typecheck on every PR
    └── publish.yml   # Publish to npm on git tag
```

---

## Releasing a new version

```bash
git tag v1.2.3
git push origin v1.2.3
```

GitHub Actions automatically builds and publishes all packages to npm and creates a GitHub Release.

---

## License

MIT © Frontend Guardian Contributors
