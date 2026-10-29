import { query, one } from "@/lib/db";
import { requirePermPage } from "@/lib/permissions";
import OrderForm from "@/components/OrderForm";
import type { Draft } from "@/lib/extract";
import { copyDraft } from "@/lib/copy";
import { createPO } from "../actions";

export default async function NewPO({ searchParams }: { searchParams: Promise<{ inbox?: string; copy?: string }> }) {
  await requirePermPage("po.create");
  const { inbox, copy } = await searchParams;
  const copied = copy ? await copyDraft("po", Number(copy)) : null;
  const inboxRow = inbox
    ? await one<{ id: number; raw_text: string; partner_id: number | null; ai_draft: Draft | null }>(
        "select id, raw_text, partner_id, ai_draft from order_inbox where id = $1",
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
          draft={inboxRow?.ai_draft ?? copied}
          submitLabel="작성하고 승인 요청"
        />
      </div>
    </>
  );
}
