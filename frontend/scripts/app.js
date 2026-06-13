const state = {
  token: localStorage.getItem('shiv_token'),
  user: null,
  permissions: [],
  meta: { products: [], vendors: [], boms: [], users: [] },
  view: 'dashboard',
  cache: {}
};

const views = [
  ['dashboard', 'Dashboard', 'Dashboard'],
  ['sales', 'Sale Orders', 'Sales'],
  ['purchase', 'Purchase Orders', 'Purchase'],
  ['manufacturing', 'Manufacturing Orders', 'Manufacturing'],
  ['boms', 'Bills of Materials', 'BoM'],
  ['products', 'Products', 'Product'],
  ['stock', 'Stock Ledger', 'Product'],
  ['audit', 'Audit Logs', 'Audit'],
  ['users', 'User Management', 'User']
];

const $ = (selector) => document.querySelector(selector);
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'class') node.className = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value);
  });
  children.forEach((child) => node.append(child?.nodeType ? child : document.createTextNode(child ?? '')));
  return node;
};

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      ...(options.headers || {})
    }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(message, ok = false) {
  const box = $('#toast');
  box.textContent = message;
  box.className = `toast ${ok ? 'ok' : ''}`;
  setTimeout(() => box.classList.add('hidden'), 3200);
}

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function money(value) { return `Rs ${Number(value || 0).toLocaleString('en-IN')}`; }
function qty(value) { return Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 }); }
function badge(text) { return `<span class="badge ${String(text).split(' ')[0]}">${text}</span>`; }

function can(module, action = 'view') {
  if (!state.user) return false;
  if (state.user.role === 'Admin') return true;
  const p = state.permissions.find((x) => x.module === module);
  return !!p && p[`can_${action}`] !== 'None';
}

async function boot() {
  bindAuth();
  $('#sidebar').classList.add('hidden');
  $('#app').classList.add('hidden');
  if (!state.token) return showAuth();
  try {
    const me = await api('/api/auth/me');
    state.user = me.user;
    state.permissions = me.permissions;
    await loadMeta();
    showApp();
    await render();
  } catch {
    localStorage.removeItem('shiv_token');
    state.token = null;
    showAuth();
  }
}

function bindAuth() {
  document.querySelectorAll('[data-auth-tab]').forEach((btn) => btn.addEventListener('click', () => {
    document.querySelectorAll('[data-auth-tab]').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.auth-pane').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $(`#${btn.dataset.authTab}`).classList.add('active');
  }));
  $('#userLogin').addEventListener('submit', (event) => doLogin(event, '/api/auth/login'));
  $('#adminLogin').addEventListener('submit', (event) => doLogin(event, '/api/auth/admin-login'));
  $('#signup').addEventListener('submit', signup);
  $('#forgotBtn').addEventListener('click', async () => {
    const email = $('#userLogin [name=loginId]').value;
    const data = await api('/api/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
    toast(data.message, true);
  });
  $('#logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('shiv_token');
    location.reload();
  });
  $('#refreshBtn').addEventListener('click', () => render());
  $('#newBtn').addEventListener('click', () => openNew());
}

async function doLogin(event, endpoint) {
  event.preventDefault();
  try {
    const data = await api(endpoint, { method: 'POST', body: JSON.stringify(formData(event.target)) });
    state.token = data.token;
    localStorage.setItem('shiv_token', data.token);
    await boot();
  } catch (error) {
    toast(error.message);
  }
}

async function signup(event) {
  event.preventDefault();
  try {
    const data = formData(event.target);
    await api('/api/auth/signup', { method: 'POST', body: JSON.stringify(data) });
    toast('Signup complete. Admin permissions are required before module access.', true);
  } catch (error) {
    toast(error.message);
  }
}

function showAuth() {
  $('#authScreen').classList.remove('hidden');
  $('#sidebar').classList.add('hidden');
  $('#app').classList.add('hidden');
}

function showApp() {
  $('#authScreen').classList.add('hidden');
  $('#sidebar').classList.remove('hidden');
  $('#app').classList.remove('hidden');
  $('#userLabel').textContent = `${state.user.name} · ${state.user.position || state.user.role}`;
  const nav = $('#nav');
  nav.innerHTML = '';
  views.filter(([, , module]) => module === 'Dashboard' || can(module)).forEach(([id, label]) => {
    nav.append(el('button', { class: `nav-btn ${state.view === id ? 'active' : ''}`, onclick: () => { state.view = id; render(); } }, [label]));
  });
}

