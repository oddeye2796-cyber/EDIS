// 재고 계산과 로트 차감. 재고는 유통기한이 지나지 않은 로트의 잔량으로 봅니다.
import type { PoolClient } from "pg";
import { query } from "./db";
import { logStatus, nextDocNo, notify } from "./workflow";

export type StockRow = {
  item_id: number;
  on_hand: number; // 유효 로트 잔량
  reserved: number; // 다른 확정 수주가 잡아둔 수량
  incoming: number; // 진행 중 발주의 미입고 수량
};

export async function stockFor(itemIds: number[], excludeSoId?: number): Promise<Map<number, StockRow>> {
  const rows = await query<{ item_id: number; on_hand: string; reserved: string; incoming: string }>(
    `select i.id as item_id,
            coalesce((select sum(remaining_qty) from lots
                       where item_id = i.id and remaining_qty > 0
                         and (expiry_date is null or expiry_date >= current_date)), 0) as on_hand,
            coalesce((select sum(l.qty - l.shipped_qty) from sales_order_lines l join sales_orders s on s.id = l.so_id
                       where l.item_id = i.id and s.status in ('confirmed','preparing','partially_shipped')
                         and s.id <> coalesce($2, 0)), 0) as reserved,
            coalesce((select sum(l.qty - l.received_qty) from purchase_order_lines l join purchase_orders p on p.id = l.po_id
                       where l.item_id = i.id
                         and p.status in ('pending_approval','approved','confirmed','sent','partially_received')), 0) as incoming
       from items i where i.id = any($1)`,
    [itemIds, excludeSoId ?? null],
  );
  return new Map(
    rows.map((r) => [r.item_id, { item_id: r.item_id, on_hand: Number(r.on_hand), reserved: Number(r.reserved), incoming: Number(r.incoming) }]),
  );
}

// 수주의 부족분을 품목 기본 공급사별로 묶어 발주서 초안(승인 대기)을 만듭니다.
export async function createShortagePOs(
  c: PoolClient,
  soId: number,
  soNo: string,
  dueDate: Date | null,
  shortages: { item_id: number; qty: number }[],
  userId: number,
) {
  const { rows: items } = await c.query(
    `select i.id, i.default_price, coalesce(i.default_supplier_id,
              (select po.supplier_id from purchase_order_lines l join purchase_orders po on po.id = l.po_id
                where l.item_id = i.id order by po.created_at desc limit 1)) as supplier_id
       from items i where i.id = any($1)`,
    [shortages.map((s) => s.item_id)],
  );
  const bySupplier = new Map<number, { item_id: number; qty: number; price: number }[]>();
  const noSupplier: number[] = [];
  for (const s of shortages) {
    const it = items.find((i) => i.id === s.item_id);
    if (!it?.supplier_id) {
      noSupplier.push(s.item_id);
      continue;
    }
    const list = bySupplier.get(it.supplier_id) ?? [];
    list.push({ item_id: s.item_id, qty: s.qty, price: Number(it.default_price) });
    bySupplier.set(it.supplier_id, list);
  }
  // 입고가 출고보다 먼저 되도록 수주 납기 3일 전을 발주 납기로 잡습니다.
  const due = dueDate ? new Date(dueDate.getTime() - 3 * 86400000) : null;
  const created: string[] = [];
  for (const [supplierId, lines] of bySupplier) {
    const poNo = await nextDocNo(c, "PO");
    const { rows } = await c.query(
      `insert into purchase_orders (po_no, supplier_id, status, due_date, memo, created_by, source_so_id)
       values ($1,$2,'pending_approval',$3,$4,$5,$6) returning id`,
      [poNo, supplierId, due, `수주 ${soNo} 부족분 자동 생성`, userId, soId],
    );
    for (const l of lines) {
      await c.query("insert into purchase_order_lines (po_id, item_id, qty, unit_price) values ($1,$2,$3,$4)", [
        rows[0].id, l.item_id, l.qty, l.price,
      ]);
    }
    await logStatus(c, "po", rows[0].id, null, "pending_approval", userId, `수주 ${soNo} 재고 부족분으로 자동 생성`);
    await notify(c, "office_admin", `수주 ${soNo} 부족분 발주서 ${poNo} 승인 요청`, `/purchase/${rows[0].id}`);
    created.push(poNo);
  }
  return { created, noSupplier };
}

// 출고 수량을 유통기한이 빠른 로트부터 차감하고 어떤 로트가 나갔는지 기록합니다.
export async function allocateFEFO(c: PoolClient, soLineId: number, itemId: number, qty: number) {
  const { rows: lots } = await c.query(
    `select id, remaining_qty from lots
      where item_id = $1 and remaining_qty > 0 and (expiry_date is null or expiry_date >= current_date)
      order by expiry_date nulls last, received_at
      for update`,
    [itemId],
  );
  let left = qty;
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(left, Number(lot.remaining_qty));
    await c.query("update lots set remaining_qty = remaining_qty - $2 where id = $1", [lot.id, take]);
    await c.query("insert into shipment_lots (so_line_id, lot_id, qty) values ($1,$2,$3)", [soLineId, lot.id, take]);
    left -= take;
  }
  if (left > 1e-9) throw new Error("유효한 로트 재고가 부족해 출고할 수 없습니다. 부족분 발주를 먼저 진행하세요.");
}

// 원문 표현과 담당자가 고른 품목을 별칭 사전에 저장합니다. 정식 이름·코드와 같으면 건너뛰고,
// 이미 학습된 별칭이 다른 품목을 가리키면 담당자 선택으로 고칩니다(직접 등록한 별칭은 그대로 둡니다).
export async function learnAliases(c: PoolClient, lines: { itemId: number; draftText: string | null }[]) {
  for (const l of lines) {
    const alias = l.draftText?.replace(/\s+/g, " ").trim();
    if (!alias || alias.length < 2) continue;
    await c.query(
      `insert into item_aliases (item_id, alias, learned)
       select $1, $2, true where not exists (select 1 from items where name = $2 or code = $2)
       on conflict (alias) do update set item_id = excluded.item_id where item_aliases.learned`,
      [l.itemId, alias],
    );
  }
}
