const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sendJson } = require('../utils/http');

const userDataCandidates = [
  path.join(__dirname, '..', 'data', 'users.json'),
  path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'shiv-furniture-mini-erp', 'users.json'),
  path.join(os.tmpdir(), 'shiv-furniture-mini-erp-users.json')
];
const modules = ['Sales', 'Purchase', 'Manufacturing', 'Product', 'BoM', 'Audit', 'User'];
const tokens = new Map();

const permissions = [];
const users = [
  user(1, 'Admin User', 'admin@shiv.local', 'admin123', 'Admin', 'System Administrator'),
  user(2, 'Amit Sales', 'amit.sales@shiv.local', 'sales123', 'User', 'Sales Manager', ['Sales', 'Product', 'Audit']),
  user(3, 'Neha Purchase', 'neha.purchase@shiv.local', 'purchase123', 'User', 'Purchase Executive', ['Purchase', 'Product', 'Audit']),
  user(4, 'Ravi Manufacturing', 'ravi.mfg@shiv.local', 'mfg123', 'User', 'Manufacturing Supervisor', ['Manufacturing', 'BoM', 'Product', 'Audit'])
];

const vendors = [
  { id: 1, vendor_name: 'Jaipur Timber Mart', email: 'timber@example.com', phone: '9876543210', vendor_address: 'RIICO Industrial Area, Jaipur' },
  { id: 2, vendor_name: 'Surat Hardware Supply', email: 'hardware@example.com', phone: '9876500001', vendor_address: 'Ring Road, Surat' }
];

const products = [
  product(1, 'SFW-CHAIR', 'Dining Chair', 2600, 1450, 35, 'Units', false, ''),
  product(2, 'SFW-TABLE', 'Six Seater Dining Table', 18500, 11200, 9, 'Units', false, ''),
  product(3, 'RM-TEAK', 'Teak Wood Plank', 0, 850, 180, 'Feet', false, ''),
  product(4, 'RM-VARNISH', 'Clear Varnish', 0, 420, 64, 'Litres', false, ''),
  product(5, 'RM-LEG', 'Wooden Legs', 0, 180, 22, 'Units', true, 'Purchase', 1)
];

const boms = [
  {
    id: 1,
    reference: 'BOM-000001',
    finished_product_id: 1,
    finished_product_name: 'Dining Chair',
    quantity: 1,
    components: [
      { id: 1, component_product_id: 3, component_name: 'Teak Wood Plank', product_name: 'Teak Wood Plank', to_consume_qty: 4, unit: 'Feet' },
      { id: 2, component_product_id: 5, component_name: 'Wooden Legs', product_name: 'Wooden Legs', to_consume_qty: 4, unit: 'Units' },
      { id: 3, component_product_id: 4, component_name: 'Clear Varnish', product_name: 'Clear Varnish', to_consume_qty: 0.25, unit: 'Litres' }
    ],
    operations: [
      { id: 1, operation_name: 'Cutting', work_center: 'Carpentry', expected_duration: 35 },
      { id: 2, operation_name: 'Finishing', work_center: 'Polish Booth', expected_duration: 20 }
    ]
  }
];

const salesOrders = [
  {
    id: 1,
    reference: 'SO-000001',
    customer_name: 'Green Leaf Cafe',
    customer_address: 'MG Road, Bengaluru',
    creation_date: today(),
    due_date: today(5),
    sales_person_id: 2,
    sales_person_name: 'Amit Sales',
    status: 'Draft',
    lines: [orderLine(1, 1, 6, 0, 'sales')]
  }
];

const purchaseOrders = [
  {
    id: 1,
    reference: 'PO-000001',
    vendor_id: 1,
    vendor_name: 'Jaipur Timber Mart',
    vendor_address: 'RIICO Industrial Area, Jaipur',
    creation_date: today(),
    due_date: today(4),
    responsible_person_id: 3,
    responsible_person_name: 'Neha Purchase',
    status: 'Draft',
    lines: [orderLine(1, 5, 24, 0, 'purchase')]
  }
];

