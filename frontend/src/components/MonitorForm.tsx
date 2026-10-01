import { CircleNotch } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { api, getToken, setToken } from "../api";
import { ApiError, type NewMonitor } from "../types";

const field = "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-[16px] text-ink placeholder:text-muted/80 focus:border-ink focus:outline-none";

/** "Add monitor", as a native <dialog> (focus trapping and Esc come for free). */
export function MonitorForm({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: number) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [needToken, setNeedToken] = useState(false);
  useEffect(() => {
    const d = ref.current!;
    if (open && !d.open) { d.showModal(); setErrors({}); }
    if (!open && d.open) d.close();
  }, [open]);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (needToken) setToken(String(f.get("token") ?? "").trim());
    const status = String(f.get("expected_status") ?? "").trim();
    const body: NewMonitor = {
      name: String(f.get("name") ?? "").trim(),
      url: String(f.get("url") ?? "").trim(),
      method: String(f.get("method")),
      interval_s: Number(f.get("interval_s")),
      timeout_s: Number(f.get("timeout_s")),
      expected_status: status ? Number(status) : null,
      keyword: String(f.get("keyword") ?? "").trim() || null,
      public: f.get("public") === "on",
    };
    const local: Record<string, string> = {};
    if (!body.name) local.name = "Give it a name, like “Checkout API”.";
    if (!/^https?:\/\/[^\s/]+/.test(body.url)) local.url = "Enter a full address starting with https:// or http://";
    setErrors(local);
    if (Object.keys(local).length) { (e.currentTarget.querySelector(`[name="${Object.keys(local)[0]}"]`) as HTMLElement)?.focus(); return; }
    setBusy(true);
    try {
      const m = await api.create(body);
      onCreated(m.id);
      onClose();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { setNeedToken(true); setErrors({ token: getToken() ? "That token wasn't accepted." : "Adding monitors needs the admin token from the server's ADMIN_TOKEN setting." }); }
      else if (err instanceof ApiError) setErrors({ ...err.fields, form: Object.keys(err.fields).length ? "" : err.message });
      else setErrors({ form: "Couldn't reach the Relay server. Check it's running, then try again." });
    } finally { setBusy(false); }
  }

  const err = (k: string) => errors[k] && <p id={`${k}-err`} className="text-[14px] text-down" aria-live="polite">{errors[k]}</p>;
  const label = "text-[14px] font-medium";
  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="add-title"
      className="m-auto w-[min(560px,calc(100vw-24px))] rounded-[var(--radius-card)] border border-line bg-surface p-0 text-ink shadow-[0_24px_80px_-24px_rgb(16_22_29/0.45)] backdrop:bg-ink/30 backdrop:backdrop-blur-sm">
      <form onSubmit={submit} noValidate className="grid gap-5 p-6 sm:p-7">
        <div>
          <h2 id="add-title" className="text-[22px] font-semibold tracking-tight">Add a monitor</h2>
          <p className="mt-1 text-[15px] text-muted">Relay checks the address on a schedule and opens an incident after 3 failures in a row.</p>
        </div>
        <div className="grid gap-2">
          <label htmlFor="name" className={label}>Name</label>
          <input id="name" name="name" className={field} autoComplete="off" placeholder="Checkout API…" aria-invalid={!!errors.name} aria-describedby={errors.name ? "name-err" : undefined} />
          {err("name")}
        </div>
        <div className="grid gap-2">
          <label htmlFor="url" className={label}>Address to check</label>
          <input id="url" name="url" type="url" inputMode="url" spellCheck={false} autoComplete="url" className={`${field} font-mono text-[15px]`} placeholder="https://example.com/health…" aria-invalid={!!errors.url} aria-describedby={errors.url ? "url-err" : undefined} />
          {err("url")}
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <label htmlFor="interval_s" className={label}>Check every</label>
            <select id="interval_s" name="interval_s" defaultValue="60" className={field}>
              <option value="10">10 seconds</option><option value="30">30 seconds</option><option value="60">1 minute</option>
              <option value="300">5 minutes</option><option value="900">15 minutes</option>
            </select>
          </div>
          <div className="grid gap-2">
            <label htmlFor="method" className={label}>Method</label>
            <select id="method" name="method" defaultValue="GET" className={field}><option>GET</option><option>HEAD</option><option>POST</option></select>
          </div>
          <div className="grid gap-2">
            <label htmlFor="timeout_s" className={label}>Timeout (s)</label>
            <input id="timeout_s" name="timeout_s" type="number" min={1} max={60} defaultValue={10} inputMode="numeric" className={field} />
            {err("timeout_s")}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <label htmlFor="expected_status" className={label}>Expected status <span className="font-normal text-muted">(optional)</span></label>
            <input id="expected_status" name="expected_status" type="number" inputMode="numeric" className={field} placeholder="Any 2xx or 3xx…" />
            {err("expected_status")}
          </div>
          <div className="grid gap-2">
            <label htmlFor="keyword" className={label}>Must contain <span className="font-normal text-muted">(optional)</span></label>
            <input id="keyword" name="keyword" className={field} placeholder="ok…" spellCheck={false} />
          </div>
        </div>
        <label className="flex items-center gap-3 text-[15px]"><input type="checkbox" name="public" defaultChecked className="h-5 w-5 accent-[var(--ink)]" /> Show on the public status page</label>
        {needToken && (
          <div className="grid gap-2 rounded-lg border border-line bg-sunk p-4">
            <label htmlFor="token" className={label}>Admin token</label>
            <input id="token" name="token" type="password" autoComplete="off" className={field} defaultValue={getToken()} />
            {err("token")}
          </div>
        )}
        {errors.form && <p className="text-[14px] text-down" role="alert">{errors.form}</p>}
        <div className="flex justify-end gap-3">
          <button type="button" onClick={onClose} className="rounded-lg px-4 py-2.5 text-[15px] font-medium text-muted hover:text-ink">Cancel</button>
          <button type="submit" disabled={busy} className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-[15px] font-medium text-bg transition-transform duration-100 active:scale-[0.98] disabled:opacity-60">
            {busy && <CircleNotch size={18} className="animate-spin" aria-hidden />}{busy ? "Adding…" : "Add monitor"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
