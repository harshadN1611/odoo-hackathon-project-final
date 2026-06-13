const { sendJson, readJson } = require('../utils/http');
const erp = require('../controllers/erpController');

const routes = [
  ['GET', /^\/api\/health$/, erp.health],
  ['POST', /^\/api\/auth\/login$/, erp.login],
  ['POST', /^\/api\/auth\/admin-login$/, erp.adminLogin],
  ['POST', /^\/api\/auth\/signup$/, erp.signup],
  ['POST', /^\/api\/auth\/forgot-password$/, erp.forgotPassword],
  ['GET', /^\/api\/auth\/me$/, erp.me],
  ['GET', /^\/api\/dashboard$/, erp.dashboard],
  ['GET', /^\/api\/meta$/, erp.meta],
  ['GET', /^\/api\/products$/, erp.listProducts],
  ['POST', /^\/api\/products$/, erp.createProduct],
  ['PUT', /^\/api\/products\/(?<id>\d+)$/, erp.updateProduct],
  ['DELETE', /^\/api\/products\/(?<id>\d+)$/, erp.deleteProduct],
  ['GET', /^\/api\/vendors$/, erp.listVendors],
  ['POST', /^\/api\/vendors$/, erp.createVendor],
  ['GET', /^\/api\/boms$/, erp.listBoms],
  ['POST', /^\/api\/boms$/, erp.createBom],
  ['PUT', /^\/api\/boms\/(?<id>\d+)$/, erp.updateBom],
  ['DELETE', /^\/api\/boms\/(?<id>\d+)$/, erp.deleteBom],
  ['GET', /^\/api\/sales-orders$/, erp.listSalesOrders],
  ['POST', /^\/api\/sales-orders$/, erp.createSalesOrder],
  ['PUT', /^\/api\/sales-orders\/(?<id>\d+)$/, erp.updateSalesOrder],
  ['POST', /^\/api\/sales-orders\/(?<id>\d+)\/confirm$/, erp.confirmSalesOrder],
  ['POST', /^\/api\/sales-orders\/(?<id>\d+)\/deliver$/, erp.deliverSalesOrder],
  ['POST', /^\/api\/sales-orders\/(?<id>\d+)\/cancel$/, erp.cancelSalesOrder],
  ['GET', /^\/api\/purchase-orders$/, erp.listPurchaseOrders],
  ['POST', /^\/api\/purchase-orders$/, erp.createPurchaseOrder],
  ['PUT', /^\/api\/purchase-orders\/(?<id>\d+)$/, erp.updatePurchaseOrder],
  ['POST', /^\/api\/purchase-orders\/(?<id>\d+)\/confirm$/, erp.confirmPurchaseOrder],
  ['POST', /^\/api\/purchase-orders\/(?<id>\d+)\/receive$/, erp.receivePurchaseOrder],
  ['POST', /^\/api\/purchase-orders\/(?<id>\d+)\/cancel$/, erp.cancelPurchaseOrder],
  ['GET', /^\/api\/manufacturing-orders$/, erp.listManufacturingOrders],
  ['POST', /^\/api\/manufacturing-orders$/, erp.createManufacturingOrder],
  ['PUT', /^\/api\/manufacturing-orders\/(?<id>\d+)$/, erp.updateManufacturingOrder],
  ['POST', /^\/api\/manufacturing-orders\/(?<id>\d+)\/confirm$/, erp.confirmManufacturingOrder],
  ['POST', /^\/api\/manufacturing-orders\/(?<id>\d+)\/start$/, erp.startManufacturingOrder],
  ['POST', /^\/api\/manufacturing-orders\/(?<id>\d+)\/produce$/, erp.produceManufacturingOrder],
  ['POST', /^\/api\/manufacturing-orders\/(?<id>\d+)\/cancel$/, erp.cancelManufacturingOrder],
  ['GET', /^\/api\/stock-ledger$/, erp.stockLedger],
  ['GET', /^\/api\/audit-logs$/, erp.auditLogs],
  ['GET', /^\/api\/users$/, erp.listUsers],
  ['POST', /^\/api\/users$/, erp.createUser],
  ['PUT', /^\/api\/users\/(?<id>\d+)$/, erp.updateUser]
];

function createRouter(broadcast) {
  return async function handleApi(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = routes
      .map(([method, pattern, handler]) => ({ method, match: url.pathname.match(pattern), handler }))
      .find((route) => route.method === req.method && route.match);

    if (!match) return sendJson(res, 404, { error: 'Endpoint not found' });

    const context = {
      url,
      params: match.match.groups || {},
      readBody: () => readJson(req),
      send: (status, payload) => sendJson(res, status, payload),
      broadcast
    };

    try {
      await match.handler(req, res, context);
    } catch (error) {
      const status = error.status || (error.code === '23505' ? 409 : 500);
      const message = error.code === '23505' ? 'Record already exists' : error.message;
      console.error('[api:error]', status, message);
      sendJson(res, status, { error: status === 500 ? 'Internal server error' : message });
    }
  };
}

module.exports = { createRouter };