const counters = { users: 5, products: 6, boms: 2, sales: 2, purchase: 2, manufacturing: 2, lines: 100, ledger: 1, logs: 1 };
const manufacturingOrders = [
  {
    id: 1,
    reference: 'MO-000001',
    finished_product_id: 1,
    finished_product_name: 'Dining Chair',
    bom_id: 1,
    quantity: 4,
    schedule_date: today(2),
    assignee_id: 4,
    assignee_name: 'Ravi Manufacturing',
    status: 'Draft',
    components: cloneComponents(1, 4),
    operations: cloneOperations(1)
  }
];

const ledgerEntries = [];
const logs = [];

loadPersistedUsers();
audit('System', 'System', 'Seed', 'Created', '', '', 'Demo data ready', users[0]);

function user(id, name, email, password, role, position, allowed = modules) {
  const next = { id, name, email, password, role, position, mobile_number: '', address: '' };
  if (role !== 'Admin') setPermissions(id, allowed);
  return next;
}

function setPermissions(userId, allowedModules) {
  permissions.splice(0, permissions.length, ...permissions.filter((p) => p.user_id !== userId));
  modules.forEach((module) => {
    const allowed = allowedModules.includes(module);
    permissions.push({
      user_id: userId,
      module,
      can_view: allowed ? 'Full' : 'None',
      can_create: allowed ? 'Full' : 'None',
      can_edit: allowed ? 'Full' : 'None',
      can_delete: module === 'Audit' ? 'None' : allowed ? 'Limited' : 'None'
    });
  });
}

function loadPersistedUsers() {
  const filePath = userDataCandidates.find((candidate) => fs.existsSync(candidate));
  if (!filePath) return;
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(data.users)) return;

  for (const savedUser of data.users) {
    const existing = users.find((u) => u.email.toLowerCase() === String(savedUser.email || '').toLowerCase());
    if (existing) Object.assign(existing, savedUser);
    else users.push(savedUser);
  }

  if (Array.isArray(data.permissions)) {
    for (const savedPermission of data.permissions) {
      const alreadyLoaded = permissions.some((p) => p.user_id === savedPermission.user_id && p.module === savedPermission.module);
      if (!alreadyLoaded) permissions.push(savedPermission);
    }
  }

  counters.users = Math.max(counters.users, ...users.map((u) => Number(u.id) + 1));
}

function saveUsers() {
  let lastError;
  for (const filePath of userDataCandidates) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify({ users, permissions }, null, 2));
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function product(id, reference, product_name, sales_price, cost_price, on_hand_qty, unit, procure_on_demand, procurement_type, vendor_id = null) {
  return {
    id,
    reference,
    product_name,
    sales_price,
    cost_price,
    on_hand_qty,
    reserved_qty: 0,
    free_to_use_qty: on_hand_qty,
    unit,
    procure_on_demand,
    procurement_type,
    vendor_id,
    bom_id: null
  };
}

function orderLine(id, productId, orderedQty, doneQty, type) {
  const p = find(products, productId, 'Product');
  const line = {
    id,
    product_id: p.id,
    product_name: p.product_name,
    ordered_qty: Number(orderedQty || 0),
    unit: p.unit,
    availability: p.free_to_use_qty >= orderedQty ? 'Available' : 'Shortage'
  };
  if (type === 'purchase') {
    line.received_qty = Number(doneQty || 0);
    line.cost_price = p.cost_price;
    line.total = line.cost_price * line.ordered_qty;
  } else {
    line.delivered_qty = Number(doneQty || 0);
    line.sales_unit_price = p.sales_price;
    line.total = line.sales_unit_price * line.ordered_qty;
  }
  return line;
}

function today(addDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + addDays);
  return d.toISOString().slice(0, 10);
}

