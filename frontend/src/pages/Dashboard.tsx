import { ArrowRight, Plus, ShieldWarning, WarningCircle } from "@phosphor-icons/react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { StageBar } from "../components/Anatomy";
import { Sparkline } from "../components/Charts";
import { LiveFeed } from "../components/LiveFeed";
import { MonitorForm } from "../components/MonitorForm";
import { Shell, Skeleton } from "../components/Shell";
import { StatusBadge } from "../components/Status";
import { ago, dateTime, fmtMs, fmtPct, useLive, useNow } from "../hooks";
import type { MonitorSummary } from "../types";

const Globe = lazy(() => import("../components/Globe"));

export function CertNote({ m }: { m: MonitorSummary }) {
  if (!m.cert) return null;
  if (m.cert.error) return <span className="inline-flex items-center gap-1 text-[13px] font-medium text-down"><ShieldWarning size={15} weight="fill" aria-hidden />Certificate problem</span>;
  const d = m.cert.days_left;
  if (d === null || d >= 14) return null;
  return <span className={`inline-flex items-center gap-1 text-[13px] font-medium ${d < 0 ? "text-down" : "text-warn"}`}><ShieldWarning size={15} weight="fill" aria-hidden />{d < 0 ? "Certificate expired" : `Certificate expires in ${Math.max(0, Math.floor(d))} days`}</span>;
}

function Headline({ data }: { data: MonitorSummary[] }) {
  const active = data.filter((m) => !m.paused);
  const down = active.filter((m) => m.status === "down");
  const ups = active.map((m) => m.uptime_24h).filter((u): u is number => u !== null);
  const p50s = active.map((m) => m.latency_p50).filter((v): v is number => v !== null).sort((a, b) => a - b);
  const n = active.length, d = down.length;
  const text = !n ? "Nothing to watch yet" : d === 0 ? (n === 1 ? "Your site is up" : `All ${n} sites are up`) : n === 1 ? "Your site is down" : `${d} of ${n} sites ${d === 1 ? "is" : "are"} down`;
  return (
    <div className="pointer-events-auto">
      <h1 className={`text-[34px] font-semibold leading-[1.05] tracking-[-0.03em] sm:text-[44px] ${down.length ? "text-down" : ""}`} aria-live="polite">{text}</h1>
      {down.length > 0 && <p className="mt-2 text-[16px]">{down.map((m) => m.name).join(", ")}</p>}
      <dl className="num mt-5 flex flex-wrap gap-x-8 gap-y-2">
        <div><dt className="text-[13px] text-muted">Average uptime, 24 h</dt><dd className="text-[20px] font-semibold">{ups.length ? fmtPct(ups.reduce((a, b) => a + b, 0) / ups.length) : "No data"}</dd></div>
        <div><dt className="text-[13px] text-muted">Typical response</dt><dd className="text-[20px] font-semibold">{p50s.length ? fmtMs(p50s[Math.floor(p50s.length / 2)]) : "No data"}</dd></div>
      </dl>
    </div>
  );
}

function FocusCard({ m, onClose }: { m: MonitorSummary; onClose: () => void }) {
  const now = useNow();
  return (
    <div className="pointer-events-auto w-[min(360px,100%)] rounded-[var(--radius-card)] border border-line bg-surface/90 p-4 shadow-[0_20px_60px_-30px_rgb(16_22_29/0.5)] backdrop-blur-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[17px] font-semibold">{m.name}</p>
          <p className="truncate text-[13px] text-muted">{m.place?.name ?? "Location unknown"}</p>
        </div>
        <button onClick={onClose} className="rounded-md px-2 py-1 text-[13px] text-muted hover:text-ink" aria-label="Stop following this site">Close</button>
      </div>
      <div className="mt-3 flex items-center justify-between text-[14px]"><StatusBadge status={m.status} short /><span className="num text-muted">{fmtMs(m.recent.at(-1)?.ms ?? null)}, {ago(m.last_checked_at, now)}</span></div>
      {m.last_timings && <div className="mt-3"><StageBar timings={m.last_timings} height={8} /></div>}
      <a href={`#/monitors/${m.id}`} className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium underline underline-offset-4">Open details <ArrowRight size={14} aria-hidden /></a>
    </div>
  );
}

