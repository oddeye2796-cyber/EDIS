import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { dateTime } from "@/lib/labels";
import { isMock } from "@/lib/ecount";

export default async function EcountPage() {
  await requireUser();
  const logs = await query(
    `select e.*, coalesce(po.po_no, so.so_no) as doc_no from ecount_sync_logs e
       left join purchase_orders po on e.doc_type = 'po' and po.id = e.doc_id
       left join sales_orders so on e.doc_type = 'so' and so.id = e.doc_id
      order by e.at desc limit 50`,
  );
  return (
    <>
      <h1 style={{ marginBottom: 4 }}>이카운트 연동</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        {isMock()
          ? "지금은 모의 모드입니다. 실제로 보낼 요청 내용만 기록하고 가짜 전표번호를 받습니다. 이카운트 오픈API 인증키를 설정하면 실제 전표가 등록됩니다."
          : "실연동 모드입니다."}
      </p>
      <div className="panel">
        <table>
          <thead><tr><th>시각</th><th>문서</th><th>결과</th><th>요청 내용</th></tr></thead>
          <tbody>
            {logs.map((l) => (
              <tr key={String(l.id)}>
                <td>{dateTime(l.at)}</td>
                <td>{l.doc_type === "po" ? "구매" : "판매"} · {String(l.doc_no)}</td>
                <td>
                  <span className={`badge ${l.success ? "ok" : "bad"}`}>{l.success ? "성공" : "실패"}</span>
                  {l.mock ? <span className="badge" style={{ marginLeft: 4 }}>모의</span> : null}
                  <div className="muted">{String((l.response as { SlipNos?: string[] })?.SlipNos?.[0] ?? "")}</div>
                </td>
                <td style={{ maxWidth: 520 }}><pre>{JSON.stringify(l.request, null, 2)}</pre></td>
              </tr>
            ))}
            {logs.length === 0 && <tr><td colSpan={4} className="muted">아직 전송 기록이 없습니다. 발주 입고나 수주 출고를 완료하면 전표가 전송됩니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
