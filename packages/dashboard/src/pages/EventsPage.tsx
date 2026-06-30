import { useState } from "react";
import { Link } from "react-router-dom";
import { useEvents } from "../hooks/useEvents.js";
import { SeverityBadge } from "../components/SeverityBadge.js";

export function EventsPage() {
  const [page, setPage] = useState(1);
  const { data, loading, error } = useEvents(page);

  return (
    <div style={{ padding: 32 }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700 }}>Events</h1>
        <p style={{ color: "var(--color-text-muted)", marginTop: 4 }}>
          All captured frontend errors, sorted by most recent
        </p>
      </div>

      {loading && <p style={{ color: "var(--color-text-muted)" }}>Loading…</p>}
      {error && <p style={{ color: "var(--color-error)" }}>{error}</p>}

      {data && (
        <>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)", textAlign: "left" }}>
                {["Severity", "Message", "App", "URL", "Time", "AI"].map((h) => (
                  <th
                    key={h}
                    style={{
                      padding: "8px 12px",
                      color: "var(--color-text-muted)",
                      fontWeight: 500,
                      fontSize: 12,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.data.map((event) => (
                <tr
                  key={event.id}
                  style={{ borderBottom: "1px solid var(--color-border)" }}
                >
                  <td style={{ padding: "10px 12px" }}>
                    <SeverityBadge severity={event.severity} />
                  </td>
                  <td style={{ padding: "10px 12px", maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    <Link to={`/events/${event.id}`}>{event.message}</Link>
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--color-text-muted)" }}>
                    {event.appName}
                  </td>
                  <td
                    style={{
                      padding: "10px 12px",
                      color: "var(--color-text-muted)",
                      maxWidth: 200,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {event.url}
                  </td>
                  <td style={{ padding: "10px 12px", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
                    {new Date(event.timestamp).toLocaleString()}
                  </td>
                  <td style={{ padding: "10px 12px" }}>
                    {event.hasAiAnalysis ? (
                      <span style={{ color: "var(--color-success)", fontSize: 12 }}>✓ Ready</span>
                    ) : (
                      <span style={{ color: "var(--color-text-muted)", fontSize: 12 }}>Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Pagination */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 20 }}>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              style={btnStyle}
            >
              ← Prev
            </button>
            <span style={{ color: "var(--color-text-muted)", fontSize: 13 }}>
              Page {page} · {data.total} events
            </span>
            <button
              onClick={() => setPage((p) => p + 1)}
              disabled={page * 20 >= data.total}
              style={btnStyle}
            >
              Next →
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const btnStyle: React.CSSProperties = {
  padding: "6px 14px",
  borderRadius: "var(--radius)",
  border: "1px solid var(--color-border)",
  background: "var(--color-surface)",
  color: "var(--color-text)",
  cursor: "pointer",
  fontSize: 13,
};