async function loadMeta() {
  state.meta = await api('/api/meta');
}

async function render() {
  await loadMeta();
  showApp();
  const def = views.find(([id]) => id === state.view) || views[0];
  $('#title').textContent = def[1];
  $('#crumb').textContent = def[1];
  $('#newBtn').style.display = ['dashboard', 'stock', 'audit'].includes(state.view) ? 'none' : '';
  const content = $('#content');
  content.innerHTML = '';
  try {
    if (state.view === 'dashboard') await renderDashboard(content);
    if (state.view === 'products') await renderProducts(content);
    if (state.view === 'boms') await renderBoms(content);
    if (state.view === 'sales') await renderOrders(content, 'sales');
    if (state.view === 'purchase') await renderOrders(content, 'purchase');
    if (state.view === 'manufacturing') await renderOrders(content, 'manufacturing');
    if (state.view === 'stock') await renderStock(content);
    if (state.view === 'audit') await renderAudit(content);
    if (state.view === 'users') await renderUsers(content);
  } catch (error) {
    content.append(el('section', { class: 'panel' }, [`Unable to load this view: ${error.message}`]));
  }
}

async function renderDashboard(root) {
  const data = await api('/api/dashboard');
  const statusTotal = (rows) => rows.reduce((sum, row) => sum + Number(row.all_count || 0), 0);
  root.append(el('div', { class: 'grid stats' }, [
    stat('Sales Orders', statusTotal(data.sales)),
    stat('Purchase Orders', statusTotal(data.purchase)),
    stat('Manufacturing Orders', statusTotal(data.manufacturing)),
    stat('Audit Logs', data.logs.total)
  ]));
  root.append(statusPanel('Sale Orders', data.sales, ['Draft', 'Confirmed', 'Partially Delivered', 'Fully Delivered']));
  root.append(statusPanel('Purchase Orders', data.purchase, ['Draft', 'Confirmed', 'Partially Received', 'Fully Received']));
  root.append(statusPanel('Manufacturing Orders', data.manufacturing, ['Draft', 'Confirmed', 'In Progress', 'Done']));
}

function stat(label, value) {
  return el('article', { class: 'stat' }, [el('span', {}, [label]), el('strong', {}, [String(value || 0)])]);
}

function statusPanel(title, rows, statuses) {
  const by = Object.fromEntries(rows.map((r) => [r.status, r]));
  return el('section', { class: 'panel' }, [
    el('div', { class: 'panel-head' }, [el('h2', {}, [title]), el('span', { class: 'muted' }, ['All / My / Late'])]),
    table(['Status', 'All', 'My', 'Late'], statuses.map((s) => [
      badge(s), by[s]?.all_count || 0, by[s]?.my_count || 0, by[s]?.late_count || 0
    ]))
  ]);
}

async function renderProducts(root) {
  const data = await api('/api/products');
  root.append(toolbar('Search products', 'productSearch'));
  root.append(el('section', { class: 'panel' }, [
    table(['Reference', 'Product', 'Sales', 'Cost', 'On Hand', 'Reserved', 'Free', 'Procurement', 'Actions'],
      data.products.map((p) => [
        p.reference, p.product_name, money(p.sales_price), money(p.cost_price), qty(p.on_hand_qty), qty(p.reserved_qty), qty(p.free_to_use_qty),
        p.procure_on_demand ? `${p.procurement_type}` : 'MTS',
        actions([['Edit', () => productForm(p)], ['Logs', () => openLogs('Product', p.reference)]])
      ]))
  ]));
}

async function renderBoms(root) {
  const data = await api('/api/boms');
  root.append(toolbar('Search BoMs', 'bomSearch'));
  root.append(el('section', { class: 'panel' }, [
    table(['Reference', 'Finished Product', 'Quantity', 'Components', 'Operations', 'Actions'],
      data.boms.map((b) => [
        b.reference, b.finished_product_name, qty(b.quantity),
        b.components.map((c) => `${c.component_name} x ${qty(c.to_consume_qty)}`).join(', '),
        b.operations.map((o) => `${o.operation_name} ${qty(o.expected_duration)}m`).join(', '),
        actions([['Edit', () => bomForm(b)], ['Logs', () => openLogs('BoM', b.reference)]])
      ]))
  ]));
}

