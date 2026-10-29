import { notFound } from "next/navigation";
import { one, query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { date, qty, won } from "@/lib/labels";
import StatusBadge from "@/components/StatusBadge";
import Timeline from "@/components/Timeline";
import { shipSO, transitionSO } from "../actions";

function ActionButton({ id, action, label, kind }: { id: number; action: string; label: string; kind?: string }) {
  return (
    <form action={transitionSO} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      <button className={kind}>{label}</button>
    </form>
  );
}

export default async function SODetail({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const id = Number((await params).id);
  const so = await one(
    `select so.*, p.name as customer, u.name as creator, i.raw_text, i.channel
       from sales_orders so join partners p on p.id = so.customer_id
       left join users u on u.id = so.created_by
       left join order_inbox i on i.id = so.inbox_id
      where so.id = $1`,
    [id],
  );
  if (!so) notFound();
  const lines = await query(
    `select l.*, i.code, i.name, i.unit,
            (select coalesce(sum(qty),0) from lots where item_id = l.item_id and (expiry_date is null or expiry_date >= current_date)) as lot_qty
       from sales_order_lines l join items i on i.id = l.item_id where l.so_id = $1 order by l.id`,
    [id],
  );
  const status = String(so.status);
  const total = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0);
  const canShip = ["preparing", "partially_shipped"].includes(status);

  return (
    <>
      <div className="topbar">
        <h1>수주 {String(so.so_no)} <StatusBadge kind="so" status={status} /></h1>
      </div>
      <div className="panel">
        <div className="fields">
          <div><label>고객사</label>{String(so.customer)}</div>
          <div><label>수주일</label>{date(so.order_date)}</div>
          <div><label>납기일</label>{date(so.due_date)}</div>
          <div><label>등록</label>{String(so.creator ?? "-")}</div>
          <div><label>이카운트 판매 전표</label>{String(so.ecount_slip_no ?? "-")}</div>
        </div>
        {so.raw_text ? <><label>접수 원문</label><div className="raw" style={{ marginBottom: 12 }}>{String(so.raw_text)}</div></> : null}
        <table>
          <thead><tr><th>품목</th><th className="num">수주 수량</th><th className="num">출고 수량</th><th className="num">유효 로트 수량</th><th className="num">단가</th><th className="num">금액</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={String(l.id)}>
                <td>{String(l.code)} {String(l.name)}</td>
                <td className="num">{qty(l.qty)} {String(l.unit)}</td>
                <td className="num">{qty(l.shipped_qty)}</td>
                <td className="num">{qty(l.lot_qty)}</td>
                <td className="num">{won(l.unit_price)}</td>
                <td className="num">{won(Number(l.qty) * Number(l.unit_price))}</td>
              </tr>
            ))}
            <tr><td colSpan={5} className="num"><b>합계</b></td><td className="num"><b>{won(total)}</b></td></tr>
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h2>다음 단계</h2>
        <div className="actions">
          {status === "received" && <ActionButton id={id} action="confirm" label="수주 확정" />}
          {status === "confirmed" && <ActionButton id={id} action="prepare" label="출고 준비 시작" />}
          {["received", "confirmed", "preparing"].includes(status) && <ActionButton id={id} action="cancel" label="취소" kind="danger" />}
          {["shipped", "cancelled"].includes(status) && <span className="muted">처리가 끝난 수주입니다.</span>}
        </div>
      </div>
      {canShip && (
        <div className="panel">
          <h2>출고 처리</h2>
          <p className="muted" style={{ marginTop: 0 }}>전량 출고되면 이카운트에 판매 전표가 자동 등록됩니다.</p>
          <form action={shipSO}>
            <input type="hidden" name="id" value={id} />
            <table style={{ marginBottom: 12 }}>
              <thead><tr><th>품목</th><th className="num">남은 수량</th><th>출고 수량</th></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const remain = Number(l.qty) - Number(l.shipped_qty);
                  return (
                    <tr key={String(l.id)}>
                      <td>{String(l.name)}<input type="hidden" name="line_id" value={String(l.id)} /></td>
                      <td className="num">{qty(remain)} {String(l.unit)}</td>
                      <td><input name="ship_qty" type="number" step="0.001" min="0" max={remain} defaultValue={remain > 0 ? remain : ""} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button>출고 확정</button>
          </form>
        </div>
      )}
      <Timeline docType="so" docId={id} />
    </>
  );
}
