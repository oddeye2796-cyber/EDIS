import { one, query } from "./db";
import { extractOrder, type Item, type Partner } from "./extract";

// 접수함 한 건을 AI로 정리해 ai_draft 에 저장합니다. 실패해도 원문은 남깁니다.
export async function draftInbox(id: number) {
  const row = await one<{ raw_text: string; direction: string; partner_id: number | null; received_at: Date; sales_note: string | null }>(
    "select raw_text, direction, partner_id, received_at, sales_note from order_inbox where id = $1",
    [id],
  );
  if (!row) return;
  const partners = await query<Partner>("select id, name, type from partners order by id");
  const items = await query<Item>(
    `select i.id, i.code, i.name, i.unit, coalesce(array_agg(a.alias) filter (where a.alias is not null), '{}') as aliases
       from items i left join item_aliases a on a.item_id = i.id group by i.id order by i.id`,
  );
  try {
    const draft = await extractOrder(
      row.raw_text,
      { direction: row.direction, partnerId: row.partner_id, receivedAt: new Date(row.received_at) },
      partners,
      items,
    );
    // 영업 담당자 메모에 "급"이 있으면 긴급으로 봅니다.
    if (!draft.urgent && row.sales_note && /급|ASAP/i.test(row.sales_note)) {
      draft.urgent = true;
      draft.urgent_reason = `영업 메모: ${row.sales_note}`;
      draft.summary = `[긴급] ${draft.summary}`;
    }
    await query("update order_inbox set ai_draft = $2, ai_error = null, urgent = $3 where id = $1", [id, draft, Boolean(draft.urgent)]);
  } catch (e) {
    await query("update order_inbox set ai_error = $2 where id = $1", [id, e instanceof Error ? e.message : String(e)]);
  }
}
