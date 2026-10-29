-- 데모용 샘플 데이터
insert into users (name, email, role) values
  ('김오피스', 'office@edis.demo', 'office_admin'),
  ('박공장', 'factory@edis.demo', 'factory_manager'),
  ('이담당', 'staff@edis.demo', 'staff'),
  ('최영업', 'sales@edis.demo', 'sales')
on conflict (email) do nothing;

insert into partners (type, name, biz_no, contact_name, phone, email, payment_terms, ecount_code) values
  ('supplier', '한빛원료', '123-45-67890', '최한빛', '010-1111-2222', 'order@hanbit.demo', '월말 마감 익월 말 지급', 'S001'),
  ('supplier', '그린캡슐', '234-56-78901', '정그린', '010-3333-4444', 'sales@greencap.demo', '선결제', 'S002'),
  ('supplier', '대한포장', '345-67-89012', '윤대한', '010-5555-6666', 'pack@daehan.demo', '월말 마감 익월 15일 지급', 'S003'),
  ('customer', '건강한생활', '456-78-90123', '한건강', '010-7777-8888', 'buy@healthy.demo', '월말 마감 익월 말 입금', 'C001'),
  ('customer', '바이오웰', '567-89-01234', '오바이오', '010-9999-0000', 'po@biowell.demo', '30일', 'C002');

insert into items (code, name, category, spec, unit, storage_condition, default_price, ecount_code) values
  ('RM-001', '비타민C (아스코르빈산)', 'raw', '분말 99%', 'kg', '실온, 차광', 18000, 'I001'),
  ('RM-002', '프로바이오틱스 원말', 'raw', '100억 CFU/g', 'kg', '냉장 2~8℃', 250000, 'I002'),
  ('RM-003', '홍삼농축액', 'raw', '진세노사이드 7mg/g', 'kg', '실온', 95000, 'I003'),
  ('RM-004', '오메가3 정제어유', 'raw', 'EPA+DHA 70%', 'kg', '냉장, 질소충전', 42000, 'I004'),
  ('SM-001', '하드캡슐 0호', 'sub', '젤라틴, 백색', 'EA', '실온, 습도 50% 이하', 12, 'I101'),
  ('SM-002', 'PTP 알루미늄 호일', 'sub', '폭 120mm', 'roll', '실온', 38000, 'I102'),
  ('SM-003', '단상자 (30일분)', 'sub', '인쇄 4도', 'EA', '실온', 220, 'I103')
on conflict (code) do nothing;

update items set default_supplier_id = (select id from partners where name = '한빛원료') where code like 'RM-%';
update items set default_supplier_id = (select id from partners where name = '그린캡슐') where code = 'SM-001';
update items set default_supplier_id = (select id from partners where name = '대한포장') where code in ('SM-002','SM-003');

insert into item_aliases (item_id, alias) select id, a from items, unnest(array[
  case code when 'RM-001' then '아스코르빈산' end, case code when 'RM-001' then '비타민씨' end, case code when 'RM-001' then '비타민C' end,
  case code when 'RM-002' then '유산균' end, case code when 'RM-002' then '프로바이오틱스' end,
  case code when 'RM-003' then '홍삼' end, case code when 'RM-003' then '홍삼농축액' end,
  case code when 'RM-004' then '오메가3' end, case code when 'RM-004' then '정제어유' end, case code when 'RM-004' then '어유' end,
  case code when 'SM-001' then '하드캡슐' end, case code when 'SM-001' then '공캡슐' end,
  case code when 'SM-002' then 'PTP호일' end, case code when 'SM-002' then '알루미늄호일' end,
  case code when 'SM-003' then '단상자' end
]) as a where a is not null
on conflict (alias) do nothing;
update partners set fax = '02-111-2222' where name = '한빛원료' and fax is null;
update partners set fax = '031-333-4444' where name = '대한포장' and fax is null;
