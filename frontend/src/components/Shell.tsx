import { GithubLogo } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { api } from "../api";

export const REPO = "https://github.com/CodingWithTaj/relay";

export function Mark() {
  return (
    <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden>
      <circle cx="16" cy="16" r="12.5" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="16" cy="16" r="5" fill="var(--up)" />
    </svg>
  );
}

export function Shell({ children, active, wide = false }: { children: ReactNode; active?: "dashboard" | "status" | "home"; wide?: boolean }) {
  const link = (href: string, label: string, key: string) => (
    <a href={href} aria-current={active === key ? "page" : undefined}
      className={`rounded-lg px-3 py-2 text-[15px] transition-colors duration-150 hover:text-ink ${active === key ? "text-ink" : "text-muted"}`}>{label}</a>
  );
  return (
    <div className="min-h-[100dvh] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      {api.demo && (
        <p className="border-b border-line bg-sunk px-4 py-2 text-center text-[13px] text-muted">
          Live demo: these monitors and checks are simulated in your browser. <a className="font-medium text-ink underline underline-offset-2" href={REPO}>Self-host Relay</a> to watch your own sites.
        </p>
      )}
      <header className="sticky top-0 z-20 border-b border-line/70 bg-bg/85 backdrop-blur-md">
        <nav className={`mx-auto flex h-16 items-center gap-2 px-4 ${wide ? "max-w-[1480px] sm:px-8" : "max-w-[1240px] sm:px-6"}`} aria-label="Main">
          <a href="#/" className="mr-auto flex items-center gap-2 text-[19px] font-semibold tracking-tight" translate="no"><Mark /> relay</a>
          {link("#/dashboard", "Dashboard", "dashboard")}
          {link("#/status", "Status page", "status")}
          <a href={REPO} className="ml-1 rounded-lg p-2 text-muted hover:text-ink" aria-label="Source code on GitHub"><GithubLogo size={22} /></a>
        </nav>
      </header>
      <main id="main">{children}</main>
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-sunk ${className}`} />;
}
