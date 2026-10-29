// 물어보기 챗봇. 매뉴얼·권한표 검색(RAG)과 업무 데이터 조회 도구를 씁니다.
// ANTHROPIC_API_KEY 가 있으면 Claude가 도구를 골라 답하고, 없으면 규칙 기반으로 가장 가까운 답을 찾습니다.
// 볼 수 있는 범위: 영업은 자기 출하 지시만, 경영진·사무실·공장은 전체.
import Anthropic from "@anthropic-ai/sdk";
import { query } from "./db";
import type { User } from "./auth";
import { roleLabel } from "./auth";
import { searchKb, type Chunk } from "./kb";
import { stockFor } from "./stock";
import { poStatus, soStatus } from "./labels";

export type ChatTurn = { role: "user" | "assistant"; content: string };
export type Source = { title: string; href: string };
export type Reply = { answer: string; sources: Source[]; engine: "claude" | "rules" };

const fmt = (n: unknown) => Number(n).toLocaleString("ko-KR", { maximumFractionDigits: 3 });
const md = (d: unknown) => {
  if (!d) return "-";
  const v = d instanceof Date ? d : new Date(String(d));
  const y = v.getFullYear() === new Date().getFullYear() ? "" : `${v.getFullYear()}.`;
  return `${y}${v.getMonth() + 1}/${v.getDate()}`;
};
const eok = (n: number) =>
  Math.abs(n) >= 100_000_000 ? `${(n / 100_000_000).toFixed(2).replace(/\.?0+$/, "")}억원` : `${Math.round(n / 10_000).toLocaleString("ko-KR")}만원`;

// 매뉴얼 화면(/manual)의 역할별 장 앵커
const section: Record<string, string> = { sales: "sales", staff: "staff", office_admin: "office", factory_manager: "factory", executive: "exec" };
const chunkHref = (c: Chunk) =>
  (c.id === "alerts" || c.id.startsWith("faq") ? "/manual#alerts" : c.roles?.[0] ? `/manual#${section[c.roles[0]]}` : "/manual#start");

// ── 도구 ──────────────────────────────────────────────

type Ctx = { user: User; sources: Map<string, Source> };
const addSource = (ctx: Ctx, s: Source) => ctx.sources.set(s.href, s);

function searchManual(ctx: Ctx, q: string) {
  const hits = searchKb(q, ctx.user.role, 3);
  hits.forEach((c) => addSource(ctx, { title: `매뉴얼: ${c.title}`, href: chunkHref(c) }));
  return hits.map((c) => ({ title: c.title, text: c.text }));
}

type Doc = {
  kind: "so" | "po"; id: number; no: string; status: string; partner: string; due_date: Date | null;
  urgent: boolean; ship_request: boolean; late: boolean; items: string; last_memo: string | null;
};

