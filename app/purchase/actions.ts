"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { tx } from "@/lib/db";
import type { Role } from "@/lib/auth";
import { guarded } from "@/lib/action";
import { requirePerm, type Perm } from "@/lib/permissions";
import { logStatus, nextDocNo, notify } from "@/lib/workflow";
import { pushSlip } from "@/lib/ecount";
import { readLines } from "@/components/OrderForm";
import { learnAliases } from "@/lib/stock";

export async function createPO(formData: FormData) {
  return guarded(() => _createPO(formData));
}

async function _createPO(formData: FormData) {
  const user = await requirePerm("po.create");
  const lines = readLines(formData);
  if (lines.length === 0) throw new Error("품목을 한 줄 이상 입력하세요.");
  const inboxId = Number(formData.get("inbox_id")) || null;
  const id = await tx(async (c) => {
    const poNo = await nextDocNo(c, "PO");
    const { rows } = await c.query(
      `insert into purchase_orders (po_no, supplier_id, status, due_date, memo, created_by, inbox_id, urgent)
       values ($1,$2,'pending_approval',$3,$4,$5,$6, coalesce((select urgent from order_inbox where id = $6), false)) returning id`,
      [poNo, Number(formData.get("partner_id")), formData.get("due_date"), formData.get("memo") || null, user.id, inboxId],
    );
    const poId = rows[0].id as number;
    for (const l of lines) {
      await c.query(
        `insert into purchase_order_lines (po_id, item_id, qty, unit_price)
         values ($1,$2,$3, coalesce($4, (select default_price from items where id = $2)))`,
        [poId, l.itemId, l.qty, l.price],
      );
    }
    await learnAliases(c, lines);
    if (inboxId) {
      await c.query(
        "update order_inbox set status = 'converted', linked_doc_type = 'po', linked_doc_id = $1 where id = $2",
        [poId, inboxId],
      );
    }
    await logStatus(c, "po", poId, null, "pending_approval", user.id, "발주서 작성 및 승인 요청");
    await notify(c, "office_admin", `발주서 ${poNo} 승인 요청이 왔습니다.`, `/purchase/${poId}`);
    return poId;
  });
  redirect(`/purchase/${id}`);
}

const transitions: Record<
  string,
  { from: string[]; to: string; perm: Perm; stamp?: string; notifyRole?: Role; message: string }
> = {
  approve: { from: ["pending_approval"], to: "approved", perm: "po.approve", stamp: "approved", notifyRole: "factory_manager", message: "오피스 승인 완료, 공장 확인을 요청합니다." },
  reject: { from: ["pending_approval", "approved"], to: "rejected", perm: "po.reject", message: "반려되었습니다." },
  confirm: { from: ["approved"], to: "confirmed", perm: "po.confirm", stamp: "confirmed", notifyRole: "office_admin", message: "공장 확인 완료, 공급사에 발송할 수 있습니다." },
  send: { from: ["confirmed"], to: "sent", perm: "po.send", message: "공급사에 발주서를 발송했습니다." },
  cancel: { from: ["pending_approval", "approved", "confirmed", "sent"], to: "cancelled", perm: "po.cancel", message: "취소되었습니다." },
  resubmit: { from: ["rejected"], to: "pending_approval", perm: "po.resubmit", notifyRole: "office_admin", message: "다시 승인을 요청합니다." },
};

const STALE = "이미 다른 단계로 넘어간 문서입니다. 화면을 새로 고쳐 지금 상태를 확인하세요.";

const sendVia: Record<string, string> = { email: "이메일", sms: "문자", fax: "팩스" };

export async function transitionPO(formData: FormData) {
  return guarded(() => _transitionPO(formData));
}

