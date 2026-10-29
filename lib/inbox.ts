import { one, query } from "./db";
import { extractOrder, type Item, type Partner } from "./extract";

// 접수함 한 건을 AI로 정리해 ai_draft 에 저장합니다. 실패해도 원문은 남깁니다.
export async function draftInbox(id: number) {
  const row = await one<{ raw_text: string; direction: string; partner_id: number | null; received_at: Date }>(
    "select raw_text, direction, partner_id, received_at from order_inbox where id = $1",
    [id],
  );
  if (!row) return;
  const partners = await query<Partner>("select id, name, type from partners order by id");
  const items = await query<Item>("select id, code, name, unit from items order by id");
  try {
    const draft = await extractOrder(
      row.raw_text,
      { direction: row.direction, partnerId: row.partner_id, receivedAt: new Date(row.received_at) },
      partners,
      items,
    );
    await query("update order_inbox set ai_draft = $2, ai_error = null where id = $1", [id, draft]);
  } catch (e) {
    await query("update order_inbox set ai_error = $2 where id = $1", [id, e instanceof Error ? e.message : String(e)]);
  }
}
