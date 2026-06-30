import { useParams, Link } from "react-router-dom";
import { useEvent } from "../hooks/useEvent.js";
import { SeverityBadge } from "../components/SeverityBadge.js";

export function EventDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { event, analysis, loading, error } = useEvent(id);

  if (loading) return <p style={{ padding: 32, color: "var(--color-text-muted)" }}>Loading…</p>;
  if (error) return <p style={{ padding: 32, color: "var(--color-error)" }}>{error}</p>;
  if (!event) return null;

  return (
    <div style={{ padding: 32, maxWidth: 860 }}>
      <div style={{ marginBottom: 20 }}>
        <Link to="/" style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
          ← Back to Events
        </Link>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <SeverityBadge severity={event.severity} />
        <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>
          {new Date(event.timestamp).toLocaleString()}
        </span>
      </div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>{event.message}</h1>
      <p style={{ color: "var(--color-text-muted)", fontSize: 13, marginBottom: 24 }}>
        {event.appName} · {event.url}
      </p>

      {/* Stack trace */}
      <section style={cardStyle}>
        <h2 style={sectionTitle}>Stack Trace</h2>
        <pre
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 12,
            overflowX: "auto",
            padding: 16,
            background: "var(--color-bg)",
            borderRadius: "var(--radius)",
            color: "var(--color-text)",
          }}
        >
          {event.stack.map((f, i) => (
            <div key={i} style={{ color: f.inApp ? "var(--color-text)" : "var(--color-text-muted)" }}>
              {"  at "}
              <span style={{ color: f.inApp ? "var(--color-primary)" : undefined }}>{f.function}</span>
              {" ("}
              {f.filename}:{f.lineno}:{f.colno}
              {")"}
            </div>
          ))}
        </pre>
      </section>

      {/* AI Analysis */}
      {analysis && (
        <section style={{ ...cardStyle, marginTop: 20 }}>
          <h2 style={sectionTitle}>
            🤖 AI Analysis
            <span
              style={{
                marginLeft: 8,
                fontSize: 11,
                padding: "2px 8px",
                borderRadius: 999,
                background: "rgba(52,211,153,0.15)",
                color: "var(--color-success)",
              }}
            >
              {Math.round((analysis.confidence ?? 0) * 100)}% confidence
            </span>
          </h2>
          <AiRow label="Summary" value={analysis.summary} />
          <AiRow label="Root Cause" value={analysis.rootCause} />
          <AiRow label="Suggested Fix" value={analysis.suggestedFix} />
          {analysis.affectedFiles.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <span style={labelStyle}>Affected Files</span>
              <ul style={{ marginTop: 6, paddingLeft: 20 }}>
                {analysis.affectedFiles.map((f) => (
                  <li key={f} style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-text)" }}>
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function AiRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <span style={labelStyle}>{label}</span>
      <p style={{ marginTop: 4, color: "var(--color-text)", lineHeight: 1.7 }}>{value}</p>
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--color-surface)",
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius)",
  padding: 20,
};

const sectionTitle: React.CSSProperties = {
  fontSize: 14,
  fontWeight: 600,
  marginBottom: 12,
  color: "var(--color-text)",
  display: "flex",
  alignItems: "center",
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "var(--color-text-muted)",
};
