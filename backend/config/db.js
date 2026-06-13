const fs = require('fs');
const path = require('path');
const { Pool: PgPool } = require('pg');
const { newDb, DataType } = require('pg-mem');

const schemaSql = fs.readFileSync(path.join(__dirname, '..', '..', 'database', 'schema.sql'), 'utf8');

const externalPool = new PgPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 5433),
  database: process.env.DB_NAME || 'shiv_erp',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 10,
  idleTimeoutMillis: 30000
});

const MEMORY_DISABLED = false;
let mode = 'auto';
let memoryPoolPromise = null;

const moduleNames = ['Sales', 'Purchase', 'Manufacturing', 'Product', 'BoM', 'Audit', 'User'];

function normalize(sql) {
  return String(sql).replace(/\s+/g, ' ').trim().toLowerCase();
}

function isConnectionError(error) {
  return ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(error?.code)
    || /ECONNREFUSED|connect .* refused|database .* does not exist/i.test(error?.message || '');
}

function registerShimFunctions(db) {
  db.public.registerFunction({
    name: 'char_length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (value) => String(value ?? '').length
  });
  db.public.registerFunction({
    name: 'length',
    args: [DataType.text],
    returns: DataType.integer,
    implementation: (value) => String(value ?? '').length
  });
}

function stripCheckConstraints(statement) {
  let result = '';
  let index = 0;
  let inQuote = false;
  while (index < statement.length) {
    const lower = statement.slice(index, index + 5).toLowerCase();
    const char = statement[index];
    if (!inQuote && lower === 'check' && /\s/.test(statement[index + 5] || '')) {
      index += 5;
      while (/\s/.test(statement[index] || '')) index += 1;
      if (statement[index] === '(') {
        let depth = 0;
        while (index < statement.length) {
          const current = statement[index];
          if (current === "'" && statement[index - 1] !== '\\') {
            inQuote = !inQuote;
          }
          if (!inQuote) {
            if (current === '(') depth += 1;
            if (current === ')') {
              depth -= 1;
              if (depth === 0) {
                index += 1;
                break;
              }
            }
          }
          index += 1;
        }
        continue;
      }
    }
    if (char === "'" && statement[index - 1] !== '\\') inQuote = !inQuote;
    result += char;
    index += 1;
  }
  return result.replace(/\s+,/g, ',').replace(/,\s+,/g, ',');
}

function loadSchema(db) {
  for (const statement of schemaSql.split(';').map((part) => part.trim()).filter(Boolean)) {
    if (/^(drop|insert|update|create view)\b/i.test(statement)) continue;
    db.public.none(stripCheckConstraints(statement));
  }
}