async function renderOrders(root, type) {
  const map = {
    sales: { endpoint: '/api/sales-orders', key: 'orders', module: 'Sales', ref: 'SalesOrder' },
    purchase: { endpoint: '/api/purchase-orders', key: 'orders', module: 'Purchase', ref: 'PurchaseOrder' },
    manufacturing: { endpoint: '/api/manufacturing-orders', key: 'orders', module: 'Manufacturing', ref: 'ManufacturingOrder' }
  }[type];
  const data = await api(map.endpoint);
  root.append(toolbar('Search reference, party, product', `${type}Search`, true));
  const headers = type === 'manufacturing'
    ? ['Reference', 'Product', 'Qty', 'Schedule', 'Assignee', 'Status', 'Actions']
    : ['Reference', type === 'sales' ? 'Customer' : 'Vendor', 'Date', 'Owner', 'Status', 'Lines', 'Actions'];
  const rows = data.orders.map((o) => type === 'manufacturing'
    ? [o.reference, o.finished_product_name, qty(o.quantity), o.schedule_date || '', o.assignee_name || '', badge(o.status), orderActions(type, o)]
    : [o.reference, type === 'sales' ? o.customer_name : o.vendor_name, o.creation_date, type === 'sales' ? o.sales_person_name : o.responsible_person_name, badge(o.status), lineSummary(o.lines), orderActions(type, o)]);
  root.append(el('section', { class: 'panel' }, [table(headers, rows)]));
}

function lineSummary(lines) {
  return (lines || []).map((l) => `${l.product_name} ${qty(l.ordered_qty || l.to_consume_qty)} ${l.availability ? badge(l.availability) : ''}`).join('<br>');
}

function orderActions(type, order) {
  const actionsList = [['Edit', () => orderForm(type, order)], ['Logs', () => openLogs(type === 'sales' ? 'Sales' : type === 'purchase' ? 'Purchase' : 'Manufacturing', order.reference)]];
  if (order.status === 'Draft') actionsList.push(['Confirm', () => workflow(type, order.id, 'confirm')]);
  if (type === 'sales' && ['Confirmed', 'Partially Delivered'].includes(order.status)) actionsList.push(['Deliver', () => deliverForm(order)]);
  if (type === 'purchase' && ['Confirmed', 'Partially Received'].includes(order.status)) actionsList.push(['Receive', () => receiveForm(order)]);
  if (type === 'manufacturing' && order.status === 'Confirmed') actionsList.push(['Start', () => workflow(type, order.id, 'start')]);
  if (type === 'manufacturing' && ['Confirmed', 'In Progress'].includes(order.status)) actionsList.push(['Produce', () => produceForm(order)]);
  if (!['Fully Delivered', 'Fully Received', 'Done', 'Cancelled'].includes(order.status)) actionsList.push(['Cancel', () => workflow(type, order.id, 'cancel')]);
  return actions(actionsList);
}

async function workflow(type, id, action, body = {}) {
  const base = { sales: 'sales-orders', purchase: 'purchase-orders', manufacturing: 'manufacturing-orders' }[type];
  try {
    await api(`/api/${base}/${id}/${action}`, { method: 'POST', body: JSON.stringify(body) });
    toast(`${action} completed`, true);
    await render();
  } catch (error) {
    toast(error.message);
  }
}

async function renderStock(root) {
  const data = await api('/api/stock-ledger');
  root.append(el('section', { class: 'panel' }, [
    table(['Date', 'Product', 'Qty', 'Reference', 'Resulting On Hand'],
      data.entries.map((e) => [new Date(e.movement_date).toLocaleString(), e.product_name, qty(e.movement_qty), `${e.reference_type} ${e.reference_number}`, qty(e.resulting_on_hand)]))
  ]));
}

async function renderAudit(root, module = '', record = '') {
  const query = new URLSearchParams();
  if (module) query.set('module', module);
  if (record) query.set('record', record);
  const data = await api(`/api/audit-logs?${query}`);
  root.append(el('div', { class: 'grid stats' }, [
    stat('Total Logs', data.counts.total), stat('Create Actions', data.counts.created), stat('Update Actions', data.counts.updated), stat('Delete Actions', data.counts.deleted)
  ]));
  root.append(el('section', { class: 'panel' }, [
    table(['Date & Time', 'User', 'Module', 'Record', 'Action', 'Field', 'Old', 'New'],
      data.logs.map((l) => [new Date(l.date_time).toLocaleString(), l.user_name || 'System', l.module, `${l.record_type} ${l.record_id}`, badge(l.action), l.field_changed || '', l.old_value || '', l.new_value || '']))
  ]));
}

