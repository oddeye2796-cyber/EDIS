import "../globals.css";
import type { Metadata, Viewport } from "next";

// 로그인(사용자 선택) 화면 전용 레이아웃: 메뉴·챗봇 없이 보여줍니다.
// 업무 화면과 루트 레이아웃이 달라서, 오갈 때마다 화면 전체를 새로 그립니다.
export const metadata: Metadata = { title: "휴럼 EDIS 수발주", description: "수발주 업무 자동화 데모" };
export const viewport: Viewport = { width: "device-width", initialScale: 1 };
export const dynamic = "force-dynamic";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
