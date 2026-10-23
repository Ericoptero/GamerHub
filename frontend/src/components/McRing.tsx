import { mcColor } from "../lib/constants";

const CIRC = 169.6; // 2πr com r = 27

export function McRing({ score, size = 72 }: { score: number | null; size?: number }) {
  const dash = `${score !== null ? ((score / 100) * CIRC).toFixed(1) : 0} ${CIRC}`;
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
      <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={`Metacritic ${score ?? "sem nota"}`}>
        <circle cx="32" cy="32" r="27" fill="none" stroke="var(--border-input)" strokeWidth="6" />
        <circle
          cx="32"
          cy="32"
          r="27"
          fill="none"
          stroke={mcColor(score)}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={dash}
          transform="rotate(-90 32 32)"
        />
      </svg>
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 24,
        }}
      >
        {score ?? "—"}
      </span>
    </div>
  );
}
