import type { FrontendGuardianConfig } from "@frontend-guardian/types";
import { FrontendGuardianSDK } from "./sdk.js";

let _instance: FrontendGuardianSDK | null = null;

/**
 * Initialize the Frontend Guardian SDK.
 *
 * Creates a singleton SDK instance, attaches all collectors and starts the
 * batch flush timer. Safe to call multiple times – subsequent calls are no-ops
 * unless you pass `force: true`.
 *
 * @example
 * ```ts
 * import { initFrontendGuardian } from "@frontend-guardian/sdk";
 *
 * initFrontendGuardian({
 *   enabled: true,
 *   apiUrl: "https://api.myapp.com",
 *   environment: "prod",
 *   enablePerformanceTracking: true,
 * });
 * ```
 */
export function initFrontendGuardian(
  config: FrontendGuardianConfig,
  opts: { force?: boolean } = {}
): FrontendGuardianSDK {
  if (_instance && !opts.force) return _instance;

  // Tear down any previous instance before replacing it.
  _instance?.stop();

  _instance = new FrontendGuardianSDK(config).start();
  return _instance;
}

/** Returns the current singleton instance, or null if not yet initialised. */
export function getGuardianInstance(): FrontendGuardianSDK | null {
  return _instance;
}

/** Tear down the singleton and release all listeners. */
export function destroyGuardian(): void {
  _instance?.stop();
  _instance = null;
}
