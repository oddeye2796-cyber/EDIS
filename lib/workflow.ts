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

// 출하 지시를 올린 영업 담당자에게만 가는 개인 알림. 사무실 사람이 만든 수주에는 보내지 않습니다.
export async function notifyRequester(c: PoolClient, soId: number, message: string) {
  await c.query(
    `insert into notifications (user_id, message, link)
     select so.created_by, $2, '/shipments' from sales_orders so join users u on u.id = so.created_by
      where so.id = $1 and u.role = 'sales'`,
    [soId, message],
  );
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
