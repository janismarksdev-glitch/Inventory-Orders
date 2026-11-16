import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./db.js";
dotenv.config();

const app = express();
app.use(cors({ origin: process.env.CLIENT_ORIGIN || "http://localhost:5173" }));
app.use(express.json());

const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

app.get("/api/dashboard", asyncRoute(async (req, res) => {
  const [[{ productCount }]] = await pool.query("SELECT COUNT(*) productCount FROM products");
  const [[{ lowStockCount }]] = await pool.query("SELECT COUNT(*) lowStockCount FROM products WHERE quantity <= reorder_level");
  const [[{ openOrders }]] = await pool.query("SELECT COUNT(*) openOrders FROM orders WHERE status IN ('Pending','Processing')");
  const [[{ unitsInStock }]] = await pool.query("SELECT COALESCE(SUM(quantity),0) unitsInStock FROM products");
  const [recent] = await pool.query(
    `SELECT sm.id, sm.movement_type, sm.quantity, sm.note, sm.created_at,
            p.name AS product_name, p.sku, o.id AS order_id
     FROM stock_movements sm JOIN products p ON p.id=sm.product_id
     LEFT JOIN orders o ON o.id=sm.order_id ORDER BY sm.created_at DESC LIMIT 8`
  );
  res.json({ productCount, lowStockCount, openOrders, unitsInStock, recent });
}));

app.get("/api/products", asyncRoute(async (req, res) => {
  const { lowStock } = req.query;
  const sql = `SELECT * FROM products ${lowStock === "true" ? "WHERE quantity <= reorder_level" : ""} ORDER BY name`;
  const [rows] = await pool.query(sql);
  res.json(rows);
}));

app.post("/api/products", asyncRoute(async (req, res) => {
  const { name, sku, photo_url, category, reorder_level = 0, storage_location, quantity = 0 } = req.body;
  if (!name?.trim() || !sku?.trim()) return res.status(400).json({ error: "Product name and SKU are required." });
  if (!Number.isInteger(Number(quantity)) || Number(quantity) < 0) return res.status(400).json({ error: "Quantity must be a non-negative whole number." });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO products (name,sku,photo_url,category,reorder_level,storage_location,quantity)
       VALUES (?,?,?,?,?,?,?)`,
      [name.trim(), sku.trim(), photo_url || null, category || null, Number(reorder_level), storage_location || null, Number(quantity)]
    );
    if (Number(quantity) > 0) await conn.query(
      "INSERT INTO stock_movements (product_id,movement_type,quantity,note) VALUES (?,'IN',?,'Opening stock')",
      [result.insertId, Number(quantity)]
    );
    await conn.commit();
    res.status(201).json({ id: result.insertId });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

app.post("/api/products/:id/receive", asyncRoute(async (req, res) => {
  const amount = Number(req.body.quantity);
  if (!Number.isInteger(amount) || amount <= 0) return res.status(400).json({ error: "Received quantity must be a positive whole number." });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query("UPDATE products SET quantity=quantity+? WHERE id=?", [amount, req.params.id]);
    if (!result.affectedRows) { await conn.rollback(); return res.status(404).json({ error: "Product not found." }); }
    await conn.query("INSERT INTO stock_movements (product_id,movement_type,quantity,note) VALUES (?,'IN',?,'Stock received')", [req.params.id, amount]);
    await conn.commit();
    res.json({ success: true });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

app.get("/api/orders", asyncRoute(async (req, res) => {
  const [orders] = await pool.query("SELECT * FROM orders ORDER BY created_at DESC");
  for (const order of orders) {
    const [items] = await pool.query(
      `SELECT oi.*, p.name AS product_name, p.sku FROM order_items oi
       JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?`, [order.id]
    );
    order.items = items;
  }
  res.json(orders);
}));

app.post("/api/orders", asyncRoute(async (req, res) => {
  const { customer_name, customer_email, customer_phone, delivery_address, delivery_date, items } = req.body;
  if (!customer_name?.trim() || !Array.isArray(items) || items.length === 0)
    return res.status(400).json({ error: "Customer name and at least one order item are required." });
  for (const item of items) if (!Number.isInteger(Number(item.product_id)) || !Number.isInteger(Number(item.quantity)) || Number(item.quantity) < 1)
    return res.status(400).json({ error: "Each item needs a product and a positive whole-number quantity." });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.query(
      `INSERT INTO orders (customer_name,customer_email,customer_phone,delivery_address,delivery_date)
       VALUES (?,?,?,?,?)`,
      [customer_name.trim(), customer_email || null, customer_phone || null, delivery_address || null, delivery_date || null]
    );
    for (const item of items) await conn.query(
      "INSERT INTO order_items (order_id,product_id,quantity,unit_price) VALUES (?,?,?,?)",
      [result.insertId, item.product_id, item.quantity, item.unit_price ?? null]
    );
    await conn.commit();
    res.status(201).json({ id: result.insertId });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

// Fulfillment is atomic and idempotent: stock is deducted once, only on the first transition to Fulfilled.
app.patch("/api/orders/:id/status", asyncRoute(async (req, res) => {
  const { status } = req.body;
  if (!["Pending","Processing","Fulfilled","Cancelled"].includes(status))
    return res.status(400).json({ error: "Invalid order status." });
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.query("SELECT * FROM orders WHERE id=? FOR UPDATE", [req.params.id]);
    if (!orders.length) { await conn.rollback(); return res.status(404).json({ error: "Order not found." }); }
    const order = orders[0];

    if (status === "Fulfilled" && order.status !== "Fulfilled") {
      const [items] = await conn.query("SELECT * FROM order_items WHERE order_id=?", [order.id]);
      for (const item of items) {
        const [updated] = await conn.query(
          "UPDATE products SET quantity=quantity-? WHERE id=? AND quantity>=?",
          [item.quantity, item.product_id, item.quantity]
        );
        if (!updated.affectedRows) throw new Error(`Insufficient stock for product ID ${item.product_id}.`);
        await conn.query(
          "INSERT INTO stock_movements (product_id,order_id,movement_type,quantity,note) VALUES (?,?,'OUT',?,'Order fulfilled')",
          [item.product_id, order.id, item.quantity]
        );
      }
      await conn.query("UPDATE orders SET status='Fulfilled', fulfilled_at=NOW() WHERE id=?", [order.id]);
    } else {
      // Do not allow reopening a fulfilled order: stock has already been deducted.
      if (order.status === "Fulfilled" && status !== "Fulfilled")
        throw new Error("A fulfilled order cannot be reopened; create a return/adjustment instead.");
      await conn.query("UPDATE orders SET status=? WHERE id=?", [status, order.id]);
    }
    await conn.commit();
    res.json({ success: true });
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}));

// Serve the built React app from the same origin as the API.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDist = path.resolve(__dirname, "../../client/dist");
app.use(express.static(clientDist));
app.get("*", (req, res, next) => {
  if (req.path.startsWith("/api/")) return next();
  res.sendFile(path.join(clientDist, "index.html"), err => {
    if (err) next(err);
  });
});

app.use((err, req, res, next) => {
  console.error(err);
  const duplicate = err.code === "ER_DUP_ENTRY";
  res.status(duplicate ? 409 : 400).json({ error: duplicate ? "That SKU already exists." : err.message || "Unexpected server error." });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log(`API listening on http://localhost:${port}`));
