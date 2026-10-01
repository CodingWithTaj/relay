import { CheckCircle, CircleDashed, PauseCircle, XCircle } from "@phosphor-icons/react";
import type { Status } from "../types";

const LOOK: Record<Status, { label: string; cls: string; Icon: typeof CheckCircle }> = {
  up: { label: "Up", cls: "text-up", Icon: CheckCircle },
  down: { label: "Down", cls: "text-down", Icon: XCircle },
  pending: { label: "Waiting for first check", cls: "text-muted", Icon: CircleDashed },
  paused: { label: "Paused", cls: "text-muted", Icon: PauseCircle },
};

/** Status is always shown as icon plus words, never colour alone. */
export function StatusBadge({ status, short = false }: { status: Status; short?: boolean }) {
  const { label, cls, Icon } = LOOK[status];
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${cls}`}>
      <Icon size={18} weight="fill" aria-hidden />
      <span>{short && status === "pending" ? "Pending" : label}</span>
    </span>
  );
}
