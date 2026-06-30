import type { EventSeverity } from "@frontend-guardian/types";

const COLOR: Record<EventSeverity, string> = {
  fatal: "#fca5a5",
  error: "#f87171",
  warning: "#fbbf24",
  info: "#60a5fa",
  debug: "#a78bfa",
};

const BG: Record<EventSeverity, string> = {
  fatal: "#450a0a",
  error: "#3b0a0a",
  warning: "#3b2200",
  info: "#0c2340",
  debug: "#1e1245",
};

interface Props {
  severity: EventSeverity;
}

export function SeverityBadge({ severity }: Props) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.05em",
        color: COLOR[severity],
        background: BG[severity],
      }}
    >
      {severity}
    </span>
  );
}
