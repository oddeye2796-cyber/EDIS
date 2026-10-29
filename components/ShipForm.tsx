"use client";
import { useState } from "react";
import { useFormStatus } from "react-dom";

// 출하 지시 입력: 거래처마다 칸을 나누고, 품목 줄은 +/− 버튼으로 늘리고 줄입니다.
// 한 번 보내면 거래처마다 출하 지시가 하나씩 등록됩니다.
type Option = { id: number; name: string; unit?: string };
type Line = { key: number; itemId: string; qty: string };
type Block = { key: number; customerId: string; dueDate: string; memo: string; urgent: boolean; lines: Line[] };

let seq = 0;
const newLine = (itemId = "", qty = ""): Line => ({ key: ++seq, itemId, qty });
const newBlock = (dueDate = ""): Block => ({ key: ++seq, customerId: "", dueDate, memo: "", urgent: false, lines: [newLine()] });

export default function ShipForm({
  action,
  customers,
  items,
  initial,
}: {
  action: (fd: FormData) => Promise<void>;
  customers: Option[];
  items: Option[];
  initial?: { customerId: number; memo: string | null; lines: { itemId: number; qty: number }[] };
}) {
  const [blocks, setBlocks] = useState<Block[]>(() => [
    initial
      ? {
          ...newBlock(),
          customerId: String(initial.customerId),
          memo: initial.memo ?? "",
          lines: initial.lines.length ? initial.lines.map((l) => newLine(String(l.itemId), String(l.qty))) : [newLine()],
        }
      : newBlock(),
  ]);

  const update = (key: number, patch: Partial<Block>) => setBlocks((bs) => bs.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const updateLine = (b: Block, lineKey: number, patch: Partial<Line>) =>
    update(b.key, { lines: b.lines.map((l) => (l.key === lineKey ? { ...l, ...patch } : l)) });

  return (
    <form action={action} className="panel">
      <label style={{ fontWeight: 600 }}>새 주문으로 출하 지시</label>
      {blocks.map((b, bi) => (
        <fieldset key={b.key} className="ship-block">
          <input type="hidden" name="block" value={bi} />
          <div className="ship-block-head">
            <b>거래처 {blocks.length > 1 ? bi + 1 : ""}</b>
            {blocks.length > 1 && (
              <button type="button" className="link-btn" onClick={() => setBlocks((bs) => bs.filter((x) => x.key !== b.key))}>
                이 거래처 빼기
              </button>
            )}
          </div>
          <select name={`c${bi}_customer_id`} required value={b.customerId} onChange={(e) => update(b.key, { customerId: e.target.value })}>
            <option value="" disabled>납품할 거래처 선택</option>
            {customers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>

          <label style={{ marginTop: 12 }}>품목과 수량</label>
          {b.lines.map((l) => (
            <div key={l.key} className="ship-line with-btn">
              <select name={`c${bi}_item_id`} required value={l.itemId} onChange={(e) => updateLine(b, l.key, { itemId: e.target.value })}>
                <option value="" disabled>품목 선택</option>
                {items.map((it) => <option key={it.id} value={it.id}>{it.name} ({it.unit})</option>)}
              </select>
              <input
                name={`c${bi}_qty`}
                type="number"
                step="0.001"
                min="0.001"
                required
                inputMode="decimal"
                placeholder="수량"
                value={l.qty}
                onChange={(e) => updateLine(b, l.key, { qty: e.target.value })}
              />
              <button
                type="button"
                className="round-btn"
                aria-label="품목 줄 빼기"
                disabled={b.lines.length === 1}
                onClick={() => update(b.key, { lines: b.lines.filter((x) => x.key !== l.key) })}
              >
                −
              </button>
            </div>
          ))}
          <button type="button" className="add-btn" onClick={() => update(b.key, { lines: [...b.lines, newLine()] })}>
            + 품목 추가
          </button>

          <div className="fields" style={{ marginTop: 12 }}>
            <div>
              <label>납품일</label>
              <input type="date" name={`c${bi}_due_date`} required value={b.dueDate} onChange={(e) => update(b.key, { dueDate: e.target.value })} />
            </div>
            <div>
              <label>메모</label>
              <input name={`c${bi}_memo`} value={b.memo} placeholder="예) 오전 중 도착" onChange={(e) => update(b.key, { memo: e.target.value })} />
            </div>
          </div>
          <label className="chip" style={{ marginTop: 8 }}>
            <input type="checkbox" name={`c${bi}_urgent`} checked={b.urgent} onChange={(e) => update(b.key, { urgent: e.target.checked })} /> 긴급
          </label>
        </fieldset>
      ))}

      <button
        type="button"
        className="secondary block"
        style={{ marginTop: 12 }}
        onClick={() => setBlocks((bs) => [...bs, newBlock(bs[bs.length - 1]?.dueDate ?? "")])}
      >
        + 다른 거래처도 함께 보내기
      </button>
      <Submit count={blocks.length} />
      {blocks.length > 1 && <p className="muted" style={{ fontSize: 12, marginBottom: 0 }}>거래처마다 출하 지시가 하나씩 등록됩니다.</p>}
    </form>
  );
}

function Submit({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button className="block" style={{ marginTop: 12 }} disabled={pending}>
      {pending ? "보내는 중…" : count > 1 ? `거래처 ${count}곳에 출하 지시 보내기` : "출하 지시 보내기"}
    </button>
  );
}
