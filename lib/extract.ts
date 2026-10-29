// 주문 원문(카톡·문자·메일)을 발주/수주 초안으로 정리합니다.
// ANTHROPIC_API_KEY 가 있으면 Claude가 정리하고, 없으면 간단한 규칙 기반으로 흉내만 냅니다.
import Anthropic from "@anthropic-ai/sdk";

export type Partner = { id: number; name: string; type: string };
export type Item = { id: number; code: string; name: string; unit: string; aliases?: string[] };

// 칸별 신뢰도: 확실 / 추정 / 확인 필요
export type Conf = "sure" | "guess" | "check";
export const confLabel: Record<Conf, string> = { sure: "확실", guess: "추정", check: "확인 필요" };

export type Draft = {
  engine: "claude" | "rules";
  direction: "purchase" | "sales" | "unknown";
  partner_id: number | null;
  partner_conf?: Conf;
  due_date: string | null;
  due_conf?: Conf;
  urgent?: boolean;
  urgent_reason?: string | null;
  lines: { item_id: number | null; item_text: string; qty: number | null; unit: string | null; unit_price: number | null; conf?: Conf }[];
  summary: string;
  needs_check: string[];
};

const confSchema = { type: "string", enum: ["sure", "guess", "check"] };

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["direction", "partner_id", "partner_conf", "due_date", "due_conf", "urgent", "urgent_reason", "lines", "summary", "needs_check"],
  properties: {
    direction: { type: "string", enum: ["purchase", "sales", "unknown"] },
    partner_id: { type: ["integer", "null"] },
    partner_conf: confSchema,
    due_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    due_conf: confSchema,
    urgent: { type: "boolean" },
    urgent_reason: { type: ["string", "null"] },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_id", "item_text", "qty", "unit", "unit_price", "conf"],
        properties: {
          item_id: { type: ["integer", "null"] },
          item_text: { type: "string" },
          qty: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          unit_price: { type: ["number", "null"] },
          conf: confSchema,
        },
      },
    },
    summary: { type: "string" },
    needs_check: { type: "array", items: { type: "string" } },
  },
};

export async function extractOrder(
  rawText: string,
  hint: { direction?: string; partnerId?: number | null; receivedAt: Date },
  partners: Partner[],
  items: Item[],
): Promise<Draft> {
  if (!process.env.ANTHROPIC_API_KEY) return extractByRules(rawText, hint, partners, items);

  const client = new Anthropic();
  const today = hint.receivedAt.toISOString().slice(0, 10);
  const system = `건강기능식품 원부재료 회사의 수발주 담당 보조입니다.
영업 담당자가 전달한 카톡·문자·메일 원문을 읽고 발주(우리가 원부재료를 사는 것) 또는 수주(고객이 우리에게 주문하는 것) 초안을 만듭니다.
- 거래처와 품목은 아래 목록의 id로만 고릅니다. 목록에 없거나 확실하지 않으면 null로 두고 needs_check에 이유를 적습니다.
- 날짜는 받은 날짜(${today}) 기준으로 YYYY-MM-DD로 바꿉니다. "다음주 수요일" 같은 표현도 계산합니다.
- 원문에 없는 수량·단가·납기를 지어내지 않습니다. 모르면 null.
- summary는 관리자가 한눈에 볼 한국어 한두 문장입니다.
- 거래처, 납기, 품목 줄마다 신뢰도를 붙입니다. 원문에 분명히 있으면 sure, 별칭이나 맥락으로 짐작했으면 guess, 못 찾았으면 check.
- "급하게", "긴급", "ASAP", "오늘·내일까지"처럼 서두르는 표현이 있거나 납기가 받은 날로부터 3일 이내면 urgent를 true로 하고 이유를 urgent_reason에 짧게 적습니다.

거래처 목록 (id, 이름, 구분):
${partners.map((p) => `${p.id}\t${p.name}\t${p.type}`).join("\n")}

품목 목록 (id, 코드, 이름, 단위, 현장에서 부르는 별칭):
${items.map((i) => `${i.id}\t${i.code}\t${i.name}\t${i.unit}\t${(i.aliases ?? []).join(", ")}`).join("\n")}`;

  const response = await client.beta.messages.create({
    model: "claude-opus-5-5",
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    system,
    messages: [
      {
        role: "user",
        content: `담당자가 고른 구분: ${hint.direction ?? "모름"}
담당자가 고른 거래처 id: ${hint.partnerId ?? "모름"}

원문:
${rawText}`,
      },
    ],
  });
  if (response.stop_reason === "refusal") throw new Error("AI가 이 원문을 처리하지 못했습니다.");
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new Error("AI 응답이 비어 있습니다.");
  const parsed = JSON.parse(text.text) as Omit<Draft, "engine">;
  // 목록에 없는 id가 오면 비웁니다.
  const partnerIds = new Set(partners.map((p) => p.id));
  const itemIds = new Set(items.map((i) => i.id));
  return {
    ...parsed,
    engine: "claude",
    partner_id: parsed.partner_id && partnerIds.has(parsed.partner_id) ? parsed.partner_id : null,
    lines: parsed.lines.map((l) => (l.item_id && itemIds.has(l.item_id) ? l : { ...l, item_id: null, conf: "check" as Conf })),
  };
}

