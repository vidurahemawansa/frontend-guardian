import type { GuardianEvent, ErrorGuardianEvent } from "@frontend-guardian/types";
import type { Rule, RuleMatch, RuleCategory, RuleIssueSeverity } from "../types.js";

function latest(events: GuardianEvent[]): GuardianEvent {
  return events[events.length - 1]!;
}
function isError(e: GuardianEvent): e is ErrorGuardianEvent {
  return e.category === "error";
}
function msgIncludes(e: GuardianEvent, ...needles: string[]): boolean {
  const msg = isError(e) ? (e.message ?? "") : (e.name ?? "");
  return needles.some((n) => msg.toLowerCase().includes(n.toLowerCase()));
}
function hasNextStack(e: GuardianEvent): boolean {
  const stack = (e as { stack?: Array<{ filename?: string }> }).stack ?? [];
  return stack.some((f) => (f.filename ?? "").includes("next/") || (f.filename ?? "").includes("/_next/"));
}
function getUrl(e: GuardianEvent): string {
  return String((e as { url?: string }).url ?? (e as { data?: Record<string,unknown> }).data?.["fetchUrl"] ?? "");
}

// ─── 1. Hydration Error ───────────────────────────────────────────────────────

export class NextjsHydrationRule implements Rule {
  readonly id       = "nextjs-hydration-error";
  readonly title    = "Next.js Hydration Error";
  readonly category: RuleCategory = "nextjs";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!msgIncludes(current,
      "Hydration failed because the initial UI does not match",
      "There was an error while hydrating",
      "Text content does not match server-rendered HTML",
      "Warning: Expected server HTML to contain"
    )) return null;

    if (!hasNextStack(current) && !msgIncludes(current, "next")) return null;

    const related = events.slice(0, -1).filter((e) =>
      msgIncludes(e, "Hydration failed", "Text content does not match", "There was an error while hydrating")
    );

    const url = getUrl(current);
    return {
      issueType: "nextjs_hydration_error",
      description: `Next.js server HTML doesn't match client render${url ? ` on ${url}` : ""}. React discards the server output and re-renders from scratch — SSR benefits are lost and users may see a flash of unstyled content.`,
      affectedEventIds: [current.id, ...related.map((e) => e.id)],
      data: { url, occurrences: related.length + 1 },
      severity: related.length >= 5 ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Find components that access window, document, or localStorage during render — move to useEffect.\n` +
      `2. For Date/time displays, use suppressHydrationWarning on the element.\n` +
      `3. Wrap client-only components in dynamic(() => import('./Component'), { ssr: false }).\n` +
      `4. Avoid Math.random() or Date.now() in the initial render.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const page = match.data["url"] ? `"${String(match.data["url"])}"` : "one of my pages";
    return (
      `My Next.js app has a hydration error on ${page}.\n` +
      `Server-rendered HTML doesn't match what React produces on the client.\n\n` +
      `Please:\n` +
      `1. Find all components that access browser-only APIs during render (window, document, localStorage).\n` +
      `2. Wrap client-only components with dynamic import and ssr: false:\n` +
      `   import dynamic from 'next/dynamic';\n` +
      `   const MapComponent = dynamic(() => import('./MapComponent'), { ssr: false });\n` +
      `3. For date/time that differs between server and client:\n` +
      `   <time suppressHydrationWarning>{new Date().toLocaleDateString()}</time>\n` +
      `4. Check for conditional rendering based on window.innerWidth or navigator.userAgent — move to useEffect.\n` +
      `5. Run next dev and look for the specific hydration error message showing the diff.`
    );
  }
}

// ─── 2. Slow Server-Side Rendering ───────────────────────────────────────────

export class NextjsSlowSSRRule implements Rule {
  readonly id       = "nextjs-slow-ssr";
  readonly title    = "Slow Server-Side Rendering";
  readonly category: RuleCategory = "nextjs";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (current.category !== "performance") return null;

    const kind = (current as { kind?: string }).kind;
    if (kind !== "api_latency") return null;

    const url  = getUrl(current) || current.name;
    const isNextPage = url.includes("/_next/") ||
      (current as { context?: Record<string,unknown> }).context?.["isSSR"] === true ||
      (current as { context?: Record<string,unknown> }).context?.["renderType"] === "ssr";

    if (!isNextPage) return null;