function seedDate(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

async function seedMemoryPool(pool) {
  const insert = async (table, values) => {
    const keys = Object.keys(values);
    const params = keys.map((key) => values[key]);
    const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');
    const { rows } = await pool.query(`insert into ${table}(${keys.join(', ')}) values(${placeholders}) returning id`, params);
    return rows[0].id;
  };

  await pool.query('insert into reference_sequences(prefix,next_value) values ($1,$2),($3,$4),($5,$6),($7,$8),($9,$10)', [
    'PROD', 10, 'BOM', 3, 'SO', 3, 'PO', 3, 'MO', 3
  ]);

  const adminId = await insert('users', { name: 'Mahesh Gupta', email: 'admin@shiv.local', password_hash: 'adminsalt00000001:1a37484e51a3cd6d3eb6b648d9c98ccbc864ae6c65ad17f830ff3801fc2b4aef', mobile_number: '9000000001', address: 'Jaipur', position: 'System Administrator', role: 'Admin' });
  const salesId = await insert('users', { name: 'Amit Sharma', email: 'amit.sales@shiv.local', password_hash: 'salessalt00000001:1d291fc9a99081f7964efb057f9094fefe0ed9e428f7475f3f16e4d277988b41', mobile_number: '9000000002', address: 'Jaipur', position: 'Sales Manager', role: 'User' });
  const purchaseId = await insert('users', { name: 'Neha Verma', email: 'neha.purchase@shiv.local', password_hash: 'purchasesalt000001:066656a778db6764f40e70a77f6e07637dcff4fe2f04e4a425918663eb8ce3c0', mobile_number: '9000000003', address: 'Jaipur', position: 'Purchase Executive', role: 'User' });
  const mfgId = await insert('users', { name: 'Ravi Patel', email: 'ravi.mfg@shiv.local', password_hash: 'mfgsalt0000000001:6700ab18209afc6e705214adbecba0b8bd5d92a4fcde608b09fa8d2e98942520', mobile_number: '9000000004', address: 'Jaipur', position: 'Manufacturing Supervisor', role: 'User' });
  const ownerId = await insert('users', { name: 'Meera Singh', email: 'meera.owner@shiv.local', password_hash: 'ownersalt00000001:49de94f386204e35d71590ac49deefccd09faa725c806727a8a6206316495841', mobile_number: '9000000005', address: 'Jaipur', position: 'Business Owner', role: 'User' });

  for (const module of moduleNames) {
    await insert('user_module_permissions', { user_id: adminId, module, can_view: 'Full', can_create: 'Full', can_edit: 'Full', can_delete: 'Full' });
  }
  await insert('user_module_permissions', { user_id: salesId, module: 'Sales', can_view: 'Full', can_create: 'Full', can_edit: 'Full', can_delete: 'Limited' });
  await insert('user_module_permissions', { user_id: purchaseId, module: 'Purchase', can_view: 'Full', can_create: 'Full', can_edit: 'Full', can_delete: 'Limited' });
  await insert('user_module_permissions', { user_id: mfgId, module: 'Manufacturing', can_view: 'Full', can_create: 'Full', can_edit: 'Full', can_delete: 'Limited' });
  await insert('user_module_permissions', { user_id: mfgId, module: 'BoM', can_view: 'Full', can_create: 'Full', can_edit: 'Full', can_delete: 'Limited' });
  for (const module of ['Sales', 'Purchase', 'Manufacturing', 'Product', 'BoM']) {
    await insert('user_module_permissions', { user_id: ownerId, module, can_view: 'Limited', can_create: 'None', can_edit: 'None', can_delete: 'None' });
  }

  const vendor1 = await insert('vendors', { vendor_name: 'Jaipur Timber Mart', vendor_address: 'Industrial Area, Jaipur', contact_info: 'timber@example.com' });
  const vendor2 = await insert('vendors', { vendor_name: 'Rajasthan Hardware Co.', vendor_address: 'MI Road, Jaipur', contact_info: 'hardware@example.com' });
  await insert('vendors', { vendor_name: 'Metro Upholstery Supply', vendor_address: 'Sitapura, Jaipur', contact_info: 'upholstery@example.com' });

  const productIds = {};
  const products = [
    ['PROD-000001', 'Wooden Table', 8500, 5200, 12],
    ['PROD-000002', 'Wooden Chair', 2400, 1400, 35],
    ['PROD-000003', 'Office Chair', 5200, 3100, 10],
    ['PROD-000004', 'Dining Table', 18500, 12400, 5],
    ['PROD-000005', 'Wooden Legs', 350, 180, 120],
    ['PROD-000006', 'Wooden Top', 2200, 1300, 30],
    ['PROD-000007', 'Screws', 2, 1, 2000],
    ['PROD-000008', 'Door Frames', 4200, 2500, 9],
    ['PROD-000009', 'Lighting Frames', 3200, 1800, 11]
  ];
  for (const [reference, product_name, sales_price, cost_price, on_hand_qty] of products) {
    productIds[reference] = await insert('products', { reference, product_name, sales_price, cost_price, on_hand_qty, unit: 'Units' });
  }

  const bom1 = await insert('bills_of_material', { reference: 'BOM-000001', finished_product_id: productIds['PROD-000001'], quantity: 1, unit: 'Units', reference_note: 'WTBL' });
  const bom2 = await insert('bills_of_material', { reference: 'BOM-000002', finished_product_id: productIds['PROD-000004'], quantity: 1, unit: 'Units', reference_note: 'DTBL' });
  await pool.query('update products set procure_on_demand=true, procurement_type=$1, bom_id=$2 where id=$3', ['Manufacturing', bom1, productIds['PROD-000001']]);
  await pool.query('update products set procure_on_demand=true, procurement_type=$1, bom_id=$2 where id=$3', ['Manufacturing', bom2, productIds['PROD-000004']]);
  await pool.query('update products set procure_on_demand=true, procurement_type=$1, vendor_id=$2 where id in ($3,$4)', ['Purchase', vendor1, productIds['PROD-000005'], productIds['PROD-000006']]);
  await pool.query('update products set procure_on_demand=true, procurement_type=$1, vendor_id=$2 where id=$3', ['Purchase', vendor2, productIds['PROD-000007']]);

  for (const row of [
    [bom1, productIds['PROD-000005'], 4],
    [bom1, productIds['PROD-000006'], 1],
    [bom1, productIds['PROD-000007'], 12],
    [bom2, productIds['PROD-000005'], 4],
    [bom2, productIds['PROD-000006'], 2],
    [bom2, productIds['PROD-000007'], 20]
  ]) {
    await insert('bom_components', { bom_id: row[0], component_product_id: row[1], to_consume_qty: row[2], unit: 'Units' });
  }

  for (const row of [
    [bom1, 'Assembly', 'Assembly Bay', 60],
    [bom1, 'Painting', 'Paint Booth', 30],
    [bom1, 'Packing', 'Dispatch Bay', 20],
    [bom2, 'Frame Assembly', 'Assembly Bay', 90],
    [bom2, 'Finishing', 'Paint Booth', 45],
    [bom2, 'Packing', 'Dispatch Bay', 25]
  ]) {
    await insert('bom_operations', { bom_id: row[0], operation_name: row[1], work_center: row[2], expected_duration: row[3] });
  }

  const sales1 = await insert('sales_orders', { reference: 'SO-000001', customer_name: 'Urban Living Store', customer_address: 'C-Scheme, Jaipur', sales_person_id: salesId, due_date: seedDate(5), status: 'Confirmed' });
  const sales2 = await insert('sales_orders', { reference: 'SO-000002', customer_name: 'Desert Home Studio', customer_address: 'Vaishali Nagar, Jaipur', sales_person_id: salesId, due_date: seedDate(-2), status: 'Partially Delivered' });
  await insert('sales_order_lines', { sales_order_id: sales1, product_id: productIds['PROD-000001'], ordered_qty: 2, delivered_qty: 0, unit: 'Units', sales_unit_price: 8500 });
  await insert('sales_order_lines', { sales_order_id: sales2, product_id: productIds['PROD-000002'], ordered_qty: 6, delivered_qty: 3, unit: 'Units', sales_unit_price: 2400 });

  const purchase1 = await insert('purchase_orders', { reference: 'PO-000001', vendor_id: vendor1, vendor_name: 'Jaipur Timber Mart', vendor_address: 'Industrial Area, Jaipur', responsible_person_id: purchaseId, due_date: seedDate(3), status: 'Confirmed' });
  const purchase2 = await insert('purchase_orders', { reference: 'PO-000002', vendor_id: vendor2, vendor_name: 'Rajasthan Hardware Co.', vendor_address: 'MI Road, Jaipur', responsible_person_id: purchaseId, due_date: seedDate(-1), status: 'Partially Received' });
  await insert('purchase_order_lines', { purchase_order_id: purchase1, product_id: productIds['PROD-000005'], ordered_qty: 40, received_qty: 0, unit: 'Units', cost_price: 180 });
  await insert('purchase_order_lines', { purchase_order_id: purchase2, product_id: productIds['PROD-000007'], ordered_qty: 1000, received_qty: 300, unit: 'Units', cost_price: 1 });

  const mo1 = await insert('manufacturing_orders', { reference: 'MO-000001', finished_product_id: productIds['PROD-000001'], quantity: 5, bom_id: bom1, schedule_date: seedDate(2), assignee_id: mfgId, status: 'Confirmed' });
  const mo2 = await insert('manufacturing_orders', { reference: 'MO-000002', finished_product_id: productIds['PROD-000004'], quantity: 2, bom_id: bom2, schedule_date: seedDate(-1), assignee_id: mfgId, status: 'In Progress' });
  await insert('mo_components', { mo_id: mo1, product_id: productIds['PROD-000005'], to_consume_qty: 20, consumed_qty: 0, unit: 'Units' });
  await insert('mo_components', { mo_id: mo1, product_id: productIds['PROD-000006'], to_consume_qty: 5, consumed_qty: 0, unit: 'Units' });
  await insert('mo_components', { mo_id: mo1, product_id: productIds['PROD-000007'], to_consume_qty: 60, consumed_qty: 0, unit: 'Units' });
  await insert('mo_components', { mo_id: mo2, product_id: productIds['PROD-000005'], to_consume_qty: 8, consumed_qty: 0, unit: 'Units' });
  await insert('mo_components', { mo_id: mo2, product_id: productIds['PROD-000006'], to_consume_qty: 4, consumed_qty: 0, unit: 'Units' });
  await insert('mo_components', { mo_id: mo2, product_id: productIds['PROD-000007'], to_consume_qty: 40, consumed_qty: 0, unit: 'Units' });
  await insert('mo_work_orders', { mo_id: mo1, operation_name: 'Assembly', work_center: 'Assembly Bay', expected_duration: 300, real_duration: 0, status: 'Confirmed' });
  await insert('mo_work_orders', { mo_id: mo1, operation_name: 'Painting', work_center: 'Paint Booth', expected_duration: 150, real_duration: 0, status: 'Confirmed' });
  await insert('mo_work_orders', { mo_id: mo1, operation_name: 'Packing', work_center: 'Dispatch Bay', expected_duration: 100, real_duration: 0, status: 'Confirmed' });
  await insert('mo_work_orders', { mo_id: mo2, operation_name: 'Frame Assembly', work_center: 'Assembly Bay', expected_duration: 180, real_duration: 120, status: 'In Progress' });
  await insert('mo_work_orders', { mo_id: mo2, operation_name: 'Finishing', work_center: 'Paint Booth', expected_duration: 90, real_duration: 0, status: 'In Progress' });
  await insert('mo_work_orders', { mo_id: mo2, operation_name: 'Packing', work_center: 'Dispatch Bay', expected_duration: 50, real_duration: 0, status: 'In Progress' });

  await pool.query('update products set reserved_qty = case reference when $1 then $2 when $3 then $4 when $5 then $6 when $7 then $8 when $9 then $10 else 0 end', [
    'PROD-000001', 2,
    'PROD-000002', 3,
    'PROD-000005', 28,
    'PROD-000006', 9,
    'PROD-000007', 100
  ]);

  for (const row of [
    [adminId, 'Product', 'Product', 'PROD-000001', 'Created', null, null, null],
    [adminId, 'BoM', 'BillOfMaterial', 'BOM-000001', 'Created', null, null, null],
    [salesId, 'Sales', 'SalesOrder', 'SO-000001', 'Status Changed', 'status', 'Draft', 'Confirmed'],
    [purchaseId, 'Purchase', 'PurchaseOrder', 'PO-000001', 'Status Changed', 'status', 'Draft', 'Confirmed'],
    [mfgId, 'Manufacturing', 'ManufacturingOrder', 'MO-000001', 'Status Changed', 'status', 'Draft', 'Confirmed']
  ]) {
    await insert('audit_logs', {
      user_id: row[0],
      module: row[1],
      record_type: row[2],
      record_id: row[3],
      action: row[4],
      field_changed: row[5],
      old_value: row[6],
      new_value: row[7]
    });
  }
}

async function createMemoryPool() {
  const db = newDb({ autoCreateForeignKeyIndices: true });
  registerShimFunctions(db);
  loadSchema(db);
  const { Pool } = db.adapters.createPg();
  const pool = new Pool();
  await seedMemoryPool(pool);
  return pool;
}

async function getPool() {
  if (mode === 'memory') return memoryPoolPromise || (memoryPoolPromise = createMemoryPool());
  if (mode === 'external') return externalPool;
  try {
    await externalPool.query('select 1');
    mode = 'external';
    return externalPool;
  } catch (error) {
    if (!MEMORY_DISABLED && isConnectionError(error)) {
      mode = 'memory';
      memoryPoolPromise = memoryPoolPromise || createMemoryPool();
      return memoryPoolPromise;
    }
    throw error;
  }
}

async function rawQuery(pool, text, params = []) {
  const startedAt = Date.now();
  const result = await pool.query(text, params);
  console.log(`[db] ${Date.now() - startedAt}ms ${text.split(/\s+/).slice(0, 4).join(' ')}`);
  return result;
}

async function loadRows(pool, text, params = []) {
  return (await rawQuery(pool, text, params)).rows;
}

async function buildBomSummary(pool) {
  const [boms, products, components, operations] = await Promise.all([
    loadRows(pool, 'select * from bills_of_material order by id'),
    loadRows(pool, 'select id, product_name from products order by id'),
    loadRows(pool, 'select * from bom_components order by id'),
    loadRows(pool, 'select * from bom_operations order by id')
  ]);
  const productById = new Map(products.map((row) => [row.id, row.product_name]));
  const componentsByBom = new Map();
  const operationsByBom = new Map();
  for (const row of components) {
    if (!componentsByBom.has(row.bom_id)) componentsByBom.set(row.bom_id, []);
    componentsByBom.get(row.bom_id).push({
      id: row.id,
      component_product_id: row.component_product_id,
      component_name: productById.get(row.component_product_id) || '',
      to_consume_qty: row.to_consume_qty,
      unit: row.unit
    });
  }
  for (const row of operations) {
    if (!operationsByBom.has(row.bom_id)) operationsByBom.set(row.bom_id, []);
    operationsByBom.get(row.bom_id).push({
      id: row.id,
      operation_name: row.operation_name,
      work_center: row.work_center,
      expected_duration: row.expected_duration
    });
  }
  return boms.map((bom) => ({
    ...bom,
    finished_product_name: productById.get(bom.finished_product_id) || '',
    components: componentsByBom.get(bom.id) || [],
    operations: operationsByBom.get(bom.id) || []
  }));
}

async function buildSalesSummary(pool) {
  const [orders, users, lines, products] = await Promise.all([
    loadRows(pool, 'select * from sales_orders order by id desc'),
    loadRows(pool, 'select id, name from users order by id'),
    loadRows(pool, 'select * from sales_order_lines order by id'),
    loadRows(pool, 'select id, product_name, on_hand_qty, reserved_qty from products order by id')
  ]);
  const userById = new Map(users.map((row) => [row.id, row.name]));
  const productById = new Map(products.map((row) => [row.id, row]));
  const linesByOrder = new Map();
  for (const line of lines) {
    if (!linesByOrder.has(line.sales_order_id)) linesByOrder.set(line.sales_order_id, []);
    const product = productById.get(line.product_id) || {};
    linesByOrder.get(line.sales_order_id).push({
      id: line.id,
      product_id: line.product_id,
      product_name: product.product_name || '',
      availability: Number(line.ordered_qty) > Number(product.on_hand_qty || 0) - Number(product.reserved_qty || 0) ? 'Shortage' : 'Available',
      ordered_qty: line.ordered_qty,
      delivered_qty: line.delivered_qty,
      unit: line.unit,
      sales_unit_price: line.sales_unit_price,
      total: Number(line.delivered_qty) > 0 ? Number(line.delivered_qty) * Number(line.sales_unit_price) : Number(line.ordered_qty) * Number(line.sales_unit_price)
    });
  }
  return orders.map((order) => ({
    ...order,
    sales_person_name: userById.get(order.sales_person_id) || null,
    lines: linesByOrder.get(order.id) || []
  }));
}

async function buildPurchaseSummary(pool) {
  const [orders, users, lines, products] = await Promise.all([
    loadRows(pool, 'select * from purchase_orders order by id desc'),
    loadRows(pool, 'select id, name from users order by id'),
    loadRows(pool, 'select * from purchase_order_lines order by id'),
    loadRows(pool, 'select id, product_name from products order by id')
  ]);
  const userById = new Map(users.map((row) => [row.id, row.name]));
  const productById = new Map(products.map((row) => [row.id, row.product_name]));
  const linesByOrder = new Map();
  for (const line of lines) {
    if (!linesByOrder.has(line.purchase_order_id)) linesByOrder.set(line.purchase_order_id, []);
    linesByOrder.get(line.purchase_order_id).push({
      id: line.id,
      product_id: line.product_id,
      product_name: productById.get(line.product_id) || '',
      ordered_qty: line.ordered_qty,
      received_qty: line.received_qty,
      unit: line.unit,
      cost_price: line.cost_price,
      total: Number(line.received_qty) > 0 ? Number(line.received_qty) * Number(line.cost_price) : Number(line.ordered_qty) * Number(line.cost_price)
    });
  }
  return orders.map((order) => ({
    ...order,
    responsible_person_name: userById.get(order.responsible_person_id) || null,
    lines: linesByOrder.get(order.id) || []
  }));
}

async function buildManufacturingSummary(pool) {
  const [orders, users, components, workOrders, products] = await Promise.all([
    loadRows(pool, 'select * from manufacturing_orders order by id desc'),
    loadRows(pool, 'select id, name from users order by id'),
    loadRows(pool, 'select * from mo_components order by id'),
    loadRows(pool, 'select * from mo_work_orders order by id'),
    loadRows(pool, 'select id, product_name, on_hand_qty, reserved_qty from products order by id')
  ]);
  const userById = new Map(users.map((row) => [row.id, row.name]));
  const productById = new Map(products.map((row) => [row.id, row]));
  const componentsByOrder = new Map();
  const operationsByOrder = new Map();
  for (const component of components) {
    if (!componentsByOrder.has(component.mo_id)) componentsByOrder.set(component.mo_id, []);
    const product = productById.get(component.product_id) || {};
    componentsByOrder.get(component.mo_id).push({
      id: component.id,
      product_id: component.product_id,
      product_name: product.product_name || '',
      availability: Number(product.on_hand_qty || 0) - Number(product.reserved_qty || 0) >= Number(component.to_consume_qty) ? 'Available' : 'Not Available',
      to_consume_qty: component.to_consume_qty,
      consumed_qty: component.consumed_qty,
      unit: component.unit
    });
  }
  for (const operation of workOrders) {
    if (!operationsByOrder.has(operation.mo_id)) operationsByOrder.set(operation.mo_id, []);
    operationsByOrder.get(operation.mo_id).push({
      id: operation.id,
      operation_name: operation.operation_name,
      work_center: operation.work_center,
      expected_duration: operation.expected_duration,
      real_duration: operation.real_duration,
      status: operation.status
    });
  }
  return orders.map((order) => ({
    ...order,
    finished_product_name: productById.get(order.finished_product_id)?.product_name || '',
    assignee_name: userById.get(order.assignee_id) || null,
    components: componentsByOrder.get(order.id) || [],
    operations: operationsByOrder.get(order.id) || []
  }));
}

async function buildDashboardRows(pool, tableName, userField, lateStatuses, userId) {
  const rows = await loadRows(pool, `select status, ${userField} from ${tableName}`);
  const grouped = new Map();
  for (const row of rows) {
    if (!grouped.has(row.status)) grouped.set(row.status, []);
    grouped.get(row.status).push(row);
  }
  const order = tableName === 'sales_orders'
    ? ['Draft', 'Confirmed', 'Partially Delivered', 'Fully Delivered', 'Cancelled']
    : tableName === 'purchase_orders'
      ? ['Draft', 'Confirmed', 'Partially Received', 'Fully Received', 'Cancelled']
      : ['Draft', 'Confirmed', 'In Progress', 'Done', 'Cancelled'];
  const today = new Date().toISOString().slice(0, 10);
  return order.filter((status) => grouped.has(status)).map((status) => {
    const entries = grouped.get(status) || [];
    const all_count = entries.length;
    const my_count = entries.filter((row) => String(row[userField]) === String(userId)).length;
    const late_count = lateStatuses
      ? entries.filter((row) => row.due_date && row.due_date < today && lateStatuses.includes(status)).length
      : 0;
    return { status, all_count, my_count, late_count };
  });
}

async function buildAuditCounts(pool) {
  const logs = await loadRows(pool, 'select action from audit_logs');
  const counts = logs.reduce((acc, row) => {
    acc.total += 1;
    if (row.action === 'Created') acc.created += 1;
    if (row.action === 'Updated') acc.updated += 1;
    if (row.action === 'Deleted') acc.deleted += 1;
    return acc;
  }, { total: 0, created: 0, updated: 0, deleted: 0 });
  return counts;
}

async function maybeIntercept(pool, text, params) {
  const normalized = normalize(text);
  if (normalized === 'select now() as time') {
    return { rows: [{ time: new Date().toISOString() }] };
  }
  if (normalized === 'select * from bom_summary order by reference' || normalized === 'select * from bom_summary order by id') {
    const rows = await buildBomSummary(pool);
    return { rows: normalized.endsWith('reference') ? rows.sort((a, b) => String(a.reference).localeCompare(String(b.reference))) : rows.sort((a, b) => Number(b.id) - Number(a.id)) };
  }
  if (normalized === 'select * from sales_order_summary order by id desc') {
    return { rows: await buildSalesSummary(pool) };
  }
  if (normalized === 'select * from purchase_order_summary order by id desc') {
    return { rows: await buildPurchaseSummary(pool) };
  }
  if (normalized === 'select * from manufacturing_order_summary order by id desc') {
    return { rows: await buildManufacturingSummary(pool) };
  }
  if (normalized.includes('from sales_orders group by status') && normalized.includes('sales_person_id=$1')) {
    return { rows: await buildDashboardRows(pool, 'sales_orders', 'sales_person_id', ['Confirmed', 'Partially Delivered'], params[0]) };
  }
  if (normalized.includes('from purchase_orders group by status') && normalized.includes('responsible_person_id=$1')) {
    return { rows: await buildDashboardRows(pool, 'purchase_orders', 'responsible_person_id', ['Confirmed', 'Partially Received'], params[0]) };
  }
  if (normalized.includes('from manufacturing_orders group by status') && normalized.includes('assignee_id=$1')) {
    return { rows: await buildDashboardRows(pool, 'manufacturing_orders', 'assignee_id', null, params[0]) };
  }
  if (normalized.includes('from audit_logs') && normalized.includes('count(*)::int total')) {
    return { rows: [await buildAuditCounts(pool)] };
  }
  return null;
}

async function query(text, params = []) {
  const pool = await getPool();
  const startedAt = Date.now();
  try {
    const intercepted = await maybeIntercept(pool, text, params);
    if (intercepted) {
      console.log(`[db] ${Date.now() - startedAt}ms ${text.split(/\s+/).slice(0, 4).join(' ')}`);
      return intercepted;
    }
    const result = await pool.query(text, params);
    console.log(`[db] ${Date.now() - startedAt}ms ${text.split(/\s+/).slice(0, 4).join(' ')}`);
    return result;
  } catch (error) {
    if (mode !== 'memory' && !MEMORY_DISABLED && isConnectionError(error)) {
      mode = 'memory';
      memoryPoolPromise = memoryPoolPromise || createMemoryPool();
      const memory = await memoryPoolPromise;
      const intercepted = await maybeIntercept(memory, text, params);
      if (intercepted) return intercepted;
      return memory.query(text, params);
    }
    console.error('[db:error]', error.message);
    throw error;
  }
}

const pool = {
  query,
  connect: async () => {
    const active = await getPool();
    return active.connect();
  },
  end: async () => {
    await externalPool.end().catch(() => {});
    if (memoryPoolPromise) {
      const memory = await memoryPoolPromise.catch(() => null);
      if (memory?.end) await memory.end().catch(() => {});
    }
  }
};

module.exports = { query, pool };
