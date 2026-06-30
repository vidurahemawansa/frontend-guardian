/**
 * frontend-guardian
 *
 * The all-in-one entry point for Frontend Guardian.
 * Installing this package gives you both the SDK and all shared types.
 *
 * Usage:
 *   npm install frontend-guardian
 *
 *   import { initFrontendGuardian } from "frontend-guardian";
 *
 *   initFrontendGuardian({
 *     apiUrl:      "https://your-guardian-server.com",
 *     apiKey:      "your-api-key",
 *     environment: "production",
 *   });
 */

// Re-export everything from the SDK (includes types automatically)
export * from "@frontend-guardian/sdk";