    const durationMs = typeof (current as { value?: number }).value === "number"
      ? (current as { value: number }).value : 0;

    if (durationMs < 500) return null;

    return {
      issueType: "nextjs_slow_ssr",
      description: `Server-side rendering took ${durationMs.toFixed(0)} ms for ${url}. Slow SSR blocks TTFB and delays first paint for every user — it cannot be cached per-user.`,
      affectedEventIds: [current.id],
      data: { durationMs, url },
      severity: durationMs > 2_000 ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    const url = String(match.data["url"] ?? "the page");
    return (
      `1. Switch ${url} from SSR (getServerSideProps) to ISR (getStaticProps + revalidate).\n` +
      `2. Cache data fetched inside getServerSideProps using Redis with a short TTL.\n` +
      `3. Move personalised content to the client with SWR/React Query — serve a static shell from SSR.\n` +
      `4. Use Next.js Partial Prerendering (PPR) to statically render the shell and stream dynamic parts.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const url = String(match.data["url"] ?? "<page>");
    const ms  = String(match.data["durationMs"] ?? "?");
    return (
      `My Next.js page "${url}" takes ${ms} ms to server-side render. This is too slow for good TTFB.\n\n` +
      `Please:\n` +
      `1. Review the getServerSideProps function for this page — what data is it fetching?\n` +
      `2. If the data doesn't change per-user, convert to ISR:\n` +
      `   export async function getStaticProps() {\n` +
      `     const data = await fetchData();\n` +
      `     return { props: { data }, revalidate: 60 }; // regenerate every 60s\n` +
      `   }\n` +
      `3. If the page must remain SSR, add Redis caching inside getServerSideProps:\n` +
      `   const cached = await redis.get(cacheKey);\n` +
      `   if (cached) return { props: JSON.parse(cached) };\n` +
      `4. For App Router: add cache: 'force-cache' or unstable_cache() to fetch calls.`
    );
  }
}

// ─── 3. Missing Next/Image ────────────────────────────────────────────────────

export class NextjsUnoptimizedImageRule implements Rule {
  readonly id       = "nextjs-unoptimized-image";
  readonly title    = "Unoptimized Image — Use next/image";
  readonly category: RuleCategory = "nextjs";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);

    // Detectable from: large payload events where the URL is an image
    const isLargeImage =
      current.category === "scalability" &&
      ["large_payload", "critical_payload"].includes((current as { kind?: string }).kind ?? "");

    if (!isLargeImage) return null;

    const url = getUrl(current);
    const isImage = /\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i.test(url);
    if (!isImage) return null;

    const bytes = typeof (current as { data?: Record<string,unknown> }).data?.["bytes"] === "number"
      ? (current as { data: Record<string,unknown> }).data["bytes"] as number : 0;

    return {
      issueType: "nextjs_unoptimized_image",
      description: `Image "${url}" is ${formatBytes(bytes)} — served without Next.js image optimization. next/image would auto-resize, convert to WebP/AVIF, and serve with lazy loading.`,
      affectedEventIds: [current.id],
      data: { url, bytes, formattedSize: formatBytes(bytes) },
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Replace <img src="..."> with <Image src="..." alt="..." width={N} height={N} /> from 'next/image'.\n` +
      `2. next/image automatically serves WebP/AVIF, resizes to the displayed size, and lazy-loads.\n` +
      `3. For images with unknown dimensions, use fill={true} with a positioned container.\n` +
      `4. Add priority={true} to above-the-fold images (hero, LCP element) to preload them.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const url  = String(match.data["url"] ?? "<image-url>");
    const size = String(match.data["formattedSize"] ?? "?");
    return (
      `My Next.js app is serving a ${size} image (${url}) without optimization.\n\n` +
      `Please:\n` +
      `1. Find all <img> elements in the codebase and replace them with next/image:\n` +
      `   import Image from 'next/image';\n` +
      `   <Image src="${url}" alt="description" width={800} height={600} />\n` +
      `2. For images in a dynamic list where dimensions are unknown, use fill mode:\n` +
      `   <div style={{ position: 'relative', width: '100%', height: '300px' }}>\n` +
      `     <Image src={item.imageUrl} alt={item.title} fill style={{ objectFit: 'cover' }} />\n` +
      `   </div>\n` +
      `3. Add priority={true} to the main hero/banner image (the LCP element).\n` +
      `4. Configure image domains in next.config.js if images are from an external CDN.`
    );
  }
}

