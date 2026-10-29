import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { can, requirePerm } from "@/lib/permissions";
import Link from "next/link";
import { itemCategory, won } from "@/lib/labels";
import { syncMaster } from "@/lib/master";
import SyncBar from "@/components/SyncBar";

async function sync() {
  "use server";
  await requirePerm("master.sync");
  await syncMaster("items");
  revalidatePath("/items");
}

async function addAlias(formData: FormData) {
  "use server";
  await requirePerm("alias.edit");
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
  await requirePerm("alias.edit");
  await query("delete from item_aliases where id = $1", [Number(formData.get("id"))]);
  revalidatePath("/items");
}

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string }> }) {
  const user = await requireUser();
  const editAlias = can(user.role, "alias.edit");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const category = sp.category && sp.category in itemCategory ? sp.category : "";
  // 별칭으로도 찾을 수 있게 합니다 (예: "트루락").
  const items = await query(
    `select * from items i
      where ($1 = '' or i.code ilike '%' || $1 || '%' or i.name ilike '%' || $1 || '%'
             or coalesce(i.ecount_code, '') ilike '%' || $1 || '%'
             or exists (select 1 from item_aliases a where a.item_id = i.id and a.alias ilike '%' || $1 || '%'))
        and ($2 = '' or i.category = $2)
      order by i.code`,
    [q, category],
  );
  const aliases = await query<{ id: number; item_id: number; alias: string; learned: boolean }>(
    "select id, item_id, alias, learned from item_aliases order by alias",
  );
  return (
    <>
      <h1 style={{ marginBottom: 4 }}>품목</h1>
      <p className="muted" style={{ marginTop: 0 }}>현장 별칭은 EDIS에만 있는 정보라 여기서 고칠 수 있습니다. 카톡·문자 원문에서 품목을 알아보는 사전이고, 주문을 확정할 때 원문 표현이 자동으로 학습됩니다(파란색).</p>
      <SyncBar kind="items" action={can(user.role, "master.sync") ? sync : undefined} />
      <div className="panel">
        <form className="filters">
          <div><label>구분</label>
            <select name="category" defaultValue={category}>
              <option value="">전체</option>
              {Object.entries(itemCategory).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div><label>검색어</label><input name="q" defaultValue={q} placeholder="품목코드, 품목명, 이카운트 코드, 별칭" /></div>
          <div className="filter-actions">
            <button>조회</button>
            {(q || category) && <Link href="/items">초기화</Link>}
          </div>
        </form>
        <div className="muted" style={{ marginBottom: 8 }}>{items.length}건</div>
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
                        {a.alias}{a.learned ? " (학습)" : ""} {editAlias && <button className="link" aria-label="별칭 삭제">×</button>}
                      </span>
                    </form>
                  ))}
                  {editAlias && <form action={addAlias} className="inline">
                    <input type="hidden" name="item_id" value={String(i.id)} />
                    <input name="alias" placeholder="별칭 추가" style={{ width: 90, padding: "2px 6px" }} />
                  </form>}
                </td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan={9} className="muted">조건에 맞는 품목이 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