async function findDocuments(ctx: Ctx, a: { kind?: string; query?: string; status?: string; late_only?: boolean; limit?: number }) {
  const sales = ctx.user.role === "sales";
  const kind = sales ? "so" : a.kind === "so" || a.kind === "po" ? a.kind : "any";
  const q = a.query?.trim() ? `%${a.query.trim()}%` : null;
  const limit = Math.min(Math.max(a.limit ?? 8, 1), 20);
  const rows: Doc[] = [];
  const itemsOf = (t: string, fk: string, id: string) =>
    `(select string_agg(i.name || ' ' || trim(to_char(l.qty, 'FM999,999,990.###')) || i.unit, ', ' order by l.id)
        from ${t} l join items i on i.id = l.item_id where l.${fk} = ${id})`;
  const lastMemo = (t: string, id: string) =>
    `(select memo from status_logs where doc_type = '${t}' and doc_id = ${id} order by at desc, id desc limit 1)`;

  if (kind !== "po") {
    rows.push(
      ...(await query<Doc>(
        `select 'so' as kind, s.id, s.so_no as no, s.status, p.name as partner, s.due_date, s.urgent,
                s.kind = 'ship_request' as ship_request,
                (s.status not in ('shipped','cancelled') and s.due_date < current_date) as late,
                ${itemsOf("sales_order_lines", "so_id", "s.id")} as items, ${lastMemo("so", "s.id")} as last_memo
           from sales_orders s join partners p on p.id = s.customer_id
          where ($1::text is null or s.so_no ilike $1 or p.name ilike $1
                 or exists (select 1 from sales_order_lines l join items i on i.id = l.item_id where l.so_id = s.id and i.name ilike $1))
            and ($2::text is null or s.status = $2)
            and (not $3 or (s.status not in ('shipped','cancelled') and s.due_date < current_date))
            and ($4::int is null or (s.created_by = $4 and s.kind = 'ship_request'))
          order by s.created_at desc limit $5`,
        [q, a.status && soStatus[a.status] ? a.status : null, !!a.late_only, sales ? ctx.user.id : null, limit],
      )),
    );
  }
  if (kind !== "so") {
    rows.push(
      ...(await query<Doc>(
        `select 'po' as kind, o.id, o.po_no as no, o.status, p.name as partner, o.due_date, o.urgent, false as ship_request,
                (o.status not in ('received','cancelled','rejected') and o.due_date < current_date) as late,
                ${itemsOf("purchase_order_lines", "po_id", "o.id")} as items, ${lastMemo("po", "o.id")} as last_memo
           from purchase_orders o join partners p on p.id = o.supplier_id
          where ($1::text is null or o.po_no ilike $1 or p.name ilike $1
                 or exists (select 1 from purchase_order_lines l join items i on i.id = l.item_id where l.po_id = o.id and i.name ilike $1))
            and ($2::text is null or o.status = $2)
            and (not $3 or (o.status not in ('received','cancelled','rejected') and o.due_date < current_date))
          order by o.created_at desc limit $4`,
        [q, a.status && poStatus[a.status] ? a.status : null, !!a.late_only, limit],
      )),
    );
  }
  return rows.map((r) => {
    const href = r.kind === "so" ? (sales ? "/shipments?f=all" : `/sales/${r.id}`) : `/purchase/${r.id}`;
    addSource(ctx, { title: r.no, href: sales ? "/shipments?f=all" : href });
    return {
      번호: r.no,
      종류: r.kind === "so" ? (r.ship_request ? "출하 지시" : "수주") : "발주",
      상태: (r.kind === "so" ? soStatus : poStatus)[r.status] ?? r.status,
      거래처: r.partner,
      납기: md(r.due_date),
      지연: r.late,
      긴급: r.urgent,
      품목: r.items,
      최근_메모: r.last_memo,
      링크: href,
    };
  });
}

async function getStock(ctx: Ctx, a: { item: string }) {
  const q = `%${(a.item ?? "").trim()}%`;
  const items = await query<{ id: number; name: string; code: string; unit: string }>(
    `select distinct i.id, i.name, i.code, i.unit from items i left join item_aliases a on a.item_id = i.id
      where i.name ilike $1 or i.code ilike $1 or a.alias ilike $1 order by i.name limit 5`,
    [q],
  );
  if (!items.length) return { 결과: `'${a.item}'에 맞는 품목이 없습니다.` };
  const stock = await stockFor(items.map((i) => i.id));
  const lots = await query<{ item_id: number; lot_no: string; expiry_date: Date | null; remaining_qty: string }>(
    `select item_id, lot_no, expiry_date, remaining_qty from lots
      where item_id = any($1) and remaining_qty > 0 and (expiry_date is null or expiry_date >= current_date)
      order by expiry_date nulls last`,
    [items.map((i) => i.id)],
  );
  addSource(ctx, { title: "로트·유통기한", href: "/lots" });
  return items.map((i) => {
    const s = stock.get(i.id)!;
    return {
      품목: `${i.name} (${i.code})`,
      현재고: `${fmt(s.on_hand)}${i.unit}`,
      확정_수주가_잡아둔_수량: `${fmt(s.reserved)}${i.unit}`,
      쓸_수_있는_재고: s.on_hand >= s.reserved ? `${fmt(s.on_hand - s.reserved)}${i.unit}` : `없음 (${fmt(s.reserved - s.on_hand)}${i.unit} 부족)`,
      입고_예정: `${fmt(s.incoming)}${i.unit}`,
      유통기한_빠른_로트: lots
        .filter((l) => l.item_id === i.id)
        .slice(0, 3)
        .map((l) => `${l.lot_no} ${fmt(l.remaining_qty)}${i.unit} (유통기한 ${l.expiry_date ? md(l.expiry_date) : "없음"})`),
    };
  });
}

