import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { partnerType } from "@/lib/labels";

async function addPartner(formData: FormData) {
  "use server";
  await requireUser();
  const f = (k: string) => String(formData.get(k) ?? "").trim() || null;
  await query(
    "insert into partners (type, name, biz_no, contact_name, phone, email, payment_terms, ecount_code) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [f("type"), f("name"), f("biz_no"), f("contact_name"), f("phone"), f("email"), f("payment_terms"), f("ecount_code")],
  );
  revalidatePath("/partners");
}

export default async function PartnersPage() {
  await requireUser();
  const partners = await query("select * from partners order by type, name");
  return (
    <>
      <h1 style={{ marginBottom: 16 }}>거래처</h1>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>구분</th><th>거래처명</th><th>사업자번호</th><th>담당자</th><th>연락처</th><th>이메일</th><th>결제조건</th><th>이카운트 코드</th>
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
                <td>{String(p.email ?? "")}</td>
                <td>{String(p.payment_terms ?? "")}</td>
                <td>{String(p.ecount_code ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h2>거래처 추가</h2>
        <form action={addPartner}>
          <div className="fields">
            <div><label>구분</label>
              <select name="type"><option value="supplier">매입처</option><option value="customer">매출처</option><option value="both">매입·매출</option></select>
            </div>
            <div><label>거래처명</label><input name="name" required /></div>
            <div><label>사업자번호</label><input name="biz_no" /></div>
            <div><label>담당자</label><input name="contact_name" /></div>
            <div><label>연락처</label><input name="phone" /></div>
            <div><label>이메일</label><input name="email" type="email" /></div>
            <div><label>결제조건</label><input name="payment_terms" /></div>
            <div><label>이카운트 거래처코드</label><input name="ecount_code" /></div>
          </div>
          <button>추가</button>
        </form>
      </div>
    </>
  );
}
