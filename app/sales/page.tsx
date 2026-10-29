import Link from "next/link";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { date, won } from "@/lib/labels";
import StatusBadge, { DueBadge } from "@/components/StatusBadge";

export default async function SalesList() {
  await requireUser();
  const rows = await query(
    `select so.*, p.name as customer,
            (select coalesce(sum(qty * unit_price),0) from sales_order_lines where so_id = so.id) as total
       from sales_orders so join partners p on p.id = so.customer_id
      order by (so.urgent and so.status not in ('shipped','cancelled')) desc, so.created_at desc`,
  );
  return (
    <>
      <div className="topbar">
        <h1>수주 (매출)</h1>
        <Link className="btn" href="/sales/new">수주 등록</Link>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>수주번호</th><th>고객사</th><th>수주일</th><th>납기</th><th className="num">금액</th><th>상태</th><th>이카운트</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>
                  <Link href={`/sales/${r.id}`}>{String(r.so_no)}</Link>
                  {r.urgent ? <> <span className="badge bad">긴급</span></> : null}
                  {r.kind === "ship_request" ? <> <span className="badge info">출하 지시</span></> : null}
                </td>
                <td>{String(r.customer)}</td>
                <td>{date(r.order_date)}</td>
                <td>{date(r.due_date)} <DueBadge due={r.due_date} done={["shipped", "cancelled"].includes(String(r.status))} /></td>
                <td className="num">{won(r.total)}</td>
                <td><StatusBadge kind="so" status={String(r.status)} /></td>
                <td>{String(r.ecount_slip_no ?? "-")}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">수주가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
