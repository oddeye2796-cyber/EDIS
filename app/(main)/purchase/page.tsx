import Link from "next/link";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { date, poStatus, won } from "@/lib/labels";
import StatusBadge, { DueBadge } from "@/components/StatusBadge";

export default async function PurchaseList({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  await requireUser();
  const filter = ((await searchParams).status ?? "").split(",").filter((v) => v in poStatus);
  const rows = await query(
    `select po.*, p.name as supplier,
            (select coalesce(sum(qty * unit_price),0) from purchase_order_lines where po_id = po.id) as total
       from purchase_orders po join partners p on p.id = po.supplier_id
      where cardinality($1::text[]) = 0 or po.status = any($1)
      order by (po.urgent and po.status not in ('received','cancelled','rejected')) desc, po.created_at desc`,
    [filter],
  );
  return (
    <>
      <div className="topbar">
        <h1>
          발주 (매입)
          {filter.length > 0 && (
            <span className="muted" style={{ fontSize: 14, fontWeight: 400, marginLeft: 8 }}>
              {filter.map((f) => poStatus[f]).join(", ")} · <Link href="/purchase">전체 보기</Link>
            </span>
          )}
        </h1>
        <Link className="btn" href="/purchase/new">발주서 작성</Link>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>발주번호</th><th>공급사</th><th>발주일</th><th>납기</th><th className="num">금액</th><th>상태</th><th>이카운트</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>
                  <Link href={`/purchase/${r.id}`}>{String(r.po_no)}</Link>
                  {r.urgent ? <> <span className="badge bad">긴급</span></> : null}
                </td>
                <td>{String(r.supplier)}</td>
                <td>{date(r.order_date)}</td>
                <td>{date(r.due_date)} <DueBadge due={r.due_date} done={["received", "cancelled", "rejected"].includes(String(r.status))} /></td>
                <td className="num">{won(r.total)}</td>
                <td><StatusBadge kind="po" status={String(r.status)} /></td>
                <td>{String(r.ecount_slip_no ?? "-")}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted">발주서가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
