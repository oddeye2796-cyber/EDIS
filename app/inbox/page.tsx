import Link from "next/link";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { guarded } from "@/lib/action";
import { requirePerm, requirePermPage } from "@/lib/permissions";
import { channelLabel, dateTime } from "@/lib/labels";
import { draftInbox } from "@/lib/inbox";
import type { Draft } from "@/lib/extract";

async function addInbox(formData: FormData) {
  "use server";
  return guarded(async () => {
  const user = await requirePerm("inbox.manage");
  const partnerId = Number(formData.get("partner_id")) || null;
  const [row] = await query<{ id: number }>(
    "insert into order_inbox (channel, direction, partner_id, raw_text, received_by) values ($1,$2,$3,$4,$5) returning id",
    [formData.get("channel"), formData.get("direction"), partnerId, String(formData.get("raw_text")).trim(), user.id],
  );
  await draftInbox(row.id);
  revalidatePath("/inbox");
  });
}

async function redraft(formData: FormData) {
  "use server";
  await requirePerm("inbox.manage");
  await draftInbox(Number(formData.get("id")));
  revalidatePath("/inbox");
}

async function ignoreInbox(formData: FormData) {
  "use server";
  await requirePerm("inbox.manage");
  await query("update order_inbox set status = 'ignored' where id = $1 and status = 'new'", [Number(formData.get("id"))]);
  revalidatePath("/inbox");
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ dir?: string }> }) {
  await requirePermPage("inbox.manage");
  const dirParam = (await searchParams).dir;
  const dir = dirParam === "sales" || dirParam === "purchase" ? dirParam : "";
  const partners = await query<{ id: number; name: string; type: string }>(
    "select id, name, type from partners order by name",
  );
  // 아직 정리되지 않은 새 접수(예: 시연 데이터)는 화면을 열 때 정리합니다.
  const undrafted = await query<{ id: number }>(
    "select id from order_inbox where status = 'new' and ai_draft is null and ai_error is null order by id limit 10",
  );
  for (const r of undrafted) await draftInbox(r.id);
  const rows = await query(
    `select i.id, i.channel, i.direction, i.raw_text, i.received_at, i.status, i.linked_doc_type, i.linked_doc_id,
            i.ai_draft, i.ai_error, i.sales_note, i.urgent, (i.image is not null) as has_image,
            p.name as partner_name, u.name as receiver
       from order_inbox i
       left join partners p on p.id = i.partner_id
       left join users u on u.id = i.received_by
      where $1 = '' or i.direction = $1
      order by (i.status = 'new') desc, (i.status = 'new' and i.urgent) desc, i.received_at desc
      limit 100`,
    [dir],
  );
  return (
    <>
      <h1 style={{ marginBottom: 4 }}>
        주문 접수함{dir && <> · {dir === "sales" ? "고객 주문 (수주)" : "원부재료 구매 (발주)"} <Link href="/inbox" style={{ fontSize: 14, fontWeight: 400 }}>전체 보기</Link></>}
      </h1>
      <p className="muted" style={{ marginTop: 0 }}>
        영업 담당자가 "주문 올리기"로 보낸 주문이 여기 쌓입니다. AI가 정리한 초안을 확인하고 발주서나 수주로 확정하세요.
      </p>
      <details className="panel">
        <summary><b>사무실에서 직접 받은 주문 기록하기</b> <span className="muted">(사무실로 바로 온 전화·메일 등)</span></summary>
        <form action={addInbox} style={{ marginTop: 12 }}>
          <div className="fields">
            <div><label>채널</label>
              <select name="channel">
                {Object.entries(channelLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div><label>구분</label>
              <select name="direction">
                <option value="sales">고객 주문 (수주)</option>
                <option value="purchase">원부재료 구매 요청 (발주)</option>
              </select>
            </div>
            <div><label>거래처</label>
              <select name="partner_id">
                <option value="">모름 / 나중에 지정</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <label>주문 원문 (메일 본문, 카톡·문자 내용, 통화 메모)</label>
            <textarea name="raw_text" required placeholder="예) 비타민C 200kg, 11/10까지 납품 부탁드립니다." />
          </div>
          <button>기록</button>
        </form>
      </details>
      <div className="panel">
        <table>
          <thead>
            <tr><th>받은 시각</th><th>채널</th><th>구분</th><th>거래처</th><th>원문</th><th>AI 정리</th><th>상태</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isNew = r.status === "new";
              const draft = r.ai_draft as Draft | null;
              const dir = draft && draft.direction !== "unknown" ? draft.direction : String(r.direction);
              const target = dir === "sales" ? "sales" : "purchase";
              return (
                <tr key={String(r.id)} style={isNew && r.urgent ? { background: "#fff5f5" } : undefined}>
                  <td>{isNew && r.urgent ? <div><span className="badge bad">긴급</span></div> : null}{dateTime(r.received_at)}<div className="muted">{String(r.receiver ?? "")}</div></td>
                  <td><span className="badge info">{channelLabel[String(r.channel)]}</span></td>
                  <td>{r.direction === "sales" ? "수주" : "발주"}</td>
                  <td>{String(r.partner_name ?? "-")}</td>
                  <td style={{ maxWidth: 320 }}>
                    <div className="raw">{String(r.raw_text)}</div>
                    {r.has_image ? (
                      <a href={`/api/inbox/${r.id}/image`} target="_blank">
                        <img src={`/api/inbox/${r.id}/image`} alt="주문 캡처" style={{ maxWidth: 160, marginTop: 6, borderRadius: 6, border: "1px solid var(--line)" }} />
                      </a>
                    ) : null}
                    {r.sales_note ? <div className="muted">메모: {String(r.sales_note)}</div> : null}
                  </td>
                  <td style={{ maxWidth: 280 }}>
                    <DraftCell draft={r.ai_draft as Draft | null} error={r.ai_error as string | null} />
                    {isNew && (
                      <form action={redraft} style={{ marginTop: 6 }}>
                        <input type="hidden" name="id" value={String(r.id)} />
                        <button className="secondary">다시 정리</button>
                      </form>
                    )}
                  </td>
                  <td>
                    {isNew ? <span className="badge warn">처리 전</span>
                      : r.status === "converted" ? (
                        <Link href={`/${r.linked_doc_type === "so" ? "sales" : "purchase"}/${r.linked_doc_id}`}>
                          <span className="badge ok">문서 생성됨</span>
                        </Link>
                      ) : <span className="badge">무시</span>}
                  </td>
                  <td>
                    {isNew && (
                      <div className="actions">
                        <Link className="btn" href={`/${target}/new?inbox=${r.id}`}>
                          {target === "sales" ? "수주로 등록" : "발주서 작성"}
                        </Link>
                        <form action={ignoreInbox} className="inline">
                          <input type="hidden" name="id" value={String(r.id)} />
                          <button className="secondary">무시</button>
                        </form>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={8} className="muted">아직 기록된 주문이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DraftCell({ draft, error }: { draft: Draft | null; error: string | null }) {
  if (error) return <span className="badge bad">정리 실패: {error}</span>;
  if (!draft) return <span className="muted">-</span>;
  return (
    <div>
      <div>{draft.summary}</div>
      {draft.urgent && draft.urgent_reason && <div style={{ color: "var(--bad)", fontSize: 13 }}>긴급: {draft.urgent_reason}</div>}
      {draft.needs_check.length > 0 && (
        <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: "var(--warn)" }}>
          {draft.needs_check.map((n, i) => <li key={i}>{n}</li>)}
        </ul>
      )}
      <div className="muted" style={{ fontSize: 12 }}>{draft.engine === "claude" ? "Claude 정리" : "규칙 기반 정리 (API 키 없음)"}</div>
    </div>
  );
}
