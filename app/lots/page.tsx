import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { date, daysUntil, itemCategory, qty } from "@/lib/labels";

export default async function LotsPage() {
  await requireUser();
  const lots = await query(
    `select lo.*, i.code, i.name, i.unit, i.category, po.po_no, po.id as po_id
       from lots lo join items i on i.id = lo.item_id
       left join purchase_order_lines l on l.id = lo.po_line_id
       left join purchase_orders po on po.id = l.po_id
      order by lo.expiry_date nulls last`,
  );
  return (
    <>
      <h1 style={{ marginBottom: 16 }}>로트·유통기한</h1>
      <div className="panel">
        <table>
          <thead><tr><th>품목</th><th>구분</th><th>로트번호</th><th className="num">수량</th><th>제조일</th><th>유통기한</th><th>COA</th><th>발주서</th></tr></thead>
          <tbody>
            {lots.map((l) => {
              const d = daysUntil(l.expiry_date);
              const badge = d === undefined ? null : d < 0 ? <span className="badge bad">만료</span> : d <= 90 ? <span className="badge warn">D-{d}</span> : null;
              return (
                <tr key={String(l.id)}>
                  <td>{String(l.code)} {String(l.name)}</td>
                  <td>{itemCategory[String(l.category)]}</td>
                  <td>{String(l.lot_no)}</td>
                  <td className="num">{qty(l.qty)} {String(l.unit)}</td>
                  <td>{date(l.mfg_date)}</td>
                  <td>{date(l.expiry_date)} {badge}</td>
                  <td>{String(l.coa_note ?? "-")}</td>
                  <td>{l.po_id ? <a href={`/purchase/${l.po_id}`}>{String(l.po_no)}</a> : "-"}</td>
                </tr>
              );
            })}
            {lots.length === 0 && <tr><td colSpan={8} className="muted">입고된 로트가 없습니다. 발주서에서 입고 처리하면 여기에 쌓입니다.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
