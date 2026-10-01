import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { api } from "../api";
import type { LiveEvent } from "../types";

interface Row extends LiveEvent { key: number }
const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Every check and incident as it happens, newest first. */
export function LiveFeed({ onPick, max = 14 }: { onPick?: (id: number) => void; max?: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const reduce = useReducedMotion();
  useEffect(() => {
    let n = 0;
    return api.subscribe((e) => {
      if (e.type !== "check" && e.type !== "incident_opened" && e.type !== "incident_resolved") return;
      setRows((r) => [{ ...e, key: n++ }, ...r].slice(0, max));
    });
  }, [max]);
  if (!rows.length) return <p className="px-4 py-6 text-[14px] text-muted">Waiting for the next check…</p>;
  return (
    <ol className="relative" aria-label="Live checks">
      <AnimatePresence initial={false}>
        {rows.map((r) => {
          const incident = r.type !== "check";
          const bad = r.type === "incident_opened" || (r.type === "check" && r.ok === false);
          return (
            <motion.li key={r.key} layout={!reduce}
              initial={reduce ? false : { opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 32 }}>
              <button onClick={() => onPick?.(r.monitor_id)}
                className={`grid w-full grid-cols-[64px_minmax(0,1fr)_auto] items-baseline gap-3 px-4 py-2 text-left text-[13px] transition-colors duration-150 hover:bg-sunk/70 ${incident ? (bad ? "bg-down/10" : "bg-up/10") : ""}`}>
                <span className="num text-muted">{r.at ? time.format(new Date(r.at)) : ""}</span>
                <span className="min-w-0 truncate">
                  <span className="font-medium">{r.monitor_name}</span>{" "}
                  {incident
                    ? <span className={bad ? "font-medium text-down" : "font-medium text-up"}>{bad ? `incident opened: ${r.detail}` : "recovered"}</span>
                    : <span className={bad ? "text-down" : "text-muted"}>{bad ? r.detail : `OK${r.status_code ? ` ${r.status_code}` : ""}`}</span>}
                </span>
                <span className="num text-right text-muted">{r.ms != null && !incident ? `${Math.round(r.ms)} ms` : ""}</span>
              </button>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}
