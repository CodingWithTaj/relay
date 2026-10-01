export type Status = "up" | "down" | "pending" | "paused";

export interface Recent { ok: boolean; ms: number | null }

export interface MonitorSummary {
  id: number;
  name: string;
  url: string;
  method: string;
  interval_s: number;
  timeout_s: number;
  expected_status: number | null;
  keyword: string | null;
  paused: boolean;
  public: boolean;
  status: Status;
  last_checked_at: string | null;
  uptime_24h: number | null;
  uptime_30d: number | null;
  latency_p50: number | null;
  recent: Recent[];
  place: Place | null;               // where the site's server is (looked up from its address)
  cert: { expires_at: string | null; error: string | null; days_left: number | null } | null;
  last_timings: Timings | null;
}

export interface Place { name: string | null; lat: number; lon: number }
export type Stage = "dns" | "connect" | "tls" | "wait" | "download";
export type Timings = Partial<Record<Stage, number>>;

export interface Day { date: string; uptime: number | null; checks: number; level: "up" | "partial" | "down" | "none"; incident: boolean }
export interface Incident { id: number; monitor_id: number; monitor_name: string; started_at: string; detected_at: string; resolved_at: string | null; cause: string; duration: string; ongoing: boolean }
export interface CheckRow { at: string; ok: boolean; status_code: number | null; ms: number | null; error: string | null; timings?: Timings | null }

export interface MonitorDetail extends MonitorSummary {
  uptime_7d: number | null;
  latency_24h: { p50: number | null; p95: number | null; samples: number };
  series_24h: { t: string; avg: number | null; failures: number }[];
  days: Day[];
  incidents: Incident[];
  checks: CheckRow[];
  anatomy_24h: { samples: number; stages: Record<Stage, number | null> };
}

export interface Replay extends Incident {
  monitor: { id: number; name: string; url: string; interval_s: number };
  fail_threshold: number;
  recover_threshold: number;
  alerts: boolean;
  checks: CheckRow[];
}

export interface StatusPage {
  title: string;
  overall: "operational" | "partial_outage" | "major_outage";
  monitors: { id: number; name: string; status: Status; uptime_90d: number | null; days: Day[] }[];
  incidents: Incident[];
  generated_at: string;
}

export interface LiveEvent {
  type: "check" | "incident_opened" | "incident_resolved" | "monitor_changed" | "origin";
  monitor_id: number; monitor_name?: string; detail?: string; at?: string | null;
  ok?: boolean; ms?: number | null; status_code?: number | null;
}

export interface NewMonitor { name: string; url: string; method: string; interval_s: number; timeout_s: number; expected_status: number | null; keyword: string | null; public: boolean }

export interface Api {
  demo: boolean;
  monitors(): Promise<MonitorSummary[]>;
  monitor(id: number): Promise<MonitorDetail>;
  create(body: NewMonitor): Promise<MonitorSummary>;
  update(id: number, patch: Partial<{ paused: boolean; name: string; public: boolean; interval_s: number }>): Promise<MonitorSummary>;
  remove(id: number): Promise<void>;
  checkNow(id: number): Promise<void>;
  incidents(): Promise<Incident[]>;
  status(): Promise<StatusPage>;
  origin(): Promise<Place | null>;
  replay(incidentId: number): Promise<Replay>;
  badgeUrl(monitorId: number): string;
  subscribe(cb: (e: LiveEvent) => void): () => void;
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public fields: Record<string, string> = {}) { super(message); }
}
