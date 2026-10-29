import type { PoolClient } from "pg";

export async function logStatus(
  c: PoolClient,
  docType: "po" | "so",
  docId: number,
  from: string | null,
  to: string,
  actorId: number,
  memo?: string,
) {
  await c.query(
    "insert into status_logs (doc_type, doc_id, from_status, to_status, actor_id, memo) values ($1,$2,$3,$4,$5,$6)",
    [docType, docId, from, to, actorId, memo ?? null],
  );
}

// 알림은 데모에서 앱 안에만 쌓입니다. 이메일 발송은 운영 전환 시 붙입니다.
export async function notify(c: PoolClient, role: string | null, message: string, link: string) {
  await c.query("insert into notifications (user_role, message, link) values ($1,$2,$3)", [
    role,
    message,
    link,
  ]);
}

export async function nextDocNo(c: PoolClient, prefix: "PO" | "SO") {
  const table = prefix === "PO" ? "purchase_orders" : "sales_orders";
  const col = prefix === "PO" ? "po_no" : "so_no";
  const ymd = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const { rows } = await c.query(
    `select count(*)::int as n from ${table} where ${col} like $1`,
    [`${prefix}-${ymd}-%`],
  );
  return `${prefix}-${ymd}-${String(rows[0].n + 1).padStart(3, "0")}`;
}
