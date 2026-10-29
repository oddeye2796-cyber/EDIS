import "./globals.css";
import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { currentUser, roleLabel } from "@/lib/auth";
import { one } from "@/lib/db";
import { logout } from "./actions";
import { navByRole } from "@/lib/nav";
import { Suspense } from "react";
import ErrorBanner from "@/components/ErrorBanner";

export const metadata: Metadata = { title: "휴럼 EDIS 수발주", description: "수발주 업무 자동화 데모" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const unread = user
    ? await one<{ n: number }>(
        "select count(*)::int as n from notifications where not read and (user_role is null or user_role = $1)",
        [user.role],
      )
    : undefined;
  return (
    <html lang="ko">
      <body>
        {user ? (
          <div className="shell">
            <nav className="side">
              <div className="brand">
                휴럼 EDIS<small>수발주 업무 자동화 (데모)</small>
              </div>
              <div className="links">
                {navByRole[user.role].map((g) => (
                  <div key={g.title} className="group">
                    <div className="group-title">{g.title}</div>
                    {g.links.map(([label, href]) => (
                      <Link key={href} href={href}>
                        {label}
                        {href === "/notifications" && unread?.n ? ` (${unread.n})` : ""}
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </nav>
            <main className="main">
              <div className="topbar">
                <div />
                <div className="actions">
                  <span>
                    {user.name} <span className="badge">{roleLabel[user.role]}</span>
                  </span>
                  <form action={logout} className="inline">
                    <button className="secondary">사용자 전환</button>
                  </form>
                </div>
              </div>
              <Suspense><ErrorBanner /></Suspense>
              {children}
            </main>
          </div>
        ) : (
          <main className="main">{children}</main>
        )}
      </body>
    </html>
  );
}
