-- 화면 시연용 진행 중 데이터 (발주·수주·접수함). seed.sql 다음에 한 번만 실행합니다.
insert into order_inbox (channel, direction, partner_id, raw_text, received_at, received_by) values
  ('email', 'sales', (select id from partners where name = '바이오웰'),
   E'제목: 11월 2주차 발주\n프로바이오틱스 원말 15kg, 하드캡슐 0호 200,000EA 요청드립니다.\n납기는 11/12 희망합니다.', now() - interval '40 minutes', 3),
  ('kakao', 'sales', (select id from partners where name = '건강한생활'),
   '홍삼농축액 30kg 이번주 금요일까지 가능할까요?', now() - interval '15 minutes', 3),
  ('sms', 'purchase', (select id from partners where name = '대한포장'),
   '[대한포장] 단상자 인쇄 시안 확정되었습니다. 수량 알려주시면 생산 들어갑니다.', now() - interval '5 minutes', 3);

with po as (
  insert into purchase_orders (po_no, supplier_id, status, order_date, due_date, created_by, memo)
  values ('PO-DEMO-001', (select id from partners where name = '그린캡슐'), 'pending_approval', current_date, current_date + 5, 3, '11월 캡슐 생산분')
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
select po.id, i.id, 100, 42000 from po, items i where i.code = 'RM-004';

with po as (
  insert into purchase_orders (po_no, supplier_id, status, order_date, due_date, created_by, approved_by, approved_at, confirmed_by, confirmed_at)
  values ('PO-DEMO-003', (select id from partners where name = '한빛원료'), 'sent', current_date - 7, current_date - 1, 3, 1, now() - interval '6 days', 2, now() - interval '6 days')
  returning id
)
insert into purchase_order_lines (po_id, item_id, qty, unit_price)
select po.id, i.id, 20, 250000 from po, items i where i.code = 'RM-002';

with so as (
  insert into sales_orders (so_no, customer_id, status, order_date, due_date, created_by)
  values ('SO-DEMO-001', (select id from partners where name = '바이오웰'), 'confirmed', current_date - 2, current_date + 3, 3)
  returning id
)
insert into sales_order_lines (so_id, item_id, qty, unit_price)
select so.id, i.id, 40, 120000 from so, items i where i.code = 'RM-003';

insert into lots (item_id, lot_no, mfg_date, expiry_date, qty, coa_note)
select id, 'RG-2510-07', current_date - 300, current_date + 45, 60, 'COA 수령, 적합' from items where code = 'RM-003';
update lots set remaining_qty = qty where remaining_qty is null;

insert into status_logs (doc_type, doc_id, from_status, to_status, actor_id, memo)
select 'po', id, null, status, 3, '데모 데이터' from purchase_orders where po_no like 'PO-DEMO-%';
insert into status_logs (doc_type, doc_id, from_status, to_status, actor_id, memo)
select 'so', id, null, status, 3, '데모 데이터' from sales_orders where so_no like 'SO-DEMO-%';
