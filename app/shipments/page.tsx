import Link from "next/link";
import { revalidatePath } from "next/cache";
import { query } from "@/lib/db";
import { requirePermPage } from "@/lib/permissions";
import { requireUser } from "@/lib/auth";
import { daysUntil, dateTime } from "@/lib/labels";
import { flagLateShips, visibleNotice } from "@/lib/shipments";

async function markSeen() {
  "use server";
  const user = await requireUser();
  await query("update notifications set read = true where user_id = $1", [user.id]);
  revalidatePath("/", "layout");
}

// 영업 담당자가 보는 4단계. 사무실·공장 내부 단계는 이 정도로만 묶어 보여줍니다.
const steps = [
  { label: "접수", status: "received" },
  { label: "확정", status: "confirmed" },
  { label: "출고 준비", status: "preparing" },
  { label: "출고 완료", status: "shipped" },
];
// 지금 기다리고 있는 단계: 접수된 건은 확정을, 확정된 건은 출고 준비를 기다립니다.
const stepOf: Record<string, number> = { received: 1, confirmed: 2, preparing: 2, partially_shipped: 3, shipped: 4 };

const headline: Record<string, string> = {
  received: "사무실에서 재고를 확인하고 있어요",
  confirmed: "확정됐어요. 공장 출고 준비를 기다리는 중이에요",
  preparing: "공장에서 출고 준비 중이에요",
  partially_shipped: "일부 출고됐어요. 나머지를 이어서 출고합니다",
  shipped: "출고가 끝났어요",
  cancelled: "취소됐어요",
};

const md = (d: unknown) => {
  const v = d instanceof Date ? d : new Date(String(d));
  return `${v.getMonth() + 1}/${v.getDate()}`;
};

type Ship = {
  id: number; so_no: string; status: string; urgent: boolean; due_date: Date | null; memo: string | null;
  created_at: Date; customer: string; parent_no: string | null; shortage: boolean;
  last_at: Date; last_memo: string | null; last_actor: string | null;
  done_at: Record<string, string> | null;
  lines: { name: string; unit: string; qty: number; shipped: number }[];
};

