"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { one, query, tx } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { logStatus, nextDocNo, notify } from "@/lib/workflow";
import { pushSlip } from "@/lib/ecount";
import { allocateFEFO, createShortagePOs, learnAliases, stockFor } from "@/lib/stock";
import { readLines } from "@/components/OrderForm";

export async function createSO(formData: FormData) {
  const user = await requireUser();
  const lines = readLines(formData);
  if (lines.length === 0) throw new Error("품목을 한 줄 이상 입력하세요.");
  const inboxId = Number(formData.get("inbox_id")) || null;
  const id = await tx(async (c) => {
    const soNo = await nextDocNo(c, "SO");
    const { rows } = await c.query(
      `insert into sales_orders (so_no, customer_id, due_date, memo, created_by, inbox_id, urgent)
       values ($1,$2,$3,$4,$5,$6, coalesce((select urgent from order_inbox where id = $6), false)) returning id`,
      [soNo, Number(formData.get("partner_id")), formData.get("due_date"), formData.get("memo") || null, user.id, inboxId],
    );
    const soId = rows[0].id as number;
    for (const l of lines) {
      await c.query(
        `insert into sales_order_lines (so_id, item_id, qty, unit_price)
         values ($1,$2,$3, coalesce($4, (select default_price from items where id = $2)))`,
        [soId, l.itemId, l.qty, l.price],
      );
    }
    await learnAliases(c, lines);
    if (inboxId) {
      await c.query(
        "update order_inbox set status = 'converted', linked_doc_type = 'so', linked_doc_id = $1 where id = $2",
        [soId, inboxId],
      );
    }
    await logStatus(c, "so", soId, null, "received", user.id, "수주 등록");
    await notify(c, "office_admin", `새 수주 ${soNo}가 등록되었습니다.`, `/sales/${soId}`);
    return soId;
  });
  redirect(`/sales/${id}`);
}

const flow: Record<string, { from: string[]; to: string; notifyRole?: string; message: string }> = {
  confirm: { from: ["received"], to: "confirmed", notifyRole: "factory_manager", message: "재고 확인 후 수주 확정, 출고 준비를 요청합니다." },
  prepare: { from: ["confirmed"], to: "preparing", message: "출고 준비를 시작했습니다." },
  cancel: { from: ["received", "confirmed", "preparing"], to: "cancelled", message: "취소되었습니다." },
};

export async function transitionSO(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const t = flow[String(formData.get("action"))];
  if (!t) throw new Error("알 수 없는 동작입니다.");
  await tx(async (c) => {
    const { rows } = await c.query("select so_no, status from sales_orders where id = $1 for update", [id]);
    const so = rows[0];
    if (!so || !t.from.includes(so.status)) throw new Error("현재 상태에서는 처리할 수 없습니다.");
    await c.query("update sales_orders set status = $2 where id = $1", [id, t.to]);
    await logStatus(c, "so", id, so.status, t.to, user.id, t.message);
    if (t.notifyRole) await notify(c, t.notifyRole, `수주 ${so.so_no}: ${t.message}`, `/sales/${id}`);
  });
  revalidatePath(`/sales/${id}`);
}

export async function shipSO(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const lineIds = formData.getAll("line_id").map(Number);
  const qtys = formData.getAll("ship_qty").map(Number);
  await tx(async (c) => {
    const { rows } = await c.query(
      `select so.so_no, so.status, p.ecount_code from sales_orders so
         join partners p on p.id = so.customer_id where so.id = $1 for update of so`,
      [id],
    );
    const so = rows[0];
    if (!so || !["preparing", "partially_shipped"].includes(so.status)) throw new Error("출고 준비 중인 수주만 출고할 수 있습니다.");
    let any = false;
    for (let i = 0; i < lineIds.length; i++) {
      if (!(qtys[i] > 0)) continue;
      any = true;
      const { rows: lr } = await c.query(
        "update sales_order_lines set shipped_qty = shipped_qty + $2 where id = $1 and so_id = $3 returning item_id",
        [lineIds[i], qtys[i], id],
      );
      await allocateFEFO(c, lineIds[i], lr[0].item_id, qtys[i]);
    }
    if (!any) throw new Error("출고 수량을 입력하세요.");
    const { rows: remain } = await c.query(
      "select count(*)::int as n from sales_order_lines where so_id = $1 and shipped_qty < qty",
      [id],
    );
    const next = remain[0].n === 0 ? "shipped" : "partially_shipped";
    await c.query("update sales_orders set status = $2 where id = $1", [id, next]);
    await logStatus(c, "so", id, so.status, next, user.id, "출고 처리");
    if (next === "shipped") {
      const { rows: lines } = await c.query(
        `select i.ecount_code as item_code, l.shipped_qty as qty, l.unit_price
           from sales_order_lines l join items i on i.id = l.item_id where l.so_id = $1`,
        [id],
      );
      const slip = await pushSlip(c, "sale", id, so.ecount_code, lines.map((l) => ({ item_code: l.item_code, qty: Number(l.qty), unit_price: Number(l.unit_price) })));
      await c.query("update sales_orders set ecount_slip_no = $2 where id = $1", [id, slip]);
      await logStatus(c, "so", id, next, next, user.id, `이카운트 판매 전표 등록 (${slip})`);
      await notify(c, null, `수주 ${so.so_no} 출고 완료, 이카운트 판매 전표 ${slip} 등록`, `/sales/${id}`);
    }
  });
  revalidatePath(`/sales/${id}`);
}

export async function orderShortage(formData: FormData) {
  const user = await requireUser();
  const id = Number(formData.get("id"));
  const row = await one<{ so_no: string; due_date: Date | null; status: string }>(
    "select so_no, due_date, status from sales_orders where id = $1",
    [id],
  );
  if (!row || row.status !== "received") throw new Error("재고 확인 단계의 수주만 부족분 발주를 만들 수 있습니다.");
  const lines = await query<{ item_id: number; remain: string }>(
    "select item_id, sum(qty - shipped_qty) as remain from sales_order_lines where so_id = $1 group by item_id",
    [id],
  );
  const stock = await stockFor(lines.map((l) => l.item_id), id);
  const shortages = lines
    .map((l) => {
      const s = stock.get(l.item_id)!;
      return { item_id: l.item_id, qty: Number(l.remain) - (s.on_hand - s.reserved) - s.incoming };
    })
    .filter((s) => s.qty > 0);
  if (shortages.length === 0) throw new Error("부족한 품목이 없습니다.");
  await tx(async (c) => {
    const { created } = await createShortagePOs(c, id, row.so_no, row.due_date, shortages, user.id);
    await logStatus(c, "so", id, row.status, row.status, user.id, `재고 부족분 발주서 생성: ${created.join(", ")}`);
  });
  revalidatePath(`/sales/${id}`);
}
