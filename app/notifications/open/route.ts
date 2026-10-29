import { NextResponse, type NextRequest } from "next/server";
import { one, query } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { visibleNotice } from "@/lib/alerts";

// 알림을 누르면 읽음으로 바꾸고 해당 화면으로 보냅니다. 본인이 볼 수 있는 알림만 처리합니다.
export async function GET(req: NextRequest) {
  const user = await currentUser();
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (!user || !id) return NextResponse.redirect(new URL("/login", req.url));
  const n = await one<{ link: string | null }>(`select link from notifications where id = $3 and ${visibleNotice}`, [user.role, user.id, id]);
  if (!n) return NextResponse.redirect(new URL("/notifications", req.url));
  await query("update notifications set read = true where id = $1", [id]);
  const link = n.link && n.link.startsWith("/") ? n.link : "/notifications";
  return NextResponse.redirect(new URL(link, req.url));
}
