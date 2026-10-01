import type { Stage, Timings } from "../types";

/** The stages of one request, in order, named the way a person would describe them.
 *  Shades of ink, not colours: colour on this site always means status. */
export const STAGES: { key: Stage; name: string; short: string; tone: number; explain: string }[] = [
  { key: "dns", name: "Finding the server", short: "DNS", tone: 0.2, explain: "Looking up the address's IP (DNS)." },
  { key: "connect", name: "Connecting", short: "Connect", tone: 0.36, explain: "Opening a connection: one round trip across the network." },
  { key: "tls", name: "Securing", short: "TLS", tone: 0.52, explain: "The HTTPS handshake that encrypts the connection." },
  { key: "wait", name: "Waiting for the server", short: "Wait", tone: 0.92, explain: "From sending the request to the first byte back: mostly the server working." },
  { key: "download", name: "Downloading", short: "Download", tone: 0.68, explain: "Receiving the rest of the response." },
];

export const stageTotal = (t: Timings) => STAGES.reduce((a, s) => a + (t[s.key] ?? 0), 0);

/** One request as a stacked bar. `scale` lets several bars share an axis. */
export function StageBar({ timings, scale, height = 10, label }: { timings: Timings; scale?: number; height?: number; label?: string }) {
  const total = stageTotal(timings), max = scale ?? total;
  if (!total) return <span className="text-[13px] text-muted">No timing data</span>;
  const parts = STAGES.filter((s) => (timings[s.key] ?? 0) > 0);
  return (
    <div className="flex w-full overflow-hidden rounded-[3px]" style={{ height }} role="img"
      aria-label={label ?? parts.map((s) => `${s.name} ${Math.round(timings[s.key]!)} ms`).join(", ")}>
      {parts.map((s) => (
        <div key={s.key} title={`${s.name}: ${Math.round(timings[s.key]!)} ms`} className="h-full border-r border-surface/60 last:border-r-0"
          style={{ width: `${(100 * timings[s.key]!) / max}%`, background: "var(--ink)", opacity: s.tone }} />
      ))}
    </div>
  );
}

/** The average request for a monitor, with a plain-language reading of it. */
export function AnatomyCard({ stages, samples }: { stages: Record<Stage, number | null>; samples: number }) {
  const t: Timings = Object.fromEntries(Object.entries(stages).filter(([, v]) => v !== null)) as Timings;
  const total = stageTotal(t);
  if (!samples || !total) {
    return <p className="text-[15px] text-muted">No stage timings yet. They appear after the next successful check.</p>;
  }
  const biggest = STAGES.reduce((a, s) => ((t[s.key] ?? 0) > (t[a.key] ?? 0) ? s : a), STAGES[0]);
  const network = (t.connect ?? 0) + (t.tls ?? 0);
  const reading =
    biggest.key === "wait" ? "Most of the time is the server working, so speeding it up means faster code or caching, not a closer server." :
    network > (t.wait ?? 0) ? "Most of the time is the trip across the network, so a server or CDN closer to your users would help most." :
    `The biggest part is ${biggest.name.toLowerCase()}.`;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-4">
        <p className="num text-[15px] text-muted">Average of {samples.toLocaleString()} successful checks</p>
        <p className="num text-[22px] font-semibold tracking-tight">{Math.round(total)} ms</p>
      </div>
      <div className="mt-3"><StageBar timings={t} height={28} /></div>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-5">
        {STAGES.map((s) => (
          <li key={s.key} className="min-w-0">
            <span className="flex items-center gap-2 text-[13px] text-muted">
              <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: "var(--ink)", opacity: s.tone }} aria-hidden />
              <span className="truncate">{s.name}</span>
            </span>
            <span className="num mt-0.5 block text-[17px] font-semibold">{t[s.key] === undefined ? "None" : `${Math.round(t[s.key]!)} ms`}</span>
          </li>
        ))}
      </ul>
      <p className="mt-4 max-w-[70ch] text-[15px] leading-relaxed">{reading}</p>
    </div>
  );
}