async function renderUsers(root) {
  const data = await api('/api/users');
  const permsByUser = Object.groupBy ? Object.groupBy(data.permissions, (p) => p.user_id) : data.permissions.reduce((a, p) => ((a[p.user_id] ||= []).push(p), a), {});
  root.append(el('section', { class: 'panel' }, [
    table(['Name', 'Email', 'Position', 'Role', 'Actions'],
      data.users.map((u) => [u.name, u.email, u.position, u.role, actions([['Edit', () => userForm(u, permsByUser[u.id] || [])]])]))
  ]));
}

function openNew() {
  if (state.view === 'products') productForm();
  if (state.view === 'boms') bomForm();
  if (['sales', 'purchase', 'manufacturing'].includes(state.view)) orderForm(state.view);
  if (state.view === 'users') userForm();
}

function productForm(product = {}) {
  const body = el('form', { class: 'form-grid' });
  body.innerHTML = `
    <div class="three">
      ${input('product_name','Product',product.product_name)}
      ${input('sales_price','Sales Price',product.sales_price,'number')}
      ${input('cost_price','Cost Price',product.cost_price,'number')}
    </div>
    <div class="three">
      ${input('on_hand_qty','On Hand Qty',product.on_hand_qty || 0,'number')}
      ${input('unit','Unit',product.unit || 'Units')}
      <label>Procure on Demand<select name="procure_on_demand"><option value="false">No</option><option value="true" ${product.procure_on_demand ? 'selected' : ''}>Yes</option></select></label>
    </div>
    <div class="three">
      <label>Procurement Type${select('procurement_type', ['', 'Purchase', 'Manufacturing'], product.procurement_type || '')}</label>
      <label>Vendor${selectRows('vendor_id', state.meta.vendors, 'vendor_name', product.vendor_id)}</label>
      <label>BoM${selectRows('bom_id', state.meta.boms, 'reference', product.bom_id, (b) => `${b.reference} · ${b.finished_product_name}`)}</label>
    </div>
    <button>Save Product</button>`;
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = normalize(formData(body));
    try {
      await api(product.id ? `/api/products/${product.id}` : '/api/products', { method: product.id ? 'PUT' : 'POST', body: JSON.stringify(data) });
      closeModal();
      toast('Product saved', true);
      await render();
    } catch (error) { toast(error.message); }
  });
  openModal(product.id ? 'Edit Product' : 'New Product', body);
}

function bomForm(bom = {}) {
  const body = el('form', { class: 'form-grid' });
  const components = bom.components?.length ? bom.components : [{}];
  const operations = bom.operations?.length ? bom.operations : [{}];
  body.innerHTML = `
    <div class="three">
      <label>Finished Product${selectRows('finished_product_id', state.meta.products, 'product_name', bom.finished_product_id)}</label>
      ${input('quantity','Quantity',bom.quantity || 1,'number')}
      ${input('reference_note','Reference Note (8 chars)',bom.reference_note || '')}
    </div>
    <h3>Components</h3><div id="componentLines" class="line-editor"></div><button type="button" id="addComponent" class="secondary">Add Component</button>
    <h3>Operations</h3><div id="operationLines" class="line-editor"></div><button type="button" id="addOperation" class="secondary">Add Operation</button>
    <button>Save BoM</button>`;
  const componentLines = body.querySelector('#componentLines');
  const operationLines = body.querySelector('#operationLines');
  const addComponent = (row = {}) => componentLines.append(lineRow('component-row', [
    `<label>Component${selectRows('component_product_id', state.meta.products, 'product_name', row.component_product_id)}</label>`,
    input('to_consume_qty', 'To Consume', row.to_consume_qty || 1, 'number'),
    input('unit', 'Unit', row.unit || 'Units'),
    '<span></span>'
  ]));
  const addOperation = (row = {}) => operationLines.append(lineRow('operation-row', [
    input('operation_name', 'Operation', row.operation_name || ''),
    input('work_center', 'Work Center', row.work_center || ''),
    input('expected_duration', 'Expected Min', row.expected_duration || 0, 'number'),
    '<span></span>'
  ]));
  components.forEach(addComponent);
  operations.forEach(addOperation);
  body.querySelector('#addComponent').onclick = () => addComponent();
  body.querySelector('#addOperation').onclick = () => addOperation();
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = normalize(formData(body));
    data.components = collectRows(componentLines);
    data.operations = collectRows(operationLines);
    try {
      await api(bom.id ? `/api/boms/${bom.id}` : '/api/boms', { method: bom.id ? 'PUT' : 'POST', body: JSON.stringify(data) });
      closeModal();
      toast('BoM saved', true);
      await render();
    } catch (error) { toast(error.message); }
  });
  openModal(bom.id ? 'Edit Bill of Materials' : 'New Bill of Materials', body);
}

