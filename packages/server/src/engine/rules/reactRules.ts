import type { GuardianEvent, ErrorGuardianEvent } from "@frontend-guardian/types";
import type { Rule, RuleMatch, RuleCategory, RuleIssueSeverity } from "../types.js";

function latest(events: GuardianEvent[]): GuardianEvent {
  return events[events.length - 1]!;
}
function isError(e: GuardianEvent): e is ErrorGuardianEvent {
  return e.category === "error";
}
function msgIncludes(e: GuardianEvent, ...needles: string[]): boolean {
  const msg = isError(e) ? (e.message ?? "") : e.name ?? "";
  return needles.some((n) => msg.includes(n));
}
function hasReactStack(e: GuardianEvent): boolean {
  const stack = (e as { stack?: Array<{ filename?: string }> }).stack ?? [];
  return stack.some((f) => (f.filename ?? "").includes("react") || (f.filename ?? "").includes("react-dom"));
}

// ─── 1. Missing Key Prop ──────────────────────────────────────────────────────

export class ReactMissingKeyRule implements Rule {
  readonly id       = "react-missing-key";
  readonly title    = "Missing Key Prop in List";
  readonly category: RuleCategory = "react";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!msgIncludes(current,
      "Each child in a list should have a unique",
      "Each child in a list should have a unique \"key\" prop",
      "Warning: Each child"
    )) return null;

    const related = events.slice(0, -1).filter((e) =>
      msgIncludes(e, "Each child in a list should have a unique")
    );

    const component = extractComponent(current);
    return {
      issueType: "react_missing_key",
      description: `A React list is rendering items without a unique "key" prop${component ? ` in ${component}` : ""}. React cannot efficiently reconcile the list and will re-render all items on every update.`,
      affectedEventIds: [current.id, ...related.map((e) => e.id)],
      data: { component, occurrences: related.length + 1 },
      severity: related.length >= 5 ? "error" : "warning",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Add a stable, unique key to each list item:\n` +
      `   items.map((item) => <Item key={item.id} {...item} />)\n` +
      `2. Never use the array index as a key if items can be reordered or filtered.\n` +
      `3. Use a UUID or the item's database ID as the key.\n` +
      `4. Enable the ESLint rule: react/jsx-key.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const component = String(match.data["component"] ?? "a component");
    return (
      `My React app is rendering a list in ${component} without unique "key" props.\n\n` +
      `Please:\n` +
      `1. Find every .map() in ${component} that renders JSX and add a key prop to the root element.\n` +
      `2. Use item.id (or another stable unique field) as the key — NOT the array index.\n` +
      `3. If items don't have IDs, generate stable keys using a slug or hash of unique fields.\n` +
      `4. Add the ESLint rule "react/jsx-key": "error" to prevent this in the future.\n` +
      `5. Show me the fixed code for the list.`
    );
  }
}

// ─── 2. useEffect Missing Dependency ─────────────────────────────────────────

