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
alter table users add constraint users_role_check check (role in ('office_admin','factory_manager','staff','sales'));
alter table order_inbox add column if not exists image bytea;
alter table order_inbox add column if not exists image_type text;
alter table order_inbox add column if not exists sales_note text;