const URGENT_WORDS = /(긴급|급히|급하게|급건|급합니다|ASAP|asap|빨리|서둘러|당일|오늘\s*중|오늘까지|내일까지)/;
const QTY = /([\d,]+(?:\.\d+)?)\s*(kg|KG|Kg|EA|ea|개|롤|박스|통|매|장|g|L)(?![A-Za-z])/;

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// 납기 찾기: "11/10", "11월 10일"은 확실, "오늘/내일/모레", "다음주 수요일"은 추정.
function findDue(text: string, base: Date): { due: string | null; conf: Conf } {
  const d = text.match(/(\d{1,2})\s*(?:\/|월)\s*(\d{1,2})/);
  if (d) {
    const m = Number(d[1]);
    const y = base.getFullYear() + (m < base.getMonth() + 1 - 6 ? 1 : 0);
    return { due: `${y}-${d[1].padStart(2, "0")}-${d[2].padStart(2, "0")}`, conf: "sure" };
  }
  const rel: Record<string, number> = { 오늘: 0, 내일: 1, 모레: 2 };
  for (const [w, n] of Object.entries(rel)) {
    if (text.includes(w)) return { due: ymd(new Date(base.getTime() + n * 86400000)), conf: "guess" };
  }
  const wk = text.match(/(이번\s*주|다음\s*주)\s*([월화수목금토일])요일/);
  if (wk) {
    const target = "일월화수목금토".indexOf(wk[2]);
    const monday = new Date(base.getTime() - ((base.getDay() + 6) % 7) * 86400000);
    const offset = (target + 6) % 7 + (wk[1].startsWith("다음") ? 7 : 0);
    return { due: ymd(new Date(monday.getTime() + offset * 86400000)), conf: "guess" };
  }
  return { due: null, conf: "check" };
}

