import Link from "next/link";
import { redirect } from "next/navigation";
import { one, query } from "@/lib/db";
import { requireUser } from "@/lib/auth";

// 경영진용 한 장 요약: 숫자 네 개, 6개월 추세, 매출처 비중, 지금 챙길 일.
// 지난 달까지는 monthly_results(이카운트 집계 자리), 이번 달은 EDIS 데이터로 계산합니다.

function eok(n: number) {
  if (Math.abs(n) >= 100_000_000) return `${(n / 100_000_000).toFixed(2).replace(/\.?0+$/, "")}억원`;
  return `${Math.round(n / 10_000).toLocaleString("ko-KR")}만원`;
}

function Delta({ now, prev, unit = "%" }: { now: number; prev: number | null; unit?: "%" | "p" }) {
  if (prev === null || prev === 0) return <span className="muted">지난달 비교 없음</span>;
  const d = unit === "p" ? now - prev : ((now - prev) / prev) * 100;
  const up = d >= 0;
  return (
    <span className={up ? "delta up" : "delta down"}>
      {up ? "▲" : "▼"} {Math.abs(d).toFixed(1)}{unit === "p" ? "%p" : "%"} <span className="muted">지난달 전체 대비</span>
    </span>
  );
}

function TrendChart({ months }: { months: { ym: string; sales: number; purchase: number; current: boolean }[] }) {
  const w = 640, h = 220, pad = 28, bottom = 28;
  const max = Math.max(1, ...months.map((m) => Math.max(m.sales, m.purchase)));
  const slot = (w - pad * 2) / months.length;
  const bw = Math.min(26, slot / 3);
  const y = (v: number) => h - bottom - (v / max) * (h - bottom - 24);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="trend" role="img" aria-label="최근 6개월 수주·매입 추세">
      <line x1={pad} x2={w - pad} y1={h - bottom} y2={h - bottom} className="axis" />
      {months.map((m, i) => {
        const cx = pad + slot * i + slot / 2;
        return (
          <g key={m.ym} opacity={m.current ? 0.55 : 1}>
            <rect x={cx - bw - 2} y={y(m.sales)} width={bw} height={h - bottom - y(m.sales)} rx={3} className="s1" />
            <rect x={cx + 2} y={y(m.purchase)} width={bw} height={h - bottom - y(m.purchase)} rx={3} className="s2" />
            <text x={cx - bw / 2 - 2} y={y(m.sales) - 6} textAnchor="middle" className="val">{(m.sales / 100_000_000).toFixed(1)}</text>
            <text x={cx} y={h - 8} textAnchor="middle" className="lab">{Number(m.ym.slice(5))}월{m.current ? " (진행 중)" : ""}</text>
          </g>
        );
      })}
    </svg>
  );
}

type ShareRow = { name: string; amount: string; note?: string };

// 거래처·품목 비중 막대. 상위 5개와 나머지 합계
function ShareList({ rows, empty }: { rows: ShareRow[]; empty: string }) {
  const total = rows.reduce((a, r) => a + Number(r.amount), 0);
  if (total === 0) return <p className="muted">{empty}</p>;
  const top = rows.slice(0, 5);
  const rest = total - top.reduce((a, r) => a + Number(r.amount), 0);
  return (
    <>
      {top.map((r) => {
        const pct = (Number(r.amount) / total) * 100;
        return (
          <div key={r.name} className="share">
            <div className="share-head"><span>{r.name}</span><span>{pct.toFixed(0)}% · {eok(Number(r.amount))}</span></div>
            <div className="share-track"><div className="bar" style={{ width: `${pct}%` }} /></div>
            {r.note && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{r.note}</div>}
          </div>
        );
      })}
      {rest > 0 && <div className="muted">그 밖 {rows.length - top.length}곳 {eok(rest)}</div>}
    </>
  );
}

