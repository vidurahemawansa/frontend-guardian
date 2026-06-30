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
  return needles.some((n) => msg.includes(n));
}
function hasAngularStack(e: GuardianEvent): boolean {
  const stack = (e as { stack?: Array<{ filename?: string }> }).stack ?? [];
  return stack.some((f) => (f.filename ?? "").includes("@angular") || (f.filename ?? "").includes("zone.js"));
}

// ─── 1. Observable Subscription Leak ─────────────────────────────────────────

export class AngularSubscriptionLeakRule implements Rule {
  readonly id       = "angular-subscription-leak";
  readonly title    = "Observable Subscription Leak";
  readonly category: RuleCategory = "angular";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);

    // Detectable from: memory growth events or error messages about subscriptions after destroy
    const isSubscriptionError = msgIncludes(current,
      "has been destroyed",
      "component has been destroyed",
      "unsubscribed",
      "ObjectUnsubscribedError",
      "subscriber"
    ) && hasAngularStack(current);

    const isMemoryGrowing = current.category === "scalability" &&
      (current as { kind?: string }).kind === "memory_growing";

    if (!isSubscriptionError && !isMemoryGrowing) return null;

    // Look for a pattern of repeated subscription-related events
    const related = events.slice(0, -1).filter((e) =>
      msgIncludes(e, "ObjectUnsubscribedError", "has been destroyed") && hasAngularStack(e)
    );

    return {
      issueType: "angular_subscription_leak",
      description: `An Angular component has an Observable subscription that is not being cleaned up on destroy. This causes memory leaks and unexpected side-effects after navigation.`,
      affectedEventIds: [current.id, ...related.map((e) => e.id)],
      data: { occurrences: related.length + 1 },
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Use the async pipe in templates — it auto-unsubscribes when the component is destroyed.\n` +
      `2. Use takeUntilDestroyed() (Angular 16+): this.service.data$.pipe(takeUntilDestroyed()).subscribe();\n` +
      `3. Use a Subject + takeUntil pattern: subject.pipe(takeUntil(this.destroy$)).subscribe(); ngOnDestroy() { this.destroy$.next(); }\n` +
      `4. Use the DestroyRef injection token in Angular 16+.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    return (
      `My Angular app has Observable subscriptions that are not being unsubscribed when components are destroyed.\n\n` +
      `Please:\n` +
      `1. Find all .subscribe() calls in components that are NOT using the async pipe.\n` +
      `2. For each one, apply the takeUntilDestroyed pattern (Angular 16+):\n` +
      `   import { takeUntilDestroyed } from '@angular/core/rxjs-interop';\n` +
      `   constructor(private destroyRef = inject(DestroyRef)) {}\n` +
      `   ngOnInit() {\n` +
      `     this.service.data$\n` +
      `       .pipe(takeUntilDestroyed(this.destroyRef))\n` +
      `       .subscribe(data => this.data = data);\n` +
      `   }\n` +
      `3. Replace subscribe() in templates with the async pipe where possible:\n` +
      `   <div *ngIf="data$ | async as data">{{ data.name }}</div>\n` +
      `4. Run the app, navigate away and back, and confirm memory usage doesn't grow.`
    );
  }
}

// ─── 2. ExpressionChangedAfterChecked ────────────────────────────────────────

