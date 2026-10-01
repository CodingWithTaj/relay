import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import type { LiveEvent } from "./types";

/** The current hash route, split into parts: "#/monitors/3" -> ["monitors", "3"]. */
export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(read);
  useEffect(() => {
    const on = () => { setRoute(read()); window.scrollTo(0, 0); };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return route;
}

/** Load data, and reload it whenever a live event says it may have changed. */
export function useLive<T>(load: () => Promise<T>, deps: unknown[], relevant: (e: LiveEvent) => boolean = () => true) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const relevantRef = useRef(relevant);
  relevantRef.current = relevant;
  const reload = useCallback(() => {
    loadRef.current().then((d) => { setData(d); setError(null); })
      .catch((e: Error & { status?: number }) => setError(e.status === 404 ? "not-found" : e.message || "Couldn't reach the Relay server."));
  }, []);
  useEffect(() => {
    setData(null);
    reload();
    let timer: number | undefined;
    const off = api.subscribe((e) => {
      if (!relevantRef.current(e)) return;
      clearTimeout(timer);
      timer = window.setTimeout(reload, 250); // coalesce bursts of events into one reload
    });
    const retry = window.setInterval(() => { if (document.visibilityState === "visible") reload(); }, 30_000);
    return () => { off(); clearTimeout(timer); clearInterval(retry); };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { data, error, reload };
}

/** A clock that ticks, for "12 s ago" labels. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto", style: "narrow" });
export function ago(isoTime: string | null, now: number): string {
  if (!isoTime) return "never";
  const s = Math.round((Date.parse(isoTime) - now) / 1000);
  if (s > -45) return rtf.format(Math.min(0, s), "second");
  if (s > -3600) return rtf.format(Math.round(s / 60), "minute");
  if (s > -86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}
export const clockTime = (iso: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
export const dateTime = (iso: string) => new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
export const fmtPct = (v: number | null, digits = 2) => (v === null ? "No data" : `${v.toFixed(v === 100 ? 0 : digits)}%`);
export const fmtMs = (v: number | null) => (v === null ? "No data" : `${Math.round(v)} ms`);
/** Copy text, falling back to the old way where the Clipboard API isn't allowed (plain HTTP). */
export async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = Object.assign(document.createElement("textarea"), { value: text });
  ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand("copy");
  ta.remove();
  return ok;
}
export const prefersReducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
