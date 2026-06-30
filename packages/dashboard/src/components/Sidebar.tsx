import { NavLink } from "react-router-dom";

const NAV_ITEMS = [
  { label: "Health",   to: "/",       icon: "🛡️" },
  { label: "Events",   to: "/events", icon: "⚡" },
];

export function Sidebar() {
  return (
    <nav
      style={{
        width: 220,
        minHeight: "100vh",
        background: "var(--color-surface)",
        borderRight: "1px solid var(--color-border)",
        display: "flex",
        flexDirection: "column",
        padding: "24px 0",
        flexShrink: 0,
      }}
    >
      <div style={{ padding: "0 20px 24px", borderBottom: "1px solid var(--color-border)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 20 }}>🛡️</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--color-text)" }}>
            Frontend Guardian
          </span>
        </div>
      </div>

      <ul style={{ listStyle: "none", padding: "16px 8px", flex: 1 }}>
        {NAV_ITEMS.map((item) => (
          <li key={item.to}>
            <NavLink
              to={item.to}
              end
              style={({ isActive }) => ({
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                borderRadius: "var(--radius)",
                color: isActive ? "var(--color-primary)" : "var(--color-text-muted)",
                background: isActive ? "rgba(99,102,241,0.12)" : "transparent",
                fontWeight: isActive ? 600 : 400,
                textDecoration: "none",
                transition: "all 0.15s",
              })}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