function orderForm(type, order = {}) {
  if (type === 'sales') return salesForm(order);
  if (type === 'purchase') return purchaseForm(order);
  return manufacturingForm(order);
}

function salesForm(order = {}) {
  const body = baseOrderForm('Sales Order', order, `
    <div class="three">
      ${input('customer_name','Customer',order.customer_name)}
      ${input('customer_address','Customer Address',order.customer_address)}
      <label>Sales Person${selectRows('sales_person_id', state.meta.users, 'name', order.sales_person_id || state.user.id)}</label>
    </div>
    <div class="split">${input('due_date','Due Date',dateOnly(order.due_date),'date')}</div>`);
  mountProductLines(body, order.lines, 'sales');
  submitOrder(body, order, 'sales-orders', (data) => data);
}

function purchaseForm(order = {}) {
  const body = baseOrderForm('Purchase Order', order, `
    <div class="three">
      <label>Vendor${selectRows('vendor_id', state.meta.vendors, 'vendor_name', order.vendor_id)}</label>
      <label>Responsible Person${selectRows('responsible_person_id', state.meta.users, 'name', order.responsible_person_id || state.user.id)}</label>
      ${input('due_date','Due Date',dateOnly(order.due_date),'date')}
    </div>`);
  mountProductLines(body, order.lines, 'purchase');
  submitOrder(body, order, 'purchase-orders', (data) => data);
}

function manufacturingForm(order = {}) {
  const body = el('form', { class: 'form-grid' });
  body.innerHTML = `
    <div class="three">
      <label>Finished Product${selectRows('finished_product_id', state.meta.products, 'product_name', order.finished_product_id)}</label>
      ${input('quantity','Quantity',order.quantity || 1,'number')}
      <label>BoM${selectRows('bom_id', state.meta.boms, 'reference', order.bom_id, (b) => `${b.reference} · ${b.finished_product_name}`)}</label>
    </div>
    <div class="split">
      ${input('schedule_date','Schedule Date',dateOnly(order.schedule_date),'date')}
      <label>Assignee${selectRows('assignee_id', state.meta.users, 'name', order.assignee_id || state.user.id)}</label>
    </div>
    <h3>Components</h3><div>${lineSummary(order.components || []) || '<span class="muted">Components populate from BoM.</span>'}</div>
    <h3>Work Orders</h3><div>${(order.operations || []).map((o) => `${o.operation_name} · ${o.work_center} · ${qty(o.expected_duration)} min`).join('<br>') || '<span class="muted">Operations populate from BoM.</span>'}</div>
    <button>Save Manufacturing Order</button>`;
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api(order.id ? `/api/manufacturing-orders/${order.id}` : '/api/manufacturing-orders', { method: order.id ? 'PUT' : 'POST', body: JSON.stringify(normalize(formData(body))) });
      closeModal();
      toast('Manufacturing Order saved', true);
      await render();
    } catch (error) { toast(error.message); }
  });
  openModal(order.id ? 'Edit Manufacturing Order' : 'New Manufacturing Order', body);
}

function baseOrderForm(title, order, topHtml) {
  const body = el('form', { class: 'form-grid' });
  body.innerHTML = `${topHtml}<h3>Lines</h3><div id="productLines" class="line-editor"></div><button type="button" id="addLine" class="secondary">Add Line</button><button>Save ${title}</button>`;
  openModal(order.id ? `Edit ${title}` : `New ${title}`, body);
  return body;
}