async function expiringLots(ctx: Ctx, a: { days?: number }) {
  const days = Math.min(Math.max(a.days ?? 90, 1), 365);
  addSource(ctx, { title: "로트·유통기한", href: "/lots" });
  const rows = await query<{ name: string; unit: string; lot_no: string; expiry_date: Date; remaining_qty: string; d: number }>(
    `select i.name, i.unit, l.lot_no, l.expiry_date, l.remaining_qty, (l.expiry_date - current_date)::int as d
       from lots l join items i on i.id = l.item_id
      where l.remaining_qty > 0 and l.expiry_date between current_date and current_date + $1::int
      order by l.expiry_date limit 15`,
    [days],
  );
  return rows.map((r) => ({ 품목: r.name, 로트: r.lot_no, 잔량: `${fmt(r.remaining_qty)}${r.unit}`, 유통기한: md(r.expiry_date), 남은_일수: r.d }));
}

// 역할별 할 일·지연 숫자
async function overview(ctx: Ctx) {
  const role = ctx.user.role;
  if (role === "sales") {
    const r = await query<{ status: string; n: number; late: number }>(
      `select status, count(*)::int as n, count(*) filter (where due_date < current_date)::int as late
         from sales_orders where created_by = $1 and kind = 'ship_request' and status not in ('shipped','cancelled') group by status`,
      [ctx.user.id],
    );
    addSource(ctx, { title: "내 출하 현황", href: "/shipments" });
    return { 진행_중_출하_지시: r.map((x) => ({ 상태: soStatus[x.status], 건수: x.n, 지연: x.late })) };
  }
  const c = await query<Record<string, number>>(
    `select
       (select count(*)::int from order_inbox where status = 'new') as "접수함_새_주문",
       (select count(*)::int from purchase_orders where status = 'pending_approval') as "발주_승인_대기",
       (select count(*)::int from purchase_orders where status = 'pending_approval' and created_at < now() - interval '1 day') as "하루_넘은_승인_대기",
       (select count(*)::int from purchase_orders where status = 'approved') as "공장_확인_대기",
       (select count(*)::int from purchase_orders where status = 'confirmed') as "공급사_발송_대기",
       (select count(*)::int from purchase_orders where status in ('sent','partially_received')) as "입고_대기",
       (select count(*)::int from sales_orders where status = 'received') as "수주_확정_대기",
       (select count(*)::int from sales_orders where status in ('confirmed','preparing','partially_shipped')) as "출고_대기",
       (select count(*)::int from sales_orders where status not in ('shipped','cancelled') and due_date < current_date) as "지연_수주",
       (select count(*)::int from purchase_orders where status not in ('received','cancelled','rejected') and due_date < current_date) as "지연_발주",
       (select count(*)::int from lots where remaining_qty > 0 and expiry_date between current_date and current_date + 30) as "30일_내_유통기한_로트"`,
  );
  addSource(ctx, { title: role === "executive" ? "경영 현황" : "대시보드", href: role === "executive" ? "/exec" : "/" });
  // 지금 이 역할이 할 일
  const mine: Record<string, string[]> = {
    staff: ["접수함_새_주문", "수주_확정_대기", "공급사_발송_대기"],
    office_admin: ["발주_승인_대기", "하루_넘은_승인_대기", "수주_확정_대기"],
    factory_manager: ["공장_확인_대기", "입고_대기", "출고_대기"],
    executive: [],
  };
  return { 전체: c[0], 내_차례: mine[role] ?? [] };
}

