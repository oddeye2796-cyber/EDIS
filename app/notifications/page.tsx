import Link from "next/link";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { dateTime } from "@/lib/labels";

async function markAllRead() {
  "use server";
  const user = await requireUser();
  await query("update notifications set read = true where user_role is null or user_role = $1", [user.role]);
  revalidatePath("/", "layout");
}

export default async function NotificationsPage() {
  const user = await requireUser();
  const rows = await query(
    "select * from notifications where user_role is null or user_role = $1 order by created_at desc limit 100",
    [user.role],
  );
  return (
    <>
      <div className="topbar">
        <h1>알림</h1>
        <form action={markAllRead}><button className="secondary">모두 읽음</button></form>
      </div>
      <div className="panel">
        <table>
          <tbody>
            {rows.map((n) => (
              <tr key={String(n.id)} style={{ fontWeight: n.read ? 400 : 600 }}>
                <td style={{ width: 160 }} className="muted">{dateTime(n.created_at)}</td>
                <td>{n.link ? <Link href={String(n.link)}>{String(n.message)}</Link> : String(n.message)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="muted">알림이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
