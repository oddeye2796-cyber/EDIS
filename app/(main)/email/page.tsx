import Link from "next/link";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { can, requirePerm } from "@/lib/permissions";
import { dateTime } from "@/lib/labels";
import { fetchNewMail, isMailMock, orderMailbox } from "@/lib/mail";
import StatusBadge from "@/components/StatusBadge";

async function checkMail() {
  "use server";
  await requirePerm("mail.check");
  const id = await fetchNewMail();
  revalidatePath("/email");
  redirect(id ? "/email?got=1" : "/email?got=0");
}

const inboxStatus: Record<string, string> = { new: "처리 전", converted: "문서로 등록", ignored: "무시" };

export default async function EmailPage({ searchParams }: { searchParams: Promise<{ got?: string }> }) {
  const user = await requireUser();
  const got = (await searchParams).got;
  const received = await query(
    `select i.id, i.received_at, coalesce(i.email_from, p.email) as email_from, i.email_subject, i.raw_text, i.status, i.urgent, p.name as partner
       from order_inbox i left join partners p on p.id = i.partner_id
      where i.channel = 'email' order by i.received_at desc limit 50`,
  );
  const sent = await query(
    `select po.id, po.po_no, po.status, po.sent_to, p.name as supplier,
            (select max(at) from status_logs s where s.doc_type = 'po' and s.doc_id = po.id and s.to_status = 'sent') as sent_at
       from purchase_orders po join partners p on p.id = po.supplier_id
      where po.sent_via = 'email' order by sent_at desc nulls last limit 50`,
  );
  return (
    <>
      <h1 style={{ marginBottom: 16 }}>이메일 연동</h1>
      <div className="panel" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <b>주문 메일함</b> {orderMailbox()}
          {isMailMock() && <span className="badge" style={{ marginLeft: 6 }}>모의</span>}
          <div className="muted">
            {isMailMock()
              ? "지금은 모의 모드입니다. 버튼을 누르면 예시 주문 메일을 한 통씩 받아 접수함에 넣습니다. 메일 계정을 설정하면 실제 메일을 주기적으로 읽어 옵니다."
              : "새 메일을 주기적으로 읽어 주문 접수함에 넣습니다."}
          </div>
          {got === "1" && <div style={{ color: "var(--ok, #15803d)" }}>새 메일 1통을 접수함에 넣었습니다.</div>}
          {got === "0" && <div className="muted">새 메일이 없습니다.</div>}
        </div>
        {can(user.role, "mail.check") && (
          <form action={checkMail}>
            <button>새 메일 확인</button>
          </form>
        )}
      </div>
      <div className="panel">
        <h2>받은 주문 메일</h2>
        <table>
          <thead><tr><th>받은 시각</th><th>보낸 사람</th><th>제목·내용</th><th>접수 상태</th></tr></thead>
          <tbody>
            {received.map((m) => (
              <tr key={String(m.id)}>
                <td>{dateTime(m.received_at)}</td>
                <td>{String(m.partner ?? "-")}<div className="muted">{String(m.email_from ?? "")}</div></td>
                <td style={{ maxWidth: 420 }}>
                  {m.urgent ? <span className="badge bad" style={{ marginRight: 4 }}>긴급</span> : null}
                  <b>{String(m.email_subject ?? "")}</b>
                  <div className="muted">{String(m.raw_text).replace(String(m.email_subject ?? ""), "").trim().slice(0, 80)}</div>
                </td>
                <td><Link href="/inbox">{inboxStatus[String(m.status)] ?? String(m.status)}</Link></td>
              </tr>
            ))}
            {received.length === 0 && <tr><td colSpan={4} className="muted">받은 주문 메일이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h2>보낸 발주서 메일</h2>
        <table>
          <thead><tr><th>보낸 시각</th><th>발주번호</th><th>공급사</th><th>받는 주소</th><th>상태</th></tr></thead>
          <tbody>
            {sent.map((s) => (
              <tr key={String(s.id)}>
                <td>{s.sent_at ? dateTime(s.sent_at) : "-"}</td>
                <td><Link href={`/purchase/${s.id}`}>{String(s.po_no)}</Link></td>
                <td>{String(s.supplier)}</td>
                <td>{String(s.sent_to ?? "")}</td>
                <td><StatusBadge kind="po" status={String(s.status)} /></td>
              </tr>
            ))}
            {sent.length === 0 && <tr><td colSpan={5} className="muted">이메일로 보낸 발주서가 없습니다. 발주서 화면에서 "이메일"로 발송하면 여기 남습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
