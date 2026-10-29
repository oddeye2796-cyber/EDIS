import { query } from "./db";

// 영업 담당자의 출하 지시 중 납기가 지났는데 출고가 안 끝난 건을 찾아 한 번씩 알립니다.
// 화면을 열 때마다 확인하므로 따로 예약 작업이 필요 없습니다.
export async function flagLateShips(userId: number) {
  await query(
    `with late as (
       update sales_orders set late_notified = true
        where created_by = $1 and kind = 'ship_request' and status not in ('shipped','cancelled')
          and due_date < current_date and not late_notified
        returning so_no, due_date)
     insert into notifications (user_id, message, link)
     select $1, '출하 지시 ' || so_no || ': 납기(' || to_char(due_date, 'MM/DD') || ')가 지났는데 아직 출고 전이에요.', '/shipments'
       from late`,
    [userId],
  );
}

// 알림 중 이 사람이 볼 수 있는 것: 본인 앞 개인 알림, 역할 알림, 전체 알림
export const visibleNotice = "(user_id = $2 or (user_id is null and (user_role is null or user_role = $1)))";