function send(res, status, payload) {
  return sendJson(res, status, payload);
}

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, position: u.position, mobile_number: u.mobile_number, address: u.address };
}

function auth(req) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  const id = token && tokens.get(token);
  return users.find((u) => u.id === id);
}

function requireUser(req) {
  const current = auth(req);
  if (!current) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }
  return current;
}

function find(rows, id, label) {
  const row = rows.find((item) => Number(item.id) === Number(id));
  if (!row) {
    const error = new Error(`${label} not found`);
    error.status = 404;
    throw error;
  }
  return row;
}

function makeToken(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  tokens.set(token, userId);
  return token;
}

function cloneOrder(order) {
  return JSON.parse(JSON.stringify(order));
}

function recalcProduct(p) {
  p.reserved_qty = salesOrders
    .flatMap((o) => ['Confirmed', 'Partially Delivered'].includes(o.status) ? o.lines : [])
    .filter((line) => line.product_id === p.id)
    .reduce((sum, line) => sum + Math.max(0, Number(line.ordered_qty) - Number(line.delivered_qty || 0)), 0);
  p.free_to_use_qty = Number(p.on_hand_qty || 0) - Number(p.reserved_qty || 0);
}

function recalcProducts() {
  products.forEach(recalcProduct);
}

function addLedger(productId, qty, referenceType, referenceNumber, current) {
  const p = find(products, productId, 'Product');
  p.on_hand_qty = Number(p.on_hand_qty || 0) + Number(qty || 0);
  recalcProduct(p);
  ledgerEntries.unshift({
    id: counters.ledger++,
    movement_date: new Date().toISOString(),
    product_id: p.id,
    product_name: p.product_name,
    movement_qty: Number(qty || 0),
    reference_type: referenceType,
    reference_number: referenceNumber,
    resulting_on_hand: p.on_hand_qty,
    user_name: current?.name || 'System'
  });
}

function audit(module, record_type, record_id, action, field_changed, old_value, new_value, current) {
  logs.unshift({
    id: counters.logs++,
    date_time: new Date().toISOString(),
    user_id: current?.id || null,
    user_name: current?.name || 'System',
    module,
    record_type,
    record_id,
    action,
    field_changed,
    old_value: old_value == null ? '' : String(old_value),
    new_value: new_value == null ? '' : String(new_value)
  });
}

function statusRows(rows, statuses, ownerField, userId) {
  return statuses.map((status) => {
    const matching = rows.filter((row) => row.status === status);
    return {
      status,
      all_count: matching.length,
      my_count: matching.filter((row) => Number(row[ownerField]) === Number(userId)).length,
      late_count: matching.filter((row) => row.due_date && row.due_date < today() && !['Fully Delivered', 'Fully Received', 'Done', 'Cancelled'].includes(row.status)).length
    };
  });
}

function linesFromBody(lines = [], type) {
  return lines
    .filter((line) => line.product_id)
    .map((line) => orderLine(counters.lines++, line.product_id, line.ordered_qty || 1, type === 'purchase' ? line.received_qty : line.delivered_qty, type));
}

function copyOrderFields(order, body, type) {
  if (type === 'sales') {
    Object.assign(order, {
      customer_name: body.customer_name || order.customer_name,
      customer_address: body.customer_address || order.customer_address,
      due_date: body.due_date || order.due_date,
      sales_person_id: body.sales_person_id || order.sales_person_id
    });
    order.sales_person_name = find(users, order.sales_person_id, 'User').name;
  }
  if (type === 'purchase') {
    const vendor = find(vendors, body.vendor_id || order.vendor_id, 'Vendor');
    Object.assign(order, {
      vendor_id: vendor.id,
      vendor_name: vendor.vendor_name,
      vendor_address: vendor.vendor_address,
      due_date: body.due_date || order.due_date,
      responsible_person_id: body.responsible_person_id || order.responsible_person_id
    });
    order.responsible_person_name = find(users, order.responsible_person_id, 'User').name;
  }
  if (Array.isArray(body.lines)) order.lines = linesFromBody(body.lines, type);
}