// 경영 숫자: 이번 달(또는 최근 90일) 매출·매입, 지난 달 실적, 매출처·공급사 상위
async function businessSummary(ctx: Ctx, a: { period?: string }) {
  const since = a.period === "90" ? "now() - interval '90 days'" : "date_trunc('month', now())";
  const [cur] = await query<{ sales: string; purchase: string; orders: number }>(
    `select
       coalesce((select sum(l.qty * l.unit_price) from sales_orders s join sales_order_lines l on l.so_id = s.id
                  where s.status <> 'cancelled' and s.parent_so_id is null and s.created_at >= ${since}), 0) as sales,
       coalesce((select sum(l.qty * l.unit_price) from purchase_orders o join purchase_order_lines l on l.po_id = o.id
                  where o.status not in ('cancelled','rejected') and o.created_at >= ${since}), 0) as purchase,
       (select count(*)::int from sales_orders where status <> 'cancelled' and parent_so_id is null and created_at >= ${since}) as orders`,
  );
  const history = await query<{ ym: string; sales: string; purchase: string; orders: number; on_time_rate: string | null }>(
    "select * from monthly_results where ym < to_char(now(), 'YYYY-MM') order by ym desc limit 6",
  );
  const top = (sql: string) => query<{ name: string; amount: string }>(sql);
  const customers = await top(
    `select p.name, sum(l.qty * l.unit_price) as amount from sales_orders s join sales_order_lines l on l.so_id = s.id
       join partners p on p.id = s.customer_id
      where s.status <> 'cancelled' and s.parent_so_id is null and s.created_at >= ${since} group by p.name order by 2 desc limit 5`,
  );
  const suppliers = await top(
    `select p.name, sum(l.qty * l.unit_price) as amount from purchase_orders o join purchase_order_lines l on l.po_id = o.id
       join partners p on p.id = o.supplier_id
      where o.status not in ('cancelled','rejected') and o.created_at >= ${since} group by p.name order by 2 desc limit 5`,
  );
  addSource(ctx, { title: "경영 현황", href: a.period === "90" ? "/exec?p=90" : "/exec" });
  addSource(ctx, { title: "리포트", href: "/report" });
  return {
    기간: a.period === "90" ? "최근 90일" : "이번 달 (오늘까지)",
    매출: eok(Number(cur.sales)),
    매입: eok(Number(cur.purchase)),
    수주_건수: cur.orders,
    지난_달_실적: history.map((h) => ({ 월: h.ym, 매출: eok(Number(h.sales)), 매입: eok(Number(h.purchase)), 수주: h.orders, 납기_준수율: h.on_time_rate ? `${h.on_time_rate}%` : null })),
    매출처_상위: customers.map((c) => `${c.name} ${eok(Number(c.amount))}`),
    공급사_상위: suppliers.map((c) => `${c.name} ${eok(Number(c.amount))}`),
  };
}