// 키가 없을 때의 규칙: 거래처명, 품목 별칭 사전, 줄마다 "품목 수량단위", 납기·긴급 표현.
function extractByRules(
  rawText: string,
  hint: { direction?: string; partnerId?: number | null; receivedAt: Date },
  partners: Partner[],
  items: Item[],
): Draft {
  const needs: string[] = [];
  let partnerConf: Conf = "check";
  let partner = partners.find((p) => rawText.includes(p.name));
  if (partner) partnerConf = "sure";
  else {
    partner = partners.find((p) => p.name.length > 2 && rawText.includes(p.name.slice(0, 2)));
    if (partner) partnerConf = "guess";
  }
  const partnerId = hint.partnerId ?? partner?.id ?? null;
  if (hint.partnerId) partnerConf = "sure";
  if (!partnerId) needs.push("거래처를 원문에서 찾지 못했습니다.");
  else if (partnerConf === "guess") needs.push(`거래처를 '${partner?.name}'(으)로 추정했습니다.`);

  // 품목 사전: 정식 이름·코드·별칭은 확실, 이름 첫 단어만 맞으면 추정.
  const dict: { key: string; item: Item; conf: Conf }[] = [];
  for (const it of items) {
    dict.push({ key: it.name.replace(/\s*\(.*\)\s*/, ""), item: it, conf: "sure" });
    dict.push({ key: it.code, item: it, conf: "sure" });
    for (const a of it.aliases ?? []) dict.push({ key: a, item: it, conf: "sure" });
    dict.push({ key: it.name.split(/[ (]/)[0], item: it, conf: "guess" });
  }
  dict.sort((a, b) => b.key.length - a.key.length);
  const norm = (t: string) => t.replace(/\s+/g, "").toLowerCase();

  const lines: Draft["lines"] = [];
  const segments = rawText.split(/\n|,(?!\d{3})|;|·| 그리고 | 랑 /).map((t) => t.trim()).filter(Boolean);
  for (const seg of segments) {
    const q = seg.match(QTY);
    const hit = dict.find((d) => d.key.length >= 2 && norm(seg).includes(norm(d.key)));
    if (!hit && !q) continue;
    if (hit && lines.some((l) => l.item_id === hit.item.id)) continue;
    const qty = q ? Number(q[1].replaceAll(",", "")) : null;
    if (hit) {
      lines.push({
        item_id: hit.item.id,
        item_text: hit.key,
        qty,
        unit: q?.[2] ?? hit.item.unit,
        unit_price: null,
        conf: qty === null ? "check" : hit.conf,
      });
      if (qty === null) needs.push(`${hit.item.name} 수량을 찾지 못했습니다.`);
      else if (hit.conf === "guess") needs.push(`'${hit.key}'를 ${hit.item.name}(으)로 추정했습니다.`);
    } else if (q) {
      const text = seg.slice(0, seg.indexOf(q[0])).replace(/[^가-힣A-Za-z0-9 ]/g, "").trim().split(/\s+/).slice(-1).join(" ");
      if (!text) continue;
      lines.push({ item_id: null, item_text: text, qty, unit: q[2], unit_price: null, conf: "check" });
      needs.push(`'${text}'에 맞는 품목을 찾지 못했습니다. 품목을 고르면 다음부터 기억합니다.`);
    }
  }
  if (lines.length === 0) needs.push("품목을 원문에서 찾지 못했습니다.");

  const { due, conf: dueConf } = findDue(rawText, hint.receivedAt);
  if (!due) needs.push("납기일을 원문에서 찾지 못했습니다.");

  const word = rawText.match(URGENT_WORDS)?.[0];
  const daysLeft = due ? Math.round((new Date(due).getTime() - new Date(ymd(hint.receivedAt)).getTime()) / 86400000) : null;
  const urgent = Boolean(word) || (daysLeft !== null && daysLeft <= 3);
  const urgentReason = word ? `원문에 '${word}'` : urgent ? `납기까지 ${daysLeft}일` : null;

  const direction = hint.direction === "purchase" || hint.direction === "sales"
    ? hint.direction
    : partner?.type === "supplier" ? "purchase" : partner?.type === "customer" ? "sales" : "unknown";
  const pName = partners.find((p) => p.id === partnerId)?.name;

  return {
    engine: "rules",
    direction,
    partner_id: partnerId,
    partner_conf: partnerConf,
    due_date: due,
    due_conf: dueConf,
    urgent,
    urgent_reason: urgentReason,
    lines,
    summary: `${urgent ? "[긴급] " : ""}${pName ?? "거래처 미상"} · ${lines.map((l) => `${l.item_text} ${l.qty ?? "?"}${l.unit ?? ""}`).join(", ") || "품목 미상"}${due ? ` · 납기 ${due}` : ""}`,
    needs_check: needs,
  };
}