function cloneComponents(bomId, quantity) {
  const bom = find(boms, bomId, 'BoM');
  return bom.components.map((c) => ({
    id: counters.lines++,
    component_product_id: c.component_product_id,
    product_id: c.component_product_id,
    component_name: c.component_name,
    product_name: c.product_name || c.component_name,
    to_consume_qty: Number(c.to_consume_qty) * Number(quantity || 1),
    consumed_qty: 0,
    unit: c.unit
  }));
}

function cloneOperations(bomId) {
  return find(boms, bomId, 'BoM').operations.map((o) => ({ ...o, id: counters.lines++ }));
}

async function health(req, res) {
  return send(res, 200, { status: 'ok' });
}

async function login(req, res, context) {
  const body = await context.readBody();
  const loginId = String(body.loginId || '').trim().toLowerCase();
  const current = users.find((u) => u.email.toLowerCase() === loginId);
  if (!current || current.password !== body.password || current.role === 'Admin') return send(res, 401, { error: 'Invalid system user credentials' });
  return send(res, 200, { token: makeToken(current.id), user: publicUser(current) });
}

async function adminLogin(req, res, context) {
  const body = await context.readBody();
  const loginId = String(body.loginId || '').trim().toLowerCase();
  const current = users.find((u) => u.email.toLowerCase() === loginId);
  if (!current || current.password !== body.password || current.role !== 'Admin') return send(res, 401, { error: 'Invalid admin credentials' });
  return send(res, 200, { token: makeToken(current.id), user: publicUser(current) });
}

async function signup(req, res, context) {
  const body = await context.readBody();
  const email = String(body.email || '').trim().toLowerCase();
  if (!body.name || !email || !body.password) return send(res, 400, { error: 'Name, email, and password are required' });
  if (body.password !== body.confirmPassword) return send(res, 400, { error: 'Passwords do not match' });
  if (users.some((u) => u.email.toLowerCase() === email)) return send(res, 409, { error: 'User already exists' });

  const current = user(counters.users++, body.name.trim(), email, body.password, 'User', 'New System User', ['Sales', 'Purchase', 'Product']);
  users.push(current);
  saveUsers();
  audit('User', 'User', current.email, 'Created', 'signup', '', 'Awaiting admin permission review', current);
  return send(res, 201, { message: 'Signup complete. You are signed in as a system user.', token: makeToken(current.id), user: publicUser(current) });
}

async function forgotPassword(req, res, context) {
  const body = await context.readBody();
  const exists = users.some((u) => u.email.toLowerCase() === String(body.email || '').toLowerCase());
  return send(res, 200, { message: exists ? 'Demo password reset checked. Ask admin to update this user.' : 'No user found for this email.' });
}

async function me(req, res) {
  const current = requireUser(req);
  return send(res, 200, {
    user: publicUser(current),
    permissions: current.role === 'Admin' ? modules.map((module) => ({ user_id: current.id, module, can_view: 'Full', can_create: 'Full', can_edit: 'Full', can_delete: 'Full' })) : permissions.filter((p) => p.user_id === current.id)
  });
}

async function dashboard(req, res) {
  const current = requireUser(req);
  return send(res, 200, {
    sales: statusRows(salesOrders, ['Draft', 'Confirmed', 'Partially Delivered', 'Fully Delivered'], 'sales_person_id', current.id),
    purchase: statusRows(purchaseOrders, ['Draft', 'Confirmed', 'Partially Received', 'Fully Received'], 'responsible_person_id', current.id),
    manufacturing: statusRows(manufacturingOrders, ['Draft', 'Confirmed', 'In Progress', 'Done'], 'assignee_id', current.id),
    logs: { total: logs.length }
  });
}