const filters = [
  ["active", "진행 중"],
  ["late", "지연"],
  ["done", "완료"],
  ["all", "전체"],
] as const;

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ f?: string; sent?: string }> }) {
  const user = await requirePermPage("order.submit");
  const { f, sent } = await searchParams;
  const filter = filters.some(([k]) => k === f) ? f! : "active";
  await flagLateShips(user.id);

  const all = await query<Ship>(
    `select so.id, so.so_no, so.status, so.urgent, so.due_date, so.memo, so.created_at, p.name as customer,
            (select so_no from sales_orders where id = so.parent_so_id) as parent_no,
            exists (select 1 from status_logs s where s.doc_type = 'so' and s.doc_id = so.id
                     and (s.memo like '%생산 요청%' or s.memo like '%부족분 발주%')) as shortage,
            last.at as last_at, last.memo as last_memo, last.actor as last_actor,
            (select jsonb_object_agg(to_status, at) from (
               select to_status, min(at) as at from status_logs
                where doc_type = 'so' and doc_id = so.id group by to_status) t) as done_at,
            (select jsonb_agg(jsonb_build_object('name', i.name, 'unit', i.unit, 'qty', l.qty, 'shipped', l.shipped_qty) order by l.id)
               from sales_order_lines l join items i on i.id = l.item_id where l.so_id = so.id) as lines
       from sales_orders so
       join partners p on p.id = so.customer_id
       cross join lateral (
         select s.at, s.memo, u.name as actor from status_logs s left join users u on u.id = s.actor_id
          where s.doc_type = 'so' and s.doc_id = so.id order by s.at desc, s.id desc limit 1) last
      where so.created_by = $1 and so.kind = 'ship_request'
      order by so.created_at desc limit 50`,
    [user.id],
  );

  const open = (s: Ship) => s.status !== "shipped" && s.status !== "cancelled";
  const isLate = (s: Ship) => open(s) && s.due_date != null && (daysUntil(s.due_date) ?? 0) < 0;
  const recentDone = (s: Ship) => !open(s) && (Date.now() - new Date(s.last_at).getTime()) / 86400000 <= 30;
  const count = {
    active: all.filter(open).length,
    late: all.filter(isLate).length,
    done: all.filter(recentDone).length,
    all: all.length,
  };
  const shown = all
    .filter((s) => (filter === "active" ? open(s) : filter === "late" ? isLate(s) : filter === "done" ? !open(s) : true))
    // 지연 → 긴급 → 납기 빠른 순
    .sort((a, b) =>
      Number(isLate(b)) - Number(isLate(a)) ||
      Number(open(b) && b.urgent) - Number(open(a) && a.urgent) ||
      (open(a) && open(b) ? new Date(a.due_date ?? 0).getTime() - new Date(b.due_date ?? 0).getTime() : 0),
    );

  const news = await query<{ id: number; message: string; created_at: Date }>(
    `select id, message, created_at from notifications where not read and user_id = $1 order by created_at desc limit 5`,
    [user.id],
  );
  const unreadAll = await query<{ n: number }>(`select count(*)::int as n from notifications where not read and ${visibleNotice}`, [user.role, user.id]);

  return (
    <div className="narrow">
      <h1 style={{ marginBottom: 4 }}>내 출하 현황</h1>
      <p className="muted" style={{ marginTop: 0 }}>
        내가 보낸 출하 지시가 지금 어디까지 왔는지 보여줍니다. 확정, 출고 준비, 출고 완료, 지연이 생기면 알림으로도 알려드려요.
      </p>

      {sent && (
        <div className="panel" style={{ borderColor: "var(--ok)" }}>
          <b>출하 지시 {sent}가 등록되었습니다.</b> 사무실에서 재고를 확인하면 알림이 옵니다.
        </div>
      )}

      {news.length > 0 && (
        <div className="panel news">
          <div className="actions" style={{ justifyContent: "space-between" }}>
            <b>새 소식 {news.length}건</b>
            <form action={markSeen}><button className="secondary" style={{ padding: "4px 10px", fontSize: 13 }}>확인했어요</button></form>
          </div>
          <ul>
            {news.map((n) => (
              <li key={n.id} className={n.message.includes("지났") || n.message.includes("늦어질") ? "bad" : n.message.includes("끝났") ? "ok" : ""}>
                {n.message} <span className="muted">· {dateTime(n.created_at)}</span>
              </li>
            ))}
          </ul>
          {(unreadAll[0]?.n ?? 0) > news.length && <Link href="/notifications">알림 전체 보기</Link>}
        </div>
      )}

      <div className="ship-tabs">
        {filters.map(([k, label]) => (
          <Link key={k} href={k === "active" ? "/shipments" : `/shipments?f=${k}`} className={`ship-tab${filter === k ? " on" : ""}${k === "late" && count.late ? " late" : ""}`}>
            <span className="n">{count[k]}</span>
            <span>{k === "done" ? "완료 (30일)" : label}</span>
          </Link>
        ))}
      </div>

      <div className="cards">
        {shown.map((s) => {
          const late = isLate(s);
          const d = daysUntil(s.due_date);
          const at = stepOf[s.status] ?? 0;
          const due = !s.due_date
            ? null
            : s.status === "shipped"
              ? <span className="badge ok">출고 {md(s.done_at?.shipped ?? s.last_at)}</span>
              : s.status === "cancelled"
                ? <span className="badge">취소</span>
                : late
                  ? <span className="badge bad">{-(d ?? 0)}일 지연</span>
                  : d === 0
                    ? <span className="badge warn">오늘 납품</span>
                    : <span className={`badge ${d !== undefined && d <= 2 ? "warn" : "info"}`}>D-{d}</span>;
          return (
            <div key={s.id} className={`panel ship-card${late ? " late" : ""}${s.status === "shipped" ? " done" : ""}${s.status === "cancelled" ? " cancelled" : ""}`}>
              <div className="ship-head">
                <div>
                  <div className="ship-customer">{s.customer} {s.urgent && open(s) && <span className="badge bad">긴급</span>}</div>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {s.so_no}{s.parent_no ? ` · ${s.parent_no}에서 분할` : ""}{s.memo ? ` · ${s.memo}` : ""}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {due}
                  {s.due_date && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>납기 {md(s.due_date)}</div>}
                </div>
              </div>

              <div className={`ship-headline${late ? " bad" : ""}`}>
                {late ? `납기가 지났어요. ${headline[s.status]}` : headline[s.status]}
              </div>
              {s.shortage && open(s) && <div className="ship-warn">재고가 부족해 생산·원료 발주를 요청한 건이에요. 납기가 늦어질 수 있어요.</div>}

              {s.status !== "cancelled" && (
                <ol className="ship-steps">
                  {steps.map((st, i) => {
                    const state = i < at ? "done" : i === at ? (late ? "late" : "now") : "todo";
                    const when = s.done_at?.[st.status];
                    return (
                      <li key={st.label} className={state}>
                        <span className="dot">{state === "done" ? "✓" : i + 1}</span>
                        <span className="lbl">{st.label}</span>
                        <span className="when">{state === "done" && when ? md(when) : state === "now" || state === "late" ? "지금" : ""}</span>
                      </li>
                    );
                  })}
                </ol>
              )}

              <div className="ship-lines">
                {s.lines.map((l, i) => {
                  const pct = Math.min(100, (Number(l.shipped) / Number(l.qty)) * 100);
                  return (
                    <div key={i} className="ship-line-row">
                      <span>{l.name}</span>
                      <span className="muted">
                        {Number(l.shipped) > 0 && s.status !== "shipped" ? `${Number(l.shipped).toLocaleString("ko-KR")} / ` : ""}
                        {Number(l.qty).toLocaleString("ko-KR")}{l.unit}
                      </span>
                      {Number(l.shipped) > 0 && s.status !== "shipped" && <span className="bar"><span style={{ width: `${pct}%` }} /></span>}
                    </div>
                  );
                })}
              </div>

              <div className="ship-foot">
                <span className="muted">
                  최근: {dateTime(s.last_at)}{s.last_actor ? ` · ${s.last_actor}` : ""}{s.last_memo ? ` · ${s.last_memo}` : ""}
                </span>
                <Link href={`/submit?mode=ship&copy=${s.id}`}>같은 내용으로 다시 보내기</Link>
              </div>
            </div>
          );
        })}
        {shown.length === 0 && (
          <p className="muted">
            {filter === "late" ? "지연된 출하 지시가 없어요." : filter === "active" ? "진행 중인 출하 지시가 없어요." : "출하 지시가 없어요."}{" "}
            <Link href="/submit?mode=ship">출하 지시 보내기</Link>
          </p>
        )}
      </div>
    </div>
  );
}
