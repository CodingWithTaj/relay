/**
 * Demo mode: a simulated Relay server running in the browser, so the public
 * site works without a backend. It produces the same JSON as the real API and
 * applies the same incident rule (src/rules.ts mirrors relay/engine.py).
 * Monitors and checks here are simulated; self-host Relay to monitor real sites.
 */
import { FAIL_AFTER, RECOVER_AFTER, incidentsFrom } from "./rules";
import { badgeSvg } from "./badge";
import type { Api, CheckRow, Day, Incident, LiveEvent, MonitorDetail, MonitorSummary, NewMonitor, Replay, Stage, StatusPage, Timings } from "./types";

export const PROBE = { name: "Toronto, Canada", lat: 43.65, lon: -79.38 };

interface Check { at: number; ok: boolean; ms: number | null; code: number | null; error: string | null; t?: Timings }
interface Mon {
  id: number; name: string; url: string; method: string; interval_s: number; timeout_s: number;
  expected_status: number | null; keyword: string | null; paused: boolean; public: boolean;
  status: "up" | "down" | "pending"; place: { name: string; lat: number; lon: number };
  base: number; blip: number; outage: boolean; rtt: number; certDays: number | null;
  checks: Check[]; days: Day[]; incidents: Incident[];
  fails: number; oks: number; failingSince: number | null; nextAt: number; created: number;
}

const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
let seed = 20261001;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const iso = (t: number | null) => (t === null ? null : new Date(t).toISOString());
let nextIncidentId = 1;

function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return h < 48 ? (m ? `${h} h ${m} min` : `${h} h`) : `${Math.floor(h / 24)} days`;
}

/** Round-trip time from the probe, from the great-circle distance: light in fibre
 *  covers about 200 km per millisecond, and real routes are roughly 1.5x longer. */
function rttFrom(lat: number, lon: number) {
  const r = Math.PI / 180, a = PROBE.lat * r, b = lat * r, d = (lon - PROBE.lon) * r;
  const km = 6371 * Math.acos(Math.min(1, Math.sin(a) * Math.sin(b) + Math.cos(a) * Math.cos(b) * Math.cos(d)));
  return 4 + (km * 1.5 * 2) / 200;
}

function stages(m: Mon, think: number): Timings {
  const j = () => 0.85 + rand() * 0.3;
  const t: Timings = { dns: Math.round(3 + rand() * 18), connect: m.rtt * j(), tls: m.rtt * 1.15 * j(), wait: think + m.rtt * j(), download: 1 + rand() * 6 };
  for (const k of Object.keys(t) as Stage[]) t[k] = Math.round((t[k] as number) * 10) / 10;
  return t;
}
const total = (t: Timings) => Math.round(Object.values(t).reduce((a, b) => a + (b ?? 0), 0) * 10) / 10;

function simulate(m: Mon, at: number, live = true): Check {
  // scripted outage for one monitor, live only: down 45 s out of every 3 minutes
  if (live && m.outage && (at % (3 * MIN)) > 2 * MIN && (at % (3 * MIN)) < 2 * MIN + 45_000)
    return { at, ok: false, ms: null, code: null, error: `timed out after ${m.timeout_s} s` };
  if (rand() < m.blip) { const t = stages(m, 4); return { at, ok: false, ms: total(t), code: 503, error: "HTTP 503", t }; }
  const spike = rand() < 0.03 ? 2 + rand() * 3 : 1;
  const t = stages(m, m.base * (0.8 + rand() * 0.45) * spike);
  return { at, ok: true, ms: total(t), code: 200, error: null, t };
}

