import { one, query } from "./db";
import type { Draft } from "./extract";

// "같은 내용으로 다시 주문": 지난 발주서·수주의 거래처와 품목 줄을 새 주문 칸에 미리 채웁니다.
export async function copyDraft(kind: "po" | "so", id: number): Promise<Draft | null> {
  const doc = kind === "po"
    ? await one<{ partner_id: number }>("select supplier_id as partner_id from purchase_orders where id = $1", [id])
    : await one<{ partner_id: number }>("select customer_id as partner_id from sales_orders where id = $1", [id]);
  if (!doc) return null;
  const lines = await query<{ item_id: number; qty: string; unit_price: string }>(
    kind === "po"
      ? "select item_id, qty, unit_price from purchase_order_lines where po_id = $1 order by id"
      : "select item_id, qty, unit_price from sales_order_lines where so_id = $1 order by id",
    [id],
  );
  return {
    engine: "rules",
    direction: kind === "po" ? "purchase" : "sales",
    partner_id: doc.partner_id,
    due_date: null,
    lines: lines.map((l) => ({ item_id: l.item_id, item_text: "", qty: Number(l.qty), unit: null, unit_price: Number(l.unit_price) })),
    summary: "",
    needs_check: [],
  };
}
