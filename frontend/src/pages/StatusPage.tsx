import { CheckCircle, WarningCircle, XCircle } from "@phosphor-icons/react";
import { api } from "../api";
import { DayBars } from "../components/Charts";
import { Mark, Shell, Skeleton } from "../components/Shell";
import { StatusBadge } from "../components/Status";
import { dateTime, fmtPct, useLive } from "../hooks";

const OVERALL = {
  operational: { text: "All systems operational", cls: "text-up", Icon: CheckCircle },
  partial_outage: { text: "Some systems are down", cls: "text-warn", Icon: WarningCircle },
  major_outage: { text: "Major outage", cls: "text-down", Icon: XCircle },
};

/** The public status page. `compact` is the version embedded on the landing page. */
export function StatusBoard({ compact = false }: { compact?: boolean }) {
  const { data } = useLive(() => api.status(), [], (e) => e.type !== "check" || !compact);
  if (!data) return <div className="grid gap-3"><Skeleton className="h-16" /><Skeleton className="h-48" /></div>;
  const o = OVERALL[data.overall];
  const rows = compact ? data.monitors.slice(0, 4) : data.monitors;
  return (
    <div>
      <div className={`flex items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface px-5 py-4 text-[18px] font-semibold ${o.cls}`} role="status">
        <o.Icon size={26} weight="fill" aria-hidden /> {o.text}
      </div>
      <ul className="mt-6 grid gap-7">
        {rows.map((m) => (
          <li key={m.id}>
            <div className="mb-2 flex items-baseline justify-between gap-4">
              <span className="font-medium">{m.name}</span>
              <span className="flex items-center gap-4 text-[14px]"><span className="num text-muted">{fmtPct(m.uptime_90d, 2)} uptime</span><StatusBadge status={m.status} short /></span>
            </div>
            <DayBars days={m.days} />
          </li>
        ))}
      </ul>
      {compact && data.monitors.length > rows.length && <p className="mt-5 text-[14px] text-muted">and {data.monitors.length - rows.length} more on the full page</p>}
      {!compact && (
        <section className="mt-14" aria-labelledby="past-title">
          <h2 id="past-title" className="text-[20px] font-semibold tracking-tight">Incidents in the last 14 days</h2>
          {data.incidents.length === 0 ? <p className="mt-3 text-muted">None.</p> : (
            <ol className="mt-4 grid gap-5">
              {data.incidents.map((i) => (
                <li key={i.id} className="border-l-2 pl-4" style={{ borderColor: i.ongoing ? "var(--down)" : "var(--line)" }}>
                  <p className="font-medium">{i.monitor_name}: {i.ongoing ? "investigating" : "resolved"}</p>
                  <p className="num text-[14px] text-muted">{dateTime(i.started_at)}, {i.ongoing ? `ongoing for ${i.duration}` : `lasted ${i.duration}`}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      )}
    </div>
  );
}

export default function StatusPage() {
  const { data } = useLive(() => api.status(), []);
  if (data) document.title = data.title;
  return (
    <Shell active="status">
      <div className="mx-auto max-w-[760px] px-4 py-12 sm:px-6">
        <h1 className="mb-8 text-[34px] font-semibold tracking-tight">{data?.title ?? "Service status"}</h1>
        <StatusBoard />
        <p className="mt-16 flex items-center justify-center gap-2 text-[14px] text-muted"><Mark /> Powered by Relay</p>
      </div>
    </Shell>
  );
}
