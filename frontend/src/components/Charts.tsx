import type { Day, MonitorDetail, Recent } from "../types";

/** The last 30 checks as bars: height is response time, red is a failure. */
export function Sparkline({ recent, label }: { recent: Recent[]; label: string }) {
  const max = Math.max(1, ...recent.map((r) => r.ms ?? 0));
  const w = 4, gap = 2, h = 28;
  const fails = recent.filter((r) => !r.ok).length;
  return (
    <svg width={30 * (w + gap)} height={h} viewBox={`0 0 ${30 * (w + gap)} ${h}`} role="img"
      aria-label={`${label}: last ${recent.length} checks, ${fails} failed`}>
      {recent.map((r, i) => {
        const bh = r.ok ? Math.max(3, (h * (r.ms ?? 0)) / max) : h;
        return <rect key={i} x={(30 - recent.length + i) * (w + gap)} y={h - bh} width={w} height={bh} rx={1}
          fill={r.ok ? "var(--ink)" : "var(--down)"} opacity={r.ok ? 0.35 : 1} />;
      })}
    </svg>
  );
}

const LEVEL = { up: "var(--up)", partial: "var(--warn)", down: "var(--down)", none: "var(--line)" } as const;
const LEVEL_TEXT = { up: "no downtime", partial: "some downtime", down: "major outage", none: "no data" } as const;

/** One bar per day for the last 90 days. */
export function DayBars({ days, height = 34 }: { days: Day[]; height?: number }) {
  const n = days.length;
  return (
    <svg className="w-full" height={height} viewBox={`0 0 ${n * 4} ${height}`} preserveAspectRatio="none" role="img"
      aria-label={`Daily uptime for the last ${n} days: ${days.filter((d) => d.level === "up").length} days with no downtime`}>
      {days.map((d, i) => (
        <rect key={d.date} x={i * 4 + 0.6} y={0} width={2.8} height={height} rx={0.8} fill={LEVEL[d.level]} opacity={d.level === "up" ? 0.55 : 1}>
          <title>{`${d.date}: ${d.uptime === null ? "no data" : `${d.uptime}% uptime`}, ${LEVEL_TEXT[d.level]}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** Average response time over 24 hours, with failures marked underneath. */
export function LatencyChart({ series, p50 }: { series: MonitorDetail["series_24h"]; p50: number | null }) {
  const W = 720, H = 190, pad = 34, max = Math.max(50, ...series.map((s) => s.avg ?? 0)) * 1.15;
  const x = (i: number) => pad + (i * (W - pad - 8)) / (series.length - 1);
  const y = (v: number) => 12 + (H - 52) * (1 - v / max);
  let d = "", open = false;
  series.forEach((s, i) => {
    if (s.avg === null) { open = false; return; }
    d += `${open ? "L" : "M"}${x(i).toFixed(1)},${y(s.avg).toFixed(1)}`;
    open = true;
  });
  const ticks = [0, max / 2, max].map((v) => Math.round(v / 10) * 10);
  const failures = series.filter((s) => s.failures).length;
  return (
    <svg className="w-full" viewBox={`0 0 ${W} ${H}`} role="img"
      aria-label={`Response time over the last 24 hours. Median ${p50 === null ? "unknown" : Math.round(p50) + " ms"}. Failures in ${failures} of ${series.length} half-hour periods.`}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad} x2={W - 8} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeDasharray={t ? "3 4" : undefined} />
          <text x={pad - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="num">{t}</text>
        </g>
      ))}
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      {series.map((s, i) => s.failures > 0 && (
        <rect key={i} x={x(i) - 3} y={H - 30} width={6} height={10} rx={1.5} fill="var(--down)">
          <title>{`${s.failures} failed check${s.failures === 1 ? "" : "s"}`}</title>
        </rect>
      ))}
      <text x={pad} y={H - 4} fontSize="11" fill="var(--muted)">24 hours ago</text>
      <text x={W - 8} y={H - 4} fontSize="11" fill="var(--muted)" textAnchor="end">now</text>
      <text x={W - 8} y={H - 34} fontSize="11" fill="var(--muted)" textAnchor="end">failures</text>
    </svg>
  );
}