async function meta(req, res) {
  requireUser(req);
  recalcProducts();
  return send(res, 200, {
    products: products.map((p) => ({ ...p })),
    vendors: vendors.map((v) => ({ ...v })),
    boms: boms.map(cloneOrder),
    users: users.map(publicUser)
  });
}

async function listProducts(req, res) {
  requireUser(req);
  recalcProducts();
  return send(res, 200, { products: products.map((p) => ({ ...p })) });
}

async function createProduct(req, res, context) {
  const current = requireUser(req);
  const body = await context.readBody();
  const row = product(counters.products++, `PROD-${String(counters.products).padStart(6, '0')}`, body.product_name, body.sales_price, body.cost_price, body.on_hand_qty || 0, body.unit || 'Units', !!body.procure_on_demand, body.procurement_type || '', body.vendor_id || null);
  row.bom_id = body.bom_id || null;
  products.push(row);
  audit('Product', 'Product', row.reference, 'Created', '', '', row.product_name, current);
  return send(res, 201, { product: row });
}

async function updateProduct(req, res, context) {
  const current = requireUser(req);
  const row = find(products, context.params.id, 'Product');
  const body = await context.readBody();
  Object.assign(row, body, { id: row.id, reference: row.reference });
  recalcProduct(row);
  audit('Product', 'Product', row.reference, 'Updated', 'details', '', 'Product updated', current);
  return send(res, 200, { product: row });
}

async function deleteProduct(req, res, context) {
  const current = requireUser(req);
  const row = find(products, context.params.id, 'Product');
  products.splice(products.indexOf(row), 1);
  audit('Product', 'Product', row.reference, 'Deleted', '', row.product_name, '', current);
  return send(res, 200, { message: 'Product deleted' });
}

async function listVendors(req, res) {
  requireUser(req);
  return send(res, 200, { vendors });
}

async function createVendor(req, res, context) {
  const current = requireUser(req);
  const body = await context.readBody();
  const row = { id: vendors.length + 1, vendor_name: body.vendor_name || body.name, email: body.email || '', phone: body.phone || '', vendor_address: body.vendor_address || body.address || '' };
  vendors.push(row);
  audit('Purchase', 'Vendor', row.vendor_name, 'Created', '', '', row.vendor_name, current);
  return send(res, 201, { vendor: row });
}

async function listBoms(req, res) {
  requireUser(req);
  return send(res, 200, { boms: boms.map(cloneOrder) });
}

async function createBom(req, res, context) {
  const current = requireUser(req);
  const body = await context.readBody();
  const finished = find(products, body.finished_product_id, 'Product');
  const row = {
    id: counters.boms++,
    reference: `BOM-${String(counters.boms).padStart(6, '0')}`,
    finished_product_id: finished.id,
    finished_product_name: finished.product_name,
    quantity: body.quantity || 1,
    components: (body.components || []).filter((c) => c.component_product_id).map((c) => {
      const p = find(products, c.component_product_id, 'Product');
      return { id: counters.lines++, component_product_id: p.id, component_name: p.product_name, product_name: p.product_name, to_consume_qty: c.to_consume_qty || 1, unit: c.unit || p.unit };
    }),
    operations: (body.operations || []).map((o) => ({ id: counters.lines++, operation_name: o.operation_name, work_center: o.work_center, expected_duration: o.expected_duration || 0 }))
  };
  boms.push(row);
  audit('BoM', 'BoM', row.reference, 'Created', '', '', row.finished_product_name, current);
  return send(res, 201, { bom: row });
}

async function updateBom(req, res, context) {
  const current = requireUser(req);
  const row = find(boms, context.params.id, 'BoM');
  const body = await context.readBody();
  Object.assign(row, body, { id: row.id, reference: row.reference });
  audit('BoM', 'BoM', row.reference, 'Updated', 'details', '', 'BoM updated', current);
  return send(res, 200, { bom: row });
}