export default async function ExecPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const user = await requireUser();
  if (!["executive", "office_admin"].includes(user.role)) redirect("/");
  // 거래처·품목 분석 기간: 이번 달 또는 최근 90일
  const period = (await searchParams).p === "90" ? "90" : "month";
  const since = period === "90" ? "now() - interval '90 days'" : "date_trunc('month', now())";

  // 분할 출하(자식 수주)는 원 수주와 겹치므로 금액에서 뺍니다.
  const cur = await one<{ ym: string; day: number; sales: string; purchase: string; orders: number; shipped: number; on_time: number }>(
    `select to_char(now(), 'YYYY-MM') as ym, extract(day from now())::int as day,
       coalesce((select sum(l.qty * l.unit_price) from sales_orders s join sales_order_lines l on l.so_id = s.id
                  where s.status <> 'cancelled' and s.parent_so_id is null and s.created_at >= date_trunc('month', now())), 0) as sales,
       coalesce((select sum(l.qty * l.unit_price) from purchase_orders o join purchase_order_lines l on l.po_id = o.id
                  where o.status not in ('cancelled','rejected') and o.created_at >= date_trunc('month', now())), 0) as purchase,
       (select count(*)::int from sales_orders where status <> 'cancelled' and parent_so_id is null
           and created_at >= date_trunc('month', now())) as orders,
       (select count(*)::int from sales_orders s join status_logs g on g.doc_type = 'so' and g.doc_id = s.id and g.to_status = 'shipped'
          where g.at >= date_trunc('month', now())) as shipped,
       (select count(*)::int from sales_orders s join status_logs g on g.doc_type = 'so' and g.doc_id = s.id and g.to_status = 'shipped'
          where g.at >= date_trunc('month', now()) and (s.due_date is null or g.at::date <= s.due_date)) as on_time`,
  );
  const history = await query<{ ym: string; sales: string; purchase: string; orders: number; on_time_rate: string | null }>(
    "select * from monthly_results where ym < to_char(now(), 'YYYY-MM') order by ym desc limit 5",
  );
  const prev = history[0];
  const sales = Number(cur?.sales ?? 0);
  const purchase = Number(cur?.purchase ?? 0);
  const onTime = cur && cur.shipped > 0 ? (cur.on_time / cur.shipped) * 100 : null;

  const risk = await one<{ late_so: number; late_po: number; stale_approval: number; expiring_lots: number; expiring_value: string }>(
    `select
       (select count(*)::int from sales_orders where status not in ('shipped','cancelled') and due_date < current_date) as late_so,
       (select count(*)::int from purchase_orders where status not in ('received','cancelled','rejected') and due_date < current_date) as late_po,
       (select count(*)::int from purchase_orders where status = 'pending_approval' and created_at < now() - interval '2 days') as stale_approval,
       (select count(*)::int from lots where remaining_qty > 0 and expiry_date between current_date and current_date + 90) as expiring_lots,
       coalesce((select sum(l.remaining_qty * i.default_price) from lots l join items i on i.id = l.item_id
                  where l.remaining_qty > 0 and l.expiry_date between current_date and current_date + 90), 0) as expiring_value`,
  );
  // 열린 수주에서 아직 내보내야 할 수량이 쓸 수 있는 재고보다 많은 품목
  const short = await query<{ name: string; need: string; on_hand: string; unit: string }>(
    `with need as (
       select l.item_id, sum(l.qty - l.shipped_qty) as need
         from sales_orders s join sales_order_lines l on l.so_id = s.id
        where s.status in ('received','confirmed','preparing','partially_shipped') and s.parent_so_id is null
        group by l.item_id),
     stock as (
       select item_id, sum(remaining_qty) as on_hand from lots
        where remaining_qty > 0 and (expiry_date is null or expiry_date >= current_date) group by item_id)
     select i.name, i.unit, n.need, coalesce(s.on_hand, 0) as on_hand
       from need n join items i on i.id = n.item_id left join stock s on s.item_id = n.item_id
      where n.need > coalesce(s.on_hand, 0) order by n.need - coalesce(s.on_hand, 0) desc`,
  );
  const customers = await query<ShareRow>(
    `select p.name, sum(l.qty * l.unit_price) as amount
       from sales_orders s join sales_order_lines l on l.so_id = s.id join partners p on p.id = s.customer_id
      where s.status <> 'cancelled' and s.parent_so_id is null and s.created_at >= ${since}
      group by p.name order by 2 desc`,
  );
  const suppliers = await query<ShareRow>(
    `select p.name, sum(l.qty * l.unit_price) as amount
       from purchase_orders o join purchase_order_lines l on l.po_id = o.id join partners p on p.id = o.supplier_id
      where o.status not in ('cancelled','rejected') and o.created_at >= ${since}
      group by p.name order by 2 desc`,
  );
  const products = await query<{ name: string; amount: string; qty: string; unit: string }>(
    `select i.name, sum(l.qty * l.unit_price) as amount, sum(l.qty) as qty, i.unit
       from sales_orders s join sales_order_lines l on l.so_id = s.id join items i on i.id = l.item_id
      where s.status <> 'cancelled' and s.parent_so_id is null and s.created_at >= ${since}
      group by i.name, i.unit order by 2 desc`,
  );
  // 원부재료는 이번에 산 평균 단가를 기준 단가(이카운트 품목 단가)와 비교해 원가 압박을 봅니다.
  const materials = await query<{ name: string; amount: string; qty: string; unit: string; avg_price: string; base_price: string }>(
    `select i.name, sum(l.qty * l.unit_price) as amount, sum(l.qty) as qty, i.unit,
            sum(l.qty * l.unit_price) / nullif(sum(l.qty), 0) as avg_price, i.default_price as base_price
       from purchase_orders o join purchase_order_lines l on l.po_id = o.id join items i on i.id = l.item_id
      where o.status not in ('cancelled','rejected') and o.created_at >= ${since}
      group by i.name, i.unit, i.default_price order by 2 desc`,
  );
  const custTotal = customers.reduce((a, c) => a + Number(c.amount), 0);
  const supTotal = suppliers.reduce((a, c) => a + Number(c.amount), 0);
  const topCustShare = custTotal ? (Number(customers[0].amount) / custTotal) * 100 : 0;
  const topSupShare = supTotal ? (Number(suppliers[0].amount) / supTotal) * 100 : 0;
  const qtyText = (n: string, unit: string) => `${Number(n).toLocaleString("ko-KR")}${unit}`;
  const productRows: ShareRow[] = products.map((p) => ({ name: p.name, amount: p.amount, note: `${qtyText(p.qty, p.unit)} 주문` }));
  const materialRows: ShareRow[] = materials.map((m) => {
    const diff = Number(m.base_price) ? ((Number(m.avg_price) - Number(m.base_price)) / Number(m.base_price)) * 100 : 0;
    const price = Math.abs(diff) < 0.5 ? "기준 단가와 같음" : `기준 단가보다 ${diff > 0 ? "▲" : "▼"}${Math.abs(diff).toFixed(1)}%`;
    return { name: m.name, amount: m.amount, note: `${qtyText(m.qty, m.unit)} · ${price}` };
  });
  const periodLabel = period === "90" ? "최근 90일" : "이번 달";

  const months = [
    ...history.slice().reverse().map((m) => ({ ym: m.ym, sales: Number(m.sales), purchase: Number(m.purchase), current: false })),
    { ym: cur?.ym ?? "", sales, purchase, current: true },
  ];

  const alerts: { level: "bad" | "warn" | "ok"; text: string; href: string }[] = [];
  if (risk?.late_so) alerts.push({ level: "bad", text: `납기가 지난 고객 주문 ${risk.late_so}건`, href: "/sales" });
  if (risk?.late_po) alerts.push({ level: "bad", text: `입고가 늦어진 원부재료 발주 ${risk.late_po}건`, href: "/purchase?status=sent,partially_received" });
  if (short.length) alerts.push({ level: "warn", text: `주문 대비 재고가 모자란 품목 ${short.length}개 (${short.slice(0, 2).map((s) => s.name).join(", ")}${short.length > 2 ? " 등" : ""})`, href: "/lots" });
  if (risk?.expiring_lots) alerts.push({ level: "warn", text: `90일 안에 유통기한이 끝나는 재고 ${risk.expiring_lots}로트, 약 ${eok(Number(risk.expiring_value))}`, href: "/lots" });
  if (risk?.stale_approval) alerts.push({ level: "warn", text: `이틀 넘게 승인을 기다리는 발주서 ${risk.stale_approval}건`, href: "/purchase?status=pending_approval" });
  if (alerts.length === 0) alerts.push({ level: "ok", text: "지금 챙길 일이 없습니다.", href: "/" });

  const salesDelta = prev ? ((sales - Number(prev.sales)) / Number(prev.sales)) * 100 : null;
  const badCount = alerts.filter((a) => a.level !== "ok").length;
  const summary = [
    `${Number(cur?.ym.slice(5))}월 수주는 ${cur?.day}일까지 ${eok(sales)}`,
    salesDelta === null ? "" : `으로 지난달 전체의 ${Math.round((sales / Number(prev!.sales)) * 100)}% 수준입니다`,
    badCount ? `. 챙길 일이 ${badCount}가지 있습니다.` : ". 지금 챙길 일은 없습니다.",
  ].join("");

  return (
    <>
      <h1 style={{ marginBottom: 6 }}>경영 현황</h1>
      <p className="exec-summary">{summary}</p>

      <div className="kpis">
        <div className="kpi">
          <div className="l">이번 달 수주 (매출)</div>
          <div className="n">{eok(sales)}</div>
          <Delta now={sales} prev={prev ? Number(prev.sales) : null} />
        </div>
        <div className="kpi">
          <div className="l">이번 달 매입 (원부재료 발주)</div>
          <div className="n">{eok(purchase)}</div>
          <Delta now={purchase} prev={prev ? Number(prev.purchase) : null} />
        </div>
        <div className="kpi">
          <div className="l">이번 달 고객 주문</div>
          <div className="n">{cur?.orders ?? 0}건</div>
          <Delta now={cur?.orders ?? 0} prev={prev ? prev.orders : null} />
        </div>
        <div className="kpi">
          <div className="l">납기 준수율</div>
          <div className="n">{onTime === null ? (prev?.on_time_rate ? `${prev.on_time_rate}%` : "-") : `${onTime.toFixed(1)}%`}</div>
          {onTime === null
            ? <span className="muted">이번 달 출고 전, 지난달 기준</span>
            : <Delta now={onTime} prev={prev?.on_time_rate ? Number(prev.on_time_rate) : null} unit="p" />}
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h2>지금 챙길 일</h2>
          <ul className="alerts">
            {alerts.map((a) => (
              <li key={a.text} className={a.level}>
                <span className="dot" />
                <Link href={a.href}>{a.text}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div className="panel">
          <h2>한눈에 보는 거래 구조 <span className="muted" style={{ fontWeight: 400 }}>({periodLabel})</span></h2>
          <ul className="facts">
            <li>가장 큰 고객 <b>{customers[0]?.name ?? "-"}</b>, 매출의 {topCustShare.toFixed(0)}%{topCustShare >= 40 && <span className="badge warn" style={{ marginLeft: 6 }}>쏠림 주의</span>}</li>
            <li>가장 많이 사는 공급사 <b>{suppliers[0]?.name ?? "-"}</b>, 매입의 {topSupShare.toFixed(0)}%{topSupShare >= 50 && <span className="badge warn" style={{ marginLeft: 6 }}>의존 주의</span>}</li>
            <li>가장 잘 팔리는 제품 <b>{products[0]?.name ?? "-"}</b>{products[0] ? `, ${eok(Number(products[0].amount))}` : ""}</li>
            <li>매입 대비 매출 <b>{supTotal ? `${(custTotal / supTotal).toFixed(1)}배` : "-"}</b> <span className="muted">(매출 {eok(custTotal)} / 매입 {eok(supTotal)})</span></li>
          </ul>
        </div>
      </div>

      <div className="topbar" style={{ margin: "8px 0 12px" }}>
        <h2 style={{ margin: 0 }}>거래처와 품목</h2>
        <div className="chips">
          <Link href="/exec" className={`chip ${period === "month" ? "on" : ""}`}>이번 달</Link>
          <Link href="/exec?p=90" className={`chip ${period === "90" ? "on" : ""}`}>최근 90일</Link>
        </div>
      </div>
      <div className="grid2">
        <div className="panel">
          <h2>매출처 (누구에게 파나)</h2>
          <ShareList rows={customers} empty="기간 안에 수주가 없습니다." />
        </div>
        <div className="panel">
          <h2>매입처 (누구에게서 사나)</h2>
          <ShareList rows={suppliers} empty="기간 안에 발주가 없습니다." />
        </div>
        <div className="panel">
          <h2>제품별 매출 (무엇이 팔리나)</h2>
          <ShareList rows={productRows} empty="기간 안에 수주가 없습니다." />
        </div>
        <div className="panel">
          <h2>원부재료별 매입 (무엇을 사나)</h2>
          <ShareList rows={materialRows} empty="기간 안에 발주가 없습니다." />
        </div>
      </div>

      <div className="panel">
        <div className="topbar" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>최근 6개월 추세 <span className="muted" style={{ fontWeight: 400 }}>(억원)</span></h2>
          <div className="legend"><span className="sw s1" />수주 (매출) <span className="sw s2" />매입</div>
        </div>
        <TrendChart months={months} />
        <p className="muted" style={{ margin: "4px 0 0" }}>지난 달까지는 이카운트 월별 집계(데모는 가상 값), 이번 달은 EDIS에 등록된 주문 기준입니다.</p>
      </div>
    </>
  );
}
