import Link from "next/link";
import { one, query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { channelLabel, date, dateTime } from "@/lib/labels";
import StatusBadge, { DueBadge } from "@/components/StatusBadge";

export default async function Dashboard() {
  const user = await requireUser();
  const c = await one<Record<string, number>>(
    `select
       (select count(*)::int from order_inbox where status = 'new') as inbox,
       (select count(*)::int from purchase_orders where status = 'pending_approval') as pending,
       (select count(*)::int from purchase_orders where status = 'approved') as factory,
       (select count(*)::int from purchase_orders where status in ('sent','partially_received')) as incoming,
       (select count(*)::int from sales_orders where status not in ('shipped','cancelled')) as open_so,
       (select count(*)::int from lots where expiry_date between current_date and current_date + 90) as expiring`,
  );
  const due = await query(
    `select 'po' as kind, po.id, po.po_no as no, p.name as partner, po.due_date, po.status
       from purchase_orders po join partners p on p.id = po.supplier_id
      where po.status not in ('received','cancelled','rejected') and po.due_date <= current_date + 3
     union all
     select 'so', so.id, so.so_no, p.name, so.due_date, so.status
       from sales_orders so join partners p on p.id = so.customer_id
      where so.status not in ('shipped','cancelled') and so.due_date <= current_date + 3
     order by due_date`,
  );
  const inbox = await query(
    `select i.*, p.name as partner from order_inbox i left join partners p on p.id = i.partner_id
      where i.status = 'new' order by received_at desc limit 5`,
  );
  const mine =
    user.role === "office_admin" ? "pending_approval" : user.role === "factory_manager" ? "approved" : null;
  const todo = mine
    ? await query(
        `select po.id, po.po_no, p.name as supplier, po.due_date, po.status from purchase_orders po
           join partners p on p.id = po.supplier_id where po.status = $1 order by po.created_at`,
        [mine],
      )
    : [];

  const stats: [string, number, string][] = [
    ["처리 전 주문", c?.inbox ?? 0, "/inbox"],
    ["오피스 승인 대기", c?.pending ?? 0, "/purchase"],
    ["공장 확인 대기", c?.factory ?? 0, "/purchase"],
    ["입고 예정 발주", c?.incoming ?? 0, "/purchase"],
    ["진행 중 수주", c?.open_so ?? 0, "/sales"],
    ["90일 내 유통기한 로트", c?.expiring ?? 0, "/lots"],
  ];

  return (
    <>
      <h1 style={{ marginBottom: 16 }}>대시보드</h1>
      <div className="grid" style={{ marginBottom: 16 }}>
        {stats.map(([l, n, href]) => (
          <Link key={l} href={href} className="stat" style={{ color: "inherit" }}>
            <div className="n">{n}</div>
            <div className="l">{l}</div>
          </Link>
        ))}
      </div>
      <div className="grid2">
        {mine && (
          <div className="panel">
            <h2>내가 처리할 발주서</h2>
            <table>
              <tbody>
                {todo.map((t) => (
                  <tr key={String(t.id)}>
                    <td><Link href={`/purchase/${t.id}`}>{String(t.po_no)}</Link></td>
                    <td>{String(t.supplier)}</td>
                    <td>{date(t.due_date)}</td>
                    <td><StatusBadge kind="po" status={String(t.status)} /></td>
                  </tr>
                ))}
                {todo.length === 0 && <tr><td className="muted">처리할 발주서가 없습니다.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        <div className="panel">
          <h2>납기 임박·지연</h2>
          <table>
            <tbody>
              {due.map((d) => (
                <tr key={`${d.kind}${d.id}`}>
                  <td>{d.kind === "po" ? "발주" : "수주"}</td>
                  <td><Link href={`/${d.kind === "po" ? "purchase" : "sales"}/${d.id}`}>{String(d.no)}</Link></td>
                  <td>{String(d.partner)}</td>
                  <td>{date(d.due_date)} <DueBadge due={d.due_date} done={false} /></td>
                </tr>
              ))}
              {due.length === 0 && <tr><td className="muted">3일 안에 납기인 건이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="panel">
          <h2>처리 전 주문</h2>
          <table>
            <tbody>
              {inbox.map((i) => (
                <tr key={String(i.id)}>
                  <td><span className="badge info">{channelLabel[String(i.channel)]}</span></td>
                  <td>{String(i.partner ?? "-")}</td>
                  <td className="muted">{String(i.raw_text).slice(0, 40)}</td>
                  <td>{dateTime(i.received_at)}</td>
                </tr>
              ))}
              {inbox.length === 0 && <tr><td className="muted">처리 전 주문이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
