import Link from "next/link";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { channelLabel, dateTime } from "@/lib/labels";

async function addInbox(formData: FormData) {
  "use server";
  const user = await requireUser();
  const partnerId = Number(formData.get("partner_id")) || null;
  await query(
    "insert into order_inbox (channel, direction, partner_id, raw_text, received_by) values ($1,$2,$3,$4,$5)",
    [formData.get("channel"), formData.get("direction"), partnerId, String(formData.get("raw_text")).trim(), user.id],
  );
  revalidatePath("/inbox");
}

async function ignoreInbox(formData: FormData) {
  "use server";
  await requireUser();
  await query("update order_inbox set status = 'ignored' where id = $1 and status = 'new'", [Number(formData.get("id"))]);
  revalidatePath("/inbox");
}

export default async function InboxPage() {
  await requireUser();
  const partners = await query<{ id: number; name: string; type: string }>(
    "select id, name, type from partners order by name",
  );
  const rows = await query(
    `select i.*, p.name as partner_name, u.name as receiver
       from order_inbox i
       left join partners p on p.id = i.partner_id
       left join users u on u.id = i.received_by
      order by (i.status = 'new') desc, i.received_at desc
      limit 100`,
  );
  return (
    <>
      <h1 style={{ marginBottom: 4 }}>주문 접수함</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        이메일, 카톡, 문자, 전화로 받은 주문을 원문 그대로 먼저 남기고, 발주서나 수주로 바꿉니다.
      </p>
      <div className="panel">
        <h2>새 주문 기록</h2>
        <form action={addInbox}>
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
      </div>
      <div className="panel">
        <table>
          <thead>
            <tr><th>받은 시각</th><th>채널</th><th>구분</th><th>거래처</th><th>원문</th><th>상태</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isNew = r.status === "new";
              const target = r.direction === "sales" ? "sales" : "purchase";
              return (
                <tr key={String(r.id)}>
                  <td>{dateTime(r.received_at)}<div className="muted">{String(r.receiver ?? "")}</div></td>
                  <td><span className="badge info">{channelLabel[String(r.channel)]}</span></td>
                  <td>{r.direction === "sales" ? "수주" : "발주"}</td>
                  <td>{String(r.partner_name ?? "-")}</td>
                  <td style={{ maxWidth: 360 }}><div className="raw">{String(r.raw_text)}</div></td>
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
                          {r.direction === "sales" ? "수주로 등록" : "발주서 작성"}
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
            {rows.length === 0 && <tr><td colSpan={7} className="muted">아직 기록된 주문이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
