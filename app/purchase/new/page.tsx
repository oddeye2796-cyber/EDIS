import { query, one } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import OrderForm from "@/components/OrderForm";
import { createPO } from "../actions";

export default async function NewPO({ searchParams }: { searchParams: Promise<{ inbox?: string }> }) {
  await requireUser();
  const { inbox } = await searchParams;
  const inboxRow = inbox
    ? await one<{ id: number; raw_text: string; partner_id: number | null }>(
        "select id, raw_text, partner_id from order_inbox where id = $1",
        [Number(inbox)],
      )
    : undefined;
  const partners = await query<{ id: number; name: string }>(
    "select id, name from partners where type in ('supplier','both') order by name",
  );
  const items = await query<{ id: number; code: string; name: string; unit: string; default_price: string }>(
    "select id, code, name, unit, default_price from items order by code",
  );
  return (
    <>
      <h1 style={{ marginBottom: 16 }}>발주서 작성</h1>
      <div className="panel">
        <OrderForm
          action={createPO}
          partnerLabel="공급사"
          partners={partners}
          items={items}
          defaultPartnerId={inboxRow?.partner_id}
          inboxId={inboxRow?.id}
          inboxText={inboxRow?.raw_text}
          submitLabel="작성하고 승인 요청"
        />
      </div>
    </>
  );
}