async function deleteBom(req, res, context) {
  const current = requireUser(req);
  const row = find(boms, context.params.id, 'BoM');
  boms.splice(boms.indexOf(row), 1);
  audit('BoM', 'BoM', row.reference, 'Deleted', '', row.finished_product_name, '', current);
  return send(res, 200, { message: 'BoM deleted' });
}

async function listSalesOrders(req, res) {
  requireUser(req);
  recalcProducts();
  return send(res, 200, { orders: salesOrders.map(cloneOrder) });
}

async function createSalesOrder(req, res, context) {
  const current = requireUser(req);
  const body = await context.readBody();
  const row = { id: counters.sales++, reference: `SO-${String(counters.sales).padStart(6, '0')}`, creation_date: today(), status: 'Draft', lines: [] };
  copyOrderFields(row, body, 'sales');
  salesOrders.push(row);
  audit('Sales', 'SalesOrder', row.reference, 'Created', '', '', row.customer_name, current);
  return send(res, 201, { order: row });
}

async function updateSalesOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(salesOrders, context.params.id, 'Sales order');
  copyOrderFields(row, await context.readBody(), 'sales');
  audit('Sales', 'SalesOrder', row.reference, 'Updated', 'details', '', 'Sales order updated', current);
  return send(res, 200, { order: row });
}

async function confirmSalesOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(salesOrders, context.params.id, 'Sales order');
  row.status = 'Confirmed';
  recalcProducts();
  audit('Sales', 'SalesOrder', row.reference, 'Updated', 'status', 'Draft', 'Confirmed', current);
  return send(res, 200, { order: row });
}

async function deliverSalesOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(salesOrders, context.params.id, 'Sales order');
  const body = await context.readBody();
  for (const input of body.lines || []) {
    const line = find(row.lines, input.id, 'Sales line');
    const delta = Math.min(Number(input.delivered_qty || 0), line.ordered_qty) - Number(line.delivered_qty || 0);
    if (delta > 0) {
      line.delivered_qty += delta;
      addLedger(line.product_id, -delta, 'SalesOrder', row.reference, current);
    }
  }
  row.status = row.lines.every((line) => line.delivered_qty >= line.ordered_qty) ? 'Fully Delivered' : 'Partially Delivered';
  audit('Sales', 'SalesOrder', row.reference, 'Updated', 'status', '', row.status, current);
  return send(res, 200, { order: row });
}

async function cancelSalesOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(salesOrders, context.params.id, 'Sales order');
  row.status = 'Cancelled';
  recalcProducts();
  audit('Sales', 'SalesOrder', row.reference, 'Updated', 'status', '', 'Cancelled', current);
  return send(res, 200, { order: row });
}

async function listPurchaseOrders(req, res) {
  requireUser(req);
  return send(res, 200, { orders: purchaseOrders.map(cloneOrder) });
}

async function createPurchaseOrder(req, res, context) {
  const current = requireUser(req);
  const body = await context.readBody();
  const row = { id: counters.purchase++, reference: `PO-${String(counters.purchase).padStart(6, '0')}`, creation_date: today(), status: 'Draft', lines: [] };
  copyOrderFields(row, body, 'purchase');
  purchaseOrders.push(row);
  audit('Purchase', 'PurchaseOrder', row.reference, 'Created', '', '', row.vendor_name, current);
  return send(res, 201, { order: row });
}

async function updatePurchaseOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(purchaseOrders, context.params.id, 'Purchase order');
  copyOrderFields(row, await context.readBody(), 'purchase');
  audit('Purchase', 'PurchaseOrder', row.reference, 'Updated', 'details', '', 'Purchase order updated', current);
  return send(res, 200, { order: row });
}

async function confirmPurchaseOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(purchaseOrders, context.params.id, 'Purchase order');
  row.status = 'Confirmed';
  audit('Purchase', 'PurchaseOrder', row.reference, 'Updated', 'status', 'Draft', 'Confirmed', current);
  return send(res, 200, { order: row });
}