function build(id: number, name: string, url: string, place: Mon["place"], base: number, blip: number, outage = false, keyword: string | null = null, certDays: number | null = 60): Mon {
  const now = Date.now();
  const m: Mon = {
    id, name, url, method: "GET", interval_s: 10, timeout_s: 10, expected_status: null, keyword, paused: false, public: true,
    status: "up", place, base, blip, outage, rtt: rttFrom(place.lat, place.lon), certDays, checks: [], days: [], incidents: [], fails: 0, oks: 0, failingSince: null,
    nextAt: now + rand() * 10_000, created: now - 90 * DAY,
  };
  // the last 24 hours, one check a minute, with one real incident for some monitors
  const start = now - DAY, burst = start + (0.3 + rand() * 0.5) * DAY;
  for (let t = start; t < now; t += MIN) {
    const c = simulate(m, t, false);
    if ((outage || blip > 0.01) && t > burst && t < burst + (outage ? 7 : 4) * MIN) Object.assign(c, { ok: false, ms: null, code: 502, error: "HTTP 502" });
    m.checks.push(c);
  }
  for (const sp of incidentsFrom(m.checks.map((c) => c.ok))) {
    const c = m.checks;
    m.incidents.push({ id: nextIncidentId++, monitor_id: id, monitor_name: name, started_at: iso(c[sp.start].at)!, detected_at: iso(c[sp.detected].at)!,
      resolved_at: sp.end === null ? null : iso(c[sp.end].at), cause: c[sp.start].error ?? "check failed",
      duration: duration((sp.end === null ? now : c[sp.end].at) - c[sp.start].at), ongoing: sp.end === null });
  }
  // the previous 89 days, as daily summaries with an occasional bad day
  for (let d = 89; d >= 1; d--) {
    const date = new Date(now - d * DAY);
    const r = rand();
    const bad = r < (outage ? 0.06 : blip > 0.01 ? 0.04 : 0.015);
    const uptime = bad ? (rand() < 0.3 ? 93 + rand() * 2 : 99 + rand() * 0.8) : 100;
    const day: Day = { date: date.toISOString().slice(0, 10), uptime: Math.round(uptime * 100) / 100, checks: 1440,
      level: uptime >= 99.9 && !bad ? "up" : uptime >= 95 ? "partial" : "down", incident: bad };
    m.days.push(day);
    if (bad) {
      const s = date.getTime() - (date.getTime() % DAY) + rand() * 20 * HOUR, len = (100 - uptime) / 100 * DAY;
      m.incidents.push({ id: nextIncidentId++, monitor_id: id, monitor_name: name, started_at: iso(s)!, detected_at: iso(s + 3 * MIN)!,
        resolved_at: iso(s + len), cause: rand() < 0.5 ? "HTTP 503" : "timed out after 10 s", duration: duration(len), ongoing: false });
    }
  }
  m.incidents.sort((a, b) => b.started_at.localeCompare(a.started_at));
  return m;
}

