import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { itemCategory, won } from "@/lib/labels";

async function addItem(formData: FormData) {
  "use server";
  await requireUser();
  const f = (k: string) => String(formData.get(k) ?? "").trim() || null;
  await query(
    "insert into items (code, name, category, spec, unit, storage_condition, default_price, ecount_code) values ($1,$2,$3,$4,$5,$6,$7,$8)",
    [f("code"), f("name"), f("category"), f("spec"), f("unit") ?? "kg", f("storage_condition"), Number(f("default_price") ?? 0), f("ecount_code")],
  );
  revalidatePath("/items");
}

export default async function ItemsPage() {
  await requireUser();
  const items = await query("select * from items order by code");
  return (
    <>
      <h1 style={{ marginBottom: 16 }}>품목</h1>
      <div className="panel">
        <table>
          <thead>
            <tr><th>코드</th><th>품목명</th><th>구분</th><th>규격</th><th>단위</th><th>보관조건</th><th className="num">기본단가</th><th>이카운트 코드</th></tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={String(i.id)}>
                <td>{String(i.code)}</td>
                <td>{String(i.name)}</td>
                <td><span className="badge">{itemCategory[String(i.category)]}</span></td>
                <td>{String(i.spec ?? "")}</td>
                <td>{String(i.unit)}</td>
                <td>{String(i.storage_condition ?? "")}</td>
                <td className="num">{won(i.default_price)}</td>
                <td>{String(i.ecount_code ?? "")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel">
        <h2>품목 추가</h2>
        <form action={addItem}>
          <div className="fields">
            <div><label>품목코드</label><input name="code" required /></div>
            <div><label>품목명</label><input name="name" required /></div>
            <div><label>구분</label><select name="category"><option value="raw">원료</option><option value="sub">부재료</option></select></div>
            <div><label>규격</label><input name="spec" /></div>
            <div><label>단위</label><input name="unit" defaultValue="kg" /></div>
            <div><label>보관조건</label><input name="storage_condition" /></div>
            <div><label>기본단가 (원)</label><input name="default_price" type="number" step="0.01" /></div>
            <div><label>이카운트 품목코드</label><input name="ecount_code" /></div>
          </div>
          <button>추가</button>
        </form>
      </div>
    </>
  );
}
