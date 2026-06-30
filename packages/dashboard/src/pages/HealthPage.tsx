import { useState } from "react";
import { useHealthScore } from "../hooks/useHealthScore.js";
import type { CategoryKey, CategoryScore, CategoryIssueGroup, RuleIssueSeverity } from "../lib/api.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const CATEGORY_LABELS: Record<CategoryKey, string> = {
  errors:       "Errors",
  performance:  "Performance",
  scalability:  "Scalability",
  architecture: "Architecture",
};

const STATUS_COLOR: Record<string, string> = {
  excellent: "var(--color-success)",
  good:      "var(--color-success)",
  fair:      "var(--color-warning)",
  poor:      "#f97316",
  critical:  "var(--color-error)",
};

const SEV_COLOR: Record<RuleIssueSeverity, string> = {
  critical: "var(--color-error)",
  error:    "#f97316",
  warning:  "var(--color-warning)",
  info:     "var(--color-info)",
};

const SEV_BG: Record<RuleIssueSeverity, string> = {
  critical: "rgba(248,113,113,0.12)",
  error:    "rgba(249,115,22,0.12)",
  warning:  "rgba(251,191,36,0.12)",
  info:     "rgba(96,165,250,0.12)",
};

const TREND_ICON: Record<string, string> = {
  improving: "↑",
  stable:    "→",
  degrading: "↓",
};
const TREND_COLOR: Record<string, string> = {
  improving: "var(--color-success)",
  stable:    "var(--color-text-muted)",
  degrading: "var(--color-error)",
};

function scoreArcPath(score: number, r: number): string {
  const pct  = score / 100;
  const circ = 2 * Math.PI * r;
  return `${pct * circ} ${circ}`;
}

