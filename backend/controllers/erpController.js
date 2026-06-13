const crypto = require('crypto');
const { pool, query } = require('../config/db');

const SECRET = process.env.JWT_SECRET || 'shiv-furniture-dev-secret';
const MODULES = ['Sales', 'Purchase', 'Manufacturing', 'Product', 'BoM', 'Audit', 'User'];

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  if (!stored || !stored.includes(':')) return false;
  const [salt] = stored.split(':');
  return hashPassword(password, salt) === stored;
}

function signToken(user) {
  const payload = Buffer.from(JSON.stringify({
    id: user.id,
    email: user.email,
    role: user.role,
    exp: Date.now() + 1000 * 60 * 60 * 12
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function readToken(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (data.exp < Date.now()) return null;
  return data;
}

async function currentUser(req) {
  const token = readToken(req);
  if (!token) return null;
  const { rows } = await query(
    `select id, name, email, mobile_number, address, position, role, created_at
     from users where id=$1`,
    [token.id]
  );
  return rows[0] || null;
}

async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) fail(401, 'Authentication required');
  return user;
}

async function can(user, module, action) {
  if (user.role === 'Admin') return true;
  const { rows } = await query(
    `select * from user_module_permissions where user_id=$1 and module=$2`,
    [user.id, module]
  );
  const permission = rows[0];
  if (!permission) return false;
  return permission[`can_${action}`] && permission[`can_${action}`] !== 'None';
}

async function requirePermission(req, module, action) {
  const user = await requireUser(req);
  if (!(await can(user, module, action))) fail(403, `${action} access denied for ${module}`);
  return user;
}

async function nextRef(client, prefix) {
  const { rows } = await client.query(
    `insert into reference_sequences(prefix, next_value) values($1, 2)
     on conflict(prefix) do update set next_value = reference_sequences.next_value + 1
     returning next_value - 1 as value`,
    [prefix]
  );
  return `${prefix}-${String(rows[0].value).padStart(6, '0')}`;
}

async function audit(client, user, module, recordType, recordId, action, fieldChanged = null, oldValue = null, newValue = null) {
  await client.query(
    `insert into audit_logs(user_id,module,record_type,record_id,action,field_changed,old_value,new_value)
     values($1,$2,$3,$4,$5,$6,$7,$8)`,
    [user?.id || null, module, recordType, String(recordId), action, fieldChanged, oldValue == null ? null : String(oldValue), newValue == null ? null : String(newValue)]
  );
}

async function auditChanges(client, user, module, recordType, recordId, before, after, fields) {
  for (const field of fields) {
    const oldValue = before?.[field];
    const newValue = after?.[field];
    if (String(oldValue ?? '') !== String(newValue ?? '')) {
      await audit(client, user, module, recordType, recordId, 'Updated', field, oldValue, newValue);
    }
  }
}

async function ledger(client, productId, qty, refType, refId, refNumber) {
  const product = await client.query('select on_hand_qty from products where id=$1 for update', [productId]);
  const current = Number(product.rows[0].on_hand_qty);
  const next = current + Number(qty);
  await client.query('update products set on_hand_qty=$1, updated_at=now() where id=$2', [next, productId]);
  await client.query(
    `insert into stock_ledger(product_id,movement_qty,reference_type,reference_id,reference_number,resulting_on_hand)
     values($1,$2,$3,$4,$5,$6)`,
    [productId, qty, refType, refId, refNumber, next]
  );
}

async function recalcReserved(client) {
  await client.query('update products set reserved_qty=0');
  await client.query(`
    update products p set reserved_qty = p.reserved_qty + x.qty
    from (
      select sol.product_id, sum(greatest(sol.ordered_qty - sol.delivered_qty, 0)) qty
      from sales_order_lines sol join sales_orders so on so.id=sol.sales_order_id
      where so.status in ('Confirmed','Partially Delivered')
      group by sol.product_id
    ) x where p.id=x.product_id
  `);
  await client.query(`
    update products p set reserved_qty = p.reserved_qty + x.qty
    from (
      select mc.product_id, sum(greatest(mc.to_consume_qty - mc.consumed_qty, 0)) qty
      from mo_components mc join manufacturing_orders mo on mo.id=mc.mo_id
      where mo.status in ('Confirmed','In Progress')
      group by mc.product_id
    ) x where p.id=x.product_id
  `);
}

function rowsToItems(rows) {
  return rows.map((row) => ({ ...row, lines: row.lines || [], components: row.components || [], operations: row.operations || [] }));
}

async function health(req, res, ctx) {
  const db = await query('select now() as time');
  ctx.send(200, { ok: true, app: 'Shiv Furniture Works Mini ERP', dbTime: db.rows[0].time });
}

async function loginBase(req, ctx, adminOnly = false) {
  const body = await ctx.readBody();
  const email = String(body.loginId || body.email || '').toLowerCase();
  const password = String(body.password || '');
  const { rows } = await query('select * from users where lower(email)=$1', [email]);
  const user = rows[0];
  if (!user || !verifyPassword(password, user.password_hash)) fail(401, 'Invalid login ID or password');
  if (adminOnly && user.role !== 'Admin') fail(403, 'Administrator access required');
  ctx.send(200, { token: signToken(user), user: publicUser(user) });
}

function publicUser(user) {
  const { password_hash, ...rest } = user;
  return rest;
}

async function login(req, res, ctx) { await loginBase(req, ctx, false); }
async function adminLogin(req, res, ctx) { await loginBase(req, ctx, true); }

async function signup(req, res, ctx) {
  const body = await ctx.readBody();
  if (!body.email || !body.password || body.password !== body.confirmPassword) fail(400, 'Passwords must match and email is required');
  const { rows } = await query(
    `insert into users(name,email,password_hash,role,position,mobile_number,address)
     values($1,$2,$3,'User','Pending Assignment',$4,$5)
     returning id,name,email,mobile_number,address,position,role,created_at`,
    [body.name || body.email, String(body.email).toLowerCase(), hashPassword(body.password), body.mobile_number || '', body.address || '']
  );
  ctx.send(201, { user: rows[0] });
}

async function forgotPassword(req, res, ctx) {
  const body = await ctx.readBody();
  if (!body.email) fail(400, 'Email is required');
  ctx.send(200, { message: 'Password reset noted. Ask the System Administrator to reset this account.' });
}

async function me(req, res, ctx) {
  const user = await requireUser(req);
  const { rows } = await query('select module,can_view,can_create,can_edit,can_delete from user_module_permissions where user_id=$1', [user.id]);
  ctx.send(200, { user, permissions: rows });
}

async function meta(req, res, ctx) {
  await requireUser(req);
  const [products, vendors, boms, users] = await Promise.all([
    query('select *, on_hand_qty-reserved_qty as free_to_use_qty from products order by product_name'),
    query('select * from vendors order by vendor_name'),
    query('select * from bom_summary order by reference'),
    query('select id,name,email,position,role from users order by name')
  ]);
  ctx.send(200, { products: products.rows, vendors: vendors.rows, boms: boms.rows, users: users.rows, modules: MODULES });
}

async function dashboard(req, res, ctx) {
  const user = await requireUser(req);
  const mine = user.id;
  const [sales, purchase, manufacturing, logs] = await Promise.all([
    query(`select status, count(*)::int all_count, count(*) filter(where sales_person_id=$1)::int my_count,
      count(*) filter(where due_date < current_date and status in ('Confirmed','Partially Delivered'))::int late_count
      from sales_orders group by status`, [mine]),
    query(`select status, count(*)::int all_count, count(*) filter(where responsible_person_id=$1)::int my_count,
      count(*) filter(where due_date < current_date and status in ('Confirmed','Partially Received'))::int late_count
      from purchase_orders group by status`, [mine]),
    query(`select status, count(*)::int all_count, count(*) filter(where assignee_id=$1)::int my_count
      from manufacturing_orders group by status`, [mine]),
    query('select count(*)::int total, count(*) filter(where action=$1)::int created, count(*) filter(where action=$2)::int updated, count(*) filter(where action=$3)::int deleted from audit_logs', ['Created', 'Updated', 'Deleted'])
  ]);
  ctx.send(200, { sales: sales.rows, purchase: purchase.rows, manufacturing: manufacturing.rows, logs: logs.rows[0] });
}

async function listProducts(req, res, ctx) {
  await requirePermission(req, 'Product', 'view');
  const { rows } = await query('select *, on_hand_qty-reserved_qty as free_to_use_qty from products order by id');
  ctx.send(200, { products: rows });
}

async function createProduct(req, res, ctx) {
  const user = await requirePermission(req, 'Product', 'create');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    validateProduct(body);
    const ref = await nextRef(client, 'PROD');
    const { rows } = await client.query(
      `insert into products(reference,product_name,sales_price,cost_price,on_hand_qty,procure_on_demand,procurement_type,vendor_id,bom_id,image_url,unit)
       values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [ref, body.product_name, body.sales_price || 0, body.cost_price || 0, body.on_hand_qty || 0, !!body.procure_on_demand, body.procurement_type || null, body.vendor_id || null, body.bom_id || null, body.image_url || null, body.unit || 'Units']
    );
    await audit(client, user, 'Product', 'Product', ref, 'Created');
    await client.query('commit');
    ctx.send(201, { product: rows[0] });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function validateProduct(body) {
  if (!body.product_name) fail(400, 'Product name is required');
  if (body.procure_on_demand && !body.procurement_type) fail(400, 'Procurement Type is required');
  if (body.procure_on_demand && body.procurement_type === 'Purchase' && !body.vendor_id) fail(400, 'Vendor is required');
  if (body.procure_on_demand && body.procurement_type === 'Manufacturing' && !body.bom_id) fail(400, 'BoM is required');
}

async function updateProduct(req, res, ctx) {
  const user = await requirePermission(req, 'Product', 'edit');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    validateProduct(body);
    const before = await one(client, 'select * from products where id=$1 for update', [ctx.params.id]);
    const { rows } = await client.query(
      `update products set product_name=$1,sales_price=$2,cost_price=$3,on_hand_qty=$4,procure_on_demand=$5,procurement_type=$6,vendor_id=$7,bom_id=$8,image_url=$9,unit=$10,updated_at=now()
       where id=$11 returning *`,
      [body.product_name, body.sales_price || 0, body.cost_price || 0, body.on_hand_qty || 0, !!body.procure_on_demand, body.procurement_type || null, body.vendor_id || null, body.bom_id || null, body.image_url || null, body.unit || 'Units', ctx.params.id]
    );
    await auditChanges(client, user, 'Product', 'Product', before.reference, before, rows[0], ['product_name', 'sales_price', 'cost_price', 'on_hand_qty', 'procure_on_demand', 'procurement_type', 'vendor_id', 'bom_id']);
    await client.query('commit');
    ctx.send(200, { product: rows[0] });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteProduct(req, res, ctx) {
  const user = await requirePermission(req, 'Product', 'delete');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const before = await one(client, 'delete from products where id=$1 returning *', [ctx.params.id]);
    await audit(client, user, 'Product', 'Product', before.reference, 'Deleted');
    await client.query('commit');
    ctx.send(200, { deleted: true });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function listVendors(req, res, ctx) {
  await requireUser(req);
  const { rows } = await query('select * from vendors order by vendor_name');
  ctx.send(200, { vendors: rows });
}

async function createVendor(req, res, ctx) {
  const user = await requirePermission(req, 'Purchase', 'create');
  const body = await ctx.readBody();
  if (!body.vendor_name) fail(400, 'Vendor name is required');
  const { rows } = await query(
    'insert into vendors(vendor_name,vendor_address,contact_info) values($1,$2,$3) returning *',
    [body.vendor_name, body.vendor_address || '', body.contact_info || '']
  );
  await audit(pool, user, 'Purchase', 'Vendor', rows[0].id, 'Created');
  ctx.send(201, { vendor: rows[0] });
}

async function listBoms(req, res, ctx) {
  await requirePermission(req, 'BoM', 'view');
  const { rows } = await query('select * from bom_summary order by id');
  ctx.send(200, { boms: rowsToItems(rows) });
}

async function createBom(req, res, ctx) {
  const user = await requirePermission(req, 'BoM', 'create');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    if (!body.finished_product_id || !body.quantity) fail(400, 'Finished Product and Quantity are required');
    if ((body.reference_note || '').length > 8) fail(400, 'Reference note must be 8 characters or fewer');
    const ref = await nextRef(client, 'BOM');
    const bom = await one(client,
      `insert into bills_of_material(reference,finished_product_id,quantity,unit,reference_note)
       values($1,$2,$3,$4,$5) returning *`,
      [ref, body.finished_product_id, body.quantity, body.unit || 'Units', body.reference_note || '']);
    for (const component of body.components || []) {
      await client.query('insert into bom_components(bom_id,component_product_id,to_consume_qty,unit) values($1,$2,$3,$4)', [bom.id, component.component_product_id, component.to_consume_qty, component.unit || 'Units']);
    }
    for (const op of body.operations || []) {
      await client.query('insert into bom_operations(bom_id,operation_name,work_center,expected_duration) values($1,$2,$3,$4)', [bom.id, op.operation_name, op.work_center, op.expected_duration || 0]);
    }
    await audit(client, user, 'BoM', 'BillOfMaterial', ref, 'Created');
    await client.query('commit');
    ctx.send(201, { bom });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function updateBom(req, res, ctx) {
  const user = await requirePermission(req, 'BoM', 'edit');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    if ((body.reference_note || '').length > 8) fail(400, 'Reference note must be 8 characters or fewer');
    const before = await one(client, 'select * from bills_of_material where id=$1 for update', [ctx.params.id]);
    const after = await one(client,
      `update bills_of_material set finished_product_id=$1,quantity=$2,unit=$3,reference_note=$4,updated_at=now()
       where id=$5 returning *`,
      [body.finished_product_id, body.quantity, body.unit || 'Units', body.reference_note || '', ctx.params.id]);
    await client.query('delete from bom_components where bom_id=$1', [ctx.params.id]);
    await client.query('delete from bom_operations where bom_id=$1', [ctx.params.id]);
    for (const component of body.components || []) await client.query('insert into bom_components(bom_id,component_product_id,to_consume_qty,unit) values($1,$2,$3,$4)', [ctx.params.id, component.component_product_id, component.to_consume_qty, component.unit || 'Units']);
    for (const op of body.operations || []) await client.query('insert into bom_operations(bom_id,operation_name,work_center,expected_duration) values($1,$2,$3,$4)', [ctx.params.id, op.operation_name, op.work_center, op.expected_duration || 0]);
    await auditChanges(client, user, 'BoM', 'BillOfMaterial', before.reference, before, after, ['finished_product_id', 'quantity', 'unit', 'reference_note']);
    await client.query('commit');
    ctx.send(200, { bom: after });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deleteBom(req, res, ctx) {
  const user = await requirePermission(req, 'BoM', 'delete');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const bom = await one(client, 'delete from bills_of_material where id=$1 returning *', [ctx.params.id]);
    await audit(client, user, 'BoM', 'BillOfMaterial', bom.reference, 'Deleted');
    await client.query('commit');
    ctx.send(200, { deleted: true });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function listSalesOrders(req, res, ctx) {
  await requirePermission(req, 'Sales', 'view');
  const { rows } = await query('select * from sales_order_summary order by id desc');
  ctx.send(200, { orders: rows });
}

async function createSalesOrder(req, res, ctx) {
  const user = await requirePermission(req, 'Sales', 'create');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const ref = await nextRef(client, 'SO');
    const order = await one(client,
      `insert into sales_orders(reference,customer_name,customer_address,sales_person_id,due_date)
       values($1,$2,$3,$4,$5) returning *`,
      [ref, body.customer_name, body.customer_address, body.sales_person_id || user.id, body.due_date || null]);
    await writeSalesLines(client, order.id, body.lines || []);
    await audit(client, user, 'Sales', 'SalesOrder', ref, 'Created');
    await client.query('commit');
    ctx.send(201, { order });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function updateSalesOrder(req, res, ctx) {
  const user = await requirePermission(req, 'Sales', 'edit');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const before = await one(client, 'select * from sales_orders where id=$1 for update', [ctx.params.id]);
    if (before.status !== 'Draft') fail(409, 'Only Draft Sales Orders can be edited');
    const after = await one(client,
      `update sales_orders set customer_name=$1,customer_address=$2,sales_person_id=$3,due_date=$4,updated_at=now()
       where id=$5 returning *`,
      [body.customer_name, body.customer_address, body.sales_person_id || user.id, body.due_date || null, ctx.params.id]);
    await client.query('delete from sales_order_lines where sales_order_id=$1', [ctx.params.id]);
    await writeSalesLines(client, ctx.params.id, body.lines || []);
    await auditChanges(client, user, 'Sales', 'SalesOrder', before.reference, before, after, ['customer_name', 'customer_address', 'sales_person_id', 'due_date']);
    await client.query('commit');
    ctx.send(200, { order: after });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function writeSalesLines(client, orderId, lines) {
  if (!lines.length) fail(400, 'At least one line is required');
  for (const line of lines) {
    const product = await one(client, 'select * from products where id=$1', [line.product_id]);
    await client.query(
      `insert into sales_order_lines(sales_order_id,product_id,ordered_qty,delivered_qty,unit,sales_unit_price)
       values($1,$2,$3,$4,$5,$6)`,
      [orderId, line.product_id, line.ordered_qty, line.delivered_qty || 0, line.unit || product.unit, line.sales_unit_price ?? product.sales_price]
    );
  }
}

async function confirmSalesOrder(req, res, ctx) {
  const user = await requirePermission(req, 'Sales', 'edit');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const order = await one(client, 'select * from sales_orders where id=$1 for update', [ctx.params.id]);
    if (order.status !== 'Draft') fail(409, 'Only Draft Sales Orders can be confirmed');
    const lines = (await client.query('select * from sales_order_lines where sales_order_id=$1', [order.id])).rows;
    for (const line of lines) {
      const product = await one(client, 'select *, on_hand_qty-reserved_qty as free_to_use_qty from products where id=$1 for update', [line.product_id]);
      const shortage = Number(line.ordered_qty) - Number(product.free_to_use_qty);
      if (shortage > 0 && product.procure_on_demand) {
        if (product.procurement_type === 'Purchase') await autoPurchase(client, user, product, shortage, order.reference);
        if (product.procurement_type === 'Manufacturing') await autoManufacturing(client, user, product, shortage, order.reference);
      } else if (shortage > 0) {
        await audit(client, user, 'Sales', 'SalesOrder', order.reference, 'Status Changed', 'shortage', 0, `${product.product_name}: ${shortage}`);
      }
    }
    await client.query(`update sales_orders set status='Confirmed', updated_at=now() where id=$1`, [order.id]);
    await recalcReserved(client);
    await audit(client, user, 'Sales', 'SalesOrder', order.reference, 'Status Changed', 'status', 'Draft', 'Confirmed');
    await client.query('commit');
    ctx.send(200, { confirmed: true });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function deliverSalesOrder(req, res, ctx) {
  const user = await requirePermission(req, 'Sales', 'edit');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const order = await one(client, 'select * from sales_orders where id=$1 for update', [ctx.params.id]);
    if (!['Confirmed', 'Partially Delivered'].includes(order.status)) fail(409, 'Sales Order is not deliverable');
    const lines = (await client.query('select * from sales_order_lines where sales_order_id=$1 for update', [order.id])).rows;
    for (const line of lines) {
      const requested = Number((body.lines || []).find((x) => Number(x.id) === line.id)?.delivered_qty ?? line.ordered_qty);
      if (requested < Number(line.delivered_qty) || requested > Number(line.ordered_qty)) fail(400, 'Delivered quantity must be between previous and ordered quantity');
      const increment = requested - Number(line.delivered_qty);
      if (increment > 0) await ledger(client, line.product_id, -increment, 'SO', order.id, order.reference);
      await client.query('update sales_order_lines set delivered_qty=$1 where id=$2', [requested, line.id]);
    }
    const nextLines = (await client.query('select * from sales_order_lines where sales_order_id=$1', [order.id])).rows;
    const done = nextLines.every((line) => Number(line.delivered_qty) >= Number(line.ordered_qty));
    const status = done ? 'Fully Delivered' : 'Partially Delivered';
    await client.query('update sales_orders set status=$1, updated_at=now() where id=$2', [status, order.id]);
    await recalcReserved(client);
    await audit(client, user, 'Sales', 'SalesOrder', order.reference, 'Status Changed', 'status', order.status, status);
    await client.query('commit');
    ctx.send(200, { status });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function cancelSalesOrder(req, res, ctx) { await cancelOrder(req, ctx, 'sales_orders', 'Sales', 'SalesOrder'); }

async function listPurchaseOrders(req, res, ctx) {
  await requirePermission(req, 'Purchase', 'view');
  const { rows } = await query('select * from purchase_order_summary order by id desc');
  ctx.send(200, { orders: rows });
}

async function createPurchaseOrder(req, res, ctx) {
  const user = await requirePermission(req, 'Purchase', 'create');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const order = await createPo(client, user, body.vendor_id, body.responsible_person_id || user.id, body.lines || [], body.due_date || null);
    await client.query('commit');
    ctx.send(201, { order });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function createPo(client, user, vendorId, responsibleId, lines, dueDate, sourceNote = null) {
  if (!lines.length) fail(400, 'At least one line is required');
  const vendor = await one(client, 'select * from vendors where id=$1', [vendorId]);
  const ref = await nextRef(client, 'PO');
  const order = await one(client,
    `insert into purchase_orders(reference,vendor_id,vendor_name,vendor_address,responsible_person_id,due_date,source_note)
     values($1,$2,$3,$4,$5,$6,$7) returning *`,
    [ref, vendor.id, vendor.vendor_name, vendor.vendor_address, responsibleId, dueDate, sourceNote]);
  for (const line of lines) {
    const product = await one(client, 'select * from products where id=$1', [line.product_id]);
    await client.query('insert into purchase_order_lines(purchase_order_id,product_id,ordered_qty,received_qty,unit,cost_price) values($1,$2,$3,0,$4,$5)', [order.id, line.product_id, line.ordered_qty, line.unit || product.unit, line.cost_price ?? product.cost_price]);
  }
  await audit(client, user, 'Purchase', 'PurchaseOrder', ref, 'Created', sourceNote ? 'source' : null, null, sourceNote);
  return order;
}

async function updatePurchaseOrder(req, res, ctx) {
  const user = await requirePermission(req, 'Purchase', 'edit');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const before = await one(client, 'select * from purchase_orders where id=$1 for update', [ctx.params.id]);
    if (before.status !== 'Draft') fail(409, 'Only Draft Purchase Orders can be edited');
    const vendor = await one(client, 'select * from vendors where id=$1', [body.vendor_id]);
    const after = await one(client, `update purchase_orders set vendor_id=$1,vendor_name=$2,vendor_address=$3,responsible_person_id=$4,due_date=$5,updated_at=now() where id=$6 returning *`, [vendor.id, vendor.vendor_name, vendor.vendor_address, body.responsible_person_id || user.id, body.due_date || null, ctx.params.id]);
    await client.query('delete from purchase_order_lines where purchase_order_id=$1', [ctx.params.id]);
    for (const line of body.lines || []) {
      const product = await one(client, 'select * from products where id=$1', [line.product_id]);
      await client.query('insert into purchase_order_lines(purchase_order_id,product_id,ordered_qty,received_qty,unit,cost_price) values($1,$2,$3,$4,$5,$6)', [ctx.params.id, line.product_id, line.ordered_qty, line.received_qty || 0, line.unit || product.unit, line.cost_price ?? product.cost_price]);
    }
    await auditChanges(client, user, 'Purchase', 'PurchaseOrder', before.reference, before, after, ['vendor_name', 'vendor_address', 'responsible_person_id', 'due_date']);
    await client.query('commit');
    ctx.send(200, { order: after });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function confirmPurchaseOrder(req, res, ctx) { await setStatus(req, ctx, 'purchase_orders', 'Purchase', 'PurchaseOrder', 'Draft', 'Confirmed'); }

async function receivePurchaseOrder(req, res, ctx) {
  const user = await requirePermission(req, 'Purchase', 'edit');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const order = await one(client, 'select * from purchase_orders where id=$1 for update', [ctx.params.id]);
    if (!['Confirmed', 'Partially Received'].includes(order.status)) fail(409, 'Purchase Order is not receivable');
    const lines = (await client.query('select * from purchase_order_lines where purchase_order_id=$1 for update', [order.id])).rows;
    for (const line of lines) {
      const requested = Number((body.lines || []).find((x) => Number(x.id) === line.id)?.received_qty ?? line.ordered_qty);
      if (requested < Number(line.received_qty) || requested > Number(line.ordered_qty)) fail(400, 'Received quantity must be between previous and ordered quantity');
      const increment = requested - Number(line.received_qty);
      if (increment > 0) await ledger(client, line.product_id, increment, 'PO', order.id, order.reference);
      await client.query('update purchase_order_lines set received_qty=$1 where id=$2', [requested, line.id]);
    }
    const nextLines = (await client.query('select * from purchase_order_lines where purchase_order_id=$1', [order.id])).rows;
    const done = nextLines.every((line) => Number(line.received_qty) >= Number(line.ordered_qty));
    const status = done ? 'Fully Received' : 'Partially Received';
    await client.query('update purchase_orders set status=$1, updated_at=now() where id=$2', [status, order.id]);
    await audit(client, user, 'Purchase', 'PurchaseOrder', order.reference, 'Status Changed', 'status', order.status, status);
    await client.query('commit');
    ctx.send(200, { status });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function cancelPurchaseOrder(req, res, ctx) { await cancelOrder(req, ctx, 'purchase_orders', 'Purchase', 'PurchaseOrder'); }

async function listManufacturingOrders(req, res, ctx) {
  await requirePermission(req, 'Manufacturing', 'view');
  const { rows } = await query('select * from manufacturing_order_summary order by id desc');
  ctx.send(200, { orders: rows });
}

async function createManufacturingOrder(req, res, ctx) {
  const user = await requirePermission(req, 'Manufacturing', 'create');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const order = await createMo(client, user, body.finished_product_id, body.quantity, body.bom_id, body.schedule_date, body.assignee_id || user.id, body.source_note || null);
    await client.query('commit');
    ctx.send(201, { order });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function createMo(client, user, productId, quantity, bomId, scheduleDate, assigneeId, sourceNote = null) {
  if (!productId || !quantity || !bomId) fail(400, 'Finished Product, Quantity and BoM are required');
  const ref = await nextRef(client, 'MO');
  const order = await one(client,
    `insert into manufacturing_orders(reference,finished_product_id,quantity,bom_id,schedule_date,assignee_id,source_note)
     values($1,$2,$3,$4,$5,$6,$7) returning *`,
    [ref, productId, quantity, bomId, scheduleDate || null, assigneeId, sourceNote]);
  await populateMoFromBom(client, order.id, bomId, quantity);
  await audit(client, user, 'Manufacturing', 'ManufacturingOrder', ref, 'Created', sourceNote ? 'source' : null, null, sourceNote);
  return order;
}

async function populateMoFromBom(client, moId, bomId, quantity) {
  const bom = await one(client, 'select * from bills_of_material where id=$1', [bomId]);
  const ratio = Number(quantity) / Number(bom.quantity);
  await client.query('delete from mo_components where mo_id=$1', [moId]);
  await client.query('delete from mo_work_orders where mo_id=$1', [moId]);
  const components = (await client.query('select * from bom_components where bom_id=$1', [bomId])).rows;
  for (const c of components) await client.query('insert into mo_components(mo_id,product_id,to_consume_qty,consumed_qty,unit) values($1,$2,$3,0,$4)', [moId, c.component_product_id, Number(c.to_consume_qty) * ratio, c.unit]);
  const operations = (await client.query('select * from bom_operations where bom_id=$1', [bomId])).rows;
  for (const op of operations) await client.query('insert into mo_work_orders(mo_id,operation_name,work_center,expected_duration,status) values($1,$2,$3,$4,$5)', [moId, op.operation_name, op.work_center, Number(op.expected_duration) * ratio, 'Draft']);
}

async function updateManufacturingOrder(req, res, ctx) {
  const user = await requirePermission(req, 'Manufacturing', 'edit');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const before = await one(client, 'select * from manufacturing_orders where id=$1 for update', [ctx.params.id]);
    if (['Done', 'Cancelled'].includes(before.status)) fail(409, 'Done or Cancelled Manufacturing Orders cannot be edited');
    const after = await one(client, `update manufacturing_orders set finished_product_id=$1,quantity=$2,bom_id=$3,schedule_date=$4,assignee_id=$5,updated_at=now() where id=$6 returning *`, [body.finished_product_id, body.quantity, body.bom_id, body.schedule_date || null, body.assignee_id || user.id, ctx.params.id]);
    if (before.status === 'Draft') await populateMoFromBom(client, ctx.params.id, body.bom_id, body.quantity);
    for (const c of body.components || []) await client.query('update mo_components set consumed_qty=$1 where id=$2 and mo_id=$3', [c.consumed_qty || 0, c.id, ctx.params.id]);
    for (const op of body.operations || []) await client.query('update mo_work_orders set real_duration=$1 where id=$2 and mo_id=$3', [op.real_duration || 0, op.id, ctx.params.id]);
    await auditChanges(client, user, 'Manufacturing', 'ManufacturingOrder', before.reference, before, after, ['finished_product_id', 'quantity', 'bom_id', 'schedule_date', 'assignee_id']);
    await recalcReserved(client);
    await client.query('commit');
    ctx.send(200, { order: after });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function confirmManufacturingOrder(req, res, ctx) {
  const user = await requirePermission(req, 'Manufacturing', 'edit');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const order = await one(client, 'select * from manufacturing_orders where id=$1 for update', [ctx.params.id]);
    if (order.status !== 'Draft') fail(409, 'Only Draft Manufacturing Orders can be confirmed');
    await client.query(`update manufacturing_orders set status='Confirmed', updated_at=now() where id=$1`, [order.id]);
    await client.query(`update mo_work_orders set status='Confirmed' where mo_id=$1`, [order.id]);
    await recalcReserved(client);
    await audit(client, user, 'Manufacturing', 'ManufacturingOrder', order.reference, 'Status Changed', 'status', 'Draft', 'Confirmed');
    await client.query('commit');
    ctx.send(200, { confirmed: true });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function startManufacturingOrder(req, res, ctx) { await setStatus(req, ctx, 'manufacturing_orders', 'Manufacturing', 'ManufacturingOrder', 'Confirmed', 'In Progress'); }

async function produceManufacturingOrder(req, res, ctx) {
  const user = await requirePermission(req, 'Manufacturing', 'edit');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const order = await one(client, 'select * from manufacturing_orders where id=$1 for update', [ctx.params.id]);
    if (!['Confirmed', 'In Progress'].includes(order.status)) fail(409, 'Manufacturing Order is not producible');
    for (const c of body.components || []) await client.query('update mo_components set consumed_qty=$1 where id=$2 and mo_id=$3', [c.consumed_qty || 0, c.id, order.id]);
    const components = (await client.query('select * from mo_components where mo_id=$1 for update', [order.id])).rows;
    await ledger(client, order.finished_product_id, Number(order.quantity), 'MO', order.id, order.reference);
    for (const c of components) {
      const consumed = Number(c.consumed_qty) || Number(c.to_consume_qty);
      await client.query('update mo_components set consumed_qty=$1 where id=$2', [consumed, c.id]);
      await ledger(client, c.product_id, -consumed, 'MO', order.id, order.reference);
    }
    await client.query(`update manufacturing_orders set status='Done', updated_at=now() where id=$1`, [order.id]);
    await client.query(`update mo_work_orders set status='Done' where mo_id=$1`, [order.id]);
    await recalcReserved(client);
    await audit(client, user, 'Manufacturing', 'ManufacturingOrder', order.reference, 'Status Changed', 'status', order.status, 'Done');
    await client.query('commit');
    ctx.send(200, { status: 'Done' });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function cancelManufacturingOrder(req, res, ctx) {
  await cancelOrder(req, ctx, 'manufacturing_orders', 'Manufacturing', 'ManufacturingOrder', true);
}

async function autoPurchase(client, user, product, shortage, source) {
  await createPo(client, user, product.vendor_id, user.id, [{ product_id: product.id, ordered_qty: shortage }], null, `Auto from ${source}`);
}

async function autoManufacturing(client, user, product, shortage, source) {
  await createMo(client, user, product.id, shortage, product.bom_id, null, user.id, `Auto from ${source}`);
}

async function setStatus(req, ctx, table, module, recordType, fromStatus, toStatus) {
  const user = await requirePermission(req, module, 'edit');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const row = await one(client, `select * from ${table} where id=$1 for update`, [ctx.params.id]);
    if (row.status !== fromStatus) fail(409, `${recordType} must be ${fromStatus}`);
    await client.query(`update ${table} set status=$1, updated_at=now() where id=$2`, [toStatus, row.id]);
    await audit(client, user, module, recordType, row.reference, 'Status Changed', 'status', fromStatus, toStatus);
    if (table === 'manufacturing_orders') await recalcReserved(client);
    await client.query('commit');
    ctx.send(200, { status: toStatus });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function cancelOrder(req, ctx, table, module, recordType, recalc = false) {
  const user = await requirePermission(req, module, 'edit');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const row = await one(client, `select * from ${table} where id=$1 for update`, [ctx.params.id]);
    if (['Fully Delivered', 'Fully Received', 'Done', 'Cancelled'].includes(row.status)) fail(409, 'Completed orders cannot be cancelled');
    await client.query(`update ${table} set status='Cancelled', updated_at=now() where id=$1`, [row.id]);
    if (recalc || table === 'sales_orders') await recalcReserved(client);
    await audit(client, user, module, recordType, row.reference, 'Status Changed', 'status', row.status, 'Cancelled');
    await client.query('commit');
    ctx.send(200, { status: 'Cancelled' });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function stockLedger(req, res, ctx) {
  await requirePermission(req, 'Product', 'view');
  const { rows } = await query(`select sl.*, p.product_name from stock_ledger sl join products p on p.id=sl.product_id order by sl.movement_date desc, sl.id desc limit 300`);
  ctx.send(200, { entries: rows });
}

async function auditLogs(req, res, ctx) {
  const user = await requirePermission(req, 'Audit', 'view');
  const module = ctx.url.searchParams.get('module');
  const action = ctx.url.searchParams.get('action');
  const record = ctx.url.searchParams.get('record');
  const params = [];
  const where = [];
  if (module) { params.push(module); where.push(`module=$${params.length}`); }
  if (action) { params.push(action); where.push(`action=$${params.length}`); }
  if (record) { params.push(record); where.push(`record_id=$${params.length}`); }
  const sql = `select al.*, u.name as user_name from audit_logs al left join users u on u.id=al.user_id ${where.length ? `where ${where.join(' and ')}` : ''} order by date_time desc limit 500`;
  const rows = await query(sql, params);
  const counts = await query(`select count(*)::int total, count(*) filter(where action='Created')::int created, count(*) filter(where action='Updated')::int updated, count(*) filter(where action='Deleted')::int deleted from audit_logs`);
  ctx.send(200, { logs: rows.rows, counts: counts.rows[0], user });
}

async function listUsers(req, res, ctx) {
  await requirePermission(req, 'User', 'view');
  const users = await query('select id,name,email,mobile_number,address,position,role,created_at from users order by id');
  const permissions = await query('select * from user_module_permissions order by user_id,module');
  ctx.send(200, { users: users.rows, permissions: permissions.rows });
}

async function createUser(req, res, ctx) {
  const admin = await requirePermission(req, 'User', 'create');
  if (admin.role !== 'Admin') fail(403, 'Only Admin can create users');
  const body = await ctx.readBody();
  const client = await pool.connect();
  try {
    await client.query('begin');
    const user = await one(client,
      `insert into users(name,email,password_hash,mobile_number,address,position,role) values($1,$2,$3,$4,$5,$6,$7)
       returning id,name,email,mobile_number,address,position,role,created_at`,
      [body.name, String(body.email).toLowerCase(), hashPassword(body.password || 'password123'), body.mobile_number || '', body.address || '', body.position || '', body.role || 'User']);
    await writePermissions(client, user.id, body.permissions || []);
    await audit(client, admin, 'User', 'User', user.email, 'Created');
    await client.query('commit');
    ctx.send(201, { user });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function updateUser(req, res, ctx) {
  const actor = await requireUser(req);
  const body = await ctx.readBody();
  const targetId = Number(ctx.params.id);
  const isSelf = actor.id === targetId;
  if (!isSelf && !(await can(actor, 'User', 'edit'))) fail(403, 'User edit access denied');
  const client = await pool.connect();
  try {
    await client.query('begin');
    const before = await one(client, 'select * from users where id=$1 for update', [targetId]);
    const position = actor.role === 'Admin' ? (body.position ?? before.position) : before.position;
    const role = actor.role === 'Admin' ? (body.role ?? before.role) : before.role;
    const after = await one(client,
      `update users set name=$1,mobile_number=$2,address=$3,position=$4,role=$5 where id=$6
       returning id,name,email,mobile_number,address,position,role,created_at`,
      [body.name ?? before.name, body.mobile_number ?? before.mobile_number, body.address ?? before.address, position, role, targetId]);
    if (actor.role === 'Admin' && body.permissions) await writePermissions(client, targetId, body.permissions);
    await auditChanges(client, actor, 'User', 'User', before.email, before, after, ['name', 'mobile_number', 'address', 'position', 'role']);
    await client.query('commit');
    ctx.send(200, { user: after });
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function writePermissions(client, userId, permissions) {
  await client.query('delete from user_module_permissions where user_id=$1', [userId]);
  for (const module of MODULES) {
    const incoming = permissions.find((p) => p.module === module) || {};
    await client.query(
      `insert into user_module_permissions(user_id,module,can_view,can_create,can_edit,can_delete)
       values($1,$2,$3,$4,$5,$6)`,
      [userId, module, incoming.can_view || 'None', incoming.can_create || 'None', incoming.can_edit || 'None', incoming.can_delete || 'None']
    );
  }
}

async function one(client, sql, params) {
  const { rows } = await client.query(sql, params);
  if (!rows[0]) fail(404, 'Record not found');
  return rows[0];
}

module.exports = {
  health, login, adminLogin, signup, forgotPassword, me, dashboard, meta,
  listProducts, createProduct, updateProduct, deleteProduct,
  listVendors, createVendor, listBoms, createBom, updateBom, deleteBom,
  listSalesOrders, createSalesOrder, updateSalesOrder, confirmSalesOrder, deliverSalesOrder, cancelSalesOrder,
  listPurchaseOrders, createPurchaseOrder, updatePurchaseOrder, confirmPurchaseOrder, receivePurchaseOrder, cancelPurchaseOrder,
  listManufacturingOrders, createManufacturingOrder, updateManufacturingOrder, confirmManufacturingOrder, startManufacturingOrder, produceManufacturingOrder, cancelManufacturingOrder,
  stockLedger, auditLogs, listUsers, createUser, updateUser
};
