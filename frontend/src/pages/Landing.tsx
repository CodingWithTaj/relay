import { ArrowRight, GithubLogo, Lightning, LockKey, ShieldCheck } from "@phosphor-icons/react";
import { motion, useReducedMotion } from "motion/react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { PROBE } from "../demo";
import { STAGES, StageBar, stageTotal } from "../components/Anatomy";
import { REPO, Shell } from "../components/Shell";
import { incidentsFrom } from "../rules";
import { ago, useLive, useNow } from "../hooks";
import { StatusBoard } from "./StatusPage";
import type { LiveEvent } from "../types";

const Globe = lazy(() => import("../components/Globe"));

function LiveCaption() {
  const [last, setLast] = useState<LiveEvent | null>(null);
  const now = useNow();
  useEffect(() => api.subscribe((e) => { if (e.type === "check") setLast(e); }), []);
  if (!last) return <span>Waiting for the next check…</span>;
  return (
    <span>
      {last.monitor_name} checked from {PROBE.name} {ago(last.at ?? null, now)}:{" "}
      <span className={last.detail === "up" ? "text-up" : "text-down"}>{last.detail === "up" ? "up" : last.detail}</span>
    </span>
  );
}

function Hero() {
  const reduce = useReducedMotion();
  const { data } = useLive(() => api.monitors(), [], (e) => e.type !== "check");
  const [focus, setFocus] = useState<number | null>(null);
  const targets = useMemo(() => (data ?? []).filter((m) => m.place).map((m) => ({ id: m.id, name: m.name, status: m.status, lat: m.place!.lat, lon: m.place!.lon })), [data]);
  const rise = (i: number) => (reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { delay: 0.08 * i, duration: 0.7, ease: [0.16, 1, 0.3, 1] as const } });
  return (
    <section className="relative overflow-hidden">
     <div className="mx-auto grid max-w-[1240px] items-center px-4 pt-8 sm:px-6 lg:min-h-[calc(100dvh-100px)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:pt-0">
      <div className="relative z-10 max-w-[600px] py-8">
        <motion.h1 {...rise(0)} className="text-[44px] font-semibold leading-[1.04] tracking-[-0.035em] sm:text-[52px] xl:text-[56px]">Know it's down before your users do.</motion.h1>
        <motion.p {...rise(1)} className="mt-6 max-w-[46ch] text-[19px] leading-relaxed text-muted">Relay checks your sites every minute, opens incidents after repeated failures, alerts your team, and runs your status page.</motion.p>
        <motion.div {...rise(2)} className="mt-9 flex flex-wrap gap-3">
          <a href="#/dashboard" className="inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-[16px] font-medium text-bg transition-transform duration-100 active:scale-[0.98]">Open the dashboard <ArrowRight size={18} aria-hidden /></a>
          <a href={REPO} className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface px-5 py-3 text-[16px] font-medium transition-colors duration-150 hover:border-muted"><GithubLogo size={18} aria-hidden /> View the source</a>
        </motion.div>
      </div>
      <motion.figure initial={reduce ? false : { opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
        className="relative aspect-square w-full lg:absolute lg:top-1/2 lg:right-[-14vw] lg:aspect-auto lg:h-[min(118dvh,1080px)] lg:w-[min(64vw,1080px)] lg:-translate-y-1/2">
        <Suspense fallback={<div className="h-full w-full" />}>
          {targets.length > 0 && <Globe targets={targets} origin={PROBE} subscribe={api.subscribe} focusId={focus}
            onSelect={(id) => { if (id === null) setFocus(null); else if (id === focus) location.hash = `#/monitors/${id}`; else setFocus(id); }} />}
        </Suspense>
        <ul className="sr-only">{targets.map((t) => <li key={t.id}><a href={`#/monitors/${t.id}`}>{t.name}</a></li>)}</ul>
      </motion.figure>
     </div>
     <p className="num relative z-10 mx-auto max-w-[1240px] px-4 pb-6 text-[14px] text-muted sm:px-6 lg:-mt-16" aria-live="off"><LiveCaption /></p>
    </section>
  );
}

/** Every demo site's latest check, stage by stage, on one shared scale. */
function TimeGoes() {
  const { data } = useLive(() => api.monitors(), [], (e) => e.type === "check");
  const rows = (data ?? []).filter((m) => m.last_timings).sort((a, b) => stageTotal(b.last_timings!) - stageTotal(a.last_timings!));
  const max = Math.max(1, ...rows.map((m) => stageTotal(m.last_timings!)));
  return (
    <section className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6" aria-labelledby="tg-title">
      <h2 id="tg-title" className="max-w-[20ch] text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px]">See where the time goes.</h2>
      <p className="mt-4 max-w-[62ch] text-[18px] leading-relaxed text-muted">Relay times every stage of every check. Far-away sites spend their time crossing the network; slow servers spend it thinking. These bars are each site's latest check, live.</p>
      <div className="mt-10 grid gap-5">
        {rows.map((m) => (
          <a key={m.id} href={`#/monitors/${m.id}`} className="group grid items-center gap-x-6 gap-y-2 sm:grid-cols-[220px_minmax(0,1fr)_72px]">
            <span className="min-w-0"><span className="block truncate font-medium group-hover:underline">{m.name}</span><span className="block truncate text-[13px] text-muted">{m.place?.name}</span></span>
            <StageBar timings={m.last_timings!} scale={max} height={18} />
            <span className="num text-right font-medium sm:text-left">{Math.round(stageTotal(m.last_timings!))} ms</span>
          </a>
        ))}
      </div>
      <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-[14px] text-muted">
        {STAGES.map((s) => <li key={s.key} className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: "var(--ink)", opacity: s.tone }} aria-hidden />{s.name}</li>)}
      </ul>
    </section>
  );
}

