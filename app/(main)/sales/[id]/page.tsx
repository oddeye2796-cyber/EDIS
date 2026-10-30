import { can, whoCan } from "@/lib/permissions";
import { notFound } from "next/navigation";
import { one, query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { date, qty, won } from "@/lib/labels";
import StatusBadge from "@/components/StatusBadge";
import Timeline from "@/components/Timeline";
import FlowSteps from "@/components/FlowSteps";
import { soFlow } from "@/lib/flow";
import { contractRemaining, stockFor } from "@/lib/stock";
import { orderShortage, shipSO, transitionSO } from "../actions";

function Waiting({ who, what }: { who: string; what: string }) {
  return <span className="muted">지금은 {who}가 {what}할 차례입니다.</span>;
}

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
  const { role } = await requireUser();
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
    `select l.*, i.code, i.name, i.unit, i.category,
            coalesce((select sum(cl.qty - cl.shipped_qty) from sales_order_lines cl join sales_orders c on c.id = cl.so_id
                       where c.parent_so_id = l.so_id and cl.item_id = l.item_id and c.status <> 'cancelled'), 0) as child_open,
            (select string_agg(lt.lot_no || ' ' || trim_scale(sl.qty)::text, ', ' order by sl.id)
               from shipment_lots sl join lots lt on lt.id = sl.lot_id where sl.so_line_id = l.id) as shipped_lots
       from sales_order_lines l join items i on i.id = l.item_id where l.so_id = $1 order by l.id`,
    [id],
  );
  const stock = await stockFor(lines.map((l) => Number(l.item_id)), id);
  const check = lines.map((l) => {
    const s = stock.get(Number(l.item_id))!;
    const need = Number(l.qty) - Number(l.shipped_qty) - Number(l.child_open);
    const available = Math.max(0, s.on_hand - s.reserved);
    return { id: l.id, name: l.name, unit: l.unit, product: l.category === "product", need, available, incoming: s.incoming, short: Math.max(0, need - available - s.incoming), lack: need > available };
  });
  const parentSO = so.parent_so_id ? await one("select id, so_no, memo from sales_orders where id = $1", [so.parent_so_id]) : null;
  const children = await query(
    `select c.id, c.so_no, c.status, c.due_date,
            (select string_agg(i.name || ' ' || trim_scale(l.qty)::text || i.unit, ', ') from sales_order_lines l join items i on i.id = l.item_id where l.so_id = c.id) as summary
       from sales_orders c where c.parent_so_id = $1 order by c.id`,
    [id],
  );
  const remaining = children.length > 0 ? await contractRemaining(id) : [];
  const madeRequest = await one(
    "select 1 from status_logs where doc_type = 'so' and doc_id = $1 and memo like '공장에 생산 요청%' limit 1",
    [id],
  );
  const sourcePOs = await query(
    `select po.id, po.po_no, po.status, p.name as supplier from purchase_orders po
       join partners p on p.id = po.supplier_id where po.source_so_id = $1 order by po.id`,
    [id],
  );
  const status = String(so.status);
  const total = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0);
  const canShip = ["preparing", "partially_shipped"].includes(status);

  return (
    <>
      <div className="topbar">
        <h1>
          {so.kind === "ship_request" ? "출하 지시" : "수주"} {String(so.so_no)} <StatusBadge kind="so" status={status} />
          {so.urgent ? <> <span className="badge bad">긴급</span></> : null}
        </h1>
      </div>
      <div className="panel">
        <div className="flow-title">처리 흐름</div>
        <FlowSteps flow={soFlow(status, Boolean(so.inbox_id), so.ecount_slip_no as string | null)} />
      </div>
      <div className="panel">
        <div className="fields">
          <div><label>고객사</label>{String(so.customer)}</div>
          <div><label>수주일</label>{date(so.order_date)}</div>
          <div><label>납기일</label>{date(so.due_date)}</div>
          <div><label>등록</label>{String(so.creator ?? "-")}</div>
          <div><label>이카운트 판매 전표</label>{String(so.ecount_slip_no ?? "-")}</div>
          {so.memo ? <div><label>메모</label>{String(so.memo)}</div> : null}
          {parentSO ? <div><label>원 수주</label><a href={`/sales/${parentSO.id}`}>{String(parentSO.so_no)}</a>{parentSO.memo ? ` ${String(parentSO.memo)}` : ""}</div> : null}
        </div>
        {so.raw_text ? <><label>접수 원문</label><div className="raw" style={{ marginBottom: 12 }}>{String(so.raw_text)}</div></> : null}
        <table>
          <thead><tr><th>품목</th><th className="num">수주 수량</th><th className="num">출고 수량</th><th>출고 로트</th><th className="num">단가</th><th className="num">금액</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={String(l.id)}>
                <td>{String(l.code)} {String(l.name)}</td>
                <td className="num">{qty(l.qty)} {String(l.unit)}</td>
                <td className="num">{qty(l.shipped_qty)}</td>
                <td className="muted">{String(l.shipped_lots ?? "-")}</td>
                <td className="num">{won(l.unit_price)}</td>
                <td className="num">{won(Number(l.qty) * Number(l.unit_price))}</td>
              </tr>
            ))}
            <tr><td colSpan={5} className="num"><b>합계</b></td><td className="num"><b>{won(total)}</b></td></tr>
          </tbody>
        </table>
      </div>
      {children.length > 0 && (
        <div className="panel">
          <h2>분할 출하</h2>
          <table>
            <thead><tr><th>품목</th><th className="num">수주</th><th className="num">남은 수량 (출하 지시 전)</th></tr></thead>
            <tbody>
              {remaining.map((r) => (
                <tr key={r.line_id}><td>{r.name}</td><td className="num">{qty(r.qty)} {r.unit}</td><td className="num">{qty(r.remaining)} {r.unit}</td></tr>
              ))}
            </tbody>
          </table>
          <table style={{ marginTop: 8 }}>
            <thead><tr><th>출하 지시</th><th>내용</th><th>납품일</th><th>상태</th></tr></thead>
            <tbody>
              {children.map((c) => (
                <tr key={String(c.id)}>
                  <td><a href={`/sales/${c.id}`}>{String(c.so_no)}</a></td>
                  <td>{String(c.summary ?? "")}</td>
                  <td className="nw">{date(c.due_date)}</td>
                  <td><StatusBadge kind="so" status={String(c.status)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {["received", "confirmed", "preparing", "partially_shipped"].includes(status) && (
        <div className="panel">
          <h2>재고 확인</h2>
          <p className="muted" style={{ marginTop: 0 }}>
            가용 재고는 유통기한이 남은 로트 잔량에서 다른 확정 수주가 잡아둔 수량을 뺀 값입니다.
            {children.length > 0 ? " 필요 수량은 출하 지시로 넘어간 몫을 뺀 나머지입니다." : ""}
          </p>
          <table>
            <thead><tr><th>품목</th><th className="num">필요</th><th className="num">가용 재고</th><th className="num">입고 예정</th><th className="num">부족</th><th>판정</th></tr></thead>
            <tbody>
              {check.map((l) => (
                <tr key={String(l.id)}>
                  <td>{String(l.name)}</td>
                  <td className="num">{qty(l.need)} {String(l.unit)}</td>
                  <td className="num">{qty(l.available)}</td>
                  <td className="num">{qty(l.incoming)}</td>
                  <td className="num">{l.short > 0 ? <b style={{ color: "var(--bad)" }}>{qty(l.short)}</b> : "0"}</td>
                  <td>{!l.lack ? <span className="badge ok">충분</span> : l.short > 0 ? <span className="badge bad">{l.product ? "생산 필요" : "발주 필요"}</span> : <span className="badge warn">입고 대기</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {madeRequest && <p className="muted">공장에 완제품 생산을 요청했습니다. 처리 이력에서 내용을 볼 수 있어요.</p>}
          {status === "received" && can(role, "so.shortage") && check.some((l) => l.short > 0 && (!l.product || !madeRequest)) && (
            <form action={orderShortage} style={{ marginTop: 12 }}>
              <input type="hidden" name="id" value={id} />
              <button>
                {check.some((l) => l.short > 0 && !l.product) && check.some((l) => l.short > 0 && l.product)
                  ? "부족분 발주서 만들기 + 공장에 생산 요청"
                  : check.some((l) => l.short > 0 && l.product)
                    ? "공장에 부족분 생산 요청"
                    : "부족분 발주서 만들기 (공급사별 자동 생성)"}
              </button>
            </form>
          )}
          {sourcePOs.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <label>이 수주로 만든 발주서</label>
              {sourcePOs.map((p) => (
                <div key={String(p.id)}>
                  <a href={`/purchase/${p.id}`}>{String(p.po_no)}</a> {String(p.supplier)} <StatusBadge kind="po" status={String(p.status)} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div className="panel">
        <h2>다음 단계</h2>
        <div className="actions">
          {status === "received" && (can(role, "so.confirm")
            ? <ActionButton id={id} action="confirm" label="수주 확정" />
            : <Waiting who={whoCan("so.confirm")} what="재고를 보고 확정" />)}
          {status === "confirmed" && (can(role, "so.prepare")
            ? <ActionButton id={id} action="prepare" label="출고 준비 시작" />
            : <Waiting who={whoCan("so.prepare")} what="출고 준비를 시작" />)}
          {canShip && !can(role, "so.ship") && <Waiting who={whoCan("so.ship")} what="출고" />}
          {["received", "confirmed", "preparing"].includes(status) && can(role, "so.cancel") && <ActionButton id={id} action="cancel" label="취소" kind="danger" />}
          {["shipped", "cancelled"].includes(status) && <span className="muted">처리가 끝난 수주입니다.</span>}
          {can(role, "so.create") && <a className="btn secondary" href={`/sales/new?copy=${id}`}>같은 내용으로 다시 수주</a>}
          {so.kind === "order" && can(role, "so.split") && ["received", "confirmed", "preparing", "partially_shipped"].includes(status) && (
            <a className="btn secondary" href={`/submit?mode=ship&from=${id}`}>이 수주에서 나눠 출하 지시</a>
          )}
        </div>
      </div>
      {canShip && can(role, "so.ship") && (
        <div className="panel">
          <h2>출고 처리</h2>
          <p className="muted" style={{ marginTop: 0 }}>전량 출고되면 이카운트에 판매 전표가 자동 등록됩니다.</p>
          <form action={shipSO}>
            <input type="hidden" name="id" value={id} />
            <table style={{ marginBottom: 12 }}>
              <thead><tr><th>품목</th><th className="num">남은 수량</th><th>출고 수량</th></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const remain = Number(l.qty) - Number(l.shipped_qty) - Number(l.child_open);
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