const allTools = {
  search_manual: {
    description: "EDIS 사용 매뉴얼·권한표·업무 규칙에서 관련 내용을 찾습니다. 사용법, 누가 무엇을 할 수 있는지, 오류 대처를 물으면 먼저 씁니다.",
    input_schema: { type: "object" as const, properties: { query: { type: "string" } }, required: ["query"] },
    run: (ctx: Ctx, a: { query: string }) => searchManual(ctx, a.query),
  },
  find_documents: {
    description:
      "수주(so, 출하 지시 포함)와 발주(po) 문서를 찾습니다. 문서 번호, 거래처 이름, 품목 이름으로 검색하고 상태나 지연 건만 고를 수 있습니다. 영업 담당자는 자기 출하 지시만 나옵니다.",
    input_schema: {
      type: "object" as const,
      properties: {
        kind: { type: "string", enum: ["so", "po", "any"] },
        query: { type: "string", description: "문서 번호, 거래처 이름, 품목 이름 일부" },
        status: { type: "string", description: `수주: ${Object.keys(soStatus).join(", ")} / 발주: ${Object.keys(poStatus).join(", ")}` },
        late_only: { type: "boolean", description: "납기·입고 예정일이 지난 건만" },
        limit: { type: "integer" },
      },
    },
    run: findDocuments,
  },
  get_stock: {
    description: "품목 재고를 봅니다: 현재고, 확정 수주가 잡아둔 수량, 쓸 수 있는 재고, 입고 예정, 유통기한 빠른 로트. 품목 이름·코드·현장 별칭으로 찾습니다.",
    input_schema: { type: "object" as const, properties: { item: { type: "string" } }, required: ["item"] },
    run: getStock,
  },
  expiring_lots: {
    description: "유통기한이 가까운 로트 목록입니다.",
    input_schema: { type: "object" as const, properties: { days: { type: "integer", description: "며칠 안에 끝나는지 (기본 90)" } } },
    run: expiringLots,
  },
  get_overview: {
    description: "지금 단계별로 쌓인 건수와 지연 건수, 이 사용자 차례인 일을 봅니다. '오늘 할 일', '밀린 거 있어?' 같은 질문에 씁니다.",
    input_schema: { type: "object" as const, properties: {} },
    run: (ctx: Ctx) => overview(ctx),
  },
  business_summary: {
    description: "경영 숫자: 매출·매입 합계, 수주 건수, 지난 달 실적과 납기 준수율, 매출처·공급사 상위 5곳.",
    input_schema: { type: "object" as const, properties: { period: { type: "string", enum: ["month", "90"] } } },
    run: businessSummary,
  },
};
type ToolName = keyof typeof allTools;

// 역할별로 쓸 수 있는 도구. 경영진은 전부 봅니다.
function toolsFor(role: User["role"]): ToolName[] {
  if (role === "sales") return ["search_manual", "find_documents", "get_stock", "get_overview"];
  if (role === "executive" || role === "office_admin") return Object.keys(allTools) as ToolName[];
  return ["search_manual", "find_documents", "get_stock", "expiring_lots", "get_overview"];
}

async function runTool(ctx: Ctx, name: string, input: unknown) {
  if (!toolsFor(ctx.user.role).includes(name as ToolName)) return { 오류: "이 역할에서는 쓸 수 없는 조회입니다." };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (allTools[name as ToolName].run as any)(ctx, input ?? {});
}

// ── Claude ────────────────────────────────────────────

function systemPrompt(user: User) {
  const scope =
    user.role === "sales"
      ? "이 사용자는 영업 담당자라서 자기가 보낸 출하 지시만 볼 수 있습니다. 다른 사람의 주문이나 발주 내용은 알려주지 마세요."
      : user.role === "executive"
        ? "이 사용자는 경영진이라 모든 수주·발주·재고·경영 숫자를 볼 수 있습니다. 숫자는 짧게 요약하고 챙길 일을 먼저 말하세요."
        : "이 사용자는 모든 수주·발주·재고를 볼 수 있습니다.";
  return `당신은 휴럼(건강기능식품 제조사)의 수발주 시스템 EDIS 안에 있는 업무 도우미입니다.
지금 사용자: ${user.name} (${roleLabel[user.role]}). 오늘: ${new Date().toISOString().slice(0, 10)}.
${scope}
- 사용법·권한·규칙은 search_manual 결과에 근거해서만 답합니다. 매뉴얼에 없으면 모른다고 하고 수발주 담당자나 오피스 관리자에게 물어보라고 합니다.
- 업무 데이터는 반드시 도구로 조회한 결과만 씁니다. 숫자를 지어내지 않습니다.
- 이 챗봇은 조회만 합니다. 승인·확정·취소 같은 처리는 해당 화면에서 하라고 안내합니다.
- 한국어로 짧게, 결론 먼저. 목록은 3~6줄 이내. 문서 번호를 그대로 적습니다.`;
}

