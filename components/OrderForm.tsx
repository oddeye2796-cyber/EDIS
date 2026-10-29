import { confLabel, type Conf, type Draft } from "@/lib/extract";

function ConfBadge({ conf }: { conf?: Conf }) {
  if (!conf) return null;
  const cls = conf === "sure" ? "ok" : conf === "guess" ? "warn" : "bad";
  return <span className={`badge ${cls}`} style={{ marginLeft: 6 }}>{confLabel[conf]}</span>;
}

type Option = { id: number; name: string };
type Item = { id: number; code: string; name: string; unit: string; default_price: string };

// 데모에서는 자바스크립트 없이 동작하도록 품목 줄을 5개 고정으로 둡니다. 빈 줄은 무시됩니다.
export default function OrderForm({
  action,
  partnerLabel,
  partners,
  items,
  defaultPartnerId,
  inboxId,
  inboxText,
  submitLabel,
  draft,
}: {
  action: (formData: FormData) => Promise<void>;
  partnerLabel: string;
  partners: Option[];
  items: Item[];
  defaultPartnerId?: number | null;
  inboxId?: number;
  inboxText?: string;
  submitLabel: string;
  draft?: Draft | null;
}) {
  const lines = draft?.lines ?? [];
  const prefill = lines.length > 0 ? Math.max(5, lines.length) : 5;
  const showText = lines.some((l) => l.conf);
  return (
    <form action={action}>
      {inboxId && (
        <div className="panel" style={{ background: "#fafafa" }}>
          <label>접수함 원문</label>
          <div className="raw">{inboxText}</div>
          {draft && (
            <div style={{ marginTop: 8 }}>
              <label>AI 정리 ({draft.engine === "claude" ? "Claude" : "규칙 기반"})</label>
              {draft.urgent && <div><span className="badge bad">긴급</span> {draft.urgent_reason}</div>}
              <div>{draft.summary}</div>
              {draft.needs_check.length > 0 && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: "var(--warn)" }}>
                  {draft.needs_check.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
              <p className="muted" style={{ marginBottom: 0 }}>
                아래 칸은 AI 정리로 미리 채웠습니다. 확실·추정·확인 필요 표시를 보고 고친 뒤 확정하세요. 원문 표현에 품목을 고르면 다음부터 그 표현을 기억합니다.
              </p>
            </div>
          )}
          <input type="hidden" name="inbox_id" value={inboxId} />
        </div>
      )}
      <div className="fields">
        <div><label>{partnerLabel}{draft && <ConfBadge conf={draft.partner_conf} />}</label>
          <select name="partner_id" required defaultValue={draft?.partner_id ?? defaultPartnerId ?? ""}>
            <option value="" disabled>선택</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div><label>납기일{draft && <ConfBadge conf={draft.due_conf} />}</label><input type="date" name="due_date" required defaultValue={draft?.due_date ?? ""} /></div>
        <div><label>메모</label><input name="memo" /></div>
      </div>
      <table style={{ marginBottom: 12 }}>
        <thead><tr>{showText && <th>원문 표현</th>}<th>품목</th><th className="num">수량</th><th className="num">단가 (비우면 기본단가)</th></tr></thead>
        <tbody>
          {Array.from({ length: prefill }, (_, i) => i).map((i) => (
            <tr key={i}>
              {showText && (
                <td>
                  {lines[i] ? <>{lines[i].item_text}<ConfBadge conf={lines[i].conf} /></> : <span className="muted">-</span>}
                </td>
              )}
              <td>
                <input type="hidden" name="draft_text" value={lines[i]?.item_text ?? ""} />
                <select name="item_id" defaultValue={lines[i]?.item_id ?? ""}>
                  <option value="">-</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>{it.code} {it.name} ({it.unit})</option>
                  ))}
                </select>
              </td>
              <td><input name="qty" type="number" step="0.001" min="0" defaultValue={lines[i]?.qty ?? ""} /></td>
              <td><input name="unit_price" type="number" step="0.01" min="0" defaultValue={lines[i]?.unit_price ?? ""} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button>{submitLabel}</button>
    </form>
  );
}

export function readLines(formData: FormData) {
  const ids = formData.getAll("item_id").map(Number);
  const qtys = formData.getAll("qty").map(Number);
  const prices = formData.getAll("unit_price").map((v) => (v === "" ? null : Number(v)));
  const texts = formData.getAll("draft_text").map(String);
  return ids
    .map((itemId, i) => ({ itemId, qty: qtys[i], price: prices[i], draftText: texts[i]?.trim() || null }))
    .filter((l) => l.itemId && l.qty > 0);
}
