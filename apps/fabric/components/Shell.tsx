"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { api } from "./api";

export function Shell({ account, children }: { account?: string; children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const tab = (href: string, label: string) => (
    <Link
      href={href}
      className={`rounded-full px-4 py-2 text-center text-xs font-semibold tracking-wide transition ${
        path.startsWith(href) ? "bg-brass/20 text-cream" : "text-cream-dim hover:text-cream"
      }`}
    >
      {label}
    </Link>
  );
  return (
    <div className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pb-[max(env(safe-area-inset-bottom),24px)] pt-[max(env(safe-area-inset-top),16px)]">
      <header className="glass mb-5 px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <Link href="/estimate" className="flex min-w-0 items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ls-logo-mark.png" alt="L&S" className="h-9 w-9 shrink-0 rounded-full" />
            <div className="min-w-0">
              <div className="font-display text-lg italic leading-tight">L&amp;S Estimator</div>
              {account && <div className="truncate text-[11px] text-cream-dim">{account}</div>}
            </div>
          </Link>
          <button
            onClick={async () => {
              await api.post("/api/auth/logout", {}).catch(() => undefined);
              router.replace("/login");
            }}
            className="shrink-0 rounded-full px-3 py-2 text-xs text-cream-dim hover:text-cream"
          >
            Sign out
          </button>
        </div>
        <nav className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-forest-deep/50 p-1">
          {tab("/estimate", "Estimate")}
          {tab("/quotes", "Quotes")}
        </nav>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
