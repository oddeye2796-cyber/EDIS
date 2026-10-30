import "../globals.css";
import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { currentUser, roleLabel } from "@/lib/auth";
import { one } from "@/lib/db";
import { logout } from "../actions";
import { navByRole } from "@/lib/nav";
import { Suspense } from "react";
import ErrorBanner from "@/components/ErrorBanner";
import { flagLate, visibleNotice } from "@/lib/alerts";
import ChatWidget from "@/components/ChatWidget";
import { suggestions } from "@/lib/assistant";
import { aiEnabled } from "@/lib/ai";

export const metadata: Metadata = { title: "휴럼 EDIS 수발주", description: "수발주 업무 자동화 데모" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  if (user) await flagLate();
  const unread = user
    ? await one<{ n: number }>(`select count(*)::int as n from notifications where not read and ${visibleNotice}`, [user.role, user.id])
    : undefined;
  return (
    <html lang="ko">
      <head>
        {/* 화면과 매뉴얼 글꼴: Pretendard (쓰는 글자만 받는 동적 서브셋) */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
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
            <ChatWidget name={user.name} suggestions={suggestions[user.role]} llm={aiEnabled()} />
          </div>
        ) : (
          <main className="main">{children}</main>
        )}
      </body>
    </html>
  );
}
