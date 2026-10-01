import { ArrowLeft, ArrowRight, ArrowSquareOut, CircleNotch, Copy, ShieldCheck, ShieldWarning } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { api, setToken } from "../api";
import { AnatomyCard, StageBar, stageTotal } from "../components/Anatomy";
import { DayBars, LatencyChart } from "../components/Charts";
import { Shell, Skeleton } from "../components/Shell";
import { StatusBadge } from "../components/Status";
import { ago, clockTime, copyText, dateTime, fmtMs, fmtPct, useLive, useNow } from "../hooks";
import { ApiError } from "../types";

export default function MonitorPage({ id }: { id: number }) {
  const { data: m, error, reload } = useLive(() => api.monitor(id), [id], (e) => e.monitor_id === id);
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const confirmRef = useRef<HTMLDialogElement>(null);
  const [copied, setCopied] = useState<"" | "yes" | "no">("");

  async function act(name: string, fn: () => Promise<unknown>) {
    setBusy(name); setNotice(null);
    try { await fn(); reload(); }
    catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        const t = prompt("This needs the admin token (the server's ADMIN_TOKEN setting):");
        if (t) { setToken(t.trim()); return act(name, fn); }
      }
      setNotice(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally { setBusy(null); }
  }

  if (error === "not-found") return <Shell active="dashboard"><div className="mx-auto max-w-[720px] px-6 py-20"><h1 className="text-[28px] font-semibold">That monitor doesn't exist</h1><p className="mt-2 text-muted">It may have been deleted. <a className="font-medium text-ink underline" href="#/dashboard">See all monitors</a></p></div></Shell>;

  const stat = (label: string, value: string) => (
    <div><p className="num text-[24px] font-semibold tracking-tight">{value}</p><p className="text-[14px] text-muted">{label}</p></div>
  );
  const btn = "inline-flex items-center gap-2 rounded-lg border border-line bg-surface px-3.5 py-2 text-[15px] font-medium transition-transform duration-100 hover:border-muted active:scale-[0.98] disabled:opacity-60";

  return (
    <Shell active="dashboard">
      <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <a href="#/dashboard" className="inline-flex items-center gap-1.5 text-[15px] text-muted hover:text-ink"><ArrowLeft size={16} aria-hidden /> All monitors</a>
        {!m ? (
          <div className="mt-6 grid gap-4"><Skeleton className="h-12 w-72" /><Skeleton className="h-24" /><Skeleton className="h-56" /></div>
        ) : (
          <>
            <header className="mt-5 flex flex-wrap items-start gap-x-6 gap-y-4">
              <div className="mr-auto min-w-0">
                <h1 className="text-[34px] font-semibold tracking-tight">{m.name}</h1>
                <a href={m.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1.5 font-mono text-[14px] text-muted hover:text-ink">
                  <span className="truncate">{m.method} {m.url}</span><ArrowSquareOut size={15} aria-hidden className="shrink-0" />
                </a>
                <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px]"><StatusBadge status={m.status} /><span className="text-muted">Checked every {m.interval_s < 60 ? `${m.interval_s} s` : `${m.interval_s / 60} min`}, last {ago(m.last_checked_at, now)}</span></p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className={btn} disabled={!!busy} onClick={() => act("check", () => api.checkNow(m.id))}>{busy === "check" && <CircleNotch className="animate-spin" size={16} aria-hidden />}{busy === "check" ? "Checking…" : "Check now"}</button>
                <button className={btn} disabled={!!busy} onClick={() => act("pause", () => api.update(m.id, { paused: !m.paused }))}>{m.paused ? "Resume" : "Pause"}</button>
                <button className={`${btn} text-down`} disabled={!!busy} onClick={() => confirmRef.current?.showModal()}>Delete…</button>
              </div>
            </header>
            {notice && <p className="mt-4 text-[15px] text-down" role="alert">{notice}</p>}

            <section aria-label="Summary" className="mt-8 grid grid-cols-2 gap-6 border-y border-line py-6 sm:grid-cols-5">
              {stat("uptime, 24 hours", fmtPct(m.uptime_24h))}
              {stat("uptime, 7 days", fmtPct(m.uptime_7d))}
              {stat("uptime, 30 days", fmtPct(m.uptime_30d))}
              {stat("median response", fmtMs(m.latency_24h.p50))}
              {stat("95th percentile", fmtMs(m.latency_24h.p95))}
            </section>

            <section className="mt-10" aria-labelledby="anatomy-title">
              <h2 id="anatomy-title" className="text-[20px] font-semibold tracking-tight">Where the time goes</h2>
              <p className="mt-1 text-[15px] text-muted">Every check opens a fresh connection, like a first-time visitor, and times each stage.</p>
              <div className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-5"><AnatomyCard stages={m.anatomy_24h.stages} samples={m.anatomy_24h.samples} /></div>
            </section>

            <section className="mt-10" aria-labelledby="rt-title">
              <h2 id="rt-title" className="text-[20px] font-semibold tracking-tight">Response time, last 24 hours</h2>
              <p className="mt-1 text-[15px] text-muted">Average of successful checks in each half hour, in milliseconds.</p>
              <div className="mt-4 rounded-[var(--radius-card)] border border-line bg-surface p-4"><LatencyChart series={m.series_24h} p50={m.latency_24h.p50} /></div>
            </section>

            <section className="mt-10" aria-labelledby="days-title">
              <h2 id="days-title" className="text-[20px] font-semibold tracking-tight">Last 90 days</h2>
              <div className="mt-4"><DayBars days={m.days} height={40} /></div>
              <div className="mt-2 flex justify-between text-[13px] text-muted"><span>90 days ago</span><span>today</span></div>
            </section>

            <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
              <section aria-labelledby="cert-title" className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <h2 id="cert-title" className="flex items-center gap-2 text-[17px] font-semibold">
                  {m.cert?.error || (m.cert?.days_left ?? 99) < 14 ? <ShieldWarning size={20} weight="fill" className={m.cert?.error || (m.cert?.days_left ?? 0) < 0 ? "text-down" : "text-warn"} aria-hidden /> : <ShieldCheck size={20} aria-hidden />}
                  Security certificate
                </h2>
                {!m.url.startsWith("https://") ? <p className="mt-2 text-[15px] text-muted">This address uses plain HTTP, so there's no certificate to check. Visitors' browsers will mark it “Not secure”.</p>
                  : !m.cert ? <p className="mt-2 text-[15px] text-muted">Not read yet. Relay reads it after the next check, then twice a day.</p>
                  : m.cert.error ? <p className="mt-2 text-[15px] text-down">{m.cert.error[0].toUpperCase() + m.cert.error.slice(1)}. Browsers will show visitors a security warning.</p>
                  : <>
                      <p className={`num mt-2 text-[32px] font-semibold tracking-tight ${(m.cert.days_left ?? 0) < 0 ? "text-down" : (m.cert.days_left ?? 99) < 14 ? "text-warn" : ""}`}>
                        {(m.cert.days_left ?? 0) < 0 ? "Expired" : `${Math.floor(m.cert.days_left ?? 0)} days left`}
                      </p>
                      <p className="text-[15px] text-muted">Expires {m.cert.expires_at ? dateTime(m.cert.expires_at) : "on an unknown date"}. {(m.cert.days_left ?? 99) < 14 ? "Renew it soon: an expired certificate blocks every visitor." : "Relay re-reads it twice a day."}</p>
                    </>}
              </section>
              <section aria-labelledby="badge-title" className="rounded-[var(--radius-card)] border border-line bg-surface p-5">
                <h2 id="badge-title" className="text-[17px] font-semibold">README badge</h2>
                <p className="mt-1 text-[15px] text-muted">Live 30-day uptime for this site, for a GitHub README.{api.demo ? " (In this demo it's drawn in your browser; a self-hosted Relay serves it.)" : ""}</p>
                <img src={api.badgeUrl(m.id)} alt={`Uptime badge for ${m.name}`} className="mt-4 h-5" />
                {(() => {
                  const md = `[![uptime](${api.demo ? `https://your-relay.example/api/monitors/${m.id}/badge.svg` : api.badgeUrl(m.id)})](${api.demo ? "https://your-relay.example/#/status" : new URL("#/status", location.href).href})`;
                  return (
                    <div className="mt-4 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded-md bg-sunk px-2.5 py-1.5 font-mono text-[12px]" translate="no">{md}</code>
                      <button onClick={() => { copyText(md).then((ok) => { setCopied(ok ? "yes" : "no"); setTimeout(() => setCopied(""), 2000); }); }}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[13px] font-medium hover:border-muted" aria-live="polite">
                        <Copy size={14} aria-hidden />{copied === "yes" ? "Copied" : copied === "no" ? "Select and copy it" : "Copy"}
                      </button>
                    </div>
                  );
                })()}
              </section>
            </div>

            <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-2">
              <section aria-labelledby="inc-title">
                <h2 id="inc-title" className="text-[20px] font-semibold tracking-tight">Incidents</h2>
                {m.incidents.length === 0 ? <p className="mt-3 text-[15px] text-muted">No incidents. Every outage of 3 or more failed checks in a row appears here.</p> : (
                  <ol className="mt-4 grid gap-4">
                    {m.incidents.map((i) => (
                      <li key={i.id} className="border-l-2 pl-4" style={{ borderColor: i.ongoing ? "var(--down)" : "var(--line)" }}>
                        <a href={`#/incidents/${i.id}`} className="group block">
                          <span className="block font-medium group-hover:underline">{i.cause}</span>
                          <span className="num block text-[14px] text-muted">Started {dateTime(i.started_at)}, {i.ongoing ? <span className="font-medium text-down">ongoing for {i.duration}</span> : `lasted ${i.duration}`}</span>
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-medium">Replay <ArrowRight size={13} aria-hidden /></span>
                        </a>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
              <section aria-labelledby="checks-title" className="min-w-0">
                <h2 id="checks-title" className="text-[20px] font-semibold tracking-tight">Latest checks</h2>
                <div className="mt-4 max-h-[420px] overflow-auto rounded-[var(--radius-card)] border border-line">
                  <table className="num w-full text-left text-[14px]">
                    <thead className="sticky top-0 bg-surface text-muted"><tr><th className="px-4 py-2 font-medium">Time</th><th className="px-4 py-2 font-medium">Result</th><th className="hidden px-4 py-2 font-medium sm:table-cell">Stages</th><th className="px-4 py-2 text-right font-medium">Response</th></tr></thead>
                    <tbody className="divide-y divide-line">
                      {m.checks.map((c) => (
                        <tr key={c.at}>
                          <td className="whitespace-nowrap px-4 py-2 text-muted">{clockTime(c.at)}</td>
                          <td className={`px-4 py-2 ${c.ok ? "" : "text-down"}`}>{c.ok ? `OK${c.status_code ? `, ${c.status_code}` : ""}` : c.error}</td>
                          <td className="hidden w-[30%] px-4 py-2 sm:table-cell">{c.timings ? <StageBar timings={c.timings} scale={Math.max(...m.checks.map((x) => (x.timings ? stageTotal(x.timings) : 0)))} height={8} /> : null}</td>
                          <td className="px-4 py-2 text-right">{fmtMs(c.ms)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>

            <dialog ref={confirmRef} aria-labelledby="del-title" className="m-auto w-[min(440px,calc(100vw-24px))] rounded-[var(--radius-card)] border border-line bg-surface p-6 text-ink backdrop:bg-ink/30">
              <h2 id="del-title" className="text-[20px] font-semibold">Delete {m.name}?</h2>
              <p className="mt-2 text-[15px] text-muted">Its checks and incident history are deleted too. This can't be undone.</p>
              <form method="dialog" className="mt-6 flex justify-end gap-3">
                <button className="rounded-lg px-4 py-2.5 font-medium text-muted hover:text-ink">Keep it</button>
                <button type="button" className="rounded-lg bg-down px-4 py-2.5 font-medium text-white" onClick={() => { confirmRef.current?.close(); act("delete", () => api.remove(m.id)).then(() => { location.hash = "#/dashboard"; }); }}>Delete monitor</button>
              </form>
            </dialog>
          </>
        )}
      </div>
    </Shell>
  );
}