export function createDemoApi(): Api {
  const mons: Mon[] = [
    build(1, "Storefront", "https://shop.northwind-books.example/", { name: "Frankfurt, Germany", lat: 50.11, lon: 8.68 }, 38, 0.002, false, null, 64),
    build(2, "Checkout API", "https://api.northwind-books.example/v2/health", { name: "Ashburn, United States", lat: 39.04, lon: -77.49 }, 61, 0.001, false, null, 211),
    build(3, "Search", "https://search.northwind-books.example/ping", { name: "Tokyo, Japan", lat: 35.68, lon: 139.69 }, 96, 0.004, true, null, 87),
    build(4, "Image CDN", "https://img.northwind-books.example/health", { name: "Sydney, Australia", lat: -33.87, lon: 151.21 }, 9, 0.012, false, null, 33),
    build(5, "Sign-in service", "https://auth.northwind-books.example/healthz", { name: "London, United Kingdom", lat: 51.51, lon: -0.13 }, 74, 0.002, false, "ok", 11),
    build(6, "Order webhooks", "https://hooks.northwind-books.example/status", { name: "São Paulo, Brazil", lat: -23.55, lon: -46.63 }, 182, 0.006, false, null, 140),
  ];
  let nextId = 7;
  const listeners = new Set<(e: LiveEvent) => void>();
  const emit = (e: LiveEvent) => listeners.forEach((cb) => cb(e));

  function runCheck(m: Mon, at = Date.now()) {
    const c = simulate(m, at);
    m.checks.push(c);
    while (m.checks.length && m.checks[0].at < at - DAY) m.checks.shift();
    m.nextAt = at + m.interval_s * 1000;
    emit({ type: "check", monitor_id: m.id, monitor_name: m.name, detail: c.ok ? "up" : c.error ?? "failed", at: iso(at), ok: c.ok, ms: c.ms, status_code: c.code });
    if (c.ok) {
      m.fails = 0; m.failingSince = null; m.oks++;
      if (m.status === "down" && m.oks >= RECOVER_AFTER) {
        const inc = m.incidents.find((i) => i.ongoing);
        if (inc) Object.assign(inc, { ongoing: false, resolved_at: iso(at), duration: duration(at - Date.parse(inc.started_at)) });
        m.status = "up";
        emit({ type: "incident_resolved", monitor_id: m.id, monitor_name: m.name, detail: "back up", at: iso(at) });
      } else if (m.status !== "down") m.status = "up";
    } else {
      m.oks = 0; m.fails++;
      m.failingSince ??= at;
      if (m.status !== "down" && m.fails >= FAIL_AFTER) {
        m.status = "down";
        m.incidents.unshift({ id: nextIncidentId++, monitor_id: m.id, monitor_name: m.name, started_at: iso(m.failingSince)!, detected_at: iso(at)!,
          resolved_at: null, cause: c.error ?? "check failed", duration: duration(at - m.failingSince), ongoing: true });
        emit({ type: "incident_opened", monitor_id: m.id, monitor_name: m.name, detail: c.error ?? "check failed", at: iso(at) });
      }
    }
  }

  setInterval(() => {
    const now = Date.now();
    for (const m of mons) if (!m.paused && now >= m.nextAt) runCheck(m, now);
    for (const m of mons) for (const i of m.incidents) if (i.ongoing) i.duration = duration(now - Date.parse(i.started_at));
  }, 500);

  const within = (m: Mon, ms: number) => m.checks.filter((c) => c.at >= Date.now() - ms);
  const pct = (cs: Check[]) => (cs.length ? Math.round((1000 * 100 * cs.filter((c) => c.ok).length) / cs.length) / 1000 : null);
  const pctile = (v: number[], p: number) => (v.length ? v[Math.max(0, Math.ceil((p / 100) * v.length) - 1)] : null);
  const lat = (cs: Check[]) => cs.filter((c) => c.ok && c.ms !== null).map((c) => c.ms as number).sort((a, b) => a - b);
  function today(m: Mon): Day {
    const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
    const cs = m.checks.filter((c) => c.at >= midnight.getTime());
    const u = pct(cs);
    const inc = m.incidents.some((i) => Date.parse(i.started_at) >= midnight.getTime() || i.ongoing);
    return { date: midnight.toISOString().slice(0, 10), uptime: u === null ? null : Math.round(u * 100) / 100, checks: cs.length,
      level: u === null ? "none" : u >= 99.9 && !inc ? "up" : u >= 95 ? "partial" : "down", incident: inc };
  }
  const days = (m: Mon) => [...m.days, today(m)];
  function longUptime(m: Mon, n: number) {
    const ds = days(m).slice(-n).filter((d) => d.uptime !== null);
    const total = ds.reduce((a, d) => a + d.checks, 0);
    return total ? Math.round((1000 * ds.reduce((a, d) => a + (d.uptime as number) * d.checks, 0)) / total) / 1000 : null;
  }
  function summary(m: Mon): MonitorSummary {
    const day = within(m, DAY);
    return { id: m.id, name: m.name, url: m.url, method: m.method, interval_s: m.interval_s, timeout_s: m.timeout_s,
      expected_status: m.expected_status, keyword: m.keyword, paused: m.paused, public: m.public,
      status: m.paused ? "paused" : m.status, last_checked_at: iso(m.checks.at(-1)?.at ?? null),
      uptime_24h: pct(day), uptime_30d: longUptime(m, 30), latency_p50: pctile(lat(day), 50),
      recent: m.checks.slice(-30).map((c) => ({ ok: c.ok, ms: c.ms })), place: m.place,
      cert: m.certDays === null ? null : { expires_at: iso(Date.now() + m.certDays * DAY), error: null, days_left: m.certDays },
      last_timings: m.checks.at(-1)?.t ?? null };
  }
  const find = (id: number) => {
    const m = mons.find((x) => x.id === id);
    if (!m) throw Object.assign(new Error("No monitor with that id."), { status: 404 });
    return m;
  };
  const later = <T,>(v: T) => new Promise<T>((r) => setTimeout(() => r(v), 120)); // feel like a network call

  return {
    demo: true,
    monitors: async () => later(mons.map(summary)),
    async monitor(id) {
      const m = find(id), day = within(m, DAY), l = lat(day), now = Date.now(), span = DAY / 48;
      const series = Array.from({ length: 48 }, (_, i) => {
        const cs = day.filter((c) => c.at >= now - DAY + i * span && c.at < now - DAY + (i + 1) * span);
        const ok = cs.filter((c) => c.ok && c.ms !== null);
        return { t: iso(now - DAY + i * span)!, avg: ok.length ? Math.round((10 * ok.reduce((a, c) => a + (c.ms as number), 0)) / ok.length) / 10 : null, failures: cs.filter((c) => !c.ok).length };
      });
      const checks: CheckRow[] = m.checks.slice(-25).reverse().map((c) => ({ at: iso(c.at)!, ok: c.ok, status_code: c.code, ms: c.ms, error: c.error, timings: c.t ?? null }));
      const timed = day.filter((c) => c.ok && c.t);
      const avg = (k: Stage) => (timed.length ? Math.round((10 * timed.reduce((a, c) => a + (c.t![k] ?? 0), 0)) / timed.length) / 10 : null);
      const detail: MonitorDetail = { ...summary(m), uptime_7d: longUptime(m, 7), latency_24h: { p50: pctile(l, 50), p95: pctile(l, 95), samples: l.length },
        series_24h: series, days: days(m), incidents: m.incidents.slice(0, 20), checks,
        anatomy_24h: { samples: timed.length, stages: { dns: avg("dns"), connect: avg("connect"), tls: avg("tls"), wait: avg("wait"), download: avg("download") } } };
      return later(detail);
    },
    async create(body: NewMonitor) {
      const m = build(nextId++, body.name, body.url, { name: "Simulated location", lat: -10 + rand() * 60, lon: -120 + rand() * 240 }, 30 + rand() * 120, 0.002, false, null, body.url.startsWith("https") ? 90 : null);
      Object.assign(m, { ...body, interval_s: Math.max(10, body.interval_s), status: "pending", checks: [], days: [], incidents: [], nextAt: Date.now() + 1500 });
      m.days = Array.from({ length: 89 }, (_, i) => ({ date: new Date(Date.now() - (89 - i) * DAY).toISOString().slice(0, 10), uptime: null, checks: 0, level: "none" as const, incident: false }));
      mons.push(m);
      emit({ type: "monitor_changed", monitor_id: m.id });
      return later(summary(m));
    },
    async update(id, patch) {
      const m = find(id);
      Object.assign(m, patch);
      if (patch.paused === false) m.nextAt = Date.now();
      emit({ type: "monitor_changed", monitor_id: id });
      return later(summary(m));
    },
    async remove(id) {
      mons.splice(mons.indexOf(find(id)), 1);
      emit({ type: "monitor_changed", monitor_id: id });
      return later(undefined);
    },
    async checkNow(id) { runCheck(find(id)); return later(undefined); },
    incidents: async () => later(mons.flatMap((m) => m.incidents).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 50)),
    async status() {
      const rows = mons.filter((m) => m.public && !m.paused).map((m) => ({ id: m.id, name: m.name, status: m.status, uptime_90d: longUptime(m, 90), days: days(m) }));
      const down = rows.filter((r) => r.status === "down").length;
      const page: StatusPage = { title: "Northwind Books status", overall: down === 0 ? "operational" : down === rows.length ? "major_outage" : "partial_outage",
        monitors: rows, incidents: mons.filter((m) => m.public).flatMap((m) => m.incidents).filter((i) => Date.parse(i.started_at) > Date.now() - 14 * DAY)
          .sort((a, b) => b.started_at.localeCompare(a.started_at)), generated_at: new Date().toISOString() };
      return later(page);
    },
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    origin: async () => later({ ...PROBE }),
    async replay(id) {
      const m = mons.find((x) => x.incidents.some((i) => i.id === id));
      const inc = m?.incidents.find((i) => i.id === id);
      if (!m || !inc) throw Object.assign(new Error("No incident with that id."), { status: 404 });
      const s = Date.parse(inc.started_at), e = inc.resolved_at ? Date.parse(inc.resolved_at) : Date.now();
      let checks: CheckRow[] = m.checks.filter((c) => c.at >= s - 6 * MIN && c.at <= e + 4 * MIN)
        .map((c) => ({ at: iso(c.at)!, ok: c.ok, status_code: c.code, ms: c.ms, error: c.error }));
      if (checks.length < 8) {
        // older than the simulator's 24 hours of history: rebuild the run of checks around it
        const step = Math.max(MIN, Math.ceil((e - s) / 60 / MIN) * MIN);
        checks = [];
        for (let t = s - 6 * step; t <= e + 4 * step; t += step) {
          const bad = t >= s && t < e;
          checks.push({ at: iso(t)!, ok: !bad, status_code: bad ? (inc.cause.startsWith("HTTP") ? Number(inc.cause.slice(5)) : null) : 200, ms: bad ? null : m.base + m.rtt * 3, error: bad ? inc.cause : null });
        }
      }
      return later({ ...inc, monitor: { id: m.id, name: m.name, url: m.url, interval_s: m.interval_s }, fail_threshold: FAIL_AFTER, recover_threshold: RECOVER_AFTER, alerts: true, checks } as Replay);
    },
    badgeUrl(id) {
      const m = find(id), u = longUptime(m, 30);
      const svg = badgeSvg("uptime 30d", u === null ? "no data" : u >= 100 ? "100%" : `${u.toFixed(2)}%`, u === null ? "#6b7580" : u >= 99.5 ? "#1e9a63" : u >= 95 ? "#b7791f" : "#cf3a32");
      return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
    },
  };
}
