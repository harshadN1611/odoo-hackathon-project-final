drop view if exists manufacturing_order_summary;
drop view if exists purchase_order_summary;
drop view if exists sales_order_summary;
drop view if exists bom_summary;
drop table if exists audit_logs, stock_ledger, mo_work_orders, mo_components, manufacturing_orders,
  purchase_order_lines, purchase_orders, sales_order_lines, sales_orders, bom_operations,
  bom_components, bills_of_material, products, vendors, user_module_permissions, users,
  reference_sequences cascade;

create table reference_sequences (
  prefix text primary key,
  next_value integer not null default 1
);

create table users (
  id bigserial primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  mobile_number text default '',
  address text default '',
  position text default '',
  role text not null check (role in ('Admin','User')),
  created_at timestamptz not null default now()
);

create table user_module_permissions (
  id bigserial primary key,
  user_id bigint not null references users(id) on delete cascade,
  module text not null check (module in ('Sales','Purchase','Manufacturing','Product','BoM','Audit','User')),
  can_view text not null default 'None' check (can_view in ('Full','Limited','Optional','None')),
  can_create text not null default 'None' check (can_create in ('Full','Limited','Optional','None')),
  can_edit text not null default 'None' check (can_edit in ('Full','Limited','Optional','None')),
  can_delete text not null default 'None' check (can_delete in ('Full','Limited','Optional','None')),
  unique(user_id,module)
);

create table vendors (
  id bigserial primary key,
  vendor_name text not null,
  vendor_address text not null default '',
  contact_info text not null default ''
);