function useWide() {
  const q = "(min-width: 1024px)";
  const [wide, setWide] = useState(() => matchMedia(q).matches);
  useEffect(() => { const m = matchMedia(q), on = () => setWide(m.matches); m.addEventListener("change", on); return () => m.removeEventListener("change", on); }, []);
  return wide;
}

export default function Dashboard() {
  const wide = useWide();
  const { data, error, reload } = useLive(() => api.monitors(), [], (e) => e.type !== "origin");
  const { data: origin } = useLive(() => api.origin(), [], (e) => e.type === "origin");
  const incidents = useLive(() => api.incidents(), [], (e) => e.type !== "check");
  const [adding, setAdding] = useState(false);
  const [focus, setFocus] = useState<number | null>(null);
  const now = useNow();
  const targets = useMemo(() => (data ?? []).filter((m) => m.place).map((m) => ({ id: m.id, name: m.name, status: m.status, lat: m.place!.lat, lon: m.place!.lon })), [data]);
  const local = (data ?? []).filter((m) => !m.place);
  const focused = data?.find((m) => m.id === focus) ?? null;
  const pick = (id: number | null) => setFocus((f) => (id === null || id === f ? null : id));

  return (
    <Shell active="dashboard" wide>
      <section aria-label="Control room" className="border-b border-line">
        <div className="mx-auto grid max-w-[1480px] lg:h-[min(80dvh,780px)] lg:min-h-[560px] lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="relative h-[62dvh] min-h-[420px] lg:h-auto">
            <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-muted">Loading the globe…</div>}>
              <div className="absolute inset-0"><Globe targets={targets} origin={origin ?? null} subscribe={api.subscribe} onSelect={pick} focusId={focus} inset={wide ? -0.34 : 0} /></div>
            </Suspense>
            <div className="pointer-events-none absolute inset-0 flex flex-col justify-between p-5 sm:p-8">
              {data ? <Headline data={data} /> : <Skeleton className="h-28 w-80" />}
              <div className="flex flex-col items-start gap-3">
                {focused ? <FocusCard m={focused} onClose={() => setFocus(null)} /> : (
                  <p className="max-w-[34ch] text-[14px] text-muted">
                    {origin ? `Arcs run from this server in ${origin.name} to each site. Drag to turn the globe; click a site to follow it.` : "Finding where this server is. Arcs appear once it's located."}
                  </p>
                )}
                {local.length > 0 && (
                  <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 text-[13px]">
                    <span className="text-muted">Not on the map:</span>
                    {local.map((m) => (
                      <a key={m.id} href={`#/monitors/${m.id}`} className={`rounded-full border border-line bg-surface/80 px-2.5 py-1 font-medium backdrop-blur ${m.status === "down" ? "text-down" : ""}`}>{m.name}</a>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
          <aside aria-labelledby="feed-title" className="flex min-h-0 flex-col border-line bg-surface/70 max-lg:border-t lg:border-l">
            <div className="flex items-center justify-between px-4 pt-4 pb-3">
              <h2 id="feed-title" className="text-[15px] font-semibold">Live checks</h2>
              <span className="flex items-center gap-2 text-[13px] text-muted"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60 motion-reduce:hidden" /><span className="relative inline-flex h-2 w-2 rounded-full bg-up" /></span>Streaming</span>
            </div>
            <div className="max-h-[360px] min-h-0 flex-1 overflow-y-auto lg:max-h-none"><LiveFeed onPick={(id) => setFocus(id)} max={40} /></div>
          </aside>
        </div>
      </section>

      <div className="mx-auto grid max-w-[1480px] gap-10 px-4 py-10 sm:px-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="monitors-title" className="min-w-0">
          <div className="mb-5 flex flex-wrap items-end gap-4">
            <h2 id="monitors-title" className="mr-auto text-[24px] font-semibold tracking-tight">Every site</h2>
            <button onClick={() => setAdding(true)} className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-[15px] font-medium text-bg transition-transform duration-100 active:scale-[0.98]">
              <Plus size={18} weight="bold" aria-hidden /> Add monitor
            </button>
          </div>
          {error && !data && (
            <div className="flex items-start gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-5" role="alert">
              <WarningCircle size={22} className="mt-0.5 text-down" aria-hidden />
              <div><p className="font-medium">Couldn't reach the Relay server.</p><p className="text-[15px] text-muted">Check that it's running. This page retries every 30 seconds. <button className="font-medium text-ink underline" onClick={reload}>Retry now</button></p></div>
            </div>
          )}
          {!data && !error && <div className="grid gap-2">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[76px]" />)}</div>}
          {data?.length === 0 && (
            <div className="rounded-[var(--radius-card)] border border-dashed border-line p-10 text-center">
              <p className="text-[17px] font-medium">Add the first site to check</p>
              <p className="mx-auto mt-1 max-w-[46ch] text-[15px] text-muted">Point Relay at a homepage or a health-check address. It starts checking right away and finds the site on the globe.</p>
              <button onClick={() => setAdding(true)} className="mt-5 rounded-lg bg-ink px-4 py-2.5 text-[15px] font-medium text-bg">Add monitor</button>
            </div>
          )}
          {data && data.length > 0 && (
            <ul className="divide-y divide-line overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface">
              {data.map((m) => (
                <li key={m.id}>
                  <a href={`#/monitors/${m.id}`} onMouseEnter={() => m.place && setFocus(m.id)}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-6 gap-y-2 px-5 py-4 transition-colors duration-150 hover:bg-sunk/60 md:grid-cols-[96px_minmax(0,1fr)_auto_90px_80px]">
                    <StatusBadge status={m.status} short />
                    <span className="min-w-0 max-md:order-first max-md:col-span-2">
                      <span className="flex flex-wrap items-baseline gap-x-3"><span className="truncate font-medium">{m.name}</span><CertNote m={m} /></span>
                      <span className="block truncate font-mono text-[13px] text-muted">{m.url}</span>
                    </span>
                    <span className="hidden md:block"><Sparkline recent={m.recent} label={m.name} /></span>
                    <span className="num text-right"><span className="block font-medium">{fmtPct(m.uptime_24h)}</span><span className="block text-[13px] text-muted">24 h uptime</span></span>
                    <span className="num hidden text-right md:block"><span className="block font-medium">{fmtMs(m.latency_p50)}</span><span className="block text-[13px] text-muted">{ago(m.last_checked_at, now)}</span></span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
        <aside aria-labelledby="incidents-title">
          <h2 id="incidents-title" className="mb-5 text-[24px] font-semibold tracking-tight">Incidents</h2>
          {!incidents.data && <Skeleton className="h-40" />}
          {incidents.data?.length === 0 && <p className="text-[15px] text-muted">None yet. When a site fails 3 checks in a row, the incident appears here and you can replay it.</p>}
          <ol className="grid gap-5">
            {incidents.data?.slice(0, 8).map((i) => (
              <li key={i.id} className="border-l-2 pl-4" style={{ borderColor: i.ongoing ? "var(--down)" : "var(--line)" }}>
                <a href={`#/incidents/${i.id}`} className="group block">
                  <span className="font-medium group-hover:underline">{i.monitor_name}</span>
                  <span className="block text-[14px] text-muted">{i.cause}</span>
                  <span className="num block text-[13px] text-muted">{dateTime(i.started_at)}, {i.ongoing ? <span className="font-medium text-down">ongoing for {i.duration}</span> : `lasted ${i.duration}`}</span>
                  <span className="mt-1 inline-flex items-center gap-1 text-[13px] font-medium">Replay <ArrowRight size={13} aria-hidden /></span>
                </a>
              </li>
            ))}
          </ol>
        </aside>
      </div>
      <MonitorForm open={adding} onClose={() => setAdding(false)} onCreated={(id) => { reload(); location.hash = `#/monitors/${id}`; }} />
    </Shell>
  );
}