function mountProductLines(body, lines = [], type) {
  const wrap = body.querySelector('#productLines');
  const add = (row = {}) => wrap.append(lineRow('line-row', [
    `<label>Product${selectRows('product_id', state.meta.products, 'product_name', row.product_id)}</label>`,
    input('ordered_qty', type === 'purchase' ? 'Ordered' : 'Ordered', row.ordered_qty || 1, 'number'),
    input(type === 'purchase' ? 'received_qty' : 'delivered_qty', type === 'purchase' ? 'Received' : 'Delivered', row.received_qty || row.delivered_qty || 0, 'number'),
    input(type === 'purchase' ? 'cost_price' : 'sales_unit_price', type === 'purchase' ? 'Cost' : 'Sales Price', row.cost_price || row.sales_unit_price || '', 'number')
  ]));
  (lines?.length ? lines : [{}]).forEach(add);
  body.querySelector('#addLine').onclick = () => add();
}

function submitOrder(body, order, endpoint) {
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = normalize(formData(body));
    data.lines = collectRows(body.querySelector('#productLines'));
    try {
      await api(order.id ? `/api/${endpoint}/${order.id}` : `/api/${endpoint}`, { method: order.id ? 'PUT' : 'POST', body: JSON.stringify(data) });
      closeModal();
      toast('Order saved', true);
      await render();
    } catch (error) { toast(error.message); }
  });
}

function deliverForm(order) {
  quantityWorkflowForm('Deliver Sales Order', order, 'delivered_qty', (lines) => workflow('sales', order.id, 'deliver', { lines }));
}

function receiveForm(order) {
  quantityWorkflowForm('Receive Purchase Order', order, 'received_qty', (lines) => workflow('purchase', order.id, 'receive', { lines }));
}

function produceForm(order) {
  const body = el('form', { class: 'form-grid' });
  body.innerHTML = `<p class="muted">Confirm consumed quantities before producing ${order.reference}.</p><div id="componentLines"></div><button>Produce</button>`;
  const wrap = body.querySelector('#componentLines');
  (order.components || []).forEach((c) => wrap.append(lineRow('component-row', [
    `<strong>${c.product_name}</strong>`,
    `<span>To consume ${qty(c.to_consume_qty)}</span>`,
    input('consumed_qty', 'Consumed Qty', c.consumed_qty || c.to_consume_qty, 'number') + `<input type="hidden" name="id" value="${c.id}">`,
    '<span></span>'
  ])));
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    closeModal();
    await workflow('manufacturing', order.id, 'produce', { components: collectRows(wrap) });
  });
  openModal('Produce Manufacturing Order', body);
}

function quantityWorkflowForm(title, order, field, onSubmit) {
  const body = el('form', { class: 'form-grid' });
  body.innerHTML = `<div id="qtyLines" class="line-editor"></div><button>${title}</button>`;
  const wrap = body.querySelector('#qtyLines');
  (order.lines || []).forEach((l) => wrap.append(lineRow('line-row', [
    `<strong>${l.product_name}</strong>`,
    `<span>Ordered ${qty(l.ordered_qty)}</span>`,
    input(field, field.replace('_', ' '), l[field] || l.ordered_qty, 'number') + `<input type="hidden" name="id" value="${l.id}">`,
    '<span></span>'
  ])));
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    closeModal();
    await onSubmit(collectRows(wrap));
  });
  openModal(title, body);
}

function userForm(user = {}, permissions = []) {
  const modules = ['Sales', 'Purchase', 'Manufacturing', 'Product', 'BoM', 'Audit', 'User'];
  const body = el('form', { class: 'form-grid' });
  body.innerHTML = `
    <div class="three">
      ${input('name','Name',user.name)}
      ${input('email','Email ID',user.email,'email', !!user.id)}
      ${input('password','Password', '', 'password')}
    </div>
    <div class="three">
      ${input('mobile_number','Mobile Number',user.mobile_number)}
      ${input('address','Address',user.address)}
      ${input('position','Position',user.position)}
    </div>
    <label>Role${select('role', ['User','Admin'], user.role || 'User')}</label>
    <h3>Permission Matrix</h3><div class="matrix" id="matrix"></div>
    <button>Save User</button>`;
  const matrix = body.querySelector('#matrix');
  matrix.append(el('div', { class: 'matrix-row' }, ['Module', 'View', 'Create', 'Edit', 'Delete'].map((x) => el('strong', {}, [x]))));
  modules.forEach((m) => {
    const p = permissions.find((x) => x.module === m) || { module: m };
    matrix.append(el('div', { class: 'matrix-row' }, [
      el('strong', {}, [m]),
      permSelect(m, 'can_view', p.can_view),
      permSelect(m, 'can_create', p.can_create),
      permSelect(m, 'can_edit', p.can_edit),
      permSelect(m, 'can_delete', p.can_delete)
    ]));
  });
  body.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = normalize(formData(body));
    data.permissions = modules.map((module) => ({ module, can_view: data[`${module}_can_view`], can_create: data[`${module}_can_create`], can_edit: data[`${module}_can_edit`], can_delete: data[`${module}_can_delete`] }));
    try {
      await api(user.id ? `/api/users/${user.id}` : '/api/users', { method: user.id ? 'PUT' : 'POST', body: JSON.stringify(data) });
      closeModal();
      toast('User saved', true);
      await render();
    } catch (error) { toast(error.message); }
  });
  openModal(user.id ? 'User Management Form' : 'Create User', body);
}

