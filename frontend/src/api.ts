import { createDemoApi } from "./demo";
import { type Api, ApiError, type LiveEvent } from "./types";

const TOKEN_KEY = "relay.adminToken";
export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY) ?? ""; } catch { return ""; } };
export const setToken = (t: string) => { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage unavailable */ } };

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(`api/${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
  });
  if (res.ok) return (res.status === 204 ? undefined : await res.json()) as T;
  const body = await res.json().catch(() => ({}));
  const fields: Record<string, string> = {};
  let message = typeof body.detail === "string" ? body.detail : `Request failed (${res.status}).`;
  if (Array.isArray(body.detail)) {
    // FastAPI validation errors: [{loc: ["body", "url"], msg: "..."}]
    for (const d of body.detail) fields[String(d.loc?.[d.loc.length - 1])] = String(d.msg).replace(/^Value error, /, "");
    message = "Some fields need fixing.";
  }
  throw new ApiError(res.status, message, fields);
}

function createHttpApi(): Api {
  return {
    demo: false,
    monitors: () => req("monitors"),
    monitor: (id) => req(`monitors/${id}`),
    create: (body) => req("monitors", { method: "POST", body: JSON.stringify(body) }),
    update: (id, patch) => req(`monitors/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
    remove: (id) => req(`monitors/${id}`, { method: "DELETE" }),
    checkNow: (id) => req(`monitors/${id}/check`, { method: "POST" }),
    incidents: () => req("incidents"),
    status: () => req("status"),
    origin: () => req("origin"),
    replay: (id) => req(`incidents/${id}`),
    badgeUrl: (id) => new URL(`api/monitors/${id}/badge.svg`, location.href).href,
    subscribe(cb: (e: LiveEvent) => void) {
      const es = new EventSource("api/events");
      es.onmessage = (m) => cb(JSON.parse(m.data));
      return () => es.close(); // EventSource reconnects by itself after network drops
    },
  };
}

// `npm run build:demo` (vite --mode demo) builds the public demo; anything else talks to a real server
export const api: Api = import.meta.env.MODE === "demo" ? createDemoApi() : createHttpApi();