// ─── 4. Missing Error Boundary ────────────────────────────────────────────────

export class NextjsMissingErrorBoundaryRule implements Rule {
  readonly id       = "nextjs-missing-error-boundary";
  readonly title    = "Missing Error Boundary — Entire Page Crashes";
  readonly category: RuleCategory = "nextjs";
  readonly severity: RuleIssueSeverity = "critical";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isError(current)) return null;

    // Detect when an error causes a full page crash (no error boundary caught it)
    const isFullPageCrash =
      msgIncludes(current, "The above error occurred in the", "React will try to recreate this component tree") ||
      (msgIncludes(current, "Minified React error") && hasNextStack(current));

    if (!isFullPageCrash) return null;

    const related = events.slice(0, -1).filter((e) =>
      isError(e) && (
        msgIncludes(e, "The above error occurred in the") ||
        msgIncludes(e, "Minified React error")
      )
    );

    const url = getUrl(current);
    return {
      issueType: "nextjs_missing_error_boundary",
      description: `An uncaught render error crashed the entire page${url ? ` (${url})` : ""}. There is no ErrorBoundary to contain the failure — all users on this page see a blank screen.`,
      affectedEventIds: [current.id, ...related.map((e) => e.id)],
      data: { url, message: current.message, occurrences: related.length + 1 },
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Add a global error boundary in app/error.tsx (App Router) or pages/_error.tsx (Pages Router).\n` +
      `2. Add component-level error boundaries around risky sections (data-dependent UI).\n` +
      `3. Use the Next.js built-in error.tsx file for segment-level error boundaries.\n` +
      `4. Add a Sentry-style global error handler to capture and report uncaught errors.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const url = match.data["url"] ? `"${String(match.data["url"])}"` : "my Next.js app";
    const msg = String(match.data["message"] ?? "a render error");
    return (
      `A render error is crashing the entire page in ${url}:\n"${msg}"\n\n` +
      `There's no ErrorBoundary to catch it. Please:\n\n` +
      `1. Create app/error.tsx for the App Router:\n` +
      `   'use client'\n` +
      `   export default function Error({ error, reset }: { error: Error; reset: () => void }) {\n` +
      `     return (\n` +
      `       <div>\n` +
      `         <h2>Something went wrong</h2>\n` +
      `         <button onClick={reset}>Try again</button>\n` +
      `       </div>\n` +
      `     );\n` +
      `   }\n\n` +
      `2. Add a global-error.tsx for root layout errors:\n` +
      `   'use client'\n` +
      `   export default function GlobalError({ reset }: { reset: () => void }) {\n` +
      `     return <html><body><h1>Critical error</h1><button onClick={reset}>Reload</button></body></html>;\n` +
      `   }\n\n` +
      `3. Wrap risky data-dependent sections in a custom ErrorBoundary component.`
    );
  }
}

// ─── 5. API Route Not Cached ──────────────────────────────────────────────────

export class NextjsApiUncachedRule implements Rule {
  readonly id       = "nextjs-api-route-uncached";
  readonly title    = "Next.js API Route Without Caching";
  readonly category: RuleCategory = "nextjs";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (current.category !== "scalability") return null;

    const kind = (current as { kind?: string }).kind;
    if (!["no_http_cache", "stale_while_revalidate_absent"].includes(kind ?? "")) return null;

    const url = getUrl(current);
    if (!url.includes("/api/")) return null;

    const data = (current as { data?: Record<string,unknown> }).data ?? {};
    const repeated = events.slice(0, -1).filter((e) => {
      const k = (e as { kind?: string }).kind;
      return ["no_http_cache", "stale_while_revalidate_absent"].includes(k ?? "") && getUrl(e) === url;
    });