const START = [true, true, false, true, true, false, false, false, false, true, false, true, true, true, true, true];

/** Relay's incident rule, live: click checks to flip them and watch incidents form. */
function BlipExplainer() {
  const [checks, setChecks] = useState(START);
  const { data: incidents } = useLive(() => api.incidents(), [], () => false);
  const latest = incidents?.find((i) => !i.ongoing)?.id;
  const spans = incidentsFrom(checks);
  const cell = "calc((100% - 15 * 6px) / 16)";
  const words = spans.length === 0 ? "No incident: no run of 3 failures in a row." :
    spans.map((s) => `Incident opened at check ${s.detected + 1}, dated from check ${s.start + 1}, ${s.end === null ? "still open" : `closed at check ${s.end + 1}`}.`).join(" ");
  return (
    <section className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6" aria-labelledby="blip-title">
      <h2 id="blip-title" className="max-w-[18ch] text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px]">A blip isn't an outage.</h2>
      <p className="mt-4 max-w-[60ch] text-[18px] leading-relaxed text-muted">Relay opens an incident only after 3 failed checks in a row, and closes it after 2 passing ones, so nobody gets paged for a single dropped request. Click any check to flip it.</p>
      <div className="mt-10 rounded-[var(--radius-card)] border border-line bg-surface p-5 sm:p-8">
        <div className="relative">
          <div className="grid grid-cols-16 gap-[6px]" style={{ gridTemplateColumns: "repeat(16, minmax(0, 1fr))" }}>
            {checks.map((ok, i) => (
              <button key={i} onClick={() => setChecks((c) => c.map((v, j) => (j === i ? !v : v)))}
                aria-label={`Check ${i + 1}: ${ok ? "passed" : "failed"}. Click to make it ${ok ? "fail" : "pass"}.`}
                className={`aspect-square min-h-[24px] rounded-md border text-[13px] font-medium transition-[background-color,transform] duration-150 active:scale-95 ${ok ? "border-line bg-bg text-muted hover:border-muted" : "border-down bg-down text-white"}`}>
                <span aria-hidden>{ok ? "" : "✕"}</span>
              </button>
            ))}
          </div>
          <div className="relative mt-4 h-9" aria-hidden>
            {spans.map((s, k) => {
              const end = s.end ?? 15;
              return (
                <motion.div key={`${k}-${s.start}`} layout className="absolute top-0 flex h-9 items-center overflow-hidden rounded-md bg-down/12 px-3 text-[13px] font-medium text-down ring-1 ring-down/40"
                  style={{ left: `calc(${s.start} * (${cell} + 6px))`, width: `calc(${end - s.start + 1} * (${cell} + 6px) - 6px)` }}>
                  <span className="truncate">Incident</span>
                </motion.div>
              );
            })}
          </div>
        </div>
        <p className="mt-5 text-[15px] text-muted" aria-live="polite">{words}</p>
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[14px] font-medium">
          <button onClick={() => setChecks(START)} className="underline underline-offset-2">Reset</button>
          {latest && <a href={`#/incidents/${latest}`} className="inline-flex items-center gap-1 underline underline-offset-2">Replay a real incident, check by check <ArrowRight size={14} aria-hidden /></a>}
        </div>
      </div>
    </section>
  );
}

