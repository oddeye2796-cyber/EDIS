import Link from "next/link";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { channelLabel, dateTime } from "@/lib/labels";
import { draftInbox } from "@/lib/inbox";
import type { Draft } from "@/lib/extract";
import FlowSteps from "@/components/FlowSteps";
import { inboxFlow, poFlow, soFlow } from "@/lib/flow";

const MAX_IMAGE = 5 * 1024 * 1024;

async function submitOrder(formData: FormData) {
  "use server";
  const user = await requireUser();
  const text = String(formData.get("raw_text") ?? "").trim();
  const file = formData.get("image");
  const image = file instanceof File && file.size > 0 ? file : null;
  if (!text && !image) throw new Error("메시지를 붙여 넣거나 사진을 올려 주세요.");
  if (image && image.size > MAX_IMAGE) throw new Error("사진은 5MB 이하로 올려 주세요.");
  const [row] = await query<{ id: number }>(
    `insert into order_inbox (channel, direction, partner_id, raw_text, received_by, image, image_type, sales_note)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [
      formData.get("channel"),
      formData.get("direction"),
      Number(formData.get("partner_id")) || null,
      text || "(사진으로 접수)",
      user.id,
      image ? Buffer.from(await image.arrayBuffer()) : null,
      image?.type ?? null,
      String(formData.get("sales_note") ?? "").trim() || null,
    ],
  );
  await draftInbox(row.id);
  await query(
    "insert into notifications (user_role, message, link) values ('staff', $1, '/inbox'), ('office_admin', $1, '/inbox')",
    [`${user.name}님이 주문을 올렸습니다.`],
  );
  redirect(`/submit?done=${row.id}`);
}

export default async function SubmitPage({ searchParams }: { searchParams: Promise<{ done?: string }> }) {
  const user = await requireUser();
  const { done } = await searchParams;
  const partners = await query<{ id: number; name: string }>("select id, name from partners order by name");
  const mine = await query(
    `select i.id, i.channel, i.direction, i.raw_text, i.received_at, i.status, i.ai_draft, i.linked_doc_type, i.linked_doc_id,
            coalesce(po.status, so.status) as doc_status, coalesce(po.po_no, so.so_no) as doc_no,
            coalesce(po.ecount_slip_no, so.ecount_slip_no) as slip_no
       from order_inbox i
       left join purchase_orders po on i.linked_doc_type = 'po' and po.id = i.linked_doc_id
       left join sales_orders so on i.linked_doc_type = 'so' and so.id = i.linked_doc_id
      where i.received_by = $1 order by i.received_at desc limit 20`,
    [user.id],
  );

  return (
    <div className="narrow">
      <h1 style={{ marginBottom: 4 }}>주문 올리기</h1>
      <p className="muted" style={{ marginTop: 0 }}>거래처에게 받은 카톡·문자·메일을 그대로 붙여 넣거나 캡처 사진을 올리세요. 수발주 담당자가 확인 후 처리합니다.</p>

      {done && (
        <div className="panel" style={{ borderColor: "var(--ok)" }}>
          <b>접수되었습니다.</b> 아래 목록에서 진행 상황을 볼 수 있어요.
        </div>
      )}

      <form action={submitOrder} className="panel">
        <label>받은 메시지</label>
        <textarea name="raw_text" placeholder="여기에 길게 눌러 붙여넣기" style={{ minHeight: 140, fontSize: 16 }} />

        <label style={{ marginTop: 12 }}>캡처 사진 (선택)</label>
        <input type="file" name="image" accept="image/*" />

        <label style={{ marginTop: 12 }}>어디서 받았나요?</label>
        <div className="chips">
          {Object.entries(channelLabel).map(([k, v], i) => (
            <label key={k} className="chip">
              <input type="radio" name="channel" value={k} defaultChecked={i === 1} /> {v}
            </label>
          ))}
        </div>

        <label style={{ marginTop: 12 }}>어떤 주문인가요?</label>
        <div className="chips">
          <label className="chip"><input type="radio" name="direction" value="sales" defaultChecked /> 고객 주문</label>
          <label className="chip"><input type="radio" name="direction" value="purchase" /> 원부재료 구매</label>
        </div>

        <details style={{ marginTop: 12 }}>
          <summary className="muted">거래처·메모 추가 (선택)</summary>
          <div className="fields" style={{ marginTop: 8 }}>
            <div><label>거래처</label>
              <select name="partner_id" defaultValue="">
                <option value="">AI가 원문에서 찾기</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><label>메모</label><input name="sales_note" placeholder="예) 급한 건입니다" /></div>
          </div>
        </details>

        <button className="block" style={{ marginTop: 16 }}>보내기</button>
      </form>

      <h2>내가 올린 주문</h2>
      <div className="cards">
        {mine.map((m) => {
          const draft = m.ai_draft as Draft | null;
          const status = m.status === "converted"
            ? `${m.linked_doc_type === "so" ? "수주" : "발주"} ${m.doc_no}`
            : m.status === "ignored" ? "처리 안 함" : "담당자 확인 대기";
          return (
            <div key={String(m.id)} className="panel">
              <div className="actions" style={{ justifyContent: "space-between" }}>
                <span className="badge info">{channelLabel[String(m.channel)]}</span>
                <span className={`badge ${m.status === "converted" ? "ok" : m.status === "ignored" ? "" : "warn"}`}>{status}</span>
              </div>
              <div style={{ marginTop: 8 }}>{draft?.summary ?? String(m.raw_text).slice(0, 60)}</div>
              <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{dateTime(m.received_at)}</div>
              <div style={{ marginTop: 8 }}>
                <FlowSteps
                  compact
                  flow={
                    m.status !== "converted"
                      ? inboxFlow(String(m.direction), String(m.status), Boolean(draft))
                      : m.linked_doc_type === "so"
                        ? soFlow(String(m.doc_status), true, m.slip_no as string | null)
                        : poFlow(String(m.doc_status), true, m.slip_no as string | null)
                  }
                />
              </div>
              {m.status === "converted" && user.role !== "sales" && (
                <Link href={`/${m.linked_doc_type === "so" ? "sales" : "purchase"}/${m.linked_doc_id}`}>문서 보기</Link>
              )}
            </div>
          );
        })}
        {mine.length === 0 && <p className="muted">아직 올린 주문이 없습니다.</p>}
      </div>
    </div>
  );
}
