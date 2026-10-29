"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { one, query, tx } from "@/lib/db";
import { guarded } from "@/lib/action";
import { requirePerm, type Perm } from "@/lib/permissions";
import { logStatus, nextDocNo, notify, notifyRequester } from "@/lib/workflow";
import { pushSlip } from "@/lib/ecount";
import { allocateFEFO, contractRemaining, createShortagePOs, learnAliases, stockFor } from "@/lib/stock";
import { readLines } from "@/components/OrderForm";

export async function createSO(formData: FormData) {
  return guarded(() => _createSO(formData));
}

async function _createSO(formData: FormData) {
  const user = await requirePerm("so.create");
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

// salesNote: 출하 지시를 올린 영업 담당자에게 보낼 말
const flow: Record<string, { from: string[]; to: string; perm: Perm; notifyRoles?: string[]; message: string; salesNote: string }> = {
  confirm: { from: ["received"], to: "confirmed", perm: "so.confirm", notifyRoles: ["factory_manager"], message: "재고 확인 후 수주 확정, 출고 준비를 요청합니다.", salesNote: "재고 확인이 끝나 확정됐어요. 공장 출고 준비를 기다립니다." },
  prepare: { from: ["confirmed"], to: "preparing", perm: "so.prepare", notifyRoles: ["staff"], message: "출고 준비를 시작했습니다.", salesNote: "공장에서 출고 준비를 시작했어요." },
  cancel: { from: ["received", "confirmed", "preparing"], to: "cancelled", perm: "so.cancel", notifyRoles: ["staff", "factory_manager"], message: "취소되었습니다.", salesNote: "사무실에서 취소했어요." },
};

export async function transitionSO(formData: FormData) {
  return guarded(() => _transitionSO(formData));
}

async function _transitionSO(formData: FormData) {
  const id = Number(formData.get("id"));
  const t = flow[String(formData.get("action"))];
  if (!t) throw new Error("알 수 없는 동작입니다.");
  const user = await requirePerm(t.perm);
  await tx(async (c) => {
    const { rows } = await c.query("select so_no, status from sales_orders where id = $1 for update", [id]);
    const so = rows[0];
    if (!so || !t.from.includes(so.status)) throw new Error("이미 다른 단계로 넘어간 문서입니다. 화면을 새로 고쳐 지금 상태를 확인하세요.");
    await c.query("update sales_orders set status = $2 where id = $1", [id, t.to]);
    await logStatus(c, "so", id, so.status, t.to, user.id, t.message);
    for (const r of t.notifyRoles ?? []) {
      if (r !== user.role) await notify(c, r, `수주 ${so.so_no}: ${t.message}`, `/sales/${id}`);
    }
    await notifyRequester(c, id, `출하 지시 ${so.so_no}: ${t.salesNote}`);
  });
  revalidatePath(`/sales/${id}`);
}

export async function shipSO(formData: FormData) {
  return guarded(() => _shipSO(formData));
}

async function _shipSO(formData: FormData) {
  const user = await requirePerm("so.ship");
  const id = Number(formData.get("id"));
  const lineIds = formData.getAll("line_id").map(Number);
  const qtys = formData.getAll("ship_qty").map(Number);
  await tx(async (c) => {
    const { rows } = await c.query(
      `select so.so_no, so.status, so.parent_so_id, p.ecount_code from sales_orders so
         join partners p on p.id = so.customer_id where so.id = $1 for update of so`,
      [id],
    );
    const so = rows[0];
    if (!so || !["preparing", "partially_shipped"].includes(so.status)) throw new Error("출고 준비 중인 수주만 출고할 수 있습니다.");
    let any = false;
    for (let i = 0; i < lineIds.length; i++) {
      if (!(qtys[i] > 0)) continue;
      any = true;
      // 분할 출하 지시로 넘어간 몫은 원 수주에서 직접 출고할 수 없습니다.
      const { rows: lr } = await c.query(
        `update sales_order_lines l set shipped_qty = shipped_qty + $2
          where id = $1 and so_id = $3
            and l.shipped_qty + $2 <= l.qty - coalesce((
              select sum(cl.qty - cl.shipped_qty) from sales_order_lines cl join sales_orders ch on ch.id = cl.so_id
               where ch.parent_so_id = l.so_id and cl.item_id = l.item_id and ch.status <> 'cancelled'), 0) + 1e-9
          returning item_id`,
        [lineIds[i], qtys[i], id],
      );
      if (!lr[0]) throw new Error("남은 수량보다 많이 출고할 수 없습니다.");
      await allocateFEFO(c, lineIds[i], lr[0].item_id, qtys[i]);
      // 분할 출하 지시면 원 수주의 출고 수량에도 더합니다.
      if (so.parent_so_id) {
        await c.query(
          `update sales_order_lines set shipped_qty = least(qty, shipped_qty + $3)
            where id = (select id from sales_order_lines where so_id = $1 and item_id = $2 order by id limit 1)`,
          [so.parent_so_id, lr[0].item_id, qtys[i]],
        );
      }
    }
    if (so.parent_so_id) {
      const { rows: pr } = await c.query(
        `select s.so_no, s.status, (select count(*)::int from sales_order_lines where so_id = s.id and shipped_qty < qty) as left
           from sales_orders s where s.id = $1 for update`,
        [so.parent_so_id],
      );
      const p = pr[0];
      const pNext = p.left === 0 ? "shipped" : "partially_shipped";
      if (p && p.status !== pNext && p.status !== "cancelled") {
        await c.query("update sales_orders set status = $2 where id = $1", [so.parent_so_id, pNext]);
        await logStatus(c, "so", so.parent_so_id, p.status, pNext, user.id, `분할 출하 ${so.so_no} 출고 반영`);
      }
    }
    if (!any) throw new Error("출고 수량을 입력하세요.");
    const { rows: remain } = await c.query(
      "select count(*)::int as n from sales_order_lines where so_id = $1 and shipped_qty < qty",
      [id],
    );
    const next = remain[0].n === 0 ? "shipped" : "partially_shipped";
    await c.query("update sales_orders set status = $2 where id = $1", [id, next]);
    await logStatus(c, "so", id, so.status, next, user.id, "출고 처리");
    await notifyRequester(c, id, next === "shipped" ? `출하 지시 ${so.so_no}: 출고가 끝났어요.` : `출하 지시 ${so.so_no}: 일부 출고됐어요. 나머지는 이어서 출고합니다.`);
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
  return guarded(() => _orderShortage(formData));
}

async function _orderShortage(formData: FormData) {
  const user = await requirePerm("so.shortage");
  const id = Number(formData.get("id"));
  const row = await one<{ so_no: string; due_date: Date | null; status: string }>(
    "select so_no, due_date, status from sales_orders where id = $1",
    [id],
  );
  if (!row || row.status !== "received") throw new Error("재고 확인 단계의 수주만 부족분 발주를 만들 수 있습니다.");
  const lines = await query<{ item_id: number; remain: string; name: string; unit: string; product: boolean }>(
    `select l.item_id, sum(l.qty - l.shipped_qty) as remain, i.name, i.unit, i.category = 'product' as product
       from sales_order_lines l join items i on i.id = l.item_id where l.so_id = $1 group by l.item_id, i.name, i.unit, i.category`,
    [id],
  );
  const stock = await stockFor(lines.map((l) => l.item_id), id);
  const shortages = lines
    .map((l) => {
      const s = stock.get(l.item_id)!;
      return { item_id: l.item_id, qty: Number(l.remain) - (s.on_hand - s.reserved) - s.incoming, line: l };
    })
    .filter((s) => s.qty > 0);
  if (shortages.length === 0) throw new Error("부족한 품목이 없습니다.");
  // 원부재료는 공급사에 발주, 완제품은 공장에 생산 요청
  const toBuy = shortages.filter((s) => !s.line.product);
  const toMake = shortages.filter((s) => s.line.product);
  await tx(async (c) => {
    if (toBuy.length) {
      const { created } = await createShortagePOs(c, id, row.so_no, row.due_date, toBuy, user.id);
      await logStatus(c, "so", id, row.status, row.status, user.id, `재고 부족분 발주서 생성: ${created.join(", ")}`);
    }
    if (toMake.length) {
      const what = toMake.map((s) => `${s.line.name} ${s.qty.toLocaleString("ko-KR")}${s.line.unit}`).join(", ");
      await logStatus(c, "so", id, row.status, row.status, user.id, `공장에 생산 요청: ${what}`);
      await notify(c, "factory_manager", `수주 ${row.so_no} 완제품 부족, 생산 요청: ${what}`, `/sales/${id}`);
    }
    await notifyRequester(c, id, `출하 지시 ${row.so_no}: 재고가 부족해 ${toMake.length ? "생산" : "원료 발주"}를 요청했어요. 납기가 늦어질 수 있어요.`);
  });
  revalidatePath(`/sales/${id}`);
}

// 기존 수주(계약)에서 이번에 내보낼 수량만 골라 출하 지시를 만듭니다. 원 수주의 남은 수량을 넘을 수 없습니다.
export async function shipFromOrder(formData: FormData) {
  return guarded(() => _shipFromOrder(formData));
}

async function _shipFromOrder(formData: FormData) {
  const user = await requirePerm("so.split");
  const parentId = Number(formData.get("parent_id"));
  const itemIds = formData.getAll("item_id").map(Number);
  const qtys = formData.getAll("qty").map(Number);
  const urgent = formData.get("urgent") === "on";
  const soNo = await tx(async (c) => {
    const { rows: pr } = await c.query(
      "select id, so_no, customer_id, status from sales_orders where id = $1 for update",
      [parentId],
    );
    const parent = pr[0];
    if (!parent || !["received", "confirmed", "preparing", "partially_shipped"].includes(parent.status)) {
      throw new Error("진행 중인 수주에서만 나눠 보낼 수 있습니다.");
    }
    const remain = new Map((await contractRemaining(parentId)).map((r) => [r.item_id, r]));
    const lines = itemIds.map((itemId, i) => ({ itemId, qty: qtys[i] })).filter((l) => l.qty > 0);
    if (lines.length === 0) throw new Error("이번에 보낼 수량을 입력하세요.");
    for (const l of lines) {
      const r = remain.get(l.itemId);
      if (!r || l.qty > Number(r.remaining) + 1e-9) {
        throw new Error(`${r?.name ?? "품목"}은 남은 수량(${Number(r?.remaining ?? 0)})까지만 보낼 수 있습니다.`);
      }
    }
    const soNo = await nextDocNo(c, "SO");
    const { rows } = await c.query(
      `insert into sales_orders (so_no, customer_id, due_date, memo, created_by, kind, urgent, parent_so_id)
       values ($1,$2,$3,$4,$5,'ship_request',$6,$7) returning id`,
      [soNo, parent.customer_id, formData.get("due_date") || null, String(formData.get("memo") ?? "").trim() || null, user.id, urgent, parentId],
    );
    const soId = rows[0].id as number;
    for (const l of lines) {
      await c.query("insert into sales_order_lines (so_id, item_id, qty, unit_price) values ($1,$2,$3,$4)", [
        soId, l.itemId, l.qty, remain.get(l.itemId)!.unit_price,
      ]);
    }
    await logStatus(c, "so", soId, null, "received", user.id, `${user.name}님 출하 지시 (${parent.so_no}에서 분할)${urgent ? " (긴급)" : ""}`);
    await logStatus(c, "so", parentId, parent.status, parent.status, user.id, `분할 출하 지시 ${soNo} 등록`);
    const msg = `${urgent ? "[긴급] " : ""}${user.name}님 출하 지시 ${soNo} (${parent.so_no}에서 분할): 재고 확인 후 확정해 주세요.`;
    await notify(c, "office_admin", msg, `/sales/${soId}`);
    await notify(c, "staff", msg, `/sales/${soId}`);
    return soNo;
  });
  redirect(`/shipments?sent=${soNo}`);
}
