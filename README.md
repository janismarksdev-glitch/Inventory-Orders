# Stockroom — Inventory & Orders

A starter full-stack inventory/order management app using **Node.js, Express, React, and MySQL**.

## Features
- Product catalog: name, unique SKU, photo URL, category, reorder level, storage location, and quantity.
- Customer orders with multiple line items and delivery details.
- Atomic stock deduction on the first transition to `Fulfilled`.
- Idempotent fulfillment: repeating the same status update cannot deduct stock twice.
- Prevents fulfillment when available stock is insufficient.
- Low-stock flag when `quantity <= reorder_level`.
- Stock receiving and a movement audit trail.
- Overview, inventory, orders, and transactions screens.

## Requirements
- Node.js 20+
- Docker Desktop (recommended) or MySQL 8+

## Start locally

1. Start MySQL (Docker Desktop recommended):

   ```bash
   docker compose up -d
   ```

2. Install dependencies once:

   ```bash
   cd server
   npm install
   cd ../client
   npm install
   ```

3. From the `server` folder, start the whole app with one command:

   ```bash
   npm start
   ```

   The server automatically builds the React client and serves it alongside the API.
   Open http://localhost:4000. API health check: http://localhost:4000/api/health

The default database connection settings match `docker-compose.yml`; create `server/.env`
only if you need to override them. The MySQL service must be running before starting the app.
For frontend development with Vite, run `npm run dev` from the project root after installing
the root dependencies as well.

## Workflow
1. Add products from **Add product**. Opening quantity is recorded as an incoming stock movement.
2. Create orders from **New order**. Orders begin as `Pending`; creating an order does not reserve or deduct stock.
3. Change an order to `Processing` as needed.
4. Change it to `Fulfilled` only when it has shipped/been handed over. The API starts a database transaction, locks the order, checks stock, deducts each line item, writes movement records, and commits the status change together.
5. Use **Receive** in Inventory when replenishment arrives.
6. Use the low-stock filter and overview watchlist to identify replenishment needs.

## API endpoints
- `GET /api/dashboard`
- `GET /api/products` (`?lowStock=true`)
- `POST /api/products`
- `POST /api/products/:id/receive`
- `GET /api/orders`
- `POST /api/orders`
- `PATCH /api/orders/:id/status`

## Important design notes
- The fulfillment operation is transactional, so a failure on any line item rolls back all deductions.
- A fulfilled order cannot be reopened in this starter app. Handle returns with a dedicated return/stock-adjustment workflow rather than changing the order status.
- Orders do not reserve stock when created. If you need reservation, add an explicit reserved-quantity model and availability checks.
- The frontend currently uses a photo URL rather than uploading image files. Add object storage (e.g. S3-compatible storage) for production photo uploads.
- This is a development starter, not a production deployment. Before launch, add authentication/roles, request validation, rate limiting, secure secrets, backups, tests, and deployment configuration.

## Suggested next steps
- Add login and roles (admin, warehouse, sales).
- Add order editing/cancellation rules and return handling.
- Add product image uploads.
- Add pagination/search/export and email notifications for low stock.
- Add automated integration tests for simultaneous fulfillment and insufficient stock.
