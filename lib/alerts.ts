import { tx } from "./db";

// 납기 지연·오래 묵은 승인 대기를 찾아 담당자들에게 한 번씩 알립니다.
// 화면을 열 때마다 확인하므로 따로 예약 작업이 필요 없습니다. 이미 알린 문서는 표시해 두고 다시 보내지 않습니다.
export async function flagLate() {
  await tx(async (c) => {
    // 수주·출하 지시 납기 지연: 사무실, 공장, 그리고 출하 지시를 올린 영업 담당자
    const { rows: so } = await c.query(
      `update sales_orders s set late_notified = true
         from partners p, users u
        where p.id = s.customer_id and u.id = s.created_by
          and s.status not in ('shipped','cancelled') and s.due_date < current_date and not s.late_notified
        returning s.id, s.so_no, p.name as customer, to_char(s.due_date, 'MM/DD') as due, u.role, s.created_by`,
    );
    for (const r of so) {
      const msg = `[지연] ${r.customer} ${r.so_no}: 납기(${r.due})가 지났는데 아직 출고 전입니다.`;
      await c.query(
        `insert into notifications (user_role, message, link) select unnest($1::text[]), $2, $3`,
        [["office_admin", "staff", "factory_manager"], msg, `/sales/${r.id}`],
      );
      if (r.role === "sales") {
        await c.query("insert into notifications (user_id, message, link) values ($1,$2,'/shipments')", [
          r.created_by,
          `출하 지시 ${r.so_no}: 납기(${r.due})가 지났는데 아직 출고 전이에요.`,
        ]);
      }
    }
    // 발주 입고 지연: 사무실과 공장
    const { rows: po } = await c.query(
      `update purchase_orders o set late_notified = true from partners p
        where p.id = o.supplier_id and o.status in ('approved','confirmed','sent','partially_received')
          and o.due_date < current_date and not o.late_notified
        returning o.id, o.po_no, p.name as supplier, to_char(o.due_date, 'MM/DD') as due`,
    );
    for (const r of po) {
      await c.query(`insert into notifications (user_role, message, link) select unnest($1::text[]), $2, $3`, [
        ["office_admin", "staff", "factory_manager"],
        `[지연] ${r.supplier} ${r.po_no}: 입고 예정일(${r.due})이 지났습니다.`,
        `/purchase/${r.id}`,
      ]);
    }
    // 하루 넘게 승인을 기다리는 발주서: 오피스 관리자
    const { rows: stale } = await c.query(
      `update purchase_orders set stale_notified = true
        where status = 'pending_approval' and not stale_notified
          and coalesce((select max(at) from status_logs where doc_type = 'po' and doc_id = purchase_orders.id), created_at) < now() - interval '1 day'
        returning id, po_no`,
    );
    for (const r of stale) {
      await c.query("insert into notifications (user_role, message, link) values ('office_admin', $1, $2)", [
        `[승인 대기] 발주서 ${r.po_no}가 하루 넘게 승인을 기다리고 있습니다.`,
        `/purchase/${r.id}`,
      ]);
    }
  });
}

// 알림 중 이 사람이 볼 수 있는 것: 본인 앞 개인 알림, 역할 알림, 전체 알림
export const visibleNotice = "(user_id = $2 or (user_id is null and (user_role is null or user_role = $1)))";

// 알림 종류: 지연·반려처럼 바로 챙길 것은 빨강, 완료는 초록
export function noticeTone(message: string) {
  if (/\[지연\]|지났|반려|취소|늦어질|부족|\[승인 대기\]/.test(message)) return "bad";
  if (/완료|끝났/.test(message)) return "ok";
  return "";
}