async function _transitionPO(formData: FormData) {
  const id = Number(formData.get("id"));
  const t = transitions[String(formData.get("action"))];
  if (!t) throw new Error("알 수 없는 동작입니다.");
  const user = await requirePerm(t.perm);
  let memo = String(formData.get("memo") ?? "").trim();
  const via = String(formData.get("send_via") ?? "");
  const to = String(formData.get("send_to") ?? "").trim();
  if (formData.get("action") === "send") {
    if (!sendVia[via] || !to) throw new Error("발송 방법과 받는 곳을 입력하세요.");
    memo = `${sendVia[via]}(${to})로 발주서를 보냈습니다.${process.env.SEND_LIVE ? "" : " (데모: 실제 발송 없음)"}`;
  }
  await tx(async (c) => {
    const { rows } = await c.query("select po_no, status from purchase_orders where id = $1 for update", [id]);
    const po = rows[0];
    if (!po || !t.from.includes(po.status)) throw new Error(STALE);
    const stamp = t.stamp ? `, ${t.stamp}_by = $3, ${t.stamp}_at = now()` : "";
    await c.query(
      `update purchase_orders set status = $2${stamp} where id = $1`,
      t.stamp ? [id, t.to, user.id] : [id, t.to],
    );
    if (via && t.to === "sent") await c.query("update purchase_orders set sent_via = $2, sent_to = $3 where id = $1", [id, via, to]);
    await logStatus(c, "po", id, po.status, t.to, user.id, memo || t.message);
    if (t.notifyRole) await notify(c, t.notifyRole, `발주서 ${po.po_no}: ${t.message}`, `/purchase/${id}`);
  });
  revalidatePath(`/purchase/${id}`);
}

export async function receivePO(formData: FormData) {
  return guarded(() => _receivePO(formData));
}

async function _receivePO(formData: FormData) {
  const user = await requirePerm("po.receive");
  const id = Number(formData.get("id"));
  const lineIds = formData.getAll("line_id").map(Number);
  const qtys = formData.getAll("recv_qty").map(Number);
  const lotNos = formData.getAll("lot_no").map(String);
  const mfg = formData.getAll("mfg_date").map(String);
  const exp = formData.getAll("expiry_date").map(String);
  const coa = formData.getAll("coa_note").map(String);
  await tx(async (c) => {
    const { rows } = await c.query(
      `select po.po_no, po.status, p.ecount_code from purchase_orders po
         join partners p on p.id = po.supplier_id where po.id = $1 for update of po`,
      [id],
    );
    const po = rows[0];
    if (!po || !["sent", "partially_received"].includes(po.status)) throw new Error("발송된 발주서만 입고할 수 있습니다.");
    let any = false;
    for (let i = 0; i < lineIds.length; i++) {
      if (!(qtys[i] > 0)) continue;
      if (!lotNos[i].trim()) throw new Error("입고 수량을 넣은 줄에는 로트번호도 입력해야 합니다.");
      any = true;
      const { rows: lr } = await c.query(
        "update purchase_order_lines set received_qty = received_qty + $2 where id = $1 and po_id = $3 returning item_id",
        [lineIds[i], qtys[i], id],
      );
      await c.query(
        `insert into lots (item_id, lot_no, mfg_date, expiry_date, qty, remaining_qty, coa_note, po_line_id)
         values ($1,$2,$3,$4,$5,$5,$6,$7)`,
        [lr[0].item_id, lotNos[i].trim(), mfg[i] || null, exp[i] || null, qtys[i], coa[i] || null, lineIds[i]],
      );
    }
    if (!any) throw new Error("입고 수량을 입력하세요.");
    const { rows: remain } = await c.query(
      "select count(*)::int as n from purchase_order_lines where po_id = $1 and received_qty < qty",
      [id],
    );
    const next = remain[0].n === 0 ? "received" : "partially_received";
    await c.query("update purchase_orders set status = $2 where id = $1", [id, next]);
    await logStatus(c, "po", id, po.status, next, user.id, "입고 처리");
    if (next === "received") {
      const { rows: lines } = await c.query(
        `select i.ecount_code as item_code, l.received_qty as qty, l.unit_price
           from purchase_order_lines l join items i on i.id = l.item_id where l.po_id = $1`,
        [id],
      );
      const slip = await pushSlip(c, "purchase", id, po.ecount_code, lines.map((l) => ({ item_code: l.item_code, qty: Number(l.qty), unit_price: Number(l.unit_price) })));
      await c.query("update purchase_orders set ecount_slip_no = $2 where id = $1", [id, slip]);
      await logStatus(c, "po", id, next, next, user.id, `이카운트 구매 전표 등록 (${slip})`);
      await notify(c, null, `발주서 ${po.po_no} 입고 완료, 이카운트 구매 전표 ${slip} 등록`, `/purchase/${id}`);
    }
  });
  revalidatePath(`/purchase/${id}`);
}
