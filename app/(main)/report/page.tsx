import Link from "next/link";
import { query } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { channelLabel, qty, won } from "@/lib/labels";

function Bar({ value, max }: { value: number; max: number }) {
  return <div className="bar" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} />;
}

export default async function ReportPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  await requireUser();
  const days = [30, 90, 365].includes(Number((await searchParams).days)) ? Number((await searchParams).days) : 90;

  // 주문이 들어온 경로: 접수함 채널, 영업 출하 지시, 엑셀 일괄 등록, 화면에서 직접 입력
  const sources = await query<{ source: string; docs: string; amount: string }>(
    `with docs as (
       select coalesce(i.channel, case when so.kind = 'ship_request' then 'ship_request'
                                       when so.memo like '엑셀 일괄 등록%' then 'excel' else 'manual' end) as source,
              (select coalesce(sum(qty * unit_price), 0) from sales_order_lines where so_id = so.id) as amount
         from sales_orders so left join order_inbox i on i.id = so.inbox_id
        where so.created_at >= now() - make_interval(days => $1) and so.status <> 'cancelled'
       union all
       select coalesce(i.channel, case when po.source_so_id is not null then 'shortage'
                                       when po.memo like '엑셀 일괄 등록%' then 'excel' else 'manual' end),
              (select coalesce(sum(qty * unit_price), 0) from purchase_order_lines where po_id = po.id)
         from purchase_orders po left join order_inbox i on i.id = po.inbox_id
        where po.created_at >= now() - make_interval(days => $1) and po.status not in ('cancelled','rejected'))
     select source, count(*) as docs, sum(amount) as amount from docs group by source order by count(*) desc`,
    [days],
  );
  const inbox = await query<{ channel: string; total: string; converted: string; pending: string }>(
    `select channel, count(*) as total, count(*) filter (where status = 'converted') as converted,
            count(*) filter (where status = 'new') as pending
       from order_inbox where received_at >= now() - make_interval(days => $1) group by channel`,
    [days],
  );
  const partners = await query<{ name: string; type: string; sales: string; purchase: string; docs: string }>(
    `select p.name, p.type,
            coalesce((select sum(l.qty * l.unit_price) from sales_orders s join sales_order_lines l on l.so_id = s.id
                       where s.customer_id = p.id and s.status <> 'cancelled' and s.created_at >= now() - make_interval(days => $1)), 0) as sales,
            coalesce((select sum(l.qty * l.unit_price) from purchase_orders o join purchase_order_lines l on l.po_id = o.id
                       where o.supplier_id = p.id and o.status not in ('cancelled','rejected') and o.created_at >= now() - make_interval(days => $1)), 0) as purchase,
            (select count(*) from sales_orders where customer_id = p.id and created_at >= now() - make_interval(days => $1))
            + (select count(*) from purchase_orders where supplier_id = p.id and created_at >= now() - make_interval(days => $1)) as docs
       from partners p order by 3 desc, 4 desc`,
    [days],
  );
  const items = await query<{ code: string; name: string; unit: string; sold: string; shipped: string; bought: string; received: string; on_hand: string }>(
    `select i.code, i.name, i.unit,
            coalesce((select sum(l.qty) from sales_order_lines l join sales_orders s on s.id = l.so_id
                       where l.item_id = i.id and s.status <> 'cancelled' and s.created_at >= now() - make_interval(days => $1)), 0) as sold,
            coalesce((select sum(l.shipped_qty) from sales_order_lines l join sales_orders s on s.id = l.so_id
                       where l.item_id = i.id and s.created_at >= now() - make_interval(days => $1)), 0) as shipped,
            coalesce((select sum(l.qty) from purchase_order_lines l join purchase_orders o on o.id = l.po_id
                       where l.item_id = i.id and o.status not in ('cancelled','rejected') and o.created_at >= now() - make_interval(days => $1)), 0) as bought,
            coalesce((select sum(l.received_qty) from purchase_order_lines l join purchase_orders o on o.id = l.po_id
                       where l.item_id = i.id and o.created_at >= now() - make_interval(days => $1)), 0) as received,
            coalesce((select sum(remaining_qty) from lots where item_id = i.id and remaining_qty > 0
                       and (expiry_date is null or expiry_date >= current_date)), 0) as on_hand
       from items i order by i.code`,
    [days],
  );

  const sourceLabel: Record<string, string> = {
    ...channelLabel,
    ship_request: "영업 출하 지시",
    excel: "엑셀 일괄 등록",
    shortage: "재고 부족 자동 발주",
    manual: "화면에서 직접 입력",
  };
  const maxSource = Math.max(0, ...sources.map((s) => Number(s.docs)));
  const maxPartner = Math.max(0, ...partners.map((p) => Number(p.sales) + Number(p.purchase)));
  const maxItem = Math.max(0, ...items.map((i) => Math.max(Number(i.sold), Number(i.bought))));

  return (
    <>
      <div className="topbar">
        <h1>리포트</h1>
        <div className="chips">
          {[30, 90, 365].map((d) => (
            <Link key={d} href={`/report?days=${d}`} className={`chip ${d === days ? "on" : ""}`}>최근 {d === 365 ? "1년" : `${d}일`}</Link>
          ))}
        </div>
      </div>

      <div className="panel">
        <h2>주문이 들어온 경로</h2>
        <table>
          <thead><tr><th>경로</th><th className="num">문서 수</th><th style={{ width: "35%" }} /><th className="num">금액</th></tr></thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.source}>
                <td>{sourceLabel[s.source] ?? s.source}</td>
                <td className="num">{s.docs}</td>
                <td><Bar value={Number(s.docs)} max={maxSource} /></td>
                <td className="num">{won(s.amount)}</td>
              </tr>
            ))}
            {sources.length === 0 && <tr><td colSpan={4} className="muted">기간 안에 등록된 주문이 없습니다.</td></tr>}
          </tbody>
        </table>
        {inbox.length > 0 && (
          <>
            <h2 style={{ marginTop: 16 }}>접수함 채널별 처리</h2>
            <table>
              <thead><tr><th>채널</th><th className="num">접수</th><th className="num">문서로 확정</th><th className="num">처리 대기</th><th className="num">확정 비율</th></tr></thead>
              <tbody>
                {inbox.map((r) => (
                  <tr key={r.channel}>
                    <td>{channelLabel[r.channel] ?? r.channel}</td>
                    <td className="num">{r.total}</td>
                    <td className="num">{r.converted}</td>
                    <td className="num">{r.pending}</td>
                    <td className="num">{Math.round((Number(r.converted) / Number(r.total)) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      <div className="panel">
        <h2>거래처별</h2>
        <table>
          <thead><tr><th>거래처</th><th className="num">매출 (수주)</th><th className="num">매입 (발주)</th><th style={{ width: "30%" }} /><th className="num">문서 수</th></tr></thead>
          <tbody>
            {partners.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td className="num">{won(p.sales)}</td>
                <td className="num">{won(p.purchase)}</td>
                <td><Bar value={Number(p.sales) + Number(p.purchase)} max={maxPartner} /></td>
                <td className="num">{p.docs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="panel">
        <h2>품목별</h2>
        <table>
          <thead><tr><th>품목</th><th className="num">수주</th><th className="num">출고</th><th className="num">발주</th><th className="num">입고</th><th style={{ width: "20%" }} /><th className="num">현재 재고</th></tr></thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.code}>
                <td>{i.code} {i.name}</td>
                <td className="num">{qty(i.sold)}</td>
                <td className="num">{qty(i.shipped)}</td>
                <td className="num">{qty(i.bought)}</td>
                <td className="num">{qty(i.received)}</td>
                <td><Bar value={Math.max(Number(i.sold), Number(i.bought))} max={maxItem} /></td>
                <td className="num">{qty(i.on_hand)} {i.unit}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
