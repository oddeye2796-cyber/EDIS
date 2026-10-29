-- 데모용 기본 데이터 (휴럼 시연용)
-- 품목과 판매 채널은 휴럼 공식 쇼핑몰(hurumshop.com), 회사 소개(hurumcorp.com), 공개 기사를 참고했습니다.
-- 공급사, 담당자, 연락처, 단가, 수량은 모두 가상입니다.
insert into users (name, email, role) values
  ('김오피스', 'office@edis.demo', 'office_admin'),
  ('박공장', 'factory@edis.demo', 'factory_manager'),
  ('이담당', 'staff@edis.demo', 'staff'),
  ('최영업', 'sales@edis.demo', 'sales'),
  ('정대표', 'ceo@edis.demo', 'executive')
on conflict (email) do nothing;

-- 공급사(가상)와 판매 채널(공개 기사에 나온 유통 채널)
insert into partners (type, name, contact_name, phone, fax, email, payment_terms, ecount_code) values
  ('supplier', '한빛원료', '최한빛', '010-1111-2222', '02-111-2222', 'order@hanbit.demo', '월말 마감 익월 말 지급', 'S001'),
  ('supplier', '바이오컬처', '정배양', '010-2222-3333', '043-222-3333', 'sales@bioculture.demo', '월말 마감 익월 말 지급', 'S002'),
  ('supplier', '제주해조원료', '고해조', '010-3333-4444', '064-333-4444', 'order@jejusea.demo', '선결제', 'S003'),
  ('supplier', '그린캡슐', '정그린', '010-4444-5555', null, 'sales@greencap.demo', '선결제', 'S004'),
  ('supplier', '대한포장', '윤대한', '010-5555-6666', '031-555-6666', 'pack@daehan.demo', '월말 마감 익월 15일 지급', 'S005'),
  ('customer', '현대홈쇼핑', '한방송', '010-6666-7777', null, 'md-hurum@hmall.demo', '방송 후 30일', 'C001'),
  ('customer', 'GS홈쇼핑', '오편성', '010-7777-8888', null, 'md-hurum@gsshop.demo', '방송 후 30일', 'C002'),
  ('customer', '쿠팡', '서로켓', '010-8888-9999', null, 'vendor-hurum@coupang.demo', '입고 후 60일', 'C003'),
  ('customer', '이마트', '이바이어', '010-9999-0000', null, 'buyer-hurum@emart.demo', '월말 마감 익월 말 입금', 'C004'),
  ('customer', '코스트코', '구매담', '010-1212-3434', null, 'buyer-hurum@costco.demo', '30일', 'C005'),
  ('customer', '다이소', '다구매', '010-5656-7878', null, 'md-hurum@daiso.demo', '월말 마감 익월 말 입금', 'C006');

