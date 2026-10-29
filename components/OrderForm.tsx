import type { Draft } from "@/lib/extract";

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
  const lines = draft?.lines.filter((l) => l.item_id) ?? [];
  return (
    <form action={action}>
      {inboxId && (
        <div className="panel" style={{ background: "#fafafa" }}>
          <label>접수함 원문</label>
          <div className="raw">{inboxText}</div>
          {draft && (
            <div style={{ marginTop: 8 }}>
              <label>AI 정리 ({draft.engine === "claude" ? "Claude" : "규칙 기반"})</label>
              <div>{draft.summary}</div>
              {draft.needs_check.length > 0 && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 16, color: "var(--warn)" }}>
                  {draft.needs_check.map((n, i) => <li key={i}>{n}</li>)}
                </ul>
              )}
              <p className="muted" style={{ marginBottom: 0 }}>아래 칸은 AI 정리로 미리 채웠습니다. 확인하고 고친 뒤 확정하세요.</p>
            </div>
          )}
          <input type="hidden" name="inbox_id" value={inboxId} />
        </div>
      )}
      <div className="fields">
        <div><label>{partnerLabel}</label>
          <select name="partner_id" required defaultValue={draft?.partner_id ?? defaultPartnerId ?? ""}>
            <option value="" disabled>선택</option>
            {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div><label>납기일</label><input type="date" name="due_date" required defaultValue={draft?.due_date ?? ""} /></div>
        <div><label>메모</label><input name="memo" /></div>
      </div>
      <table style={{ marginBottom: 12 }}>
        <thead><tr><th>품목</th><th className="num">수량</th><th className="num">단가 (비우면 기본단가)</th></tr></thead>
        <tbody>
          {[0, 1, 2, 3, 4].map((i) => (
            <tr key={i}>
              <td>
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
  return ids
    .map((itemId, i) => ({ itemId, qty: qtys[i], price: prices[i] }))
    .filter((l) => l.itemId && l.qty > 0);
}
