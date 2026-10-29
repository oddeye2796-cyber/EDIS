import "./globals.css";
import Link from "next/link";
import type { Metadata, Viewport } from "next";
import { currentUser, roleLabel } from "@/lib/auth";
import { one } from "@/lib/db";
import { logout } from "./actions";

export const metadata: Metadata = { title: "EDIS 수발주", description: "수발주 업무 자동화 데모" };
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
                EDIS<small>수발주 업무 자동화</small>
              </div>
              <div className="links">
                {user.role === "sales" ? (
                  <>
                    <Link href="/submit">주문 올리기</Link>
                    <Link href="/submit?mode=ship">출하 지시</Link>
                  </>
                ) : (
                  <>
                    <Link href="/">대시보드</Link>
                    <Link href="/submit">주문 올리기</Link>
                    <Link href="/inbox">주문 접수함</Link>
                    <Link href="/upload">엑셀 일괄 등록</Link>
                    <Link href="/purchase">발주</Link>
                    <Link href="/sales">수주</Link>
                    <Link href="/lots">로트·유통기한</Link>
                    <Link href="/partners">거래처</Link>
                    <Link href="/items">품목</Link>
                    <Link href="/report">리포트</Link>
                    <Link href="/ecount">이카운트</Link>
                    <Link href="/notifications">알림{unread?.n ? ` (${unread.n})` : ""}</Link>
                  </>
                )}
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