function permSelect(module, field, value = 'None') {
  const wrapper = el('label');
  wrapper.innerHTML = select(`${module}_${field}`, ['Full', 'Limited', 'Optional', 'None'], value || 'None');
  return wrapper;
}

function openLogs(module, record) {
  state.view = 'audit';
  render().then(() => {
    $('#content').innerHTML = '';
    renderAudit($('#content'), module, record);
  });
}

function table(headers, rows) {
  const wrap = el('div', { class: 'table-wrap' });
  const t = el('table');
  t.append(el('thead', {}, [el('tr', {}, headers.map((h) => el('th', {}, [h])))]));
  t.append(el('tbody', {}, rows.map((row) => el('tr', {}, row.map((cell) => el('td', { html: cell?.nodeType ? '' : String(cell ?? '') }, cell?.nodeType ? [cell] : []))))));
  wrap.append(t);
  return wrap;
}

function actions(items) {
  const box = el('div', { class: 'actions' });
  items.forEach(([label, handler]) => box.append(el('button', { class: label === 'Cancel' ? 'danger' : 'secondary', onclick: handler }, [label])));
  return box;
}

function toolbar(placeholder, id, withView = false) {
  return el('div', { class: 'toolbar' }, [
    el('input', { id, placeholder }),
    el('select', { html: '<option>All Statuses</option><option>Draft</option><option>Confirmed</option><option>Done</option>' }),
    el('button', { class: 'secondary' }, ['Filter']),
    el('button', { class: 'secondary' }, [withView ? 'Kanban' : 'List'])
  ]);
}

function input(name, label, value = '', type = 'text', readonly = false) {
  return `<label>${label}<input name="${name}" type="${type}" value="${value ?? ''}" ${readonly ? 'readonly' : ''}></label>`;
}

function select(name, options, value) {
  return `<select name="${name}">${options.map((o) => `<option value="${o}" ${String(o) === String(value) ? 'selected' : ''}>${o || 'Select'}</option>`).join('')}</select>`;
}

function selectRows(name, rows, labelKey, value, labelFn) {
  return `<select name="${name}"><option value="">Select</option>${rows.map((r) => `<option value="${r.id}" ${String(r.id) === String(value) ? 'selected' : ''}>${labelFn ? labelFn(r) : r[labelKey]}</option>`).join('')}</select>`;
}

function lineRow(className, htmlParts) {
  const row = el('div', { class: className });
  row.innerHTML = `${htmlParts.join('')}<button type="button" class="secondary">Remove</button>`;
  row.querySelector('button').onclick = () => row.remove();
  return row;
}

function collectRows(container) {
  return [...container.children].map((row) => normalize(Object.fromEntries(new FormData(row.closest('form')).entries()))).map((_, index) => {
    const fields = [...container.children[index].querySelectorAll('input,select,textarea')];
    return normalize(Object.fromEntries(fields.map((f) => [f.name, f.value])));
  });
}

function normalize(data) {
  const out = {};
  Object.entries(data).forEach(([k, v]) => {
    if (v === '') out[k] = null;
    else if (v === 'true') out[k] = true;
    else if (v === 'false') out[k] = false;
    else if (!Number.isNaN(Number(v)) && v !== null && v !== '' && !String(k).includes('date') && k !== 'password' && k !== 'email') out[k] = Number(v);
    else out[k] = v;
  });
  return out;
}

function dateOnly(value) {
  return value ? String(value).slice(0, 10) : '';
}

function openModal(title, body) {
  $('#modalTitle').textContent = title;
  $('#modalBody').innerHTML = '';
  $('#modalBody').append(body);
  $('#modal').showModal();
}

function closeModal() {
  $('#modal').close();
}

boot();
