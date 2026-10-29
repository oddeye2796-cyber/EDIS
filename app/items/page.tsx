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

async function addAlias(formData: FormData) {
  "use server";
  await requireUser();
  const alias = String(formData.get("alias") ?? "").trim();
  if (!alias) return;
  await query(
    `insert into item_aliases (item_id, alias, learned) values ($1, $2, false)
     on conflict (alias) do update set item_id = excluded.item_id, learned = false`,
    [Number(formData.get("item_id")), alias],
  );
  revalidatePath("/items");
}

async function removeAlias(formData: FormData) {
  "use server";
  await requireUser();
  await query("delete from item_aliases where id = $1", [Number(formData.get("id"))]);
  revalidatePath("/items");
}

export default async function ItemsPage() {
  await requireUser();
  const items = await query("select * from items order by code");
  const aliases = await query<{ id: number; item_id: number; alias: string; learned: boolean }>(
    "select id, item_id, alias, learned from item_aliases order by alias",
  );
  return (
    <>
      <h1 style={{ marginBottom: 4 }}>품목</h1>
      <p className="muted" style={{ marginTop: 0 }}>현장 별칭은 카톡·문자 원문에서 품목을 알아보는 사전입니다. 주문을 확정할 때 원문 표현이 자동으로 학습됩니다(파란색).</p>
      <div className="panel">
        <table>
          <thead>
            <tr><th>코드</th><th>품목명</th><th>구분</th><th>규격</th><th>단위</th><th>보관조건</th><th className="num">기본단가</th><th>이카운트 코드</th><th>현장 별칭</th></tr>
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
                <td style={{ minWidth: 200 }}>
                  {aliases.filter((a) => a.item_id === i.id).map((a) => (
                    <form key={a.id} action={removeAlias} className="inline" style={{ marginRight: 4 }}>
                      <input type="hidden" name="id" value={a.id} />
                      <span className={`badge ${a.learned ? "info" : ""}`} title={a.learned ? "주문 확정 때 자동으로 배운 별칭" : "직접 등록한 별칭"}>
                        {a.alias}{a.learned ? " (학습)" : ""} <button className="link" aria-label="별칭 삭제">×</button>
                      </span>
                    </form>
                  ))}
                  <form action={addAlias} className="inline">
                    <input type="hidden" name="item_id" value={String(i.id)} />
                    <input name="alias" placeholder="별칭 추가" style={{ width: 90, padding: "2px 6px" }} />
                  </form>
                </td>
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
            <div><label>구분</label><select name="category"><option value="raw">원료</option><option value="sub">부재료</option><option value="product">완제품</option></select></div>
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