async function askClaude(user: User, history: ChatTurn[], ctx: Ctx): Promise<string> {
  const client = new Anthropic();
  const names = toolsFor(user.role);
  const tools = names.map((n) => ({ name: n, description: allTools[n].description, input_schema: allTools[n].input_schema }));
  const messages: Anthropic.MessageParam[] = history.slice(-10).map((t) => ({ role: t.role, content: t.content }));
  for (let i = 0; i < 6; i++) {
    const res = await client.messages.create({
      model: "claude-opus-5-5",
      max_tokens: 2000,
      system: systemPrompt(user),
      tools,
      messages,
    });
    if (res.stop_reason !== "tool_use") {
      return res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    }
    messages.push({ role: "assistant", content: res.content });
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const b of res.content) {
      if (b.type !== "tool_use") continue;
      try {
        results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(await runTool(ctx, b.name, b.input)) });
      } catch (e) {
        results.push({ type: "tool_result", tool_use_id: b.id, content: `조회 실패: ${(e as Error).message}`, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
  }
  return "조회가 길어져서 멈췄어요. 질문을 조금 좁혀서 다시 물어봐 주세요.";
}

// ── 규칙 기반 ─────────────────────────────────────────

function lines(rows: { 번호: string; 거래처: string; 상태: string; 납기: string; 지연: boolean; 품목: string | null }[]) {
  return rows.map((r) => `- ${r.번호} ${r.거래처}: ${r.상태}, 납기 ${r.납기}${r.지연 ? " (지연)" : ""}${r.품목 ? ` · ${r.품목}` : ""}`).join("\n");
}

async function askRules(user: User, q: string, ctx: Ctx): Promise<string> {
  const text = q.trim();
  const sales = user.role === "sales";

  const no = text.match(/(SO|PO)-[A-Z0-9-]+/i)?.[0];
  if (no) {
    const rows = await findDocuments(ctx, { query: no.toUpperCase(), limit: 3 });
    if (!rows.length) return sales ? `${no.toUpperCase()}는 내가 보낸 출하 지시에서 찾지 못했어요.` : `${no.toUpperCase()} 문서를 찾지 못했어요.`;
    const r = rows[0];
    return `${r.번호} (${r.종류}, ${r.거래처})는 지금 **${r.상태}** 단계예요. 납기 ${r.납기}${r.지연 ? ", 납기가 지났어요" : ""}.\n품목: ${r.품목 ?? "-"}${r.최근_메모 ? `\n최근 기록: ${r.최근_메모}` : ""}`;
  }

  if (/지연|늦|밀린|지난/.test(text)) {
    const rows = await findDocuments(ctx, { late_only: true, limit: 10 });
    if (!rows.length) return sales ? "늦어지는 출하 지시는 없어요." : "납기나 입고 예정일이 지난 건은 없어요.";
    return `지연된 건이 ${rows.length}건 있어요.\n${lines(rows)}`;
  }

  if (/유통기한|임박/.test(text) && !sales) {
    const rows = await expiringLots(ctx, { days: 90 });
    if (!rows.length) return "90일 안에 유통기한이 끝나는 로트는 없어요.";
    return `90일 안에 유통기한이 끝나는 로트 ${rows.length}개예요.\n${rows.map((r) => `- ${r.품목} ${r.로트} ${r.잔량}, ${r.유통기한} (D-${r.남은_일수})`).join("\n")}`;
  }

  if (/재고|몇\s*(kg|개|병)|남았/.test(text)) {
    const name = text.replace(/재고|얼마|있어|남았|몇|kg|개|병|\?|야|나|요|는|은|좀|알려줘|확인/g, " ").trim().split(/\s+/).filter(Boolean).join(" ");
    if (name) {
      const res = await getStock(ctx, { item: name });
      if (Array.isArray(res)) {
        return res
          .map((r) => `**${r.품목}**: 쓸 수 있는 재고 ${r.쓸_수_있는_재고} (현재고 ${r.현재고}, 확정 수주가 잡아둔 ${r.확정_수주가_잡아둔_수량}, 입고 예정 ${r.입고_예정})${r.유통기한_빠른_로트.length ? `\n  유통기한 빠른 로트: ${r.유통기한_빠른_로트.join(", ")}` : ""}`)
          .join("\n");
      }
    }
  }

  if ((/매출|매입|실적|경영/.test(text) && !/어떻게|읽|보는/.test(text)) && (user.role === "executive" || user.role === "office_admin")) {
    const s = await businessSummary(ctx, { period: /90|분기|석\s*달/.test(text) ? "90" : "month" });
    return `${s.기간} 매출 ${s.매출}, 매입 ${s.매입}, 수주 ${s.수주_건수}건이에요.${s.지난_달_실적[0] ? `\n지난 달(${s.지난_달_실적[0].월}) 매출 ${s.지난_달_실적[0].매출}, 매입 ${s.지난_달_실적[0].매입}.` : ""}${s.매출처_상위.length ? `\n매출처 상위: ${s.매출처_상위.slice(0, 3).join(", ")}` : ""}`;
  }

  if (/할\s*일|처리할|대기|쌓인|현황|내 출하/.test(text) && !/어떻게/.test(text)) {
    const o = await overview(ctx);
    if ("진행_중_출하_지시" in o) {
      const list = o.진행_중_출하_지시 ?? [];
      if (!list.length) return "진행 중인 출하 지시가 없어요.";
      return `진행 중인 출하 지시예요.\n${list.map((x) => `- ${x.상태} ${x.건수}건${x.지연 ? ` (지연 ${x.지연})` : ""}`).join("\n")}`;
    }
    const all = o.전체;
    const mine = o.내_차례.filter((k) => all[k] > 0);
    const late = all["지연_수주"] + all["지연_발주"];
    const label = (k: string) => k.replace(/_/g, " ");
    const head = mine.length ? `지금 내 차례인 일: ${mine.map((k) => `${label(k)} ${all[k]}건`).join(", ")}.` : "지금 내 차례로 쌓인 일은 없어요.";
    return `${head}${late ? `\n지연: 수주 ${all["지연_수주"]}건, 발주 ${all["지연_발주"]}건.` : ""}\n전체: ${Object.entries(all).filter(([, v]) => v > 0).map(([k, v]) => `${label(k)} ${v}`).join(" · ")}`;
  }

  const hits = searchKb(text, user.role, 2);
  if (hits.length) {
    addSource(ctx, { title: `매뉴얼: ${hits[0].title}`, href: chunkHref(hits[0]) });
    return `**${hits[0].title}**\n${hits[0].text}`;
  }
  addSource(ctx, { title: "사용 매뉴얼", href: "/manual" });
  return "매뉴얼에서 맞는 내용을 찾지 못했어요. 문서 번호(SO-…, PO-…), 품목 이름, '지연', '재고' 같은 말을 넣어 다시 물어보세요.";
}

export async function ask(user: User, history: ChatTurn[]): Promise<Reply> {
  const ctx: Ctx = { user, sources: new Map() };
  const last = history.filter((t) => t.role === "user").at(-1)?.content ?? "";
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const answer = await askClaude(user, history, ctx);
      return { answer, sources: [...ctx.sources.values()].slice(0, 4), engine: "claude" };
    } catch (e) {
      console.error("assistant: claude failed, using rules", e);
      ctx.sources.clear();
    }
  }
  const answer = await askRules(user, last, ctx);
  return { answer, sources: [...ctx.sources.values()].slice(0, 4), engine: "rules" };
}

export const suggestions: Record<User["role"], string[]> = {
  sales: ["내 출하 중 늦어지는 거 있어?", "SO-DEMO-005 어디까지 왔어?", "출하 지시는 어떻게 보내?"],
  staff: ["오늘 처리할 일 알려줘", "트루락 재고 얼마야?", "부족분 발주는 어떻게 해?"],
  office_admin: ["승인 대기 발주서 있어?", "지연된 건 알려줘", "반려하면 어떻게 돼?"],
  factory_manager: ["처리할 일 알려줘", "유통기한 임박 로트 있어?", "입고 확정이 안 돼"],
  executive: ["이번 달 매출 얼마야?", "지연된 건 알려줘", "유통기한 임박 로트 있어?"],
};

