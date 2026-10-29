import Link from "next/link";
import { one, query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { channelLabel, date, dateTime } from "@/lib/labels";
import StatusBadge, { DueBadge } from "@/components/StatusBadge";
import { redirect } from "next/navigation";
import FlowSteps from "@/components/FlowSteps";
import { poSteps, soSteps } from "@/lib/flow";

export default async function Dashboard() {
  const user = await requireUser();
  if (user.role === "sales") redirect("/submit");
  if (user.role === "executive") redirect("/exec");
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
    `select i.id, i.channel, i.raw_text, i.received_at, p.name as partner from order_inbox i left join partners p on p.id = i.partner_id
      where i.status = 'new' order by received_at desc limit 5`,
  );
  // 역할마다 지금 처리할 발주서: 오피스는 승인, 공장은 확인·입고, 수발주 담당자는 발송
  const mine: Record<string, string[]> = {
    office_admin: ["pending_approval"],
    factory_manager: ["approved", "sent", "partially_received"],
    staff: ["confirmed"],
  };
  const todo = mine[user.role]
    ? await query(
        `select po.id, po.po_no, p.name as supplier, po.due_date, po.status from purchase_orders po
           join partners p on p.id = po.supplier_id where po.status = any($1) order by po.due_date nulls last, po.created_at`,
        [mine[user.role]],
      )
    : [];

  // 단계별로 지금 머물러 있는 건수
  const sc = await one<Record<string, number>>(
    `select
       (select count(*)::int from order_inbox where status = 'new' and direction = 'purchase') as po_inbox,
       (select count(*)::int from order_inbox where status = 'new' and direction = 'sales') as so_inbox,
       (select count(*)::int from purchase_orders where status = 'pending_approval') as po_approve,
       (select count(*)::int from purchase_orders where status = 'approved') as po_factory,
       (select count(*)::int from purchase_orders where status = 'confirmed') as po_send,
       (select count(*)::int from purchase_orders where status in ('sent','partially_received')) as po_receive,
       (select count(*)::int from sales_orders where status = 'received') as so_confirm,
       (select count(*)::int from sales_orders where status = 'confirmed') as so_prepare,
       (select count(*)::int from sales_orders where status in ('preparing','partially_shipped')) as so_ship`,
  );
  const poCounts = [0, 0, sc?.po_inbox ?? 0, sc?.po_approve ?? 0, sc?.po_factory ?? 0, sc?.po_send ?? 0, sc?.po_receive ?? 0, 0];
  const soCounts = [0, 0, sc?.so_inbox ?? 0, sc?.so_confirm ?? 0, sc?.so_prepare ?? 0, sc?.so_ship ?? 0, 0];

  const stats: [string, number, string][] = [
    ["처리 전 주문", c?.inbox ?? 0, "/inbox"],
    ["오피스 승인 대기", c?.pending ?? 0, "/purchase?status=pending_approval"],
    ["공장 확인 대기", c?.factory ?? 0, "/purchase?status=approved"],
    ["입고 예정 발주", c?.incoming ?? 0, "/purchase?status=sent,partially_received"],
    ["진행 중 수주", c?.open_so ?? 0, "/sales"],
    ["90일 내 유통기한 로트", c?.expiring ?? 0, "/lots"],
  ];

  return (
    <>
      <h1 style={{ marginBottom: 16 }}>대시보드</h1>
      <div className="panel">
        <p className="muted" style={{ marginTop: 0 }}>주황색 숫자는 지금 그 단계에 머물러 있는 건수입니다.</p>
        <div style={{ marginBottom: 8 }}><b>수주 (고객 주문)</b></div>
        <FlowSteps flow={{ steps: soSteps, current: -1, tone: "active" }} counts={soCounts} />
        <div style={{ margin: "16px 0 8px" }}><b>발주 (원부재료 구매)</b></div>
        <FlowSteps flow={{ steps: poSteps, current: -1, tone: "active" }} counts={poCounts} />
      </div>
      <div className="grid" style={{ marginBottom: 16 }}>
        {stats.map(([l, n, href]) => (
          <Link key={l} href={href} className="stat" style={{ color: "inherit" }}>
            <div className="n">{n}</div>
            <div className="l">{l}</div>
          </Link>
        ))}
      </div>
      <div className="grid2">
        {mine[user.role] && (
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
