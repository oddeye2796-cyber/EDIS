-- EDIS 수발주 데모 스키마

create table if not exists users (
  id serial primary key,
  name text not null,
  email text unique not null,
  role text not null check (role in ('office_admin','factory_manager','staff','sales'))
);

create table if not exists partners (
  id serial primary key,
  type text not null check (type in ('supplier','customer','both')),
  name text not null,
  biz_no text,
  contact_name text,
  phone text,
  email text,
  payment_terms text,
  ecount_code text,
  created_at timestamptz not null default now()
);

create table if not exists items (
  id serial primary key,
  code text unique not null,
  name text not null,
  category text not null check (category in ('raw','sub')),
  spec text,
  unit text not null default 'kg',
  storage_condition text,
  default_price numeric(14,2) not null default 0,
  ecount_code text
);

create table if not exists order_inbox (
  id serial primary key,
  channel text not null check (channel in ('email','kakao','sms','phone')),
  direction text not null check (direction in ('purchase','sales')),
  partner_id int references partners(id),
  raw_text text not null,
  received_at timestamptz not null default now(),
  received_by int references users(id),
  status text not null default 'new' check (status in ('new','converted','ignored')),
  linked_doc_type text,
  linked_doc_id int
);

create table if not exists purchase_orders (
  id serial primary key,
  po_no text unique not null,
  supplier_id int not null references partners(id),
  status text not null default 'draft' check (status in
    ('draft','pending_approval','approved','confirmed','sent','partially_received','received','rejected','cancelled')),
  order_date date not null default current_date,
  due_date date,
  memo text,
  created_by int references users(id),
  approved_by int references users(id),
  approved_at timestamptz,
  confirmed_by int references users(id),
  confirmed_at timestamptz,
  ecount_slip_no text,
  inbox_id int references order_inbox(id),
  created_at timestamptz not null default now()
);

create table if not exists purchase_order_lines (
  id serial primary key,
  po_id int not null references purchase_orders(id) on delete cascade,
  item_id int not null references items(id),
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null default 0,
  received_qty numeric(14,3) not null default 0
);

create table if not exists sales_orders (
  id serial primary key,
  so_no text unique not null,
  customer_id int not null references partners(id),
  status text not null default 'received' check (status in
    ('received','confirmed','preparing','partially_shipped','shipped','cancelled')),
  order_date date not null default current_date,
  due_date date,
  memo text,
  created_by int references users(id),
  ecount_slip_no text,
  inbox_id int references order_inbox(id),
  created_at timestamptz not null default now()
);

create table if not exists sales_order_lines (
  id serial primary key,
  so_id int not null references sales_orders(id) on delete cascade,
  item_id int not null references items(id),
  qty numeric(14,3) not null check (qty > 0),
  unit_price numeric(14,2) not null default 0,
  shipped_qty numeric(14,3) not null default 0
);

create table if not exists lots (
  id serial primary key,
  item_id int not null references items(id),
  lot_no text not null,
  mfg_date date,
  expiry_date date,
  qty numeric(14,3) not null,
  coa_note text,
  po_line_id int references purchase_order_lines(id),
  received_at timestamptz not null default now(),
  unique (item_id, lot_no)
);

create table if not exists status_logs (
  id serial primary key,
  doc_type text not null,
  doc_id int not null,
  from_status text,
  to_status text not null,
  actor_id int references users(id),
  memo text,
  at timestamptz not null default now()
);
create index if not exists status_logs_doc on status_logs(doc_type, doc_id);

create table if not exists notifications (
  id serial primary key,
  user_role text,
  message text not null,
  link text,
  created_at timestamptz not null default now(),
  read boolean not null default false
);

create table if not exists ecount_sync_logs (
  id serial primary key,
  doc_type text not null,
  doc_id int not null,
  request jsonb not null,
  response jsonb,
  success boolean not null,
  mock boolean not null default true,
  at timestamptz not null default now()
);

-- AI 정리 결과 (주문 원문 → 발주/수주 초안)
alter table order_inbox add column if not exists ai_draft jsonb;
alter table order_inbox add column if not exists ai_error text;

-- 영업 담당자 역할과 주문 캡처 이미지
alter table users drop constraint if exists users_role_check;
alter table users add constraint users_role_check check (role in ('office_admin','factory_manager','staff','sales','executive'));
alter table order_inbox add column if not exists image bytea;
alter table order_inbox add column if not exists image_type text;
alter table order_inbox add column if not exists sales_note text;

-- 재고 확인: 품목 기본 공급사, 로트 잔량, 출고 로트 기록(추적성)
alter table items add column if not exists default_supplier_id int references partners(id);
alter table lots add column if not exists remaining_qty numeric(14,3);
update lots set remaining_qty = qty where remaining_qty is null;
create table if not exists shipment_lots (
  id serial primary key,
  so_line_id int not null references sales_order_lines(id) on delete cascade,
  lot_id int not null references lots(id),
  qty numeric(14,3) not null,
  at timestamptz not null default now()
);
alter table purchase_orders add column if not exists source_so_id int references sales_orders(id);

-- 품목 별칭: 거래처가 부르는 이름 → 내부 품목
create table if not exists item_aliases (
  id serial primary key,
  item_id int not null references items(id) on delete cascade,
  alias text not null unique,
  learned boolean not null default false,
  created_at timestamptz not null default now()
);

-- 긴급 주문 표시
alter table order_inbox add column if not exists urgent boolean not null default false;
alter table partners add column if not exists fax text;
alter table purchase_orders add column if not exists sent_via text;
alter table purchase_orders add column if not exists sent_to text;
alter table sales_orders add column if not exists kind text not null default 'order';
alter table sales_orders add column if not exists urgent boolean not null default false;
alter table purchase_orders add column if not exists urgent boolean not null default false;

-- 완제품(휴럼 제품) 품목: 수주·출하용
alter table items drop constraint if exists items_category_check;
alter table items add constraint items_category_check check (category in ('raw','sub','product'));

-- 출하 지시를 기존 수주(계약)에 연결: 원 수주의 남은 수량에서 나눠 내보냅니다.
alter table sales_orders add column if not exists parent_so_id int references sales_orders(id);

-- 기준 정보(거래처·품목)는 이카운트가 원본입니다. EDIS는 받아서 조회만 합니다.
create table if not exists master_sync_logs (
  id serial primary key,
  kind text not null check (kind in ('partners','items')),
  count int not null,
  mock boolean not null default true,
  at timestamptz not null default now()
);

-- 주문 메일함에서 가져온 메일의 보낸 사람·제목
alter table order_inbox add column if not exists email_from text;
alter table order_inbox add column if not exists email_subject text;

-- 경영 현황용 지난 달 실적. 운영에서는 이카운트 월별 매출·매입 집계에서 받아 옵니다. 이번 달은 EDIS 데이터로 계산합니다.
create table if not exists monthly_results (
  ym text primary key,
  sales numeric(16,0) not null,
  purchase numeric(16,0) not null,
  orders int not null,
  on_time_rate numeric(5,1)
);

-- 개인 알림: user_id가 있으면 그 사람에게만 보입니다 (영업 담당자의 출하 지시 진행·지연 알림).
alter table notifications add column if not exists user_id int references users(id);
-- 출하 지시 납기 지연 알림을 한 번만 보내기 위한 표시
alter table sales_orders add column if not exists late_notified boolean not null default false;
