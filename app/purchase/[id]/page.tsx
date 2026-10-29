import { notFound } from "next/navigation";
import { one, query } from "@/lib/db";
import { requireUser, type Role } from "@/lib/auth";
import { date, dateTime, qty, won } from "@/lib/labels";
import StatusBadge from "@/components/StatusBadge";
import Timeline from "@/components/Timeline";
import FlowSteps from "@/components/FlowSteps";
import { poFlow } from "@/lib/flow";
import SendPOForm from "@/components/SendPOForm";
import { receivePO, transitionPO } from "../actions";

function ActionButton({ id, action, label, kind, withMemo }: { id: number; action: string; label: string; kind?: string; withMemo?: boolean }) {
  return (
    <form action={transitionPO} className="actions">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value={action} />
      {withMemo && <input name="memo" placeholder="사유" style={{ width: 200 }} />}
      <button className={kind}>{label}</button>
    </form>
  );
}

export default async function PODetail({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const id = Number((await params).id);
  const po = await one(
    `select po.*, p.name as supplier, p.email as supplier_email, p.phone as supplier_phone, p.fax as supplier_fax, p.contact_name,
            cu.name as creator, au.name as approver, fu.name as confirmer
       from purchase_orders po
       join partners p on p.id = po.supplier_id
       left join users cu on cu.id = po.created_by
       left join users au on au.id = po.approved_by
       left join users fu on fu.id = po.confirmed_by
      where po.id = $1`,
    [id],
  );
  if (!po) notFound();
  const lines = await query(
    `select l.*, i.code, i.name, i.unit from purchase_order_lines l join items i on i.id = l.item_id
      where l.po_id = $1 order by l.id`,
    [id],
  );
  const lots = await query(
    `select lo.*, i.name from lots lo join purchase_order_lines l on l.id = lo.po_line_id
       join items i on i.id = lo.item_id where l.po_id = $1 order by lo.received_at`,
    [id],
  );
  const status = String(po.status);
  const role: Role = user.role;
  const total = lines.reduce((s, l) => s + Number(l.qty) * Number(l.unit_price), 0);
  const canReceive = ["sent", "partially_received"].includes(status);

  return (
    <>
      <div className="topbar">
        <h1>발주서 {String(po.po_no)} <StatusBadge kind="po" status={status} />{po.urgent ? <> <span className="badge bad">긴급</span></> : null}</h1>
      </div>

      <div className="panel">
        <div className="flow-title">처리 흐름</div>
        <FlowSteps flow={poFlow(status, Boolean(po.inbox_id), po.ecount_slip_no as string | null)} />
      </div>

      <div className="panel">
        <div className="fields">
          <div><label>공급사</label>{String(po.supplier)} <span className="muted">{String(po.contact_name ?? "")}</span></div>
          <div><label>발주일</label>{date(po.order_date)}</div>
          <div><label>납기일</label>{date(po.due_date)}</div>
          <div><label>작성</label>{String(po.creator ?? "-")}</div>
          <div><label>오피스 승인</label>{po.approver ? `${po.approver} (${dateTime(po.approved_at)})` : "-"}</div>
          <div><label>공장 확인</label>{po.confirmer ? `${po.confirmer} (${dateTime(po.confirmed_at)})` : "-"}</div>
          <div><label>이카운트 구매 전표</label>{String(po.ecount_slip_no ?? "-")}</div>
        </div>
        {po.memo ? <p className="muted">메모: {String(po.memo)}</p> : null}
        <table>
          <thead><tr><th>품목</th><th className="num">발주 수량</th><th className="num">입고 수량</th><th className="num">단가</th><th className="num">금액</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={String(l.id)}>
                <td>{String(l.code)} {String(l.name)}</td>
                <td className="num">{qty(l.qty)} {String(l.unit)}</td>
                <td className="num">{qty(l.received_qty)} {String(l.unit)}</td>
                <td className="num">{won(l.unit_price)}</td>
                <td className="num">{won(Number(l.qty) * Number(l.unit_price))}</td>
              </tr>
            ))}
            <tr><td colSpan={4} className="num"><b>합계</b></td><td className="num"><b>{won(total)}</b></td></tr>
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>다음 단계</h2>
        <div className="actions">
          {status === "pending_approval" && role === "office_admin" && (
            <>
              <ActionButton id={id} action="approve" label="오피스 승인" />
              <ActionButton id={id} action="reject" label="반려" kind="danger" withMemo />
            </>
          )}
          {status === "pending_approval" && role !== "office_admin" && <span className="muted">오피스 관리자의 승인을 기다리는 중입니다.</span>}
          {status === "approved" && role === "factory_manager" && (
            <>
              <ActionButton id={id} action="confirm" label="공장 확인" />
              <ActionButton id={id} action="reject" label="반려" kind="danger" withMemo />
            </>
          )}
          {status === "approved" && role !== "factory_manager" && <span className="muted">공장 관리자의 확인을 기다리는 중입니다.</span>}
          {status === "confirmed" && role !== "factory_manager" && (
            <SendPOForm
              id={id}
              action={transitionPO}
              contacts={{ email: po.supplier_email as string | null, sms: po.supplier_phone as string | null, fax: po.supplier_fax as string | null }}
            />
          )}
          {po.sent_via ? <span className="muted">발송: {({ email: "이메일", sms: "문자", fax: "팩스" } as Record<string, string>)[String(po.sent_via)]} {String(po.sent_to ?? "")}</span> : null}
          {status === "confirmed" && role === "factory_manager" && <span className="muted">사무실에서 공급사에 발송할 차례입니다.</span>}
          {status === "rejected" && <ActionButton id={id} action="resubmit" label="다시 승인 요청" kind="secondary" />}
          {["pending_approval", "approved", "confirmed", "sent"].includes(status) && role === "office_admin" && (
            <ActionButton id={id} action="cancel" label="발주 취소" kind="danger" withMemo />
          )}
          {["received", "cancelled"].includes(status) && <span className="muted">처리가 끝난 발주서입니다.</span>}
          <a className="btn secondary" href={`/purchase/new?copy=${id}`}>같은 내용으로 다시 발주</a>
        </div>
      </div>

      {canReceive && (
        <div className="panel">
          <h2>입고 처리</h2>
          <p className="muted" style={{ marginTop: 0 }}>들어온 수량과 로트 정보를 입력하세요. 전량 입고되면 이카운트에 구매 전표가 자동 등록됩니다.</p>
          <form action={receivePO}>
            <input type="hidden" name="id" value={id} />
            <table style={{ marginBottom: 12 }}>
              <thead><tr><th>품목</th><th className="num">남은 수량</th><th>입고 수량</th><th>로트번호</th><th>제조일</th><th>유통기한</th><th>시험성적서(COA) 메모</th></tr></thead>
              <tbody>
                {lines.map((l) => {
                  const remain = Number(l.qty) - Number(l.received_qty);
                  return (
                    <tr key={String(l.id)}>
                      <td>{String(l.name)}<input type="hidden" name="line_id" value={String(l.id)} /></td>
                      <td className="num">{qty(remain)} {String(l.unit)}</td>
                      <td><input name="recv_qty" type="number" step="0.001" min="0" max={remain} defaultValue={remain > 0 ? remain : ""} /></td>
                      <td><input name="lot_no" /></td>
                      <td><input name="mfg_date" type="date" /></td>
                      <td><input name="expiry_date" type="date" /></td>
                      <td><input name="coa_note" placeholder="예) COA 수령, 적합" /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <button>입고 확정</button>
          </form>
        </div>
      )}

      {lots.length > 0 && (
        <div className="panel">
          <h2>입고된 로트</h2>
          <table>
            <thead><tr><th>품목</th><th>로트번호</th><th className="num">수량</th><th>제조일</th><th>유통기한</th><th>COA</th></tr></thead>
            <tbody>
              {lots.map((l) => (
                <tr key={String(l.id)}>
                  <td>{String(l.name)}</td><td>{String(l.lot_no)}</td><td className="num">{qty(l.qty)}</td>
                  <td>{date(l.mfg_date)}</td><td>{date(l.expiry_date)}</td><td>{String(l.coa_note ?? "-")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Timeline docType="po" docId={id} />
    </>
  );
}