function StatusPreview() {
  return (
    <section className="mx-auto grid max-w-[1240px] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:items-start" aria-labelledby="sp-title">
      <div className="lg:sticky lg:top-28">
        <h2 id="sp-title" className="text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px]">Your status page, already built.</h2>
        <p className="mt-4 max-w-[44ch] text-[18px] leading-relaxed text-muted">Every monitor you mark public appears on a status page your users can check during an outage. It updates as checks come in.</p>
        <a href="#/status" className="mt-6 inline-flex items-center gap-2 font-medium underline underline-offset-4">Open the status page <ArrowRight size={16} aria-hidden /></a>
      </div>
      <div className="rounded-[20px] border border-line bg-bg p-5 shadow-[0_30px_80px_-40px_rgb(16_22_29/0.35)] sm:p-7"><StatusBoard compact /></div>
    </section>
  );
}

function SelfHost() {
  return (
    <section className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6" aria-labelledby="sh-title">
      <h2 id="sh-title" className="text-[36px] font-semibold leading-[1.08] tracking-[-0.03em] sm:text-[44px]">Run it on your own server.</h2>
      <p className="mt-4 max-w-[56ch] text-[18px] leading-relaxed text-muted">One container for the app, one for PostgreSQL. Deploy scripts for Azure Container Apps are included.</p>
      <div className="mt-10 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="rounded-[var(--radius-card)] bg-ink p-6 text-bg sm:p-8 lg:col-span-2">
          <p className="text-[15px] opacity-70">In a terminal:</p>
          <pre className="mt-3 overflow-x-auto font-mono text-[15px] leading-[1.9]"><code translate="no">{`git clone ${REPO}\ncd relay\nADMIN_TOKEN=choose-a-secret docker compose up`}</code></pre>
          <p className="mt-6 text-[15px] opacity-70">Then open <span className="font-mono opacity-100" translate="no">localhost:8000</span>. A demo service with a slow page, a flaky page and a scheduled outage starts alongside it, so you see incidents within minutes.</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line bg-surface p-6">
          <Lightning size={26} aria-hidden />
          <h3 className="mt-4 text-[19px] font-semibold">Alerts where your team talks</h3>
          <p className="mt-1 text-[15px] text-muted">Point it at a Discord or Slack webhook. You get one message when an incident opens and one when it closes:</p>
          <p className="mt-3 rounded-lg bg-sunk px-3 py-2 font-mono text-[13px] leading-relaxed">🔴 Checkout API is down: HTTP 503<br />🟢 Checkout API is up again (back up after 6 min)</p>
        </div>
        <div className="rounded-[var(--radius-card)] border border-line p-6">
          <LockKey size={26} aria-hidden />
          <h3 className="mt-4 text-[19px] font-semibold">Safe to put online</h3>
          <p className="mt-1 text-[15px] text-muted">Changes need an admin token, and Relay refuses to check private or internal addresses, so a public instance can't be used to probe your network or the cloud metadata service.</p>
        </div>
        <div className="flex flex-wrap items-start gap-x-6 gap-y-3 rounded-[var(--radius-card)] border border-line bg-surface p-6 lg:col-span-2">
          <ShieldCheck size={26} aria-hidden className="mt-0.5" />
          <div className="max-w-[70ch]">
            <h3 className="text-[19px] font-semibold">Certificates and badges</h3>
            <p className="mt-1 text-[15px] text-muted">Relay reads each site's security certificate twice a day and warns two weeks before it expires. Every site also gets a live uptime badge for its README.</p>
          </div>
        </div>
      </div>
    </section>
  );
}

export default function Landing() {
  useEffect(() => { document.title = "Relay: uptime monitoring and status pages"; }, []);
  return (
    <Shell active="home">
      <Hero />
      <TimeGoes />
      <BlipExplainer />
      <StatusPreview />
      <SelfHost />
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-4 px-4 py-8 text-[14px] text-muted sm:px-6">
          <span className="mr-auto">Relay is open source under the MIT license. Built by Tajveer Pal Singh.</span>
          <a href={REPO} className="inline-flex items-center gap-1.5 hover:text-ink"><GithubLogo size={18} aria-hidden /> Source</a>
        </div>
      </footer>
    </Shell>
  );
}
