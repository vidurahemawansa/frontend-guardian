import type { Rule } from "../types.js";

// Error rules
import {
  HighErrorRateRule,
  UnhandledRejectionRule,
  ChunkLoadErrorRule,
  ErrorSpikeRule,
  RecurringErrorRule,
} from "./errorRules.js";

// Performance rules
import {
  SlowApiRule,
  RenderLoopRule,
  LongTaskRule,
  MemoryPressureRule,
  ApiDegradationRule,
} from "./performanceRules.js";

// Scalability rules
import {
  OverFetchingRule,
  LargePayloadRule,
  SlowApiScalabilityRule,
  PollingDetectedRule,
  LongTaskFrequencyRule,
} from "./scalabilityRules.js";

// React rules
import {
  ReactMissingKeyRule,
  ReactUseEffectDepRule,
  ReactStateUnmountedRule,
  ReactPropTypeRule,
  ReactContextOveruseRule,
  ReactHydrationRule,
} from "./reactRules.js";

// Angular rules
import {
  AngularSubscriptionLeakRule,
  AngularExpressionChangedRule,
  AngularNullInjectorRule,
  AngularChangeDetectionRule,
  AngularTrackByRule,
  AngularZonePollutionRule,
} from "./angularRules.js";

// Next.js rules
import {
  NextjsHydrationRule,
  NextjsSlowSSRRule,
  NextjsUnoptimizedImageRule,
  NextjsMissingErrorBoundaryRule,
  NextjsApiUncachedRule,
  NextjsDynamicImportFailureRule,
} from "./nextjsRules.js";

export const ALL_RULES: Rule[] = [
  // ── Error (5) ──────────────────────────────────────────────────────────────
  new HighErrorRateRule(),
  new UnhandledRejectionRule(),
  new ChunkLoadErrorRule(),
  new ErrorSpikeRule(),
  new RecurringErrorRule(),

  // ── Performance (5) ───────────────────────────────────────────────────────
  new SlowApiRule(),
  new RenderLoopRule(),
  new LongTaskRule(),
  new MemoryPressureRule(),
  new ApiDegradationRule(),

  // ── Scalability (5) ───────────────────────────────────────────────────────
  new OverFetchingRule(),
  new LargePayloadRule(),
  new SlowApiScalabilityRule(),
  new PollingDetectedRule(),
  new LongTaskFrequencyRule(),

  // ── React (6) ─────────────────────────────────────────────────────────────
  new ReactMissingKeyRule(),
  new ReactUseEffectDepRule(),
  new ReactStateUnmountedRule(),
  new ReactPropTypeRule(),
  new ReactContextOveruseRule(),
  new ReactHydrationRule(),

  // ── Angular (6) ───────────────────────────────────────────────────────────
  new AngularSubscriptionLeakRule(),
  new AngularExpressionChangedRule(),
  new AngularNullInjectorRule(),
  new AngularChangeDetectionRule(),
  new AngularTrackByRule(),
  new AngularZonePollutionRule(),

  // ── Next.js (6) ───────────────────────────────────────────────────────────
  new NextjsHydrationRule(),
  new NextjsSlowSSRRule(),
  new NextjsUnoptimizedImageRule(),
  new NextjsMissingErrorBoundaryRule(),
  new NextjsApiUncachedRule(),
  new NextjsDynamicImportFailureRule(),
];

// Named exports for custom engine configurations
export {
  HighErrorRateRule, UnhandledRejectionRule, ChunkLoadErrorRule, ErrorSpikeRule, RecurringErrorRule,
  SlowApiRule, RenderLoopRule, LongTaskRule, MemoryPressureRule, ApiDegradationRule,
  OverFetchingRule, LargePayloadRule, SlowApiScalabilityRule, PollingDetectedRule, LongTaskFrequencyRule,
  ReactMissingKeyRule, ReactUseEffectDepRule, ReactStateUnmountedRule, ReactPropTypeRule, ReactContextOveruseRule, ReactHydrationRule,
  AngularSubscriptionLeakRule, AngularExpressionChangedRule, AngularNullInjectorRule, AngularChangeDetectionRule, AngularTrackByRule, AngularZonePollutionRule,
  NextjsHydrationRule, NextjsSlowSSRRule, NextjsUnoptimizedImageRule, NextjsMissingErrorBoundaryRule, NextjsApiUncachedRule, NextjsDynamicImportFailureRule,
};
