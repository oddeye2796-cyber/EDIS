-- 화면 시연용 진행 중 데이터 (휴럼 시연용, 수량·날짜는 가상). seed.sql 다음에 한 번만 실행합니다.
insert into order_inbox (channel, direction, partner_id, raw_text, received_at, received_by, sales_note) values
  ('email', 'sales', (select id from partners where name = '현대홈쇼핑'),
   E'제목: 11월 방송분 물량 확정\n황후의 보이차 다이어트 3,000박스, 트루락 패밀리 1,200박스\n11/12까지 입고 부탁드립니다.', now() - interval '40 minutes', 4, null),
  ('kakao', 'sales', (select id from partners where name = '쿠팡'),
   '쿠팡 재입고 요청이요. 메가비타민C 2,000개, 아이편안 500개 다음주 월요일까지 들어가야 합니다', now() - interval '15 minutes', 4, '급한 건입니다'),
  ('sms', 'purchase', (select id from partners where name = '바이오컬처'),
   '[바이오컬처] 트루락 원말 다음 배치 생산 일정 잡혔습니다. 필요 수량 회신 부탁드립니다.', now() - interval '5 minutes', 3, null);

with po as (
  insert into purchase_orders (po_no, supplier_id, status, order_date, due_date, created_by, memo)
  values ('PO-DEMO-001', (select id from partners where name = '그린캡슐'), 'pending_approval', current_date, current_date + 5, 3, '아이편안 11월 생산분')
  returning id
)
insert into purchase_order_lines (po_id, item_id, qty, unit_price)
select po.id, i.id, 500000, 12 from po, items i where i.code = 'SM-001';

with po as (
  insert into purchase_orders (po_no, supplier_id, status, order_date, due_date, created_by, approved_by, approved_at)
  values ('PO-DEMO-002', (select id from partners where name = '한빛원료'), 'approved', current_date - 1, current_date + 2, 3, 1, now() - interval '3 hours')
  returning id
)
insert into purchase_order_lines (po_id, item_id, qty, unit_price)
select po.id, i.id, 200, 56000 from po, items i where i.code = 'RM-004';

with po as (
  insert into purchase_orders (po_no, supplier_id, status, order_date, due_date, created_by, approved_by, approved_at, confirmed_by, confirmed_at)
  values ('PO-DEMO-003', (select id from partners where name = '바이오컬처'), 'sent', current_date - 7, current_date - 1, 3, 1, now() - interval '6 days', 2, now() - interval '6 days')
  returning id
)
insert into purchase_order_lines (po_id, item_id, qty, unit_price)
select po.id, i.id, 20, 250000 from po, items i where i.code = 'RM-003';

with so as (
  insert into sales_orders (so_no, customer_id, status, order_date, due_date, created_by)
  values ('SO-DEMO-001', (select id from partners where name = 'GS홈쇼핑'), 'confirmed', current_date - 2, current_date + 3, 3)
  returning id
)
insert into sales_order_lines (so_id, item_id, qty, unit_price)
select so.id, i.id, 1000, 10500 from so, items i where i.code = 'FG-002';

with so as (
  insert into sales_orders (so_no, customer_id, status, order_date, due_date, created_by, kind, urgent, memo)
  values ('SO-DEMO-002', (select id from partners where name = '이마트'), 'received', current_date, current_date + 2, 4, 'ship_request', true, '행사 매대 추가분')
  returning id
)
insert into sales_order_lines (so_id, item_id, qty, unit_price)
select so.id, i.id, 800, 13000 from so, items i where i.code = 'FG-001';