export class ReactUseEffectDepRule implements Rule {
  readonly id       = "react-useeffect-missing-deps";
  readonly title    = "useEffect Missing Dependency";
  readonly category: RuleCategory = "react";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!msgIncludes(current,
      "React Hook useEffect has a missing dependency",
      "React Hook useCallback has a missing dependency",
      "React Hook useMemo has a missing dependency",
      "react-hooks/exhaustive-deps"
    )) return null;

    const msg = isError(current) ? current.message : current.name;
    const hookMatch = msg.match(/React Hook (\w+)/);
    const depMatch  = msg.match(/['"](\w+)['"]\./);

    return {
      issueType: "react_missing_effect_dep",
      description: `${hookMatch?.[1] ?? "A React Hook"} has a missing dependency${depMatch?.[1] ? ` (${depMatch[1]})` : ""}, causing stale closures and hard-to-debug behaviour.`,
      affectedEventIds: [current.id],
      data: { hook: hookMatch?.[1] ?? "useEffect", missingDep: depMatch?.[1] ?? null, message: msg },
    };
  }

  recommendation(match: RuleMatch): string {
    const hook = String(match.data["hook"] ?? "useEffect");
    const dep  = match.data["missingDep"] ? `"${String(match.data["missingDep"])}"` : "the missing dependency";
    return (
      `1. Add ${dep} to the ${hook} dependency array.\n` +
      `2. If adding it causes an infinite loop, the real problem is an unstable reference — wrap it in useCallback or useMemo.\n` +
      `3. Never disable the eslint-disable comment to silence this — fix the underlying issue.\n` +
      `4. Enable: "react-hooks/exhaustive-deps": "error" in your ESLint config.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const hook = String(match.data["hook"] ?? "useEffect");
    const dep  = String(match.data["missingDep"] ?? "a variable");
    return (
      `My React app has a ${hook} with a missing dependency: "${dep}".\n` +
      `This causes stale closures — the hook reads an outdated value of "${dep}".\n\n` +
      `Please:\n` +
      `1. Find all ${hook} calls in the codebase with incomplete dependency arrays.\n` +
      `2. For each one, add the missing dependencies.\n` +
      `3. If adding "${dep}" causes an infinite loop, it means "${dep}" is recreated on every render — fix it:\n` +
      `   - If it's a function: wrap in useCallback.\n` +
      `   - If it's an object/array: wrap in useMemo.\n` +
      `4. Show the corrected ${hook} with the full dependency array.`
    );
  }
}

// ─── 3. State Update on Unmounted Component ───────────────────────────────────

export class ReactStateUnmountedRule implements Rule {
  readonly id       = "react-state-update-unmounted";
  readonly title    = "State Update on Unmounted Component";
  readonly category: RuleCategory = "react";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!msgIncludes(current,
      "Can't perform a React state update on an unmounted component",
      "Warning: Can't perform a React state update",
      "setState on unmounted"
    )) return null;

    const related = events.slice(0, -1).filter((e) =>
      msgIncludes(e, "Can't perform a React state update on an unmounted component")
    );

    const component = extractComponent(current);
    return {
      issueType: "react_state_update_unmounted",
      description: `An async operation is calling setState after ${component ?? "a component"} has already unmounted. This causes a memory leak and will become an error in future React versions.`,
      affectedEventIds: [current.id, ...related.map((e) => e.id)],
      data: { component, occurrences: related.length + 1 },
      severity: related.length >= 3 ? "error" : "warning",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Add a cleanup flag in useEffect:\n` +
      `   let cancelled = false;\n` +
      `   fetchData().then(data => { if (!cancelled) setState(data); });\n` +
      `   return () => { cancelled = true; };\n` +
      `2. Use AbortController to cancel the fetch itself on unmount.\n` +
      `3. Use React Query — it handles cancellation automatically.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const component = String(match.data["component"] ?? "a component");
    return (
      `My React component "${component}" is calling setState after it unmounts.\n` +
      `This happens because an async operation (fetch, timer, subscription) completes after the component is removed.\n\n` +
      `Please:\n` +
      `1. Find all async operations in ${component} (fetch calls, setTimeout, subscriptions).\n` +
      `2. Add cleanup using AbortController:\n` +
      `   useEffect(() => {\n` +
      `     const controller = new AbortController();\n` +
      `     fetch(url, { signal: controller.signal })\n` +
      `       .then(r => r.json())\n` +
      `       .then(data => setState(data))\n` +
      `       .catch(e => { if (e.name !== 'AbortError') console.error(e); });\n` +
      `     return () => controller.abort();\n` +
      `   }, [url]);\n` +
      `3. If using setTimeout: return () => clearTimeout(timerId);\n` +
      `4. If using a subscription: return () => subscription.unsubscribe();`
    );
  }
}

// ─── 4. PropTypes Validation Failure ─────────────────────────────────────────

