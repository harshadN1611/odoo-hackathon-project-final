# Shiv Furniture Works Mini ERP

Mini ERP web application for demand-to-delivery operations at Shiv Furniture Works. It replaces spreadsheet/manual tracking with centralized products, stock, sales orders, purchase orders, manufacturing orders, BoMs, stock ledger, audit logs, dashboard counts, and role-based access control.

## Stack

- Backend: Node.js core `http` server with REST APIs
- Database: PostgreSQL 16
- Frontend: Responsive vanilla JavaScript SPA
- Auth: signed bearer tokens with PBKDF2 password hashes
- Inventory: transactional stock ledger movements for SO, PO, and MO workflows

## Setup

1. Install Node.js 18+.
2. Start PostgreSQL with Docker:

   ```bash
   npm run db:up
   ```

   The database is named `shiv_erp` and is exposed on local port `5433`.

3. Install dependencies:

   ```bash
   npm install
   ```

4. Start the app:

   ```bash
   npm start
   ```

5. Open `http://localhost:3000`.

To reset the database and reload seed data:

```bash
npm run db:reset
```

## Environment

Copy `.env.example` if you want to override defaults.

```env
DB_HOST=127.0.0.1
DB_PORT=5433
DB_NAME=shiv_erp
DB_USER=postgres
DB_PASSWORD=postgres
PORT=3000
JWT_SECRET=change-this-for-production
```

## Demo Accounts

| Role | Login ID | Password |
| --- | --- | --- |
| Admin | `admin@shiv.local` | `admin123` |
| Sales User | `amit.sales@shiv.local` | `sales123` |
| Purchase User | `neha.purchase@shiv.local` | `purchase123` |
| Manufacturing User | `ravi.mfg@shiv.local` | `mfg123` |
| Business Owner | `meera.owner@shiv.local` | `owner123` |

## Implemented Modules

- Authentication: System User login, System Administrator login, signup, forgot-password placeholder.
- RBAC: module/action permissions in PostgreSQL, enforced on every protected API endpoint.
- Products: reference numbering, prices, on-hand/reserved/free-to-use stock, procure-on-demand settings.
- Vendors and BoMs: components, operations, duration scaling source data, 8-character BoM reference-note validation.
- Sales Orders: Draft to Confirmed to Partially/Fully Delivered, reservations, shortage audit notes, MTS/MTO procurement trigger.
- Purchase Orders: Draft to Confirmed to Partially/Fully Received, receipt stock increases, stock ledger entries.
- Manufacturing Orders: Draft to Confirmed to In Progress to Done, BoM component/work-order population, component reservations, finished-product production and component consumption ledger entries.
- Stock Ledger: signed inventory movement history with resulting on-hand balances.
- Audit Logs: create/update/delete/status-change rows with user, module, record, field, old value, and new value.
- Dashboard: All/My status counts plus late counts for Sales and Purchase.
- User Management: admin-managed users and permission matrix.

## Verification

Run syntax checks:

```bash
npm run check
```

Run a health check after PostgreSQL and the app are running:

```bash
curl http://localhost:3000/api/health
```

Suggested end-to-end smoke test:

1. Log in as Admin and open Dashboard, Products, BoMs, Audit Logs, and User Management.
2. Log in as Sales user and create a Sales Order for a stocked product. Confirm it and verify reserved/free-to-use stock changes.
3. Deliver the Sales Order and verify on-hand stock decreases plus a negative Stock Ledger row appears.
4. Log in as Purchase user and process a Purchase Order receipt. Verify on-hand stock increases plus a positive Stock Ledger row appears.
5. Log in as Manufacturing user and create/confirm/start/produce an MO from a BoM. Verify finished goods increase, components decrease, and Stock Ledger records both movement types.
6. Configure a product as procure-on-demand Purchase or Manufacturing, confirm an oversized Sales Order, and verify an auto-created Draft PO or MO.
7. Return as Admin and inspect Audit Logs for the chronological trace.

## Notes

This implementation uses the existing lightweight Node/PostgreSQL project structure in this workspace rather than adding new package dependencies. It is intentionally self-contained and can run after `npm install` with the current `pg` dependency.