create table products (
  id bigserial primary key,
  reference text not null unique,
  product_name text not null,
  sales_price numeric(12,2) not null default 0,
  cost_price numeric(12,2) not null default 0,
  on_hand_qty numeric(14,3) not null default 0,
  reserved_qty numeric(14,3) not null default 0,
  procure_on_demand boolean not null default false,
  procurement_type text check (procurement_type in ('Purchase','Manufacturing')),
  vendor_id bigint references vendors(id),
  bom_id bigint,
  image_url text,
  unit text not null default 'Units',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table bills_of_material (
  id bigserial primary key,
  reference text not null unique,
  finished_product_id bigint not null references products(id),
  quantity numeric(14,3) not null default 1,
  unit text not null default 'Units',
  reference_note text not null default '' check (char_length(reference_note) <= 8),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table products add constraint products_bom_fk foreign key (bom_id) references bills_of_material(id);

create table bom_components (
  id bigserial primary key,
  bom_id bigint not null references bills_of_material(id) on delete cascade,
  component_product_id bigint not null references products(id),
  to_consume_qty numeric(14,3) not null,
  unit text not null default 'Units'
);

create table bom_operations (
  id bigserial primary key,
  bom_id bigint not null references bills_of_material(id) on delete cascade,
  operation_name text not null,
  work_center text not null,
  expected_duration numeric(14,2) not null default 0
);

create table sales_orders (
  id bigserial primary key,
  reference text not null unique,
  customer_name text not null,
  customer_address text not null,
  creation_date date not null default current_date,
  due_date date,
  sales_person_id bigint references users(id),
  status text not null default 'Draft' check (status in ('Draft','Confirmed','Partially Delivered','Fully Delivered','Cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sales_order_lines (
  id bigserial primary key,
  sales_order_id bigint not null references sales_orders(id) on delete cascade,
  product_id bigint not null references products(id),
  ordered_qty numeric(14,3) not null,
  delivered_qty numeric(14,3) not null default 0,
  unit text not null default 'Units',
  sales_unit_price numeric(12,2) not null default 0
);

create table purchase_orders (
  id bigserial primary key,
  reference text not null unique,
  vendor_id bigint references vendors(id),
  vendor_name text not null,
  vendor_address text not null,
  creation_date date not null default current_date,
  due_date date,
  responsible_person_id bigint references users(id),
  source_note text,
  status text not null default 'Draft' check (status in ('Draft','Confirmed','Partially Received','Fully Received','Cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table purchase_order_lines (
  id bigserial primary key,
  purchase_order_id bigint not null references purchase_orders(id) on delete cascade,
  product_id bigint not null references products(id),
  ordered_qty numeric(14,3) not null,
  received_qty numeric(14,3) not null default 0,
  unit text not null default 'Units',
  cost_price numeric(12,2) not null default 0
);

create table manufacturing_orders (
  id bigserial primary key,
  reference text not null unique,
  finished_product_id bigint not null references products(id),
  quantity numeric(14,3) not null,
  bom_id bigint not null references bills_of_material(id),
  schedule_date date,
  assignee_id bigint references users(id),
  source_note text,
  status text not null default 'Draft' check (status in ('Draft','Confirmed','In Progress','Done','Cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table mo_components (
  id bigserial primary key,
  mo_id bigint not null references manufacturing_orders(id) on delete cascade,
  product_id bigint not null references products(id),
  to_consume_qty numeric(14,3) not null,
  consumed_qty numeric(14,3) not null default 0,
  unit text not null default 'Units'
);

create table mo_work_orders (
  id bigserial primary key,
  mo_id bigint not null references manufacturing_orders(id) on delete cascade,
  operation_name text not null,
  work_center text not null,
  expected_duration numeric(14,2) not null default 0,
  real_duration numeric(14,2) not null default 0,
  status text not null default 'Draft'
);

create table stock_ledger (
  id bigserial primary key,
  product_id bigint not null references products(id),
  movement_qty numeric(14,3) not null,
  reference_type text not null check (reference_type in ('SO','PO','MO')),
  reference_id bigint not null,
  reference_number text not null,
  movement_date timestamptz not null default now(),
  resulting_on_hand numeric(14,3) not null
);

create table audit_logs (
  id bigserial primary key,
  date_time timestamptz not null default now(),
  user_id bigint references users(id),
  module text not null,
  record_type text not null,
  record_id text not null,
  action text not null check (action in ('Created','Updated','Deleted','Status Changed')),
  field_changed text,
  old_value text,
  new_value text
);

insert into reference_sequences(prefix,next_value) values
('PROD', 10), ('BOM', 3), ('SO', 3), ('PO', 3), ('MO', 3);

insert into users(name,email,password_hash,mobile_number,address,position,role) values
('Mahesh Gupta','admin@shiv.local','adminsalt00000001:1a37484e51a3cd6d3eb6b648d9c98ccbc864ae6c65ad17f830ff3801fc2b4aef','9000000001','Jaipur','System Administrator','Admin'),
('Amit Sharma','amit.sales@shiv.local','salessalt00000001:1d291fc9a99081f7964efb057f9094fefe0ed9e428f7475f3f16e4d277988b41','9000000002','Jaipur','Sales Manager','User'),
('Neha Verma','neha.purchase@shiv.local','purchasesalt000001:066656a778db6764f40e70a77f6e07637dcff4fe2f04e4a425918663eb8ce3c0','9000000003','Jaipur','Purchase Executive','User'),
('Ravi Patel','ravi.mfg@shiv.local','mfgsalt0000000001:6700ab18209afc6e705214adbecba0b8bd5d92a4fcde608b09fa8d2e98942520','9000000004','Jaipur','Manufacturing Supervisor','User'),
('Meera Singh','meera.owner@shiv.local','ownersalt00000001:49de94f386204e35d71590ac49deefccd09faa725c806727a8a6206316495841','9000000005','Jaipur','Business Owner','User');

insert into user_module_permissions(user_id,module,can_view,can_create,can_edit,can_delete)
select u.id, m.module, 'Full','Full','Full','Full'
from users u cross join (values ('Sales'),('Purchase'),('Manufacturing'),('Product'),('BoM'),('Audit'),('User')) as m(module)
where u.role='Admin';

insert into user_module_permissions(user_id,module,can_view,can_create,can_edit,can_delete)
select id,'Sales','Full','Full','Full','Limited' from users where email='amit.sales@shiv.local';
insert into user_module_permissions(user_id,module,can_view,can_create,can_edit,can_delete)
select id,'Purchase','Full','Full','Full','Limited' from users where email='neha.purchase@shiv.local';
insert into user_module_permissions(user_id,module,can_view,can_create,can_edit,can_delete)
select id,'Manufacturing','Full','Full','Full','Limited' from users where email='ravi.mfg@shiv.local';
insert into user_module_permissions(user_id,module,can_view,can_create,can_edit,can_delete)
select id,'BoM','Full','Full','Full','Limited' from users where email='ravi.mfg@shiv.local';
insert into user_module_permissions(user_id,module,can_view,can_create,can_edit,can_delete)
select id,module,'Limited','None','None','None'
from users cross join (values ('Sales'),('Purchase'),('Manufacturing'),('Product'),('BoM')) as m(module)
where email='meera.owner@shiv.local';

insert into vendors(vendor_name,vendor_address,contact_info) values
('Jaipur Timber Mart','Industrial Area, Jaipur','timber@example.com'),
('Rajasthan Hardware Co.','MI Road, Jaipur','hardware@example.com'),
('Metro Upholstery Supply','Sitapura, Jaipur','upholstery@example.com');

insert into products(reference,product_name,sales_price,cost_price,on_hand_qty,unit) values
('PROD-000001','Wooden Table',8500,5200,12,'Units'),
('PROD-000002','Wooden Chair',2400,1400,35,'Units'),
('PROD-000003','Office Chair',5200,3100,10,'Units'),
('PROD-000004','Dining Table',18500,12400,5,'Units'),
('PROD-000005','Wooden Legs',350,180,120,'Units'),
('PROD-000006','Wooden Top',2200,1300,30,'Units'),
('PROD-000007','Screws',2,1,2000,'Units'),
('PROD-000008','Door Frames',4200,2500,9,'Units'),
('PROD-000009','Lighting Frames',3200,1800,11,'Units');

insert into bills_of_material(reference,finished_product_id,quantity,unit,reference_note) values
('BOM-000001',1,1,'Units','WTBL'),
('BOM-000002',4,1,'Units','DTBL');

insert into bom_components(bom_id,component_product_id,to_consume_qty,unit) values
(1,5,4,'Units'),(1,6,1,'Units'),(1,7,12,'Units'),
(2,5,4,'Units'),(2,6,2,'Units'),(2,7,20,'Units');

insert into bom_operations(bom_id,operation_name,work_center,expected_duration) values
(1,'Assembly','Assembly Bay',60),(1,'Painting','Paint Booth',30),(1,'Packing','Dispatch Bay',20),
(2,'Frame Assembly','Assembly Bay',90),(2,'Finishing','Paint Booth',45),(2,'Packing','Dispatch Bay',25);

update products set procure_on_demand=true, procurement_type='Manufacturing', bom_id=1 where id=1;
update products set procure_on_demand=true, procurement_type='Manufacturing', bom_id=2 where id=4;
update products set procure_on_demand=true, procurement_type='Purchase', vendor_id=1 where id in (5,6);
update products set procure_on_demand=true, procurement_type='Purchase', vendor_id=2 where id=7;

insert into sales_orders(reference,customer_name,customer_address,sales_person_id,due_date,status) values
('SO-000001','Urban Living Store','C-Scheme, Jaipur',2,current_date + 5,'Confirmed'),
('SO-000002','Desert Home Studio','Vaishali Nagar, Jaipur',2,current_date - 2,'Partially Delivered');
insert into sales_order_lines(sales_order_id,product_id,ordered_qty,delivered_qty,unit,sales_unit_price) values
(1,1,2,0,'Units',8500),(2,2,6,3,'Units',2400);

insert into purchase_orders(reference,vendor_id,vendor_name,vendor_address,responsible_person_id,due_date,status) values
('PO-000001',1,'Jaipur Timber Mart','Industrial Area, Jaipur',3,current_date + 3,'Confirmed'),
('PO-000002',2,'Rajasthan Hardware Co.','MI Road, Jaipur',3,current_date - 1,'Partially Received');
insert into purchase_order_lines(purchase_order_id,product_id,ordered_qty,received_qty,unit,cost_price) values
(1,5,40,0,'Units',180),(2,7,1000,300,'Units',1);

insert into manufacturing_orders(reference,finished_product_id,quantity,bom_id,schedule_date,assignee_id,status) values
('MO-000001',1,5,1,current_date + 2,4,'Confirmed'),
('MO-000002',4,2,2,current_date - 1,4,'In Progress');
insert into mo_components(mo_id,product_id,to_consume_qty,consumed_qty,unit) values
(1,5,20,0,'Units'),(1,6,5,0,'Units'),(1,7,60,0,'Units'),
(2,5,8,0,'Units'),(2,6,4,0,'Units'),(2,7,40,0,'Units');
insert into mo_work_orders(mo_id,operation_name,work_center,expected_duration,real_duration,status) values
(1,'Assembly','Assembly Bay',300,0,'Confirmed'),(1,'Painting','Paint Booth',150,0,'Confirmed'),(1,'Packing','Dispatch Bay',100,0,'Confirmed'),
(2,'Frame Assembly','Assembly Bay',180,120,'In Progress'),(2,'Finishing','Paint Booth',90,0,'In Progress'),(2,'Packing','Dispatch Bay',50,0,'In Progress');

update products p set reserved_qty = coalesce(x.qty,0)
from (
  select product_id, sum(qty) qty from (
    select sol.product_id, greatest(sol.ordered_qty-sol.delivered_qty,0) qty
    from sales_order_lines sol join sales_orders so on so.id=sol.sales_order_id
    where so.status in ('Confirmed','Partially Delivered')
    union all
    select mc.product_id, greatest(mc.to_consume_qty-mc.consumed_qty,0) qty
    from mo_components mc join manufacturing_orders mo on mo.id=mc.mo_id
    where mo.status in ('Confirmed','In Progress')
  ) q group by product_id
) x where p.id=x.product_id;

insert into audit_logs(user_id,module,record_type,record_id,action,field_changed,old_value,new_value) values
(1,'Product','Product','PROD-000001','Created',null,null,null),
(1,'BoM','BillOfMaterial','BOM-000001','Created',null,null,null),
(2,'Sales','SalesOrder','SO-000001','Status Changed','status','Draft','Confirmed'),
(3,'Purchase','PurchaseOrder','PO-000001','Status Changed','status','Draft','Confirmed'),
(4,'Manufacturing','ManufacturingOrder','MO-000001','Status Changed','status','Draft','Confirmed');

create view bom_summary as
select b.*, p.product_name as finished_product_name,
  coalesce(json_agg(distinct jsonb_build_object('id',bc.id,'component_product_id',bc.component_product_id,'component_name',cp.product_name,'to_consume_qty',bc.to_consume_qty,'unit',bc.unit)) filter (where bc.id is not null), '[]') as components,
  coalesce(json_agg(distinct jsonb_build_object('id',bo.id,'operation_name',bo.operation_name,'work_center',bo.work_center,'expected_duration',bo.expected_duration)) filter (where bo.id is not null), '[]') as operations
from bills_of_material b
join products p on p.id=b.finished_product_id
left join bom_components bc on bc.bom_id=b.id
left join products cp on cp.id=bc.component_product_id
left join bom_operations bo on bo.bom_id=b.id
group by b.id,p.product_name;

create view sales_order_summary as
select so.*, u.name as sales_person_name,
  coalesce(json_agg(jsonb_build_object('id',l.id,'product_id',l.product_id,'product_name',p.product_name,'availability',case when l.ordered_qty > (p.on_hand_qty-p.reserved_qty) then 'Shortage' else 'Available' end,'ordered_qty',l.ordered_qty,'delivered_qty',l.delivered_qty,'unit',l.unit,'sales_unit_price',l.sales_unit_price,'total',case when l.delivered_qty > 0 then l.delivered_qty*l.sales_unit_price else l.ordered_qty*l.sales_unit_price end)) filter (where l.id is not null), '[]') as lines
from sales_orders so
left join users u on u.id=so.sales_person_id
left join sales_order_lines l on l.sales_order_id=so.id
left join products p on p.id=l.product_id
group by so.id,u.name;

create view purchase_order_summary as
select po.*, u.name as responsible_person_name,
  coalesce(json_agg(jsonb_build_object('id',l.id,'product_id',l.product_id,'product_name',p.product_name,'ordered_qty',l.ordered_qty,'received_qty',l.received_qty,'unit',l.unit,'cost_price',l.cost_price,'total',case when l.received_qty > 0 then l.received_qty*l.cost_price else l.ordered_qty*l.cost_price end)) filter (where l.id is not null), '[]') as lines
from purchase_orders po
left join users u on u.id=po.responsible_person_id
left join purchase_order_lines l on l.purchase_order_id=po.id
left join products p on p.id=l.product_id
group by po.id,u.name;

create view manufacturing_order_summary as
select mo.*, fp.product_name as finished_product_name, u.name as assignee_name,
  coalesce(json_agg(distinct jsonb_build_object('id',mc.id,'product_id',mc.product_id,'product_name',p.product_name,'availability',case when (p.on_hand_qty-p.reserved_qty) >= mc.to_consume_qty then 'Available' else 'Not Available' end,'to_consume_qty',mc.to_consume_qty,'consumed_qty',mc.consumed_qty,'unit',mc.unit)) filter (where mc.id is not null), '[]') as components,
  coalesce(json_agg(distinct jsonb_build_object('id',wo.id,'operation_name',wo.operation_name,'work_center',wo.work_center,'expected_duration',wo.expected_duration,'real_duration',wo.real_duration,'status',wo.status)) filter (where wo.id is not null), '[]') as operations
from manufacturing_orders mo
join products fp on fp.id=mo.finished_product_id
left join users u on u.id=mo.assignee_id
left join mo_components mc on mc.mo_id=mo.id
left join products p on p.id=mc.product_id
left join mo_work_orders wo on wo.mo_id=mo.id
group by mo.id,fp.product_name,u.name;