export class ReactPropTypeRule implements Rule {
  readonly id       = "react-prop-type-error";
  readonly title    = "PropTypes Validation Failure";
  readonly category: RuleCategory = "react";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!msgIncludes(current,
      "Warning: Failed prop type",
      "Invalid prop",
      "The prop"
    ) || !hasReactStack(current)) return null;

    const msg = isError(current) ? current.message : current.name;
    const componentMatch = msg.match(/in (\w+)/);
    const propMatch      = msg.match(/prop[s]? [`'"](\w+)[`'"]/i);

    const related = events.slice(0, -1).filter((e) =>
      msgIncludes(e, "Warning: Failed prop type", "Invalid prop")
    );

    return {
      issueType: "react_prop_type_error",
      description: `PropTypes validation failed${componentMatch?.[1] ? ` in ${componentMatch[1]}` : ""}${propMatch?.[1] ? ` for prop "${propMatch[1]}"` : ""}. This is a type mismatch that TypeScript would catch at compile time.`,
      affectedEventIds: [current.id, ...related.map((e) => e.id)],
      data: { component: componentMatch?.[1] ?? null, prop: propMatch?.[1] ?? null, message: msg },
    };
  }

  recommendation(match: RuleMatch): string {
    const component = String(match.data["component"] ?? "the component");
    return (
      `1. Switch ${component} to TypeScript and define a Props interface — PropTypes become unnecessary.\n` +
      `2. If staying with PropTypes, fix the type mismatch in the parent component that passes the wrong value.\n` +
      `3. Add "react/prop-types": "error" to your ESLint config to catch these at dev time.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const component = String(match.data["component"] ?? "a component");
    const prop      = match.data["prop"] ? `"${String(match.data["prop"])}"` : "a prop";
    return (
      `My React component "${component}" has a PropTypes validation failure for prop ${prop}.\n\n` +
      `Please:\n` +
      `1. Convert "${component}" from PropTypes to TypeScript:\n` +
      `   interface ${component}Props { ${String(match.data["prop"] ?? "propName")}: <correct-type>; }\n` +
      `   function ${component}({ ... }: ${component}Props) { ... }\n` +
      `2. Find the parent component that renders <${component}> and fix the prop being passed.\n` +
      `3. Remove the PropTypes import once TypeScript is in place.\n` +
      `4. Run tsc --noEmit to surface any other type mismatches.`
    );
  }
}

// ─── 5. React Context Overuse ─────────────────────────────────────────────────

export class ReactContextOveruseRule implements Rule {
  readonly id       = "react-context-overuse";
  readonly title    = "React Context Causing Excessive Re-renders";
  readonly category: RuleCategory = "react";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (current.category !== "performance") return null;

    const kind = (current as { kind?: string }).kind;
    if (!["render_repeated", "render_loop"].includes(kind ?? "")) return null;

    const component = (current as { context?: Record<string, unknown> }).context?.["component"];
    const msg = String(component ?? current.name ?? "");

    // Heuristic: context re-renders often manifest as many different components re-rendering
    const recentRenders = events.slice(0, -1).filter((e) => {
      const k = (e as { kind?: string }).kind;
      return e.category === "performance" && ["render_repeated", "render_loop"].includes(k ?? "");
    });

    // Look for a pattern where many different components all re-render after a single state update
    const distinctComponents = new Set(
      recentRenders.map((e) => String((e as { context?: Record<string, unknown> }).context?.["component"] ?? e.name))
    );

    if (distinctComponents.size < 3) return null;

    return {
      issueType: "react_context_overuse",
      description: `${distinctComponents.size} different components are re-rendering in a cascade — likely caused by a Context value changing reference on every parent render.`,
      affectedEventIds: [current.id, ...recentRenders.slice(0, 10).map((e) => e.id)],
      data: { distinctComponents: [...distinctComponents], triggeredBy: msg },
      severity: "error",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Split your Context into smaller, focused contexts (e.g. UserContext, ThemeContext) so updates only re-render relevant consumers.\n` +
      `2. Memoize the context value: const value = useMemo(() => ({ user, setUser }), [user]);\n` +
      `3. Replace Context with Zustand or Jotai for high-frequency state updates.\n` +
      `4. Use React.memo() on components that subscribe to Context but don't need all its properties.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const components = (match.data["distinctComponents"] as string[] ?? []).slice(0, 5).join(", ");
    return (
      `My React app has a Context that is causing ${String((match.data["distinctComponents"] as string[]).length ?? "many")} components to re-render (${components}).\n\n` +
      `Please:\n` +
      `1. Find all Context.Provider usages and check if the value prop is a new object on every render.\n` +
      `2. Fix it by memoizing the value:\n` +
      `   const value = useMemo(() => ({ data, setData }), [data]);\n` +
      `   <MyContext.Provider value={value}>\n` +
      `3. Split the context: separate state (changes often) from actions (stable) into two contexts.\n` +
      `4. For high-frequency updates (every keypress, scroll), replace Context with Zustand:\n` +
      `   npm install zustand\n` +
      `   const useStore = create((set) => ({ data: null, setData: (d) => set({ data: d }) }));`
    );
  }
}

// ─── 6. React Hydration Mismatch ─────────────────────────────────────────────

export class ReactHydrationRule implements Rule {
  readonly id       = "react-hydration-mismatch";
  readonly title    = "React Hydration Mismatch";
  readonly category: RuleCategory = "react";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!msgIncludes(current,
      "Hydration failed",
      "Text content does not match",
      "There was an error while hydrating",
      "did not match. Server:",
      "Warning: Expected server HTML to contain"
    )) return null;

    const related = events.slice(0, -1).filter((e) =>
      msgIncludes(e, "Hydration failed", "Text content does not match", "There was an error while hydrating")
    );

    const url = (current as { url?: string }).url ?? null;
    return {
      issueType: "react_hydration_mismatch",
      description: `Server-rendered HTML doesn't match what React produced on the client${url ? ` on ${url}` : ""}. React will re-render the entire subtree, losing SSR performance benefits.`,
      affectedEventIds: [current.id, ...related.map((e) => e.id)],
      data: { url, occurrences: related.length + 1 },
      severity: related.length >= 5 ? "critical" : "error",
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Find components that read browser-only APIs (window, document, localStorage) during render.\n` +
      `2. Move browser-only logic into useEffect — it only runs on the client.\n` +
      `3. For content that intentionally differs, add suppressHydrationWarning to the element.\n` +
      `4. Avoid Date.now(), Math.random(), and other non-deterministic values in initial renders.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const url = match.data["url"] ? `on page "${String(match.data["url"])}"` : "in my app";
    return (
      `My React app has a hydration mismatch ${url}.\n` +
      `The server renders different HTML than the client, causing React to re-render the entire tree.\n\n` +
      `Please:\n` +
      `1. Search for components that access browser-only APIs during render:\n` +
      `   - window, document, localStorage, sessionStorage, navigator\n` +
      `   - Date.now(), Math.random()\n` +
      `2. Wrap each in a useEffect or add an isMounted check:\n` +
      `   const [mounted, setMounted] = useState(false);\n` +
      `   useEffect(() => setMounted(true), []);\n` +
      `   if (!mounted) return <Skeleton />; // matches server output\n` +
      `3. For intentional differences (timestamps, personalisation), add suppressHydrationWarning={true}.\n` +
      `4. Run the app with React StrictMode to surface more hydration issues during development.`
    );
  }
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function extractComponent(event: GuardianEvent): string | null {
  const msg = isError(event) ? event.message : event.name;
  const m = msg.match(/in (\w+)/) ?? msg.match(/component[:\s]+["']?(\w+)["']?/i);
  return m?.[1] ?? null;
}