async function receivePurchaseOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(purchaseOrders, context.params.id, 'Purchase order');
  const body = await context.readBody();
  for (const input of body.lines || []) {
    const line = find(row.lines, input.id, 'Purchase line');
    const delta = Math.min(Number(input.received_qty || 0), line.ordered_qty) - Number(line.received_qty || 0);
    if (delta > 0) {
      line.received_qty += delta;
      addLedger(line.product_id, delta, 'PurchaseOrder', row.reference, current);
    }
  }
  row.status = row.lines.every((line) => line.received_qty >= line.ordered_qty) ? 'Fully Received' : 'Partially Received';
  audit('Purchase', 'PurchaseOrder', row.reference, 'Updated', 'status', '', row.status, current);
  return send(res, 200, { order: row });
}

async function cancelPurchaseOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(purchaseOrders, context.params.id, 'Purchase order');
  row.status = 'Cancelled';
  audit('Purchase', 'PurchaseOrder', row.reference, 'Updated', 'status', '', 'Cancelled', current);
  return send(res, 200, { order: row });
}

async function listManufacturingOrders(req, res) {
  requireUser(req);
  return send(res, 200, { orders: manufacturingOrders.map(cloneOrder) });
}

async function createManufacturingOrder(req, res, context) {
  const current = requireUser(req);
  const body = await context.readBody();
  const finished = find(products, body.finished_product_id, 'Product');
  const row = {
    id: counters.manufacturing++,
    reference: `MO-${String(counters.manufacturing).padStart(6, '0')}`,
    finished_product_id: finished.id,
    finished_product_name: finished.product_name,
    bom_id: body.bom_id,
    quantity: body.quantity || 1,
    schedule_date: body.schedule_date || today(),
    assignee_id: body.assignee_id || current.id,
    assignee_name: find(users, body.assignee_id || current.id, 'User').name,
    status: 'Draft',
    components: cloneComponents(body.bom_id, body.quantity || 1),
    operations: cloneOperations(body.bom_id)
  };
  manufacturingOrders.push(row);
  audit('Manufacturing', 'ManufacturingOrder', row.reference, 'Created', '', '', row.finished_product_name, current);
  return send(res, 201, { order: row });
}

async function updateManufacturingOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(manufacturingOrders, context.params.id, 'Manufacturing order');
  Object.assign(row, await context.readBody(), { id: row.id, reference: row.reference });
  audit('Manufacturing', 'ManufacturingOrder', row.reference, 'Updated', 'details', '', 'Manufacturing order updated', current);
  return send(res, 200, { order: row });
}

async function confirmManufacturingOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(manufacturingOrders, context.params.id, 'Manufacturing order');
  row.status = 'Confirmed';
  audit('Manufacturing', 'ManufacturingOrder', row.reference, 'Updated', 'status', 'Draft', 'Confirmed', current);
  return send(res, 200, { order: row });
}

async function startManufacturingOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(manufacturingOrders, context.params.id, 'Manufacturing order');
  row.status = 'In Progress';
  audit('Manufacturing', 'ManufacturingOrder', row.reference, 'Updated', 'status', '', 'In Progress', current);
  return send(res, 200, { order: row });
}

async function produceManufacturingOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(manufacturingOrders, context.params.id, 'Manufacturing order');
  const body = await context.readBody();
  for (const input of body.components || row.components) {
    const component = find(row.components, input.id, 'Component');
    const delta = Math.min(Number(input.consumed_qty || component.to_consume_qty), component.to_consume_qty) - Number(component.consumed_qty || 0);
    if (delta > 0) {
      component.consumed_qty += delta;
      addLedger(component.product_id, -delta, 'ManufacturingOrder', row.reference, current);
    }
  }
  addLedger(row.finished_product_id, row.quantity, 'ManufacturingOrder', row.reference, current);
  row.status = 'Done';
  audit('Manufacturing', 'ManufacturingOrder', row.reference, 'Updated', 'status', '', 'Done', current);
  return send(res, 200, { order: row });
}

