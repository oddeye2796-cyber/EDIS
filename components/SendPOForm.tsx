"use client";
import { useState } from "react";

// 발송 방법을 고르면 받는 곳을 그 거래처 연락처로 바꿔 줍니다.
export default function SendPOForm({
  id,
  action,
  contacts,
}: {
  id: number;
  action: (formData: FormData) => Promise<void>;
  contacts: { email: string | null; sms: string | null; fax: string | null };
}) {
  const options = [
    ["email", "이메일"],
    ["sms", "문자"],
    ["fax", "팩스"],
  ] as const;
  const [via, setVia] = useState<"email" | "sms" | "fax">("email");
  const [to, setTo] = useState(contacts.email ?? "");
  return (
    <form action={action} style={{ width: "100%" }}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="action" value="send" />
      <label>공급사에 발주서 보내기</label>
      <div className="chips" style={{ marginBottom: 8 }}>
        {options.map(([k, label]) => (
          <label key={k} className="chip">
            <input
              type="radio"
              name="send_via"
              value={k}
              checked={via === k}
              onChange={() => {
                setVia(k);
                setTo(contacts[k] ?? "");
              }}
            />{" "}
            {label}
          </label>
        ))}
      </div>
      <div className="actions">
        <input name="send_to" value={to} onChange={(e) => setTo(e.target.value)} placeholder="받는 곳" style={{ maxWidth: 280 }} required />
        <button>발주서 발송</button>
      </div>
      <p className="muted" style={{ margin: "6px 0 0", fontSize: 12 }}>데모에서는 실제로 보내지 않고 발송 기록만 남깁니다.</p>
    </form>
  );
}
