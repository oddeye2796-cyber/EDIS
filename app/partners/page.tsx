import Link from "next/link";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { partnerType } from "@/lib/labels";
import { syncMaster } from "@/lib/master";
import SyncBar from "@/components/SyncBar";

async function sync() {
  "use server";
  await requireUser();
  await syncMaster("partners");
  revalidatePath("/partners");
}

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const type = sp.type && sp.type in partnerType ? sp.type : "";
  const partners = await query(
    `select * from partners
      where ($1 = '' or name ilike '%' || $1 || '%' or coalesce(ecount_code, '') ilike '%' || $1 || '%'
             or coalesce(biz_no, '') ilike '%' || $1 || '%' or coalesce(contact_name, '') ilike '%' || $1 || '%')
        and ($2 = '' or type = $2 or ($2 <> 'both' and type = 'both'))
      order by type, name`,
    [q, type],
  );
  return (
    <>
      <h1 style={{ marginBottom: 16 }}>거래처</h1>
      <SyncBar kind="partners" action={sync} />
      <div className="panel">
        <form className="filters">
          <div><label>구분</label>
            <select name="type" defaultValue={type}>
              <option value="">전체</option>
              {Object.entries(partnerType).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label>검색어</label><input name="q" defaultValue={q} placeholder="거래처명, 이카운트 코드, 사업자번호, 담당자" /></div>
          <div className="filter-actions">
            <button>조회</button>
            {(q || type) && <Link href="/partners">초기화</Link>}
          </div>
        </form>
        <div className="muted" style={{ marginBottom: 8 }}>{partners.length}건</div>
        <table>
          <thead>
            <tr>
              <th>구분</th><th>거래처명</th><th>사업자번호</th><th>담당자</th><th>연락처</th><th>팩스</th><th>이메일</th><th>결제조건</th><th>이카운트 코드</th>
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => (
              <tr key={String(p.id)}>
                <td><span className="badge">{partnerType[String(p.type)]}</span></td>
                <td>{String(p.name)}</td>
                <td>{String(p.biz_no ?? "")}</td>
                <td>{String(p.contact_name ?? "")}</td>
                <td>{String(p.phone ?? "")}</td>
                <td>{String(p.fax ?? "")}</td>
                <td>{String(p.email ?? "")}</td>
                <td>{String(p.payment_terms ?? "")}</td>
                <td>{String(p.ecount_code ?? "")}</td>
              </tr>
            ))}
            {partners.length === 0 && <tr><td colSpan={9} className="muted">조건에 맞는 거래처가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