function formatRelative(isoStr: string): string {
  const diff = Date.now() - new Date(isoStr).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

// ─── Window selector ──────────────────────────────────────────────────────────

const WINDOWS = [
  { label: "1 h",  ms: 3_600_000 },
  { label: "6 h",  ms: 21_600_000 },
  { label: "24 h", ms: 86_400_000 },
];

// ─── Issue card ───────────────────────────────────────────────────────────────

function IssueCard({ issue }: { issue: CategoryIssueGroup }) {
  const [expanded, setExpanded] = useState(false);
  const lines = issue.recommendation.split(/\n+/).filter(Boolean);

  return (
    <div
      style={{
        background: SEV_BG[issue.severity],
        border: `1px solid ${SEV_COLOR[issue.severity]}33`,
        borderRadius: "var(--radius)",
        padding: "14px 16px",
        cursor: "pointer",
        transition: "border-color 0.15s",
      }}
      onClick={() => setExpanded((v) => !v)}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: SEV_COLOR[issue.severity],
                background: `${SEV_COLOR[issue.severity]}22`,
                padding: "2px 7px",
                borderRadius: 4,
              }}
            >
              {issue.severity}
            </span>
            {issue.occurrences > 1 && (
              <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
                ×{issue.occurrences}
              </span>
            )}
          </div>
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--color-text)", marginBottom: 4 }}>
            {issue.title}
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", lineHeight: 1.5 }}>
            {issue.description}
          </div>
        </div>
        <span style={{ color: "var(--color-text-muted)", fontSize: 18, marginTop: 2, flexShrink: 0 }}>
          {expanded ? "▴" : "▾"}
        </span>
      </div>

      {expanded && lines.length > 0 && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 14,
            borderTop: `1px solid ${SEV_COLOR[issue.severity]}22`,
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--color-text-muted)", marginBottom: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            Recommended Fix
          </div>
          <ul style={{ listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {lines.map((line, i) => (
              <li key={i} style={{ display: "flex", gap: 10, fontSize: 13, color: "var(--color-text)", lineHeight: 1.5 }}>
                <span style={{ color: "var(--color-success)", flexShrink: 0, marginTop: 1 }}>▸</span>
                <span>{line.replace(/^[\d\.\-\*\•]\s*/, "")}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── Category card ────────────────────────────────────────────────────────────

function CategoryCard({
  id,
  data,
  selected,
  onClick,
}: {
  id:       CategoryKey;
  data:     CategoryScore;
  selected: boolean;
  onClick:  () => void;
}) {
  const statusColor = STATUS_COLOR[data.status] ?? "var(--color-text-muted)";
  const r = 28;
  const circumference = 2 * Math.PI * r;
  const dashArray = scoreArcPath(data.score, r);

  return (
    <div
      onClick={onClick}
      style={{
        background: selected ? "rgba(99,102,241,0.1)" : "var(--color-surface)",
        border: `1px solid ${selected ? "var(--color-primary)" : "var(--color-border)"}`,
        borderRadius: "var(--radius)",
        padding: "20px",
        cursor: "pointer",
        transition: "all 0.18s",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        userSelect: "none",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 18 }}>{data.emoji}</span>
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: statusColor,
            background: `${statusColor}22`,
            padding: "2px 8px",
            borderRadius: 20,
          }}
        >
          {data.grade}
        </span>
      </div>

      {/* Category name */}
      <div style={{ fontWeight: 700, fontSize: 15, color: "var(--color-text)" }}>
        {CATEGORY_LABELS[id]}
      </div>

      {/* Score ring + number */}
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <svg width={70} height={70} style={{ flexShrink: 0, transform: "rotate(-90deg)" }}>
          <circle cx={35} cy={35} r={r} fill="none" stroke="var(--color-border)" strokeWidth={5} />
          <circle
            cx={35} cy={35} r={r}
            fill="none"
            stroke={statusColor}
            strokeWidth={5}
            strokeDasharray={dashArray}
            strokeDashoffset={0}
            strokeLinecap="round"
            style={{ transition: "stroke-dasharray 0.6s ease" }}
          />
        </svg>
        <div>
          <div style={{ fontSize: 28, fontWeight: 800, color: statusColor, lineHeight: 1 }}>
            {data.score}
          </div>
          <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 4 }}>out of 100</div>
        </div>
      </div>

      {/* Label */}
      <div style={{ fontSize: 13, color: statusColor, fontWeight: 600 }}>
        {data.label}
      </div>

      {/* Counts row */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {data.counts.critical > 0 && (
          <Pill label={`${data.counts.critical} Critical`} color="var(--color-error)" />
        )}
        {data.counts.error > 0 && (
          <Pill label={`${data.counts.error} Error`} color="#f97316" />
        )}
        {data.counts.warning > 0 && (
          <Pill label={`${data.counts.warning} Warning`} color="var(--color-warning)" />
        )}
        {data.counts.info > 0 && (
          <Pill label={`${data.counts.info} Info`} color="var(--color-info)" />
        )}
        {data.counts.critical + data.counts.error + data.counts.warning + data.counts.info === 0 && (
          <span style={{ fontSize: 12, color: "var(--color-success)" }}>No issues detected</span>
        )}
      </div>

      {selected && (
        <div style={{ fontSize: 12, color: "var(--color-primary)", fontWeight: 500, marginTop: 2 }}>
          ↓ showing details below
        </div>
      )}
    </div>
  );
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        fontSize: 11,
        fontWeight: 600,
        color,
        background: `${color}22`,
        padding: "2px 8px",
        borderRadius: 20,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}

// ─── Drill-down panel ─────────────────────────────────────────────────────────

function DrillDown({ id, data }: { id: CategoryKey; data: CategoryScore }) {
  const statusColor = STATUS_COLOR[data.status] ?? "var(--color-text-muted)";

  return (
    <div
      style={{
        background: "var(--color-surface)",
        border: "1px solid var(--color-primary)44",
        borderRadius: "var(--radius)",
        padding: "24px",
        animation: "fadeSlideIn 0.2s ease",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--color-text)" }}>
            {data.emoji} {CATEGORY_LABELS[id]} — Detailed Issues
          </div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 4 }}>
            Score: <span style={{ color: statusColor, fontWeight: 600 }}>{data.score}/100</span>
            {" · "}
            {data.topIssues.length === 0 ? "No issues" : `${data.topIssues.length} rule${data.topIssues.length > 1 ? "s" : ""} fired`}
          </div>
        </div>
        <div
          style={{
            fontSize: 36,
            fontWeight: 800,
            color: statusColor,
            lineHeight: 1,
          }}
        >
          {data.score}
        </div>
      </div>

      {data.topIssues.length === 0 ? (
        <div
          style={{
            textAlign: "center",
            padding: "40px 20px",
            color: "var(--color-success)",
            background: "rgba(52,211,153,0.06)",
            borderRadius: "var(--radius)",
            border: "1px solid rgba(52,211,153,0.15)",
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8 }}>✓</div>
          <div style={{ fontWeight: 600, fontSize: 15 }}>No issues detected</div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginTop: 4 }}>
            This category is healthy within the current time window.
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {data.topIssues.map((issue) => (
            <IssueCard key={issue.ruleId} issue={issue} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Overall score dial ───────────────────────────────────────────────────────

function OverallDial({ score, grade, trend }: { score: number; grade: string; trend: string }) {
  const r = 56;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - score / 100);

  const color =
    score >= 90 ? "var(--color-success)" :
    score >= 75 ? "var(--color-warning)" :
    score >= 50 ? "#f97316" :
    "var(--color-error)";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}>
      <div style={{ position: "relative", width: 140, height: 140 }}>
        <svg
          width={140} height={140}
          style={{ transform: "rotate(-90deg)" }}
          viewBox="0 0 140 140"
        >
          <circle cx={70} cy={70} r={r} fill="none" stroke="var(--color-border)" strokeWidth={8} />
          <circle
            cx={70} cy={70} r={r}
            fill="none"
            stroke={color}
            strokeWidth={8}
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(.4,0,.2,1)" }}
          />
        </svg>
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
          }}
        >
          <span style={{ fontSize: 34, fontWeight: 800, color, lineHeight: 1 }}>{score}</span>
          <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>/ 100</span>
        </div>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
        <span
          style={{
            fontSize: 18,
            fontWeight: 800,
            color,
            background: `${color}22`,
            padding: "4px 14px",
            borderRadius: 20,
          }}
        >
          Grade {grade}
        </span>
        <span
          style={{
            fontSize: 15,
            fontWeight: 600,
            color: TREND_COLOR[trend],
          }}
          title={`Trend: ${trend}`}
        >
          {TREND_ICON[trend]} {trend}
        </span>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function HealthPage() {
  const { data, loading, error, refresh, windowMs, setWindowMs } = useHealthScore();
  const [selectedCategory, setSelectedCategory] = useState<CategoryKey | null>(null);

  const handleCategoryClick = (id: CategoryKey) => {
    setSelectedCategory((prev) => (prev === id ? null : id));
  };

  if (loading && !data) {
    return (
      <div style={{ padding: 40, color: "var(--color-text-muted)", textAlign: "center" }}>
        <div style={{ fontSize: 24, marginBottom: 12, animation: "spin 1s linear infinite" }}>⟳</div>
        Loading health score…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40 }}>
        <div
          style={{
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.25)",
            borderRadius: "var(--radius)",
            padding: 24,
            color: "var(--color-error)",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Could not load health score</div>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", marginBottom: 16 }}>{error}</div>
          <button
            onClick={refresh}
            style={{
              background: "var(--color-primary)",
              color: "#fff",
              border: "none",
              borderRadius: "var(--radius)",
              padding: "8px 16px",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 13,
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const categories: CategoryKey[] = ["errors", "performance", "scalability", "architecture"];

  return (
    <div style={{ padding: "32px 40px", maxWidth: 1100, margin: "0 auto" }}>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 36 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: "var(--color-text)", marginBottom: 4 }}>
            Project Health
          </h1>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)" }}>
            Updated {formatRelative(data.computedAt)}
            {" · "}
            {data.eventCount} events · {data.issueCount} issues
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {/* Window selector */}
          <div style={{ display: "flex", background: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
            {WINDOWS.map((w) => (
              <button
                key={w.ms}
                onClick={() => setWindowMs(w.ms)}
                style={{
                  background: windowMs === w.ms ? "var(--color-primary)" : "transparent",
                  color:      windowMs === w.ms ? "#fff" : "var(--color-text-muted)",
                  border: "none",
                  padding: "6px 14px",
                  cursor: "pointer",
                  fontWeight: 600,
                  fontSize: 12,
                  transition: "all 0.15s",
                }}
              >
                {w.label}
              </button>
            ))}
          </div>

          <button
            onClick={refresh}
            disabled={loading}
            title="Refresh"
            style={{
              background: "var(--color-surface)",
              color: loading ? "var(--color-text-muted)" : "var(--color-text)",
              border: "1px solid var(--color-border)",
              borderRadius: "var(--radius)",
              padding: "6px 12px",
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 16,
              transition: "all 0.15s",
            }}
          >
            {loading ? "…" : "⟳"}
          </button>
        </div>
      </div>

      {/* Overall score + summary */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: 40,
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius)",
          padding: "28px 36px",
          marginBottom: 28,
          alignItems: "center",
        }}
      >
        <OverallDial score={data.overall} grade={data.grade} trend={data.trend} />

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontSize: 13, color: "var(--color-text-muted)", fontWeight: 500, letterSpacing: "0.05em", textTransform: "uppercase" }}>
            Summary
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: "8px 24px",
            }}
          >
            {categories.map((key) => {
              const cat = data.categories[key];
              const statusColor = STATUS_COLOR[cat.status] ?? "var(--color-text-muted)";
              return (
                <div
                  key={key}
                  onClick={() => handleCategoryClick(key)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "6px 10px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: selectedCategory === key ? "rgba(99,102,241,0.08)" : "transparent",
                    transition: "background 0.15s",
                  }}
                >
                  <span style={{ fontSize: 16 }}>{cat.emoji}</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: "var(--color-text)", minWidth: 100 }}>
                    {CATEGORY_LABELS[key]}
                  </span>
                  <span style={{ fontSize: 13, color: statusColor, fontWeight: 500 }}>
                    {cat.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Category cards grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 16,
          marginBottom: 24,
        }}
      >
        {categories.map((key) => (
          <CategoryCard
            key={key}
            id={key}
            data={data.categories[key]}
            selected={selectedCategory === key}
            onClick={() => handleCategoryClick(key)}
          />
        ))}
      </div>

      {/* Drill-down panel */}
      {selectedCategory && (
        <DrillDown id={selectedCategory} data={data.categories[selectedCategory]} />
      )}

      <style>{`
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