export class AngularExpressionChangedRule implements Rule {
  readonly id       = "angular-expression-changed";
  readonly title    = "ExpressionChangedAfterItHasBeenCheckedError";
  readonly category: RuleCategory = "angular";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!msgIncludes(current, "ExpressionChangedAfterItHasBeenCheckedError", "Expression has changed after it was checked")) return null;

    const msg = isError(current) ? current.message : current.name;
    const valueMatch = msg.match(/was: ['"]?(.+?)['"]?[;,] now: ['"]?(.+?)['"]?[;.]/);

    return {
      issueType: "angular_expression_changed",
      description: `Angular's change detection found that a bound expression changed value AFTER the current change detection cycle completed. This causes a production-breaking error in strict mode.`,
      affectedEventIds: [current.id],
      data: {
        previousValue: valueMatch?.[1] ?? null,
        currentValue:  valueMatch?.[2] ?? null,
      },
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Do NOT use ChangeDetectorRef.detectChanges() as a band-aid — find the root cause.\n` +
      `2. Move side-effectful template expressions into the component's lifecycle hooks (ngOnInit, ngAfterViewInit).\n` +
      `3. Avoid writing to a @Input() or template-bound property inside ngAfterViewChecked or ngAfterContentChecked.\n` +
      `4. Use async pipe to defer value resolution to the next tick.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const prev = match.data["previousValue"] ? `"${String(match.data["previousValue"])}"` : "one value";
    const curr = match.data["currentValue"]  ? `"${String(match.data["currentValue"])}"` : "another";
    return (
      `My Angular app throws ExpressionChangedAfterItHasBeenCheckedError.\n` +
      `The expression changed from ${prev} to ${curr} after change detection ran.\n\n` +
      `Please:\n` +
      `1. Find where a template-bound property is being mutated inside a lifecycle hook that runs after ngOnInit (ngAfterViewInit, ngAfterContentInit, ngAfterViewChecked).\n` +
      `2. Move the mutation to ngOnInit or defer it with Promise.resolve().then(...):\n` +
      `   ngAfterViewInit() {\n` +
      `     Promise.resolve().then(() => { this.value = newValue; });\n` +
      `   }\n` +
      `3. Alternatively, set the property before change detection runs by moving logic to the constructor or ngOnInit.\n` +
      `4. NEVER use ChangeDetectorRef.detectChanges() to suppress this warning — that hides the real bug.`
    );
  }
}

// ─── 3. NullInjectorError ─────────────────────────────────────────────────────

export class AngularNullInjectorRule implements Rule {
  readonly id       = "angular-null-injector";
  readonly title    = "NullInjectorError — Missing Provider";
  readonly category: RuleCategory = "angular";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (!msgIncludes(current, "NullInjectorError", "No provider for", "R3InjectorError")) return null;

    const msg = isError(current) ? current.message : current.name;
    const serviceMatch = msg.match(/No provider for (\w+)/);

    return {
      issueType: "angular_null_injector",
      description: `Angular cannot find a provider for ${serviceMatch?.[1] ?? "a service"} in the injector tree. The service is being injected but was never registered in a module or with providedIn.`,
      affectedEventIds: [current.id],
      data: { service: serviceMatch?.[1] ?? null, message: msg },
    };
  }

  recommendation(match: RuleMatch): string {
    const service = String(match.data["service"] ?? "the service");
    return (
      `1. Add @Injectable({ providedIn: 'root' }) to ${service} for app-wide availability.\n` +
      `2. Or add it to the providers array of the relevant @NgModule or @Component.\n` +
      `3. For lazy-loaded modules, ensure the service is provided in the lazy module, not just the root module.\n` +
      `4. Check for circular imports between modules that might prevent the provider from registering.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const service = String(match.data["service"] ?? "MyService");
    return (
      `My Angular app throws NullInjectorError: "No provider for ${service}".\n\n` +
      `Please:\n` +
      `1. Find the ${service} class and add providedIn: 'root':\n` +
      `   @Injectable({ providedIn: 'root' })\n` +
      `   export class ${service} { ... }\n` +
      `2. If ${service} should be scoped to a specific module, add it to that module's providers array:\n` +
      `   @NgModule({ providers: [${service}] })\n` +
      `3. Check for barrel file (index.ts) circular imports that could prevent the module from loading.\n` +
      `4. If this is a lazy-loaded feature module, ensure ${service} is provided inside that module.`
    );
  }
}

// ─── 4. Excessive Change Detection ───────────────────────────────────────────

export class AngularChangeDetectionRule implements Rule {
  readonly id       = "angular-change-detection-excessive";
  readonly title    = "Excessive Change Detection Cycles";
  readonly category: RuleCategory = "angular";
  readonly severity: RuleIssueSeverity = "error";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (current.category !== "performance") return null;
    if (!["render_repeated", "render_loop"].includes((current as { kind?: string }).kind ?? "")) return null;

    // Heuristic: Angular change detection shows up as many rapid renders
    // We detect it when events contain angular stack traces or zone.js references
    const recentRenders = events.filter((e) => {
      const k = (e as { kind?: string }).kind;
      return e.category === "performance" && ["render_repeated", "render_loop"].includes(k ?? "");
    });

    const hasAngularCtx = recentRenders.some(hasAngularStack);
    if (!hasAngularCtx && !String(current.name ?? "").match(/angular|zone|ng[A-Z]/)) return null;

    const renderCount = typeof (current as { value?: number }).value === "number"
      ? (current as { value: number }).value : recentRenders.length;

    return {
      issueType: "angular_cd_excessive",
      description: `Angular is running ${renderCount} change detection cycles — likely because a component is using Default (not OnPush) change detection with a frequently-changing data source.`,
      affectedEventIds: recentRenders.slice(0, 10).map((e) => e.id),
      data: { renderCount, componentName: current.name },
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Switch components to ChangeDetectionStrategy.OnPush — Angular will only check them when inputs change.\n` +
      `2. Replace mutable object mutations with immutable updates so OnPush detects changes correctly.\n` +
      `3. Run side-effectful code outside Angular zone: this.ngZone.runOutsideAngular(() => { ... });\n` +
      `4. Use the async pipe — it automatically marks the component for checking when the Observable emits.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const component = String(match.data["componentName"] ?? "components");
    const count     = String(match.data["renderCount"] ?? "many");
    return (
      `My Angular app is running ${count} unnecessary change detection cycles in ${component}.\n\n` +
      `Please:\n` +
      `1. Add ChangeDetectionStrategy.OnPush to all components that receive data via @Input():\n` +
      `   @Component({ changeDetection: ChangeDetectionStrategy.OnPush })\n` +
      `2. Replace all mutable state updates with immutable ones so OnPush detects the change:\n` +
      `   // Bad:  this.items.push(item);\n` +
      `   // Good: this.items = [...this.items, item];\n` +
      `3. Move any event listeners or timers outside the Angular zone:\n` +
      `   this.ngZone.runOutsideAngular(() => {\n` +
      `     element.addEventListener('mousemove', handler);\n` +
      `   });\n` +
      `4. Replace subscribe() calls in components with the async pipe in templates.`
    );
  }
}

// ─── 5. ngFor Missing trackBy ────────────────────────────────────────────────

export class AngularTrackByRule implements Rule {
  readonly id       = "angular-trackby-missing";
  readonly title    = "ngFor Without trackBy";
  readonly category: RuleCategory = "angular";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    // Detectable from: large list rendering events or performance events with Angular context
    if (current.category !== "scalability") return null;

    const kind = (current as { kind?: string }).kind;
    if (kind !== "large_list_no_pagination") return null;

    const data = (current as { data?: Record<string, unknown> }).data ?? {};
    const hasAngularCtx = Boolean(data["framework"]) && String(data["framework"]).includes("angular");
    const selector = String(data["domSelector"] ?? "");
    const isNgFor = selector.includes("[_ngcontent") || selector.includes("ng-") || hasAngularCtx;

    if (!isNgFor) return null;

    const itemCount = typeof data["itemCount"] === "number" ? data["itemCount"] as number : 0;

    return {
      issueType: "angular_missing_trackby",
      description: `An *ngFor directive is rendering ${itemCount} items without a trackBy function. Angular will destroy and recreate every DOM node on each change detection cycle.`,
      affectedEventIds: [current.id],
      data: { itemCount, selector },
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Add a trackBy function to every *ngFor:\n` +
      `   <li *ngFor="let item of items; trackBy: trackByItem">\n` +
      `   trackByItem(index: number, item: Item): string { return item.id; }\n` +
      `2. The trackBy function should return a stable unique identifier (item.id, not the index).\n` +
      `3. For very large lists (1 000+ items), consider using CDK Virtual Scrolling.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const count = String(match.data["itemCount"] ?? "many");
    return (
      `My Angular template uses *ngFor to render ${count} items without a trackBy function.\n` +
      `This causes Angular to destroy and recreate every DOM node on every change detection cycle.\n\n` +
      `Please:\n` +
      `1. Find all *ngFor directives in templates.\n` +
      `2. Add trackBy to each one:\n` +
      `   <li *ngFor="let item of items; trackBy: trackById">\n` +
      `   In the component class: trackById(_: number, item: { id: string }) { return item.id; }\n` +
      `3. For lists > 1 000 items, implement CDK Virtual Scrolling:\n` +
      `   npm install @angular/cdk\n` +
      `   <cdk-virtual-scroll-viewport itemSize="50" style="height: 400px">\n` +
      `     <app-item *cdkVirtualFor="let item of items" [item]="item"></app-item>\n` +
      `   </cdk-virtual-scroll-viewport>\n` +
      `4. Show me the before/after for the largest list.`
    );
  }
}

// ─── 6. Zone.js Pollution ─────────────────────────────────────────────────────

export class AngularZonePollutionRule implements Rule {
  readonly id       = "angular-zone-pollution";
  readonly title    = "Zone.js Pollution — Unnecessary Change Detection";
  readonly category: RuleCategory = "angular";
  readonly severity: RuleIssueSeverity = "warning";

  detect(events: GuardianEvent[]): RuleMatch | null {
    const current = latest(events);
    if (current.category !== "performance") return null;

    const kind = (current as { kind?: string }).kind;
    if (kind !== "long_task") return null;

    // Long tasks in Angular are often caused by zone.js triggering CD from 3rd-party timers/events
    const stack = (current as { stack?: Array<{ filename?: string; function?: string }> }).stack ?? [];
    const hasZone = stack.some((f) => (f.filename ?? "").includes("zone") || (f.function ?? "").includes("Zone"));

    if (!hasZone) return null;

    const durationMs = typeof (current as { value?: number }).value === "number"
      ? (current as { value: number }).value : 0;

    return {
      issueType: "angular_zone_pollution",
      description: `A long task (${durationMs.toFixed(0)} ms) is being triggered by zone.js intercepting a browser event (setTimeout, requestAnimationFrame, or a third-party library). This forces unnecessary Angular change detection.`,
      affectedEventIds: [current.id],
      data: { durationMs },
    };
  }

  recommendation(match: RuleMatch): string {
    return (
      `1. Run third-party animations, intervals, and WebSocket handlers outside the Angular zone:\n` +
      `   this.ngZone.runOutsideAngular(() => { thirdPartyLib.init(); });\n` +
      `2. Re-enter the zone only when you need Angular to update the view:\n` +
      `   this.ngZone.run(() => { this.data = result; });\n` +
      `3. For Angular 18+, consider using zoneless change detection.\n` +
      `4. Audit third-party libraries — some (Google Maps, Chart.js) flood zone.js with events.`
    );
  }

  generateCursorPrompt(match: RuleMatch): string {
    const ms = String(match.data["durationMs"] ?? "?");
    return (
      `My Angular app has zone.js triggering unnecessary change detection, causing a ${ms} ms long task.\n\n` +
      `Please:\n` +
      `1. Find all third-party library initializations (Google Maps, Chart.js, D3, socket.io, etc.).\n` +
      `2. Wrap each in ngZone.runOutsideAngular():\n` +
      `   constructor(private ngZone: NgZone) {}\n` +
      `   ngOnInit() {\n` +
      `     this.ngZone.runOutsideAngular(() => {\n` +
      `       this.chart = new Chart(canvas, options); // runs outside zone\n` +
      `     });\n` +
      `   }\n` +
      `3. For Angular 18+, migrate to zoneless:\n` +
      `   bootstrapApplication(AppComponent, { providers: [provideExperimentalZonelessChangeDetection()] })\n` +
      `4. Find all setInterval / setTimeout calls in components and move them outside the zone too.`
    );
  }
}