insert into items (code, name, category, spec, unit, storage_condition, default_price, ecount_code) values
  ('RM-001', '비타민C (아스코르빈산)', 'raw', '영국산 분말 99%', 'kg', '실온, 차광', 18000, 'I001'),
  ('RM-002', '비타민D3', 'raw', '100,000IU/g 분말', 'kg', '실온, 차광', 160000, 'I002'),
  ('RM-003', '프로바이오틱스 원말', 'raw', '트루락 배합용 1,000억 CFU/g', 'kg', '냉장 2~8℃', 250000, 'I003'),
  ('RM-004', '보이차추출물', 'raw', '갈산 함량 규격품', 'kg', '실온', 56000, 'I004'),
  ('RM-005', '마리골드꽃추출물', 'raw', '루테인·지아잔틴 20%', 'kg', '냉장, 차광', 320000, 'I005'),
  ('RM-006', '보스웰리아추출물', 'raw', '보스웰릭산 65%', 'kg', '실온', 88000, 'I006'),
  ('RM-007', '감태추출물', 'raw', '제주산', 'kg', '실온, 차광', 210000, 'I007'),
  ('RM-008', '밀크씨슬추출물', 'raw', '실리마린 80%', 'kg', '실온', 64000, 'I008'),
  ('RM-009', '홍삼농축액', 'raw', '6년근, 고형분 64%', 'kg', '실온', 95000, 'I009'),
  ('SM-001', '하드캡슐 0호', 'sub', '식물성, 백색', 'EA', '실온, 습도 50% 이하', 12, 'I101'),
  ('SM-002', 'PTP 알루미늄 호일', 'sub', '폭 120mm', 'roll', '실온', 38000, 'I102'),
  ('SM-003', '분말스틱 포장필름', 'sub', '폭 70mm, 4도 인쇄', 'roll', '실온', 52000, 'I103'),
  ('SM-004', '단상자 (트루락 패밀리)', 'sub', '인쇄 4도', 'EA', '실온', 220, 'I104'),
  ('FG-001', '트루락 패밀리 1BOX', 'product', '30포', 'EA', '실온', 13000, 'P001'),
  ('FG-002', '황후의 보이차 다이어트 1개월분', 'product', '30포', 'EA', '실온', 10500, 'P002'),
  ('FG-003', '메가 비타민C 1000 플러스 D', 'product', '30포', 'EA', '실온', 8000, 'P003'),
  ('FG-004', '아이편안 루테인지아잔틴', 'product', '500mg x 30캡슐', 'EA', '실온', 5500, 'P004'),
  ('FG-005', '6년근 고려홍삼정스틱골드', 'product', '10ml x 30포', 'EA', '실온', 25000, 'P005'),
  ('FG-006', '리얼슬립 1개월분', 'product', '30정', 'EA', '실온', 12000, 'P006')
on conflict (code) do nothing;

update items set default_supplier_id = (select id from partners where name = '한빛원료') where code in ('RM-001','RM-002','RM-004','RM-005','RM-006','RM-008','RM-009');
update items set default_supplier_id = (select id from partners where name = '바이오컬처') where code = 'RM-003';
update items set default_supplier_id = (select id from partners where name = '제주해조원료') where code = 'RM-007';
update items set default_supplier_id = (select id from partners where name = '그린캡슐') where code = 'SM-001';
update items set default_supplier_id = (select id from partners where name = '대한포장') where code in ('SM-002','SM-003','SM-004');

-- 현장에서 부르는 이름 → 품목
insert into item_aliases (item_id, alias)
select i.id, a.alias from (values
  ('RM-001','아스코르빈산'), ('RM-001','비타민씨'), ('RM-001','비타민C'),
  ('RM-002','비타민D'), ('RM-002','D3'),
  ('RM-003','유산균 원말'), ('RM-003','트루락 원말'), ('RM-003','유산균'),
  ('RM-004','보이차'),
  ('RM-005','루테인'), ('RM-005','지아잔틴'),
  ('RM-006','보스웰리아'),
  ('RM-007','감태'),
  ('RM-008','밀크씨슬'), ('RM-008','실리마린'),
  ('RM-009','홍삼'), ('RM-009','홍삼농축액'),
  ('SM-001','하드캡슐'), ('SM-001','공캡슐'),
  ('SM-002','PTP호일'), ('SM-002','알루미늄호일'),
  ('SM-003','스틱필름'), ('SM-003','포장필름'),
  ('SM-004','단상자'),
  ('FG-001','트루락 패밀리'), ('FG-001','트루락'),
  ('FG-002','황후의 보이차'), ('FG-002','보이차 다이어트'),
  ('FG-003','메가비타민C'), ('FG-003','메가 비타민C'),
  ('FG-004','아이편안'),
  ('FG-005','홍삼정스틱'), ('FG-005','홍삼스틱'),
  ('FG-006','리얼슬립')
) as a(code, alias) join items i on i.code = a.code
on conflict (alias) do nothing;

-- 지난 5개월 실적 (가상, 이카운트 집계 자리)
insert into monthly_results (ym, sales, purchase, orders, on_time_rate) values
  ('2026-05', 128400000, 31200000, 6, 91.7),
  ('2026-06', 135900000, 34800000, 7, 93.2),
  ('2026-07', 121300000, 29500000, 6, 88.9),
  ('2026-08', 142600000, 36900000, 8, 95.1),
  ('2026-09', 151800000, 38300000, 8, 94.3)
on conflict (ym) do nothing;
