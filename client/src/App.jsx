import React, { useEffect, useMemo, useState } from "react";
const API = import.meta.env.VITE_API_URL || "/api";
async function request(path, options={}) {
  const response = await fetch(`${API}${path}`, { headers: { "Content-Type":"application/json" }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Request failed");
  return data;
}
const money = value => value == null ? "—" : `$${Number(value).toFixed(2)}`;

export default function App() {
  const [tab,setTab] = useState("Overview"), [products,setProducts] = useState([]), [orders,setOrders] = useState([]);
  const [dashboard,setDashboard] = useState({}), [error,setError] = useState(""), [busy,setBusy] = useState(false);
  const [showProduct,setShowProduct] = useState(false), [showOrder,setShowOrder] = useState(false), [lowOnly,setLowOnly] = useState(false);
  const [product,setProduct] = useState({name:"",sku:"",photo_url:"",category:"",reorder_level:5,storage_location:"",quantity:0});
  const [order,setOrder] = useState({customer_name:"",customer_email:"",customer_phone:"",delivery_address:"",delivery_date:"",items:[{product_id:"",quantity:1,unit_price:""}]});
  async function load() {
    try {
      const [p,o,d] = await Promise.all([request("/products"),request("/orders"),request("/dashboard")]);
      setProducts(p); setOrders(o); setDashboard(d); setError("");
    } catch(e) { setError(e.message); }
  }
  useEffect(()=>{ load(); },[]);
  const visibleProducts = useMemo(()=>lowOnly ? products.filter(p=>p.quantity<=p.reorder_level) : products,[products,lowOnly]);
  async function submitProduct(e) {
    e.preventDefault(); setBusy(true);
    try { await request("/products",{method:"POST",body:JSON.stringify(product)}); setShowProduct(false); setProduct({name:"",sku:"",photo_url:"",category:"",reorder_level:5,storage_location:"",quantity:0}); await load(); }
    catch(e){setError(e.message)} finally{setBusy(false)}
  }
  async function submitOrder(e) {
    e.preventDefault(); setBusy(true);
    try { await request("/orders",{method:"POST",body:JSON.stringify({...order,items:order.items.map(i=>({...i,product_id:Number(i.product_id),quantity:Number(i.quantity),unit_price:i.unit_price===""?null:Number(i.unit_price)}))})}); setShowOrder(false); setOrder({customer_name:"",customer_email:"",customer_phone:"",delivery_address:"",delivery_date:"",items:[{product_id:"",quantity:1,unit_price:""}]}); await load(); }
    catch(e){setError(e.message)} finally{setBusy(false)}
  }
  async function changeStatus(id,status) {
    setBusy(true); try { await request(`/orders/${id}/status`,{method:"PATCH",body:JSON.stringify({status})}); await load(); }
    catch(e){setError(e.message)} finally{setBusy(false)}
  }
  async function receiveStock(id) {
    const quantity=Number(prompt("How many units were received?"));
    if(!Number.isInteger(quantity)||quantity<=0)return;
    try{await request(`/products/${id}/receive`,{method:"POST",body:JSON.stringify({quantity})});await load()}catch(e){setError(e.message)}
  }
  const field=(label,key,type="text")=><label>{label}<input type={type} required={["name","sku","customer_name"].includes(key)} value={product[key]??""} onChange={e=>setProduct({...product,[key]:e.target.value})}/></label>;
  return <div className="shell">
    <aside className="sidebar"><div className="brand"><span className="brand-mark">S</span><div><b>Stockroom</b><small>Inventory workspace</small></div></div>
      <div className="nav-label">WORKSPACE</div>{["Overview","Inventory","Orders","Transactions"].map(x=><button key={x} className={`nav ${tab===x?"active":""}`} onClick={()=>setTab(x)}>{x==="Overview"?"▦":x==="Inventory"?"▤":x==="Orders"?"⇄":"◷"} <span>{x}</span></button>)}
      <div className="sidebar-foot">Inventory & order control<br/><span>Local development</span></div>
    </aside>
    <main className="main">
      <header><div><p className="eyebrow">INVENTORY MANAGEMENT</p><h1>{tab}</h1></div><div className="header-actions"><button className="btn light" onClick={()=>setShowProduct(true)}>＋ Add product</button><button className="btn primary" onClick={()=>setShowOrder(true)}>＋ New order</button></div></header>
      {error&&<div className="alert"><span>{error}</span><button onClick={()=>setError("")}>×</button></div>}
      {tab==="Overview"&&<><section className="stats">
        <Stat label="Products" value={dashboard.productCount??0} note="Items in catalog" icon="▤"/>
        <Stat label="Units in stock" value={dashboard.unitsInStock??0} note="Across all products" icon="▦"/>
        <Stat label="Low-stock items" value={dashboard.lowStockCount??0} note="At or below reorder level" icon="⚑" warn/>
        <Stat label="Open orders" value={dashboard.openOrders??0} note="Pending or processing" icon="⇄"/>
      </section><section className="panel"><div className="panel-head"><div><h2>Recent stock activity</h2><p>Latest inventory movements</p></div><button className="text-btn" onClick={()=>setTab("Transactions")}>View all →</button></div><Transactions rows={dashboard.recent||[]}/></section>
      <section className="panel"><div className="panel-head"><div><h2>Low-stock watchlist</h2><p>Products that need replenishment</p></div><button className="text-btn" onClick={()=>{setTab("Inventory");setLowOnly(true)}}>View inventory →</button></div><ProductTable rows={products.filter(p=>p.quantity<=p.reorder_level).slice(0,5)} onReceive={receiveStock}/></section></>}
      {tab==="Inventory"&&<section className="panel"><div className="panel-head"><div><h2>Product catalog</h2><p>Manage product details and stock levels</p></div><div><label className="check"><input type="checkbox" checked={lowOnly} onChange={e=>setLowOnly(e.target.checked)}/> Low stock only</label></div></div><ProductTable rows={visibleProducts} onReceive={receiveStock}/></section>}
      {tab==="Orders"&&<section className="panel"><div className="panel-head"><div><h2>Customer orders</h2><p>Track order status and deliveries</p></div></div><OrdersTable rows={orders} onStatus={changeStatus}/></section>}
      {tab==="Transactions"&&<section className="panel"><div className="panel-head"><div><h2>Stock transactions</h2><p>Audit trail of incoming and outgoing stock</p></div></div><Transactions rows={dashboard.recent||[]}/></section>}
    </main>
    {showProduct&&<Modal title="Add product" close={()=>setShowProduct(false)}><form onSubmit={submitProduct} className="form-grid">
      <label>Product name<input required value={product.name} onChange={e=>setProduct({...product,name:e.target.value})}/></label>
      <label>SKU<input required value={product.sku} onChange={e=>setProduct({...product,sku:e.target.value})}/></label>
      <label>Category<input value={product.category} onChange={e=>setProduct({...product,category:e.target.value})}/></label>
      <label>Photo URL<input type="url" value={product.photo_url} onChange={e=>setProduct({...product,photo_url:e.target.value})}/></label>
      <label>Reorder level<input type="number" min="0" value={product.reorder_level} onChange={e=>setProduct({...product,reorder_level:e.target.value})}/></label>
      <label>Storage location<input value={product.storage_location} onChange={e=>setProduct({...product,storage_location:e.target.value})}/></label>
      <label>Opening quantity<input type="number" min="0" required value={product.quantity} onChange={e=>setProduct({...product,quantity:e.target.value})}/></label>
      <div className="form-actions"><button type="button" className="btn light" onClick={()=>setShowProduct(false)}>Cancel</button><button disabled={busy} className="btn primary">Save product</button></div>
    </form></Modal>}
    {showOrder&&<Modal title="Create customer order" close={()=>setShowOrder(false)}><form onSubmit={submitOrder} className="form-grid">
      <label>Customer name<input required value={order.customer_name} onChange={e=>setOrder({...order,customer_name:e.target.value})}/></label>
      <label>Email<input type="email" value={order.customer_email} onChange={e=>setOrder({...order,customer_email:e.target.value})}/></label>
      <label>Phone<input value={order.customer_phone} onChange={e=>setOrder({...order,customer_phone:e.target.value})}/></label>
      <label>Delivery date<input type="date" value={order.delivery_date} onChange={e=>setOrder({...order,delivery_date:e.target.value})}/></label>
      <label className="wide">Delivery address<textarea value={order.delivery_address} onChange={e=>setOrder({...order,delivery_address:e.target.value})}/></label>
      <div className="wide"><div className="items-head"><b>Order items</b><button type="button" className="text-btn" onClick={()=>setOrder({...order,items:[...order.items,{product_id:"",quantity:1,unit_price:""}]})}>＋ Add item</button></div>
        {order.items.map((item,i)=><div className="item-row" key={i}><select required value={item.product_id} onChange={e=>setOrder({...order,items:order.items.map((v,j)=>j===i?{...v,product_id:e.target.value}:v)})}><option value="">Select product</option>{products.map(p=><option key={p.id} value={p.id}>{p.name} ({p.sku}) — {p.quantity} in stock</option>)}</select><input aria-label="Quantity" type="number" min="1" required value={item.quantity} onChange={e=>setOrder({...order,items:order.items.map((v,j)=>j===i?{...v,quantity:e.target.value}:v)})}/><button type="button" className="remove" onClick={()=>setOrder({...order,items:order.items.filter((_,j)=>j!==i)})} disabled={order.items.length===1}>×</button></div>)}
      </div><p className="hint wide">Stock is deducted when the order is first marked Fulfilled, not when it is created.</p>
      <div className="form-actions"><button type="button" className="btn light" onClick={()=>setShowOrder(false)}>Cancel</button><button disabled={busy} className="btn primary">Create order</button></div>
    </form></Modal>}
  </div>;
}
function Stat({label,value,note,icon,warn}){return <div className="stat"><div className="stat-top"><span>{label}</span><span className={warn?"stat-icon warning":"stat-icon"}>{icon}</span></div><strong>{value}</strong><small>{note}</small></div>}
function ProductTable({rows,onReceive}){return <div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>SKU</th><th>CATEGORY</th><th>LOCATION</th><th>ON HAND</th><th>REORDER AT</th><th>STATUS</th><th></th></tr></thead><tbody>{rows.length?rows.map(p=><tr key={p.id}><td><div className="product-cell">{p.photo_url?<img src={p.photo_url} alt=""/>:<span className="placeholder">▤</span>}<b>{p.name}</b></div></td><td>{p.sku}</td><td>{p.category||"—"}</td><td>{p.storage_location||"—"}</td><td><b>{p.quantity}</b></td><td>{p.reorder_level}</td><td><span className={`pill ${p.quantity<=p.reorder_level?"red":"green"}`}>{p.quantity<=p.reorder_level?"Low stock":"In stock"}</span></td><td><button className="text-btn" onClick={()=>onReceive(p.id)}>＋ Receive</button></td></tr>):<tr><td colSpan="8" className="empty">No products match this view.</td></tr>}</tbody></table></div>}
function OrdersTable({rows,onStatus}){return <div className="table-wrap"><table><thead><tr><th>ORDER</th><th>CUSTOMER</th><th>ITEMS</th><th>DELIVERY</th><th>STATUS</th><th>UPDATE</th></tr></thead><tbody>{rows.length?rows.map(o=><tr key={o.id}><td><b>#{o.id}</b><small className="sub">{new Date(o.created_at).toLocaleDateString()}</small></td><td>{o.customer_name}<small className="sub">{o.customer_email||o.customer_phone||""}</small></td><td>{o.items.map(i=>`${i.product_name} × ${i.quantity}`).join(", ")}</td><td>{o.delivery_date?new Date(o.delivery_date).toLocaleDateString():"—"}<small className="sub">{o.delivery_address||""}</small></td><td><span className={`pill ${o.status==="Fulfilled"?"green":o.status==="Cancelled"?"gray":"amber"}`}>{o.status}</span></td><td><select disabled={o.status==="Fulfilled"} value={o.status} onChange={e=>onStatus(o.id,e.target.value)}>{["Pending","Processing","Fulfilled","Cancelled"].map(s=><option key={s}>{s}</option>)}</select></td></tr>):<tr><td colSpan="6" className="empty">No orders yet.</td></tr>}</tbody></table></div>}
function Transactions({rows}){return <div className="table-wrap"><table><thead><tr><th>DATE</th><th>PRODUCT</th><th>TYPE</th><th>QUANTITY</th><th>REFERENCE</th><th>NOTE</th></tr></thead><tbody>{rows.length?rows.map(r=><tr key={r.id}><td>{new Date(r.created_at).toLocaleString()}</td><td><b>{r.product_name}</b><small className="sub">{r.sku}</small></td><td><span className={`pill ${r.movement_type==="IN"?"green":"amber"}`}>{r.movement_type}</span></td><td>{r.movement_type==="OUT"?"−":"+"}{r.quantity}</td><td>{r.order_id?`Order #${r.order_id}`:"—"}</td><td>{r.note||"—"}</td></tr>):<tr><td colSpan="6" className="empty">No stock movements recorded yet.</td></tr>}</tbody></table></div>}
function Modal({title,close,children}){return <div className="backdrop" onMouseDown={e=>e.target===e.currentTarget&&close()}><div className="modal"><div className="modal-head"><h2>{title}</h2><button onClick={close}>×</button></div>{children}</div></div>}