async function cancelManufacturingOrder(req, res, context) {
  const current = requireUser(req);
  const row = find(manufacturingOrders, context.params.id, 'Manufacturing order');
  row.status = 'Cancelled';
  audit('Manufacturing', 'ManufacturingOrder', row.reference, 'Updated', 'status', '', 'Cancelled', current);
  return send(res, 200, { order: row });
}

async function stockLedger(req, res) {
  requireUser(req);
  return send(res, 200, { entries: ledgerEntries });
}

async function auditLogs(req, res, context) {
  requireUser(req);
  const module = context.url.searchParams.get('module');
  const record = context.url.searchParams.get('record');
  let rows = logs;
  if (module) rows = rows.filter((log) => log.module === module || log.record_type === module);
  if (record) rows = rows.filter((log) => String(log.record_id).includes(record));
  return send(res, 200, {
    counts: {
      total: rows.length,
      created: rows.filter((log) => log.action === 'Created').length,
      updated: rows.filter((log) => log.action === 'Updated').length,
      deleted: rows.filter((log) => log.action === 'Deleted').length
    },
    logs: rows
  });
}

async function listUsers(req, res) {
  requireUser(req);
  return send(res, 200, { users: users.map(publicUser), permissions });
}

async function createUser(req, res, context) {
  const current = requireUser(req);
  const body = await context.readBody();
  if (users.some((u) => u.email.toLowerCase() === String(body.email || '').toLowerCase())) return send(res, 409, { error: 'User already exists' });
  const row = user(counters.users++, body.name, String(body.email || '').toLowerCase(), body.password || 'welcome123', body.role || 'User', body.position || 'Staff', []);
  users.push(row);
  if (Array.isArray(body.permissions)) {
    permissions.splice(0, permissions.length, ...permissions.filter((p) => p.user_id !== row.id));
    body.permissions.forEach((p) => permissions.push({ user_id: row.id, ...p }));
  }
  saveUsers();
  audit('User', 'User', row.email, 'Created', '', '', row.name, current);
  return send(res, 201, { user: publicUser(row) });
}

async function updateUser(req, res, context) {
  const current = requireUser(req);
  const row = find(users, context.params.id, 'User');
  const body = await context.readBody();
  Object.assign(row, {
    name: body.name || row.name,
    mobile_number: body.mobile_number || row.mobile_number,
    address: body.address || row.address,
    position: body.position || row.position,
    role: body.role || row.role
  });
  if (body.password) row.password = body.password;
  if (Array.isArray(body.permissions)) {
    permissions.splice(0, permissions.length, ...permissions.filter((p) => p.user_id !== row.id));
    body.permissions.forEach((p) => permissions.push({ user_id: row.id, ...p }));
  }
  saveUsers();
  audit('User', 'User', row.email, 'Updated', 'details', '', 'User updated', current);
  return send(res, 200, { user: publicUser(row) });
}

module.exports = {
  health,
  login,
  adminLogin,
  signup,
  forgotPassword,
  me,
  dashboard,
  meta,
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
  listVendors,
  createVendor,
  listBoms,
  createBom,
  updateBom,
  deleteBom,
  listSalesOrders,
  createSalesOrder,
  updateSalesOrder,
  confirmSalesOrder,
  deliverSalesOrder,
  cancelSalesOrder,
  listPurchaseOrders,
  createPurchaseOrder,
  updatePurchaseOrder,
  confirmPurchaseOrder,
  receivePurchaseOrder,
  cancelPurchaseOrder,
  listManufacturingOrders,
  createManufacturingOrder,
  updateManufacturingOrder,
  confirmManufacturingOrder,
  startManufacturingOrder,
  produceManufacturingOrder,
  cancelManufacturingOrder,
  stockLedger,
  auditLogs,
  listUsers,
  createUser,
  updateUser
};
