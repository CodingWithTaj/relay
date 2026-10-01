import { ArrowLeft, Pause, Play } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { Shell, Skeleton } from "../components/Shell";
import { StatusBadge } from "../components/Status";
import { dateTime, prefersReducedMotion, useLive } from "../hooks";
import type { CheckRow } from "../types";

type Moment = "first_failure" | "opened" | "first_success" | "resolved";
interface Step { check: CheckRow; fails: number; oks: number; down: boolean; moment?: Moment }

/** Re-run Relay's incident rule over the checks, one at a time (the same logic as relay/engine.py). */
function replaySteps(checks: CheckRow[], failAfter: number, recoverAfter: number): Step[] {
  let fails = 0, oks = 0, down = false;
  return checks.map((check) => {
    let moment: Moment | undefined;
    if (check.ok) {
      fails = 0; oks++;
      if (down && oks === 1) moment = "first_success";
      if (down && oks >= recoverAfter) { down = false; moment = "resolved"; }
    } else {
      oks = 0; fails++;
      if (!down && fails === 1) moment = "first_failure";
      if (!down && fails >= failAfter) { down = true; moment = "opened"; }
    }
    return { check, fails, oks, down, moment };
  });
}

const clock = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

export default function ReplayPage({ id }: { id: number }) {
  const { data: r, error } = useLive(() => api.replay(id), [id], () => false);
  const steps = useMemo(() => (r ? replaySteps(r.checks, r.fail_threshold, r.recover_threshold) : []), [r]);
  const [at, setAt] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => { if (steps.length) { setAt(0); setPlaying(!prefersReducedMotion()); } }, [steps.length]);
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setAt((i) => { if (i >= steps.length - 1) { setPlaying(false); return i; } return i + 1; }), steps.length > 40 ? 160 : 420);
    return () => clearInterval(t);
  }, [playing, steps.length]);

  if (error === "not-found") return <Shell active="dashboard"><div className="mx-auto max-w-[720px] px-6 py-20"><h1 className="text-[28px] font-semibold">That incident doesn't exist</h1><p className="mt-2 text-muted"><a className="font-medium text-ink underline" href="#/dashboard">Back to the dashboard</a></p></div></Shell>;

  const s = steps[at];
  const moments = steps.map((x, i) => ({ ...x, i })).filter((x) => x.moment);
  const narrate = (x: Step) => {
    if (!r) return "";
    if (x.moment === "first_failure") return `First failed check (${x.check.error}). One failure could be a blip, so Relay waits.`;
    if (x.moment === "opened") return `${r.fail_threshold} failures in a row: that's an outage. Relay opens an incident, dated from the first failure${r.alerts ? ", and sends the alert" : ""}.`;
    if (x.moment === "first_success") return `A successful check. The incident stays open until ${r.recover_threshold} pass in a row, in case it's flapping.`;
    if (x.moment === "resolved") return `${r.recover_threshold} successes in a row. The incident is resolved${r.alerts ? " and the all-clear goes out" : ""}.`;
    if (!x.check.ok) return x.down ? "Still failing. The incident stays open." : `Failure ${x.fails} of ${r.fail_threshold} in a row.`;
    return x.down ? `Success ${x.oks} of ${r.recover_threshold} in a row.` : "Normal: the check passed.";
  };
  const LABEL: Record<Moment, string> = { first_failure: "First failure", opened: "Incident opened", first_success: "First success", resolved: "Resolved" };

  return (
    <Shell active="dashboard">
      <div className="mx-auto max-w-[1100px] px-4 py-8 sm:px-6">
        <a href="#/dashboard" className="inline-flex items-center gap-1.5 text-[15px] text-muted hover:text-ink"><ArrowLeft size={16} aria-hidden /> Dashboard</a>
        {!r || !s ? <div className="mt-6 grid gap-4"><Skeleton className="h-12 w-96" /><Skeleton className="h-72" /></div> : (
          <>
            <header className="mt-5">
              <h1 className="text-[34px] font-semibold leading-tight tracking-tight sm:text-[42px]">{r.monitor.name} went down</h1>
              <p className="mt-2 text-[17px] text-muted">{dateTime(r.started_at)}, {r.ongoing ? `ongoing for ${r.duration}` : `lasted ${r.duration}`}. The checks said: <span className="text-ink">{r.cause}</span>.</p>
            </header>

            <section aria-label="Replay" className="mt-8 rounded-[20px] border border-line bg-surface p-5 sm:p-7">
              <div className="flex flex-wrap items-center gap-4">
                <button onClick={() => { if (at >= steps.length - 1) setAt(0); setPlaying((p) => !p); }}
                  className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-[15px] font-medium text-bg transition-transform duration-100 active:scale-[0.98]">
                  {playing ? <Pause size={16} weight="fill" aria-hidden /> : <Play size={16} weight="fill" aria-hidden />}{playing ? "Pause" : at >= steps.length - 1 ? "Replay" : "Play"}
                </button>
                <label className="flex min-w-[220px] flex-1 items-center gap-3 text-[14px] text-muted">
                  <span className="sr-only">Step through the checks</span>
                  <input type="range" min={0} max={steps.length - 1} value={at} onChange={(e) => { setPlaying(false); setAt(Number(e.target.value)); }} className="w-full accent-[var(--ink)]" />
                </label>
                <span className="num text-[14px] text-muted">Check {at + 1} of {steps.length}</span>
              </div>

              <div className="relative mt-8">
                <div className="relative h-11 text-[12px]">
                  {moments.map((m) => (
                    <span key={m.i} className={`absolute -translate-x-1/2 whitespace-nowrap font-medium transition-opacity duration-300 ${m.moment === "opened" || m.moment === "resolved" ? "top-0" : "top-5"} ${m.i <= at ? "opacity-100" : "opacity-30"} ${m.moment === "opened" ? "text-down" : m.moment === "resolved" ? "text-up" : "text-muted"}`}
                      style={{ left: `${((m.i + 0.5) / steps.length) * 100}%` }}>{LABEL[m.moment!]}</span>
                  ))}
                </div>
                <div className="flex h-24 items-end gap-[2px]" role="img" aria-label={`${steps.filter((x) => !x.check.ok).length} failed checks out of ${steps.length}`}>
                  {steps.map((x, i) => (
                    <button key={i} onClick={() => { setPlaying(false); setAt(i); }} aria-label={`Check at ${clock.format(new Date(x.check.at))}`}
                      className="relative h-full min-w-0 flex-1 rounded-[2px] transition-[opacity,transform] duration-200"
                      style={{ background: x.check.ok ? "var(--ink)" : "var(--down)", opacity: i > at ? 0.12 : x.check.ok ? 0.28 : 1, transform: i === at ? "scaleY(1.08)" : undefined }}>
                      {x.down && i <= at && <span className="absolute inset-x-0 -bottom-2 h-1 bg-down" aria-hidden />}
                    </button>
                  ))}
                </div>
                <div className="relative mt-3 h-0">
                  <span className="absolute -top-1 h-3 w-[2px] -translate-x-1/2 bg-ink transition-[left] duration-200" style={{ left: `${((at + 0.5) / steps.length) * 100}%` }} aria-hidden />
                </div>
              </div>

              <div className="mt-8 grid gap-6 border-t border-line pt-6 sm:grid-cols-[1.1fr_1fr_1fr_1fr]">
                <div>
                  <p className="text-[13px] text-muted">Check at {clock.format(new Date(s.check.at))}</p>
                  <p className={`mt-1 text-[18px] font-semibold ${s.check.ok ? "" : "text-down"}`}>{s.check.ok ? `OK${s.check.status_code ? `, ${s.check.status_code}` : ""}` : s.check.error}</p>
                </div>
                <div>
                  <p className="text-[13px] text-muted">Failures in a row</p>
                  <div className="mt-2 flex gap-1.5" aria-label={`${Math.min(s.fails, r.fail_threshold)} of ${r.fail_threshold}`}>
                    {Array.from({ length: r.fail_threshold }, (_, k) => <span key={k} className="h-3 w-7 rounded-sm transition-colors duration-200" style={{ background: k < s.fails ? "var(--down)" : "var(--sunk)" }} />)}
                  </div>
                </div>
                <div>
                  <p className="text-[13px] text-muted">Successes in a row</p>
                  <div className="mt-2 flex gap-1.5" aria-label={`${Math.min(s.oks, r.recover_threshold)} of ${r.recover_threshold}`}>
                    {Array.from({ length: r.recover_threshold }, (_, k) => <span key={k} className="h-3 w-7 rounded-sm transition-colors duration-200" style={{ background: k < s.oks && (s.down || s.moment === "resolved") ? "var(--up)" : "var(--sunk)" }} />)}
                  </div>
                </div>
                <div>
                  <p className="text-[13px] text-muted">Relay's verdict</p>
                  <p className="mt-1 text-[16px]"><StatusBadge status={s.down ? "down" : "up"} /></p>
                </div>
              </div>
              <p className="mt-5 min-h-[3em] max-w-[70ch] text-[16px] leading-relaxed" aria-live="polite">{narrate(s)}</p>
            </section>

            <section className="mt-10" aria-labelledby="key-title">
              <h2 id="key-title" className="text-[20px] font-semibold tracking-tight">Key moments</h2>
              <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {moments.map((m) => (
                  <li key={m.i}>
                    <button onClick={() => { setPlaying(false); setAt(m.i); }} className="w-full rounded-[var(--radius-card)] border border-line bg-surface p-4 text-left transition-colors duration-150 hover:border-muted">
                      <span className={`block font-semibold ${m.moment === "opened" ? "text-down" : m.moment === "resolved" ? "text-up" : ""}`}>{LABEL[m.moment!]}</span>
                      <span className="num block text-[14px] text-muted">{clock.format(new Date(m.check.at))}</span>
                    </button>
                  </li>
                ))}
              </ol>
              <p className="mt-6 text-[15px] text-muted"><a className="font-medium text-ink underline underline-offset-4" href={`#/monitors/${r.monitor.id}`}>See everything about {r.monitor.name}</a></p>
            </section>
          </>
        )}
      </div>
    </Shell>
  );
}
