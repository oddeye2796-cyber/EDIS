import Link from "next/link";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { dateTime } from "@/lib/labels";
import { noticeTone, visibleNotice } from "@/lib/alerts";

async function markAllRead() {
  "use server";
  const user = await requireUser();
  await query(`update notifications set read = true where not read and ${visibleNotice}`, [user.role, user.id]);
  revalidatePath("/", "layout");
}

export default async function NotificationsPage({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const user = await requireUser();
  const showAll = (await searchParams).all === "1";
  const rows = await query(
    `select * from notifications where ${visibleNotice} ${showAll ? "" : "and not read"} order by created_at desc limit 100`,
    [user.role, user.id],
  );
  return (
    <>
      <div className="topbar">
        <h1>알림</h1>
        <form action={markAllRead}><button className="secondary">모두 읽음</button></form>
      </div>
      <div className="chips" style={{ marginBottom: 12 }}>
        <Link href="/notifications" className={`chip ${showAll ? "" : "on"}`}>안 읽은 알림</Link>
        <Link href="/notifications?all=1" className={`chip ${showAll ? "on" : ""}`}>전체</Link>
      </div>
      <div className="panel">
        <table>
          <tbody>
            {rows.map((n) => (
              <tr key={String(n.id)} className={`notice ${noticeTone(String(n.message))}`} style={{ fontWeight: n.read ? 400 : 600 }}>
                <td style={{ width: 160 }} className="muted">{dateTime(n.created_at)}</td>
                <td>
                  {n.user_id ? <span className="badge info" style={{ marginRight: 6 }}>나에게</span> : null}
                  {n.link ? <Link prefetch={false} href={`/notifications/open?id=${n.id}`}>{String(n.message)}</Link> : String(n.message)}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="muted">{showAll ? "알림이 없습니다." : "안 읽은 알림이 없습니다."}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