    return {
      issueType: "nextjs_api_route_uncached",
      description: `Next.js API route "${url}" returns no cache headers. Every request hits the server — add Cache-Control or use Next.js fetch caching.`,
      affectedEventIds: [current.id, ...repeated.map((e) => e.id)],
      data: { url, cacheControl: data["cacheControl"] ?? null, occurrences: repeated.length + 1 },
    };
  }

  recommendation(match: RuleMatch): string {
    const url = String(match.data["url"] ?? "/api/<route>");
    return (
      `1. Add Cache-Control headers to the API response:\n` +
      `   res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=30');\n` +
      `2. In App Router, use fetch with cache options:\n` +
      `   fetch(url, { next: { revalidate: 60 } })\n` +
      `3. For rarely-changing data, use unstable_cache() from next/cache.\n` +
      `4. Deploy a CDN (Vercel Edge, Cloudflare) in front of the API to cache at the edge.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const url = String(match.data["url"] ?? "/api/<route>");
    return (
      `My Next.js API route "${url}" has no caching. Every request hits the origin server.\n\n` +
      `Please:\n` +
      `1. For Pages Router API routes, add Cache-Control:\n` +
      `   export default function handler(req, res) {\n` +
      `     res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=30');\n` +
      `     res.json(data);\n` +
      `   }\n\n` +
      `2. For App Router Route Handlers, use next/headers:\n` +
      `   import { NextResponse } from 'next/server';\n` +
      `   export async function GET() {\n` +
      `     const data = await fetchData();\n` +
      `     return NextResponse.json(data, {\n` +
      `       headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },\n` +
      `     });\n` +
      `   }\n\n` +
      `3. For server components, wrap the data fetch with unstable_cache:\n` +
      `   import { unstable_cache } from 'next/cache';\n` +
      `   const getCachedData = unstable_cache(fetchData, ['cache-key'], { revalidate: 60 });`
    );
  }
}

// ─── 6. Dynamic Import Failure ────────────────────────────────────────────────

export class NextjsDynamicImportFailureRule implements Rule {
  readonly id       = "nextjs-dynamic-import-failed";
  readonly title    = "Next.js Dynamic Import Failure";
  readonly category: RuleCategory = "nextjs";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!isError(current)) return null;

    const isNextDynamicError =
      msgIncludes(current, "dynamic", "import(", "Loading chunk", "Failed to fetch dynamically imported module") &&
      hasNextStack(current);

    if (!isNextDynamicError) return null;

    const related = events.slice(0, -1).filter((e) =>
      isError(e) && msgIncludes(e, "Loading chunk", "Failed to fetch dynamically imported module") && hasNextStack(e)
    );

    return {
      issueType: "nextjs_dynamic_import_failed",
      description: `A Next.js dynamic import (code-split chunk) failed to load. ${related.length + 1} occurrence(s). This is usually caused by a stale deployment or CDN caching old asset hashes.`,
      affectedEventIds: [current.id, ...related.map((e) => e.id)],
      data: { message: current.message, occurrences: related.length + 1 },
      severity: related.length >= 3 ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Add error handling to all dynamic() calls with a fallback component:\n` +
      `   dynamic(() => import('./Component'), { loading: () => <Spinner />, ssr: false })\n` +
      `2. In error boundaries, detect ChunkLoadError and call router.refresh() or window.location.reload().\n` +
      `3. Configure CDN Cache-Control: no-store for HTML, max-age=31536000 for hashed JS/CSS assets.\n` +
      `4. Deploy using Vercel or a platform that handles chunk invalidation automatically.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const msg = String(match.data["message"] ?? "a chunk load error");
    const count = String(match.data["occurrences"] ?? 1);
    return (
      `My Next.js app is failing to load dynamically imported chunks (${count} times):\n"${msg}"\n\n` +
      `This happens after deployment when users have cached the old HTML.\n\n` +
      `Please:\n` +
      `1. Add a global error handler that detects ChunkLoadError and reloads once:\n` +
      `   // app/error.tsx\n` +
      `   useEffect(() => {\n` +
      `     if (error.name === 'ChunkLoadError') {\n` +
      `       const reloaded = sessionStorage.getItem('chunk-reload');\n` +
      `       if (!reloaded) { sessionStorage.setItem('chunk-reload', '1'); window.location.reload(); }\n` +
      `     }\n` +
      `   }, [error]);\n\n` +
      `2. Fix the CDN cache headers:\n` +
      `   - HTML pages: Cache-Control: no-cache, must-revalidate\n` +
      `   - /_next/static/ assets: Cache-Control: public, max-age=31536000, immutable\n\n` +
      `3. Add loading fallbacks to all dynamic() calls:\n` +
      `   const HeavyComponent = dynamic(() => import('./HeavyComponent'), {\n` +
      `     loading: () => <div>Loading...</div>,\n` +
      `   });`
    );
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1_024)     return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(2)} MB`;
}
