// 주문 원문(카톡·문자·메일)을 발주/수주 초안으로 정리합니다.
// ANTHROPIC_API_KEY 가 있으면 Claude가 정리하고, 없으면 간단한 규칙 기반으로 흉내만 냅니다.
import Anthropic from "@anthropic-ai/sdk";

export type Partner = { id: number; name: string; type: string };
export type Item = { id: number; code: string; name: string; unit: string };

export type Draft = {
  engine: "claude" | "rules";
  direction: "purchase" | "sales" | "unknown";
  partner_id: number | null;
  due_date: string | null;
  lines: { item_id: number | null; item_text: string; qty: number | null; unit: string | null; unit_price: number | null }[];
  summary: string;
  needs_check: string[];
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["direction", "partner_id", "due_date", "lines", "summary", "needs_check"],
  properties: {
    direction: { type: "string", enum: ["purchase", "sales", "unknown"] },
    partner_id: { type: ["integer", "null"] },
    due_date: { type: ["string", "null"], description: "YYYY-MM-DD" },
    lines: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["item_id", "item_text", "qty", "unit", "unit_price"],
        properties: {
          item_id: { type: ["integer", "null"] },
          item_text: { type: "string" },
          qty: { type: ["number", "null"] },
          unit: { type: ["string", "null"] },
          unit_price: { type: ["number", "null"] },
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

거래처 목록 (id, 이름, 구분):
${partners.map((p) => `${p.id}\t${p.name}\t${p.type}`).join("\n")}

품목 목록 (id, 코드, 이름, 단위):
${items.map((i) => `${i.id}\t${i.code}\t${i.name}\t${i.unit}`).join("\n")}`;

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
    lines: parsed.lines.map((l) => ({ ...l, item_id: l.item_id && itemIds.has(l.item_id) ? l.item_id : null })),
  };
}

// 키가 없을 때의 단순 규칙: 이름 포함 여부, 품목명 뒤 숫자+단위, "M/D" 날짜.
function extractByRules(
  rawText: string,
  hint: { direction?: string; partnerId?: number | null; receivedAt: Date },
  partners: Partner[],
  items: Item[],
): Draft {
  const needs: string[] = [];
  const partner = partners.find((p) => rawText.includes(p.name));
  const partnerId = hint.partnerId ?? partner?.id ?? null;
  if (!partnerId) needs.push("거래처를 원문에서 찾지 못했습니다.");

  const lines: Draft["lines"] = [];
  for (const item of items) {
    const key = item.name.split(/[ (]/)[0];
    const idx = rawText.indexOf(key);
    if (idx < 0) continue;
    const after = rawText.slice(idx + key.length, idx + key.length + 40);
    const m = after.match(/([\d,]+(?:\.\d+)?)\s*(kg|g|EA|ea|개|롤|roll|박스)?/);
    const qty = m ? Number(m[1].replaceAll(",", "")) : null;
    if (qty === null) needs.push(`${item.name} 수량을 찾지 못했습니다.`);
    lines.push({ item_id: item.id, item_text: key, qty, unit: m?.[2] ?? item.unit, unit_price: null });
  }
  if (lines.length === 0) needs.push("품목을 원문에서 찾지 못했습니다.");

  let due: string | null = null;
  const d = rawText.match(/(\d{1,2})\s*[\/월]\s*(\d{1,2})/);
  if (d) {
    const y = hint.receivedAt.getFullYear();
    due = `${y}-${d[1].padStart(2, "0")}-${d[2].padStart(2, "0")}`;
  } else {
    needs.push("납기일을 원문에서 찾지 못했습니다.");
  }

  const direction = hint.direction === "purchase" || hint.direction === "sales"
    ? hint.direction
    : partner?.type === "supplier" ? "purchase" : partner?.type === "customer" ? "sales" : "unknown";

  return {
    engine: "rules",
    direction,
    partner_id: partnerId,
    due_date: due,
    lines,
    summary: `${partner?.name ?? "거래처 미상"} · ${lines.map((l) => `${l.item_text} ${l.qty ?? "?"}${l.unit ?? ""}`).join(", ") || "품목 미상"}${due ? ` · 납기 ${due}` : ""}`,
    needs_check: needs,
  };
}