-- 재고 로트 (원료·완제품)
insert into lots (item_id, lot_no, mfg_date, expiry_date, qty, coa_note)
select i.id, l.lot_no, current_date - l.age, current_date + l.left_days, l.qty, l.coa
from (values
  ('RM-001', 'VC-2609-02', 60, 640, 400, 'COA 수령, 적합'),
  ('RM-003', 'TL-2610-01', 20, 340, 6, 'COA 수령, 적합 (냉장 보관)'),
  ('RM-004', 'PE-2608-11', 80, 650, 120, 'COA 수령, 적합'),
  ('RM-009', 'RG-2510-07', 300, 45, 60, 'COA 수령, 적합'),
  ('SM-001', 'HC-2610-15', 10, 1000, 300000, '입고 검사 적합'),
  ('FG-001', 'FG1-2610-03', 25, 700, 600, '출하 검사 적합'),
  ('FG-002', 'FG2-2609-21', 40, 690, 1500, '출하 검사 적합'),
  ('FG-003', 'FG3-2610-08', 20, 710, 4000, '출하 검사 적합'),
  ('FG-004', 'FG4-2607-30', 90, 25, 300, '출하 검사 적합'),
  ('FG-004', 'FG4-2610-12', 15, 715, 500, '출하 검사 적합')
) as l(code, lot_no, age, left_days, qty, coa)
join items i on i.code = l.code;
update lots set remaining_qty = qty where remaining_qty is null;

insert into status_logs (doc_type, doc_id, from_status, to_status, actor_id, memo)
select 'po', id, null, status, 3, '데모 데이터' from purchase_orders where po_no like 'PO-DEMO-%';
insert into status_logs (doc_type, doc_id, from_status, to_status, actor_id, memo)
select 'so', id, null, status, created_by, case kind when 'ship_request' then '최영업님 출하 지시 (긴급)' else '데모 데이터' end
  from sales_orders where so_no like 'SO-DEMO-%';

-- 분기 공급 계약(원 수주)과 그 계약에서 나눠 보낸 출하 지시
with so as (
  insert into sales_orders (so_no, customer_id, status, order_date, due_date, created_by, memo)
  values ('SO-DEMO-003', (select id from partners where name = '코스트코'), 'confirmed', current_date - 20, current_date + 60, 3, '4분기 공급 계약 (분할 출하)')
  returning id
)
insert into sales_order_lines (so_id, item_id, qty, unit_price)
select so.id, i.id, 6000, 7600 from so, items i where i.code = 'FG-003';

with so as (
  insert into sales_orders (so_no, customer_id, status, order_date, due_date, created_by, kind, parent_so_id, memo)
  values ('SO-DEMO-004', (select id from partners where name = '코스트코'), 'received', current_date, current_date + 4, 4, 'ship_request',
          (select id from sales_orders where so_no = 'SO-DEMO-003'), '11월 1차분')
  returning id
)
insert into sales_order_lines (so_id, item_id, qty, unit_price)
select so.id, i.id, 1500, 7600 from so, items i where i.code = 'FG-003';
insert into status_logs (doc_type, doc_id, from_status, to_status, actor_id, memo)
select 'so', id, null, status, created_by, case when parent_so_id is null then '데모 데이터' else '최영업님 출하 지시 (SO-DEMO-003에서 분할)' end
  from sales_orders where so_no in ('SO-DEMO-003','SO-DEMO-004');

-- 납기가 지난 출하 지시 (영업 화면의 지연 알림 시연용)
with so as (
  insert into sales_orders (so_no, customer_id, status, order_date, due_date, created_by, kind, memo)
  values ('SO-DEMO-005', (select id from partners where name = '쿠팡'), 'confirmed', current_date - 6, current_date - 1, 4, 'ship_request', '로켓배송 재입고')
  returning id
)
insert into sales_order_lines (so_id, item_id, qty, unit_price)
select so.id, i.id, 400, 9800 from so, items i where i.code = 'FG-004';
insert into status_logs (doc_type, doc_id, from_status, to_status, actor_id, memo, at)
select 'so', id, null, 'received', 4, '최영업님 출하 지시', now() - interval '6 days' from sales_orders where so_no = 'SO-DEMO-005'
union all
select 'so', id, 'received', 'confirmed', 3, '재고 확인 후 수주 확정, 출고 준비를 요청합니다.', now() - interval '5 days' from sales_orders where so_no = 'SO-DEMO-005';
