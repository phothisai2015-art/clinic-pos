const dns = require('dns');
dns.setDefaultResultOrder('ipv4first'); 
const { exec } = require('child_process'); 
const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const axios = require('axios');
const nodemailer = require('nodemailer'); 
const jwt = require('jsonwebtoken'); 
const db = require('./database');

const Jimp = require('jimp');
const jsQR = require('jsqr');

const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });
const Tesseract = require('tesseract.js');
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const SECRET_KEY = "MySuperSecretKey1234!"; 

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/shop', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop.html')));
app.get('/superadmin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'superadmin.html')));
app.get('/download', (req, res) => res.sendFile(path.join(__dirname, 'public', 'download.html')));

app.get('/shop/menu', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop_menu.html')));
app.get('/shop/pos', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop_pos.html')));
app.get('/shop/receipt', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop_receipt.html')));
app.get('/shop/products', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop_products.html')));
app.get('/shop/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop_dashboard.html')));
app.get('/shop/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop_settings.html')));
app.get('/shop/booking', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop_booking.html')));
app.get('/shop/emr', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop_emr.html')));
app.get('/shop/hr', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop_hr.html')));

db.run(`ALTER TABLE tenants ADD COLUMN renew_status TEXT DEFAULT 'NONE'`, () => {});
db.run(`ALTER TABLE tenants ADD COLUMN renew_notified INTEGER DEFAULT 1`, () => {});

db.run(`CREATE TABLE IF NOT EXISTS superadmin_settings (key TEXT PRIMARY KEY, value TEXT)`, () => {
  const defaults = { username: 'superadmin', password: '1234', email: '', pkg_1m: '150', pkg_3m: '400', pkg_6m: '750', pkg_12m: '1200' };
  const stmt = db.prepare(`INSERT OR IGNORE INTO superadmin_settings (key, value) VALUES (?, ?)`);
  for (const [k, v] of Object.entries(defaults)) stmt.run(k, v);
  stmt.finalize();
});

const TELEGRAM_BOT_TOKEN = "8383540467:AAHP2VfSU0U7riTyhrfq-dQHOQgiTmd8t0Y";
const TELEGRAM_CHAT_ID = "5519991585";

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: 'my.server.pos.online@gmail.com', pass: 'blfllltvbernypps' }
});

const otpStore = {};

function deleteLocalImage(imageUrl) {
  if (!imageUrl || !imageUrl.startsWith('/uploads/')) return;
  const filePath = path.join(__dirname, 'public', imageUrl);
  fs.unlink(filePath, (err) => { if (err && err.code !== 'ENOENT') console.error("❌ ลบรูปเก่าล้มเหลว:", err.message); });
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

async function sendAdminAlert(message) {
  try { await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: 'HTML' }); } catch (e) { console.error('🛑 [Telegram Error]:', e.message); }
}

app.get('/api/app-info', (req, res) => res.json({ version: "1.0.0" }));

app.post('/api/login-shop', (req, res) => {
  const { contact, password } = req.body;
  db.all(`SELECT key, value FROM superadmin_settings`, [], (err, rows) => {
    const sa = {}; if (rows) rows.forEach(r => sa[r.key] = r.value);
    if (contact === (sa.username || 'superadmin') && password === (sa.password || '1234')) {
      if (sa.email && sa.email.trim() !== '') {
        transporter.sendMail({ from: transporter.options.auth.user, to: sa.email, subject: "🚨 แจ้งเตือนการเข้าสู่ระบบ Super Admin", text: `ระบบ POS ของคุณมีการเข้าสู่ระบบผ่านบัญชี Super Admin\nเวลา: ${new Date().toLocaleString('th-TH')}\n\nหากคุณไม่ได้เป็นผู้ทำรายการ กรุณาตรวจสอบทันที!` }).catch(e => console.error("SA Mail Error:", e));
      }
      const token = jwt.sign({ role: 'superadmin' }, SECRET_KEY, { expiresIn: '1d' });
      return res.json({ status: "superadmin", token: token });
    }
    db.get(`SELECT * FROM tenants WHERE (LOWER(email) = LOWER(?) OR phone = ?) AND password = ?`, [contact, contact, password], (err, row) => {
      if (err || !row) return res.json({ status: "error", message: "อีเมล/เบอร์โทร หรือรหัสผ่านไม่ถูกต้อง!" });
      if (row.status !== "ACTIVE") return res.json({ status: "error", message: "⚠️ สถานะร้านค้าไม่พร้อมใช้งาน" });
      const today = new Date(); today.setHours(0,0,0,0); const exp = new Date(row.expire_date); exp.setHours(0,0,0,0);
      const daysRemaining = Math.ceil((exp - today) / (1000 * 3600 * 24));
      res.json({ status: "success", sheetId: row.sheet_id, shopName: row.shop_name, daysRemaining });
    }); 
  }); 
}); 

app.get('/api/settings/:tenantId', (req, res) => {
  db.all(`SELECT key, value FROM settings WHERE tenant_id = ?`, [req.params.tenantId], (err, rows) => {
    const settings = {}; if (rows) rows.forEach(r => settings[r.key] = r.value); res.json(settings);
  });
});

app.post('/api/settings/update', (req, res) => {
  const { tenantId, newSettings } = req.body;
  if (newSettings.shop_logo !== undefined) {
    db.get(`SELECT value FROM settings WHERE tenant_id = ? AND key = 'shop_logo'`, [tenantId], (err, row) => {
      if (row && row.value && row.value !== newSettings.shop_logo) deleteLocalImage(row.value);
    });
  }
  const stmt = db.prepare(`INSERT INTO settings (tenant_id, key, value) VALUES (?, ?, ?) ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value`);
  for (const [key, value] of Object.entries(newSettings)) stmt.run(tenantId, key, String(value));
  stmt.finalize(); res.json("success");
});

app.get('/api/users/:tenantId', (req, res) => { db.all(`SELECT pin, name, permissions, role FROM users WHERE tenant_id = ?`, [req.params.tenantId], (err, rows) => res.json(rows || [])); });
app.post('/api/users/save', (req, res) => {
  const { tenantId, user } = req.body; let pin = user.pin.toString().trim(); while (pin.length < 4) pin = "0" + pin;
  db.get(`SELECT pin FROM users WHERE tenant_id = ? AND pin = ?`, [tenantId, pin], (err, row) => {
    if (row) return res.json("duplicate");
    db.run(`INSERT INTO users (tenant_id, pin, name, role, permissions) VALUES (?, ?, ?, ?, ?)`, [tenantId, pin, user.name, user.role || 'STAFF', user.permissions], (err) => res.json(err ? "error" : "added"));
  });
});
app.post('/api/users/delete', (req, res) => { db.run(`DELETE FROM users WHERE tenant_id = ? AND pin = ?`, [req.body.tenantId, req.body.pin], function(err) { res.json(this.changes > 0 ? "deleted" : "not_found"); }); });

// ==========================================
// 📦 API จัดการสินค้า ยา และคอร์ส
// ==========================================
app.get('/api/products/:tenantId', (req, res) => { 
  db.all(`SELECT id, name, price, image, category, stock, min_stock as minStock, unit, type, course_qty, lot, expire FROM products WHERE tenant_id = ?`, [req.params.tenantId], (err, rows) => res.json(rows || [])); 
});

app.post('/api/products/add', (req, res) => {
  const { tenantId, product } = req.body;
  db.get(`SELECT id FROM products WHERE tenant_id = ? AND id = ?`, [tenantId, product.id], (err, row) => {
    if (row) return res.json("duplicate");
    db.run(`INSERT INTO products (tenant_id, id, name, price, image, category, stock, min_stock, unit, type, course_qty, lot, expire) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, product.id, product.name, product.price, product.image, product.category, product.stock, product.minStock, product.unit, product.type || 'PRODUCT', product.course_qty || 1, product.lot || '', product.expire || ''], () => {
        io.to(tenantId).emit('force_refresh_stock'); res.json("success");
      });
  });
});

app.post('/api/products/update', (req, res) => {
  const { tenantId, product } = req.body;
  db.get(`SELECT image FROM products WHERE tenant_id = ? AND id = ?`, [tenantId, product.oldId], (err, row) => {
    if (row && row.image && row.image !== product.image) deleteLocalImage(row.image);
    db.run(`UPDATE products SET id=?, name=?, price=?, image=?, category=?, stock=?, min_stock=?, unit=?, type=?, course_qty=?, lot=?, expire=? WHERE tenant_id=? AND id=?`,
      [product.id, product.name, product.price, product.image, product.category, product.stock, product.minStock, product.unit, product.type || 'PRODUCT', product.course_qty || 1, product.lot || '', product.expire || '', tenantId, product.oldId], function() { 
        io.to(tenantId).emit('force_refresh_stock'); res.json(this.changes > 0 ? "success" : "not_found"); 
      });
  });
});

app.post('/api/products/delete', (req, res) => { 
  const { tenantId, id } = req.body;
  db.get(`SELECT image FROM products WHERE tenant_id = ? AND id = ?`, [tenantId, id], (err, row) => {
    if (row && row.image) deleteLocalImage(row.image);
    db.run(`DELETE FROM products WHERE tenant_id = ? AND id = ?`, [tenantId, id], function() { io.to(tenantId).emit('force_refresh_stock'); res.json(this.changes > 0 ? "success" : "not_found"); }); 
  });
});

app.post('/api/update-bulk-stock', (req, res) => {
  const { tenantId, payload } = req.body; JSON.parse(payload).forEach(item => {
    db.get(`SELECT stock FROM products WHERE tenant_id = ? AND id = ?`, [tenantId, item.id], (err, row) => {
      if (row && row.stock !== "ไม่จำกัด") {
        const newStock = (parseInt(row.stock) || 0) + parseInt(item.addQty);
        db.run(`UPDATE products SET stock = ? WHERE tenant_id = ? AND id = ?`, [String(newStock), tenantId, item.id]);
      }
    });
  }); 
  setTimeout(() => { io.to(tenantId).emit('force_refresh_stock'); }, 500); res.json("success");
});

app.post('/api/upload-image', (req, res) => {
  try {
    const { tenantId, base64Data } = req.body; 
    if (!base64Data || !base64Data.includes(',')) return res.json(base64Data);
    const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/); 
    const ext = matches ? (matches[1].split('/')[1] || 'png') : 'png';
    const buffer = Buffer.from(matches ? matches[2] : base64Data, 'base64'); 
    const safeName = `img_${Date.now()}_${Math.floor(Math.random()*1000)}.${ext}`;
    const shopDir = path.join(__dirname, 'public', 'uploads', tenantId || 'general');
    if (!fs.existsSync(shopDir)) fs.mkdirSync(shopDir, { recursive: true });
    fs.writeFileSync(path.join(shopDir, safeName), buffer); 
    res.json(`/uploads/${tenantId || 'general'}/${safeName}`);
  } catch(e) { res.json("error: " + e.message); }
});

// ==========================================
// 💳 บันทึกการขาย & ตัดคอร์ส
// ==========================================
const checkoutLocks = {};

app.post('/api/save-order', async (req, res) => {
  const { tenantId, payload } = req.body; 
  const orderData = JSON.parse(payload);

  if (checkoutLocks[tenantId]) return res.json({ status: "error", message: "มีการชำระเงินพร้อมกันในระบบ กรุณารอ 2 วินาทีแล้วกดใหม่ครับ" });
  checkoutLocks[tenantId] = true;

  try {
    const checkStockBeforeSave = () => {
      return new Promise((resolve, reject) => {
        if (!orderData.cartItems || orderData.cartItems.length === 0) return resolve();
        let itemsToCheck = orderData.cartItems.length;
        let hasError = false;

        orderData.cartItems.forEach(item => {
          db.get(`SELECT name, stock FROM products WHERE tenant_id = ? AND id = ?`, [tenantId, item.id], (err, row) => {
            if (hasError) return;
            if (row && row.stock !== "ไม่จำกัด") {
              let currentStock = parseInt(row.stock) || 0;
              let orderQty = parseInt(item.qty) || 0;
              if (currentStock < orderQty) { hasError = true; reject(`สินค้า "${row.name}" มีสต็อกไม่พอ (เหลือแค่ ${currentStock})`); }
            }
            itemsToCheck--;
            if (itemsToCheck === 0 && !hasError) resolve();
          });
        });
      });
    };

    await checkStockBeforeSave(); 

    const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
    const recId = "REC" + d.getFullYear().toString().substr(-2) + pad(d.getMonth()+1) + pad(d.getDate()) + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    const timestamp = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

    db.run(`INSERT INTO sales_log (tenant_id, timestamp, receipt_id, patient_id, patient_name, customer_name, items_str, total, payment_method, phone, seller) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tenantId, timestamp, recId, orderData.patientId || null, orderData.patientName || null, orderData.customerName || "-", orderData.itemsStr, orderData.total, orderData.paymentMethod, orderData.phone || "-", orderData.seller || "Admin"], function(err) {
        if (err) { delete checkoutLocks[tenantId]; return res.json({ status: "error", message: err.message }); }

        if (orderData.cartItems) {
          orderData.cartItems.forEach(item => {
            db.get(`SELECT stock, type, course_qty, name FROM products WHERE tenant_id = ? AND id = ?`, [tenantId, item.id], (e, row) => {
              if (row) {
                if (row.stock !== "ไม่จำกัด") {
                  const newStock = Math.max(0, parseInt(row.stock) - parseInt(item.qty));
                  db.run(`UPDATE products SET stock = ? WHERE tenant_id = ? AND id = ?`, [String(newStock), tenantId, item.id]);
                }
                if (row.type === 'COURSE' && orderData.patientId) {
                  const totalCourseQty = (parseInt(row.course_qty) || 1) * parseInt(item.qty);
                  db.run(`INSERT INTO patient_courses (tenant_id, patient_id, product_id, course_name, total_qty, used_qty, remain_qty, status) VALUES (?, ?, ?, ?, ?, 0, ?, 'ACTIVE')`,
                    [tenantId, orderData.patientId, item.id, row.name, totalCourseQty, totalCourseQty]);
                }
              }
            });
          });
        }
        delete checkoutLocks[tenantId];
        io.to(tenantId).emit('force_refresh_stock');
        res.json({ status: "success", receiptId: recId });
    });
  } catch (errorMsg) {
    delete checkoutLocks[tenantId]; res.json({ status: "error", message: errorMsg });
  }
});

app.post('/api/void-order', (req, res) => {
  const { tenantId, receiptId } = req.body;
  db.get(`SELECT items_str, receipt_id FROM sales_log WHERE tenant_id = ? AND receipt_id = ?`, [tenantId, receiptId], (err, row) => {
    if (!row) return res.json("not_found");
    if (row.receipt_id.includes("(ยกเลิก)")) return res.json("already_voided");
    const itemsArr = row.items_str.split(' | '); const itemsToRestore = [];
    itemsArr.forEach(str => {
      if (str.startsWith('[หักส่วนลด') || str.startsWith('[คืนแล้ว]')) return;
      const match = str.match(/^(.*?)\s*\(x(\d+)/); if (match) itemsToRestore.push({ name: match[1].trim(), qty: parseInt(match[2], 10) });
    });
    db.run(`UPDATE sales_log SET receipt_id = '(ยกเลิก) ' || receipt_id WHERE tenant_id = ? AND receipt_id = ?`, [tenantId, receiptId], function(err) {
      if (err) return res.json("error");
      itemsToRestore.forEach(item => {
        db.get(`SELECT id, stock FROM products WHERE tenant_id = ? AND name = ?`, [tenantId, item.name], (err, prod) => {
          if (prod && prod.stock !== "ไม่จำกัด") {
            const newStock = (parseInt(prod.stock) || 0) + item.qty;
            db.run(`UPDATE products SET stock = ? WHERE tenant_id = ? AND id = ?`, [String(newStock), tenantId, prod.id]);
          }
        });
      });
      setTimeout(() => { io.to(tenantId).emit('force_refresh_stock'); }, 500); res.json("success");
    });
  });
});

app.post('/api/void-partial-item', (req, res) => {
  const { tenantId, receiptId, itemIndex, returnQty } = req.body;
  db.get(`SELECT items_str, total, receipt_id FROM sales_log WHERE tenant_id = ? AND receipt_id = ?`, [tenantId, receiptId], (err, row) => {
    if (!row) return res.json("not_found");
    if (row.receipt_id.includes("(ยกเลิก)")) return res.json("already_voided");
    let itemsArr = row.items_str.split(' | ');
    if (itemIndex < 0 || itemIndex >= itemsArr.length) return res.json("invalid_item");
    let targetItemStr = itemsArr[itemIndex];
    if (targetItemStr.startsWith('[หักส่วนลด') || targetItemStr.startsWith('[คืนแล้ว]')) return res.json("cannot_refund");
    const match = targetItemStr.match(/^(.*?)\s*\(x(\d+)(?:\s+(.*?))?\)\s*=\s*([\d\.,]+)\s*บ\./);
    if (!match) return res.json("parse_error");
    const name = match[1].trim(); const currentQty = parseInt(match[2], 10);
    const unit = match[3] ? match[3].trim() : ''; const currentLineTotal = parseFloat(match[4].replace(/,/g, ''));
    const pricePerUnit = currentLineTotal / currentQty; const retQty = parseInt(returnQty, 10);
    if (retQty <= 0 || retQty > currentQty) return res.json("invalid_qty");
    const newQty = currentQty - retQty; const newTotal = pricePerUnit * newQty; const refundAmount = pricePerUnit * retQty;
    if (newQty === 0) itemsArr[itemIndex] = `[คืนแล้ว] ${name} (x0${unit ? ' ' + unit : ''}) = 0 บ.`;
    else itemsArr[itemIndex] = `${name} (x${newQty}${unit ? ' ' + unit : ''}) = ${newTotal} บ.`;
    const newItemsStr = itemsArr.join(' | ');
    let newBillTotal = parseFloat(row.total) - refundAmount; if (newBillTotal < 0) newBillTotal = 0;
    db.run(`UPDATE sales_log SET items_str = ?, total = ? WHERE tenant_id = ? AND receipt_id = ?`, [newItemsStr, newBillTotal, tenantId, receiptId], function(err) {
      if (err) return res.json("error");
      db.get(`SELECT id, stock FROM products WHERE tenant_id = ? AND name = ?`, [tenantId, name], (err, prod) => {
        if (prod && prod.stock !== "ไม่จำกัด") {
          const newStock = (parseInt(prod.stock) || 0) + retQty;
          db.run(`UPDATE products SET stock = ? WHERE tenant_id = ? AND id = ?`, [String(newStock), tenantId, prod.id]);
        }
      });
      setTimeout(() => { io.to(tenantId).emit('force_refresh_stock'); }, 500); res.json("success");
    });
  });
});

app.post('/api/delete-test-bills', (req, res) => {
  const { tenantId, receiptIdsArray } = req.body; let count = 0;
  receiptIdsArray.forEach(id => {
    db.run(`DELETE FROM sales_log WHERE tenant_id = ? AND (receipt_id = ? OR receipt_id LIKE ?)`, [tenantId, id, `%${id}%`], function() { count += this.changes; });
  }); setTimeout(() => res.json({ status: 'success', count }), 500);
});

app.get('/api/dashboard/:tenantId', (req, res) => { db.all(`SELECT timestamp as dateStr, receipt_id as receiptId, items_str as items, total, payment_method as method, customer_name, seller FROM sales_log WHERE tenant_id = ? ORDER BY id DESC`, [req.params.tenantId], (err, rows) => res.json(rows || [])); });
app.post('/api/log-action', (req, res) => {
  const { tenantId, staffName, action, detail } = req.body; const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
  const timestamp = `${pad(d.getDate())}/${pad(d.getMonth()+1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  db.run(`INSERT INTO activity_log (tenant_id, timestamp, staff_name, action, detail) VALUES (?, ?, ?, ?, ?)`, [tenantId, timestamp, staffName, action, detail], () => res.json({ status: "success" }));
});
app.get('/api/activity-logs/:tenantId', (req, res) => { db.all(`SELECT timestamp, staff_name as staff, action, detail FROM activity_log WHERE tenant_id = ? ORDER BY id DESC LIMIT 300`, [req.params.tenantId], (err, rows) => res.json(rows || [])); });

function padStr(n) { return String(n).padStart(2, '0'); }
app.get('/api/tenant-info/:sheetId', (req, res) => {
  db.get(`SELECT email, shop_name as shopName, expire_date, renew_status, renew_notified FROM tenants WHERE sheet_id = ?`, [req.params.sheetId], (err, row) => {
    if (!row) return res.json(null);
    const today = new Date(); today.setHours(0,0,0,0); const exp = new Date(row.expire_date); exp.setHours(0,0,0,0);
    const daysRemaining = Math.ceil((exp - today) / (1000 * 3600 * 24));
    res.json({ email: row.email, shopName: row.shopName, expireDate: `${padStr(exp.getDate())}/${padStr(exp.getMonth()+1)}/${exp.getFullYear()}`, daysRemaining, renewStatus: row.renew_status || 'NONE', renewNotified: row.renew_notified !== undefined ? row.renew_notified : 1 });
  });
});

app.post('/api/clear-renew-notify', (req, res) => { db.run(`UPDATE tenants SET renew_notified = 1 WHERE sheet_id = ?`, [req.body.sheetId], () => { res.json({ status: "success" }); }); });

app.post('/api/request-register-otp', (req, res) => {
  const { email, phone } = req.body;
  db.get(`SELECT id FROM tenants WHERE LOWER(email)=LOWER(?) OR phone=?`, [email, phone], (err, row) => {
    if (row) return res.json({ status: "error", message: "Email หรือ เบอร์โทรศัพท์ นี้มีในระบบแล้ว" });
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore["REG_" + email] = otp;
    const mailOptions = { from: transporter.options.auth.user, to: email, subject: "รหัส OTP สำหรับยืนยันการสมัครเปิดร้าน POS", text: `สวัสดีครับ,\n\nรหัส OTP สำหรับยืนยันอีเมลของคุณคือ: ${otp}\n\nรหัสนี้มีอายุ 10 นาทีครับ` };
    transporter.sendMail(mailOptions).catch(err => console.error("Mail Error:", err));
    res.json({ status: "success" });
  });
});

app.post('/api/verify-and-create-shop', (req, res) => {
  const { password, shopName, email, phone } = req.body; 
  db.get(`SELECT id FROM tenants WHERE LOWER(email)=LOWER(?) OR phone=?`, [email, phone], (err, row) => {
    if (row) return res.json({ status: "error", message: "Email หรือ เบอร์โทรศัพท์ นี้มีในระบบแล้ว" });
    const sheetId = "SHOP_" + Date.now();
    const expDate = new Date(); expDate.setDate(expDate.getDate() + 30);
    const expStr = expDate.toISOString().split('T')[0];
    db.run(`INSERT INTO tenants (user, password, shop_name, email, phone, sheet_id, status, expire_date) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      [email, password, shopName, email, phone, sheetId, expStr], (err) => {
        if (err) return res.json({ status: "error", message: err.message });
        sendAdminAlert(`🎉 <b>มีร้านค้าสมัครใหม่!</b>\nอีเมล: ${escapeHtml(email)}\nร้าน: ${escapeHtml(shopName)}\nเบอร์: ${escapeHtml(phone)}`);
        res.json({ status: "success", expireDate: `${padStr(expDate.getDate())}/${padStr(expDate.getMonth()+1)}/${expDate.getFullYear()}` });
      });
  });
});

app.post('/api/request-reset-otp', (req, res) => {
  const { email } = req.body;
  db.get(`SELECT email FROM tenants WHERE LOWER(email)=LOWER(?) OR phone=?`, [email, email], (err, row) => {
    if (err || !row) return res.json({ status: "error", message: "ไม่พบ อีเมล หรือ เบอร์โทร นี้ในระบบ" });
    const targetEmail = row.email; const otp = Math.floor(100000 + Math.random() * 900000).toString();
    otpStore["RES_" + targetEmail] = otp;
    const mailOptions = { from: transporter.options.auth.user, to: targetEmail, subject: "รหัส OTP สำหรับรีเซ็ตรหัสผ่าน", text: `รหัส OTP ของคุณคือ: ${otp}\nหากคุณไม่ได้ทำรายการนี้ โปรดเพิกเฉยต่ออีเมลนี้` };
    transporter.sendMail(mailOptions).catch(err => console.error("Mail Error:", err));
    res.json({ status: "success", realEmail: targetEmail });
  });
});

app.post('/api/reset-password-direct', (req, res) => {
  const { email, phone, newPassword } = req.body; 
  db.get(`SELECT email, shop_name FROM tenants WHERE LOWER(email)=LOWER(?) AND phone=?`, [email, phone], (err, row) => {
    if (err || !row) return res.json({ status: "error", message: "❌ อีเมล หรือ เบอร์โทรศัพท์ ไม่ถูกต้อง" });
    db.run(`UPDATE tenants SET password = ? WHERE LOWER(email)=LOWER(?) AND phone=?`, [newPassword, email, phone], (err) => {
      if (err) return res.json({ status: "error", message: "เกิดข้อผิดพลาดในการเปลี่ยนรหัส" });
      res.json({ status: "success", shopName: row.shop_name });
    });
  });
});

app.post('/api/check-renew-email', (req, res) => {
  const { email } = req.body; 
  db.get(`SELECT email, shop_name FROM tenants WHERE LOWER(email)=LOWER(?) OR phone=?`, [email, email], (err, row) => {
    if (err || !row) return res.json({ status: "error", message: "ไม่พบข้อมูลร้านค้าจาก อีเมล หรือ เบอร์โทร นี้" });
    res.json({ status: "success", shopName: row.shop_name, realEmail: row.email });
  });
});

app.post(['/api/upload-slip-notify', '/api/upload-quick-renew-slip'], async (req, res) => {
  try {
    const { email, shopName, pkgName, price, base64Data } = req.body; 
    const cleanEmail = String(email || '-').trim(); const cleanPkg = String(pkgName || '1M').split('|')[0].trim(); const cleanPrice = String(price || '0').split('|')[0].trim();
    let fileUrl = ""; let filePath = ""; let buffer = null;
    const slipDir = path.join(__dirname, 'public', 'uploads', 'slip');
    if (!fs.existsSync(slipDir)) fs.mkdirSync(slipDir, { recursive: true });

    if (base64Data && base64Data.includes(',')) {
      const matches = base64Data.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/); 
      const ext = matches ? (matches[1].split('/')[1] || 'jpg') : 'jpg';
      buffer = Buffer.from(matches ? matches[2] : base64Data, 'base64'); 
      const safeName = `slip_${Date.now()}_${Math.floor(Math.random()*1000)}.${ext}`;
      filePath = path.join(slipDir, safeName);
      fs.writeFileSync(filePath, buffer); 
      fileUrl = `/uploads/slip/${safeName}`;
    }

    if (!filePath || !buffer) return res.json({ status: "error", message: "ไม่พบไฟล์รูปภาพสลิป" });
    const fullSlipUrl = `http://${req.get('host')}${fileUrl}`; const safeUrl = encodeURI(fullSlipUrl);

    let qrPayload = null;
    try {
        const image = await Jimp.read(buffer);
        image.resize(800, Jimp.AUTO);
        const imageData = new Uint8ClampedArray(image.bitmap.data);
        const qr = jsQR(imageData, image.bitmap.width, image.bitmap.height);
        if (qr) qrPayload = qr.data;
    } catch (qrErr) {}

    const refNoToSave = qrPayload || `NO_QR_${Date.now()}`;
    const existingSlip = await new Promise((resolve) => {
        if (!qrPayload) return resolve(null);
        db.get(`SELECT status FROM slip_logs WHERE ref_no = ?`, [qrPayload], (err, row) => { resolve(row); });
    });

    if (existingSlip && (existingSlip.status === 'USED' || existingSlip.status === 'PENDING')) {
        const dupMsg = `🚨 <b>แจ้งเตือน: พบการใช้สลิปซ้ำ!</b>\n\n🏢 ร้าน: ${escapeHtml(shopName)}\n📧 อีเมล: ${escapeHtml(email)}\n⚠️ บอทตรวจพบว่า QR Code บนสลิปนี้ <b>เคยถูกใช้ต่ออายุในระบบไปแล้ว</b>\n\n📄 <a href="${safeUrl}">ดูรูปสลิปที่มีปัญหา</a>`;
        axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: dupMsg, parse_mode: "HTML" }, { timeout: 5000 }).catch(()=>{});
        return res.json({ status: "error", message: "ขออภัยครับ สลิปใบนี้เคยถูกใช้งานในระบบไปแล้ว" }); 
    }

    db.run(`UPDATE tenants SET renew_status = 'PENDING' WHERE LOWER(email) = LOWER(?)`, [cleanEmail]);
    await new Promise((resolve) => {
      db.run(`INSERT OR REPLACE INTO slip_logs (ref_no, email, amount, package, timestamp, status) VALUES (?, ?, ?, ?, ?, 'PENDING')`, [refNoToSave, cleanEmail, cleanPrice, cleanPkg, new Date().toISOString()], () => resolve());
    });
    res.json({ status: "success", note: "processing_in_background" });

    (async () => {
      let isAutoApproved = false; let botRejectReason = "";
      try {
        const ocrImage = await Jimp.read(buffer);
        ocrImage.resize(600, Jimp.AUTO).grayscale();
        const ocrBuffer = await ocrImage.getBufferAsync(Jimp.MIME_JPEG);
        const { data: { text } } = await Tesseract.recognize(ocrBuffer, 'tha+eng');
        const slipText = text.toLowerCase().replace(/[\s,]+/g, ''); 

        const validNames = ["กนกพล", "โพธิสัย", "kanokphon", "phothisai"];
        const condition1 = validNames.some(name => slipText.includes(name));
        const condition2 = slipText.includes(`${cleanPrice}.00`) || slipText.includes(`${cleanPrice}บาท`) || slipText.includes(`จำนวนเงิน${cleanPrice}`);
        const condition4 = slipText.includes("7930") || slipText.includes("1697930") || slipText.includes("0981697930");

        if (condition1 && condition2 && condition4 && qrPayload) {
          isAutoApproved = true;
        } else {
          if (!qrPayload) botRejectReason = "ไม่พบ QR Code บอทจึงไม่สามารถยืนยันความถูกต้องได้";
          else botRejectReason = `ไม่ผ่านเงื่อนไข: ชื่อ=${condition1}, ยอด=${condition2}, พร้อมเพย์=${condition4}`;
        }
      } catch (ocrError) { botRejectReason = "บอทไม่สามารถอ่านตัวหนังสือจากรูปภาพนี้ได้"; }

      if (isAutoApproved) {
        let addMonths = 0;
        if (cleanPkg === "1M") addMonths = 1; else if (cleanPkg === "3M") addMonths = 3; else if (cleanPkg === "6M") addMonths = 6; else if (cleanPkg === "12M") addMonths = 12;

        db.get(`SELECT expire_date, shop_name FROM tenants WHERE LOWER(email) = LOWER(?)`, [cleanEmail], (err, row) => {
          if(row) {
            const currentExp = new Date(row.expire_date); const today = new Date();
            let baseDate = (currentExp < today) ? today : currentExp;
            baseDate.setMonth(baseDate.getMonth() + addMonths);
            const newExpStr = baseDate.toISOString().split('T')[0];

            db.run(`UPDATE tenants SET expire_date = ?, renew_status = 'NONE', renew_notified = 0 WHERE LOWER(email) = LOWER(?)`, [newExpStr, cleanEmail], () => {
              db.run(`UPDATE slip_logs SET status = 'USED' WHERE ref_no = ?`, [refNoToSave]);
              const padStr = (n) => String(n).padStart(2, '0');
              const autoMsg = `🤖✅ <b>BOT อนุมัติการต่ออายุอัตโนมัติ!</b>\n\n🏢 ร้าน: ${escapeHtml(row.shop_name)}\n📧 อีเมล: ${escapeHtml(cleanEmail)}\n📦 แพ็กเกจ: ${escapeHtml(cleanPkg)}\n💰 ยอดเงิน: ${cleanPrice} บาท\n📅 หมดอายุใหม่: ${padStr(baseDate.getDate())}/${padStr(baseDate.getMonth()+1)}/${baseDate.getFullYear()}\n\n📄 <a href="${safeUrl}">คลิกดูสลิปโอนเงิน</a>`;
              axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: autoMsg, parse_mode: "HTML" }).catch(()=>{});
            });
          }
        });
      } else {
        const message = `💳 <b>แจ้งโอนเงินต่ออายุ</b>\n⚠️ <i>BOT แนะนำให้ตรวจสอบ: ${botRejectReason}</i>\n\n🏢 ร้าน: ${escapeHtml(shopName)}\n📧 อีเมล: ${escapeHtml(email)}\n📦 แพ็กเกจ: ${escapeHtml(pkgName)}\n💰 ยอดเงิน: ${escapeHtml(price)} บาท\n\n📄 <a href="${safeUrl}">คลิกดูสลิปโอนเงิน</a>`;
        const approveData = `APP_${cleanPkg}|${cleanEmail}`.substring(0, 64);
        const rejectData = `REJ_${cleanEmail}`.substring(0, 64);
        const keyboard = { inline_keyboard: [ [ { text: `✅ อนุมัติ ${cleanPkg}`, callback_data: approveData } ], [ { text: "❌ ไม่อนุมัติ", callback_data: rejectData } ] ] };
        axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: TELEGRAM_CHAT_ID, text: message, parse_mode: "HTML", reply_markup: keyboard }).catch(()=>{});
      }
    })();
  } catch(e) { res.json({ status: "error", message: "เกิดข้อผิดพลาดภายในเซิร์ฟเวอร์" }); }
});

// ==========================================
// 🤖 Telegram Bot Polling (อนุมัติสลิป)
// ==========================================
let lastUpdateId = 0; let isPollingTelegram = false;
async function pollTelegram() {
  if (isPollingTelegram) return;
  isPollingTelegram = true;
  try {
    const response = await axios.get(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates?offset=${lastUpdateId + 1}&timeout=5`, { timeout: 10000 });
    if (response.data && response.data.ok && response.data.result.length > 0) {
      for (const update of response.data.result) {
        lastUpdateId = update.update_id;
        if (update.message && update.message.text) {
          const chatId = String(update.message.chat.id); const text = update.message.text.trim();
          if (chatId === String(TELEGRAM_CHAT_ID)) {
            if (text === '/git pull' || text === '/pull git') {
              axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: "⏳ <b>กำลังดึงโค้ดล่าสุดจาก Git...</b>", parse_mode: "HTML" }).catch(()=>{});
              exec('git pull', (err, stdout, stderr) => {
                let replyText = err ? `❌ <b>Git Pull ล้มเหลว:</b>\n<code>${escapeHtml(err.message)}</code>` : `✅ <b>Git Pull สำเร็จ!</b>\n<code>${escapeHtml(stdout || 'Already up to date.')}</code>\n\n🔄 กำลังสั่ง Restart ระบบ POS...`;
                axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: replyText, parse_mode: "HTML" }).then(() => { if (!err) exec('pm2 restart my-pos'); }).catch(() => { if (!err) exec('pm2 restart my-pos'); });
              });
            } else if (text === '/restart shop') {
              exec('pm2 restart my-pos', (err) => { if (err) axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: `❌ <b>Restart ล้มเหลว:</b>\n<code>${escapeHtml(err.message)}</code>`, parse_mode: "HTML" }).catch(()=>{}); });
            } else if (text === '/-c slip' || text === '/clearslip') {
              db.serialize(() => {
                db.run('DELETE FROM slip_logs');
                db.run("UPDATE tenants SET renew_status = 'NONE'", (err) => { axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, { chat_id: chatId, text: err ? "❌ Error" : "🧹 เคลียร์ประวัติสลิปแล้ว", parse_mode: "HTML" }).catch(()=>{}); });
              });
            }
          }
        } else if (update.callback_query) {
          const callbackData = update.callback_query.data; const callbackQueryId = update.callback_query.id; const chatId = update.callback_query.message.chat.id; const messageId = update.callback_query.message.message_id;
          axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/answerCallbackQuery`, { callback_query_id: callbackQueryId }).catch(()=>{});
          let action = ""; let pkg = "1M"; let email = "";
          if (callbackData.startsWith("APP_") || callbackData.startsWith("APPROVE_")) { action = "APPROVE"; const parts = callbackData.replace(/^APPROVE_|^APP_/, '').split('|'); pkg = parts[0] || "1M"; email = parts[1] || ""; } 
          else if (callbackData.startsWith("REJ_") || callbackData.startsWith("REJECT_")) { action = "REJECT"; email = callbackData.replace(/^REJECT_|^REJ_/, ''); }

          if (action === "APPROVE") {
            axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, { chat_id: chatId, message_id: messageId, text: "⏳ <b>กำลังดำเนินการอนุมัติ...</b>", parse_mode: "HTML" }).catch(()=>{});
            let addMonths = 1; if (pkg === "3M") addMonths = 3; else if (pkg === "6M") addMonths = 6; else if (pkg === "12M") addMonths = 12;
            db.get(`SELECT expire_date, shop_name, renew_status FROM tenants WHERE LOWER(email) = LOWER(?)`, [email], (err, row) => {
              if (row && row.renew_status === 'PENDING') {
                const currentExp = new Date(row.expire_date); const today = new Date(); let baseDate = (currentExp < today) ? today : currentExp; baseDate.setMonth(baseDate.getMonth() + addMonths); const newExpStr = baseDate.toISOString().split('T')[0];
                db.run(`UPDATE tenants SET expire_date = ?, renew_status = 'NONE', renew_notified = 0 WHERE LOWER(email) = LOWER(?)`, [newExpStr, email], async () => {
                  db.run(`UPDATE slip_logs SET status = 'USED' WHERE LOWER(email) = LOWER(?) AND status = 'PENDING'`, [email]);
                  const newText = `✅ <b>อนุมัติการต่ออายุเรียบร้อยแล้ว</b>\nร้าน: ${row.shop_name}\nวันหมดอายุใหม่: ${padStr(baseDate.getDate())}/${padStr(baseDate.getMonth()+1)}/${baseDate.getFullYear()}`;
                  axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, { chat_id: chatId, message_id: messageId, text: newText, parse_mode: "HTML" }).catch(()=>{});
                });
              } else { axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, { chat_id: chatId, message_id: messageId, text: "⚠️ <b>รายการนี้ถูกดำเนินการไปแล้ว หรือไม่พบข้อมูลร้านค้า</b>", parse_mode: "HTML" }).catch(()=>{}); }
            });
          } else if (action === "REJECT") {
            db.run(`UPDATE slip_logs SET status = 'REJECTED' WHERE LOWER(email) = LOWER(?) AND status = 'PENDING'`, [email]);
            db.get(`SELECT shop_name FROM tenants WHERE LOWER(email) = LOWER(?)`, [email], (err, row) => {
              if (row) {
                db.run(`UPDATE tenants SET renew_status = 'NONE' WHERE LOWER(email) = LOWER(?)`, [email], () => { axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/editMessageText`, { chat_id: chatId, message_id: messageId, text: "❌ <b>ปฏิเสธการต่ออายุเรียบร้อยแล้ว</b>", parse_mode: "HTML" }).catch(() => {}); });
              }
            });
          }
        }
      }
    }
  } catch (e) { } finally { isPollingTelegram = false; setTimeout(pollTelegram, 2000); }
}
pollTelegram();

// ==========================================
// 📥 API นำเข้า Excel
// ==========================================
app.post('/api/import-excel', (req, res) => {
  const { tenantId, payload } = req.body;
  if (!tenantId || !payload) return res.json({ status: "error", message: "ข้อมูลไม่ครบถ้วน" });
  try {
    const data = JSON.parse(payload); const settings = data.settings || {}; const products = data.products || [];
    if (Object.keys(settings).length > 0) {
      const stmt = db.prepare(`INSERT INTO settings (tenant_id, key, value) VALUES (?, ?, ?) ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value`);
      for (const [key, value] of Object.entries(settings)) stmt.run(tenantId, key, String(value));
      stmt.finalize();
    }
    if (products.length > 0) {
      const pStmt = db.prepare(`INSERT INTO products (tenant_id, id, name, price, image, category, stock, min_stock, unit) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(tenant_id, id) DO UPDATE SET name=excluded.name, price=excluded.price, image=excluded.image, category=excluded.category, stock=excluded.stock, min_stock=excluded.min_stock, unit=excluded.unit`);
      products.forEach(p => pStmt.run(tenantId, p.id, p.name, p.price, p.image, p.category, p.stock, p.minStock, p.unit));
      pStmt.finalize();
    }
    res.json({ status: "success" });
  } catch (e) { res.json({ status: "error", message: e.message }); }
});

// =================================================================
// 👑 ระบบ Super Admin (จัดการร้านค้า)
// =================================================================
const verifySuperAdmin = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ status: "error", message: "Unauthorized: ไม่มีสิทธิ์เข้าถึง" });
    const token = authHeader.split(" ")[1];
    jwt.verify(token, SECRET_KEY, (err, decoded) => { if (err || decoded.role !== 'superadmin') return res.status(403).json({ status: "error", message: "Forbidden: บัตรไม่ถูกต้องหรือหมดอายุ" }); next(); });
};
app.get('/api/superadmin/tenants', verifySuperAdmin, (req, res) => { db.all(`SELECT id, shop_name, email, phone, password, expire_date, sheet_id, status FROM tenants ORDER BY id DESC`, [], (err, rows) => { res.json(rows || []); }); });
app.get('/api/superadmin/tenant-details/:sheetId', verifySuperAdmin, async (req, res) => {
  const sheetId = req.params.sheetId;
  const queryDB = (sql, params) => new Promise((resolve, reject) => { db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); }); });
  try {
    const [products, sales, users, settings, logs] = await Promise.all([
      queryDB(`SELECT * FROM products WHERE tenant_id = ?`, [sheetId]), queryDB(`SELECT * FROM sales_log WHERE tenant_id = ? ORDER BY id DESC`, [sheetId]), queryDB(`SELECT * FROM users WHERE tenant_id = ?`, [sheetId]), queryDB(`SELECT * FROM settings WHERE tenant_id = ?`, [sheetId]), queryDB(`SELECT * FROM activity_log WHERE tenant_id = ? ORDER BY id DESC LIMIT 500`, [sheetId])
    ]);
    res.json({ status: "success", products, sales, users, settings, logs });
  } catch (err) { res.json({ status: "error", message: err.message }); }
});
app.post('/api/superadmin/kick-tenant', verifySuperAdmin, (req, res) => { io.to(req.body.sheetId).emit('force_logout_event'); res.json({ status: "success" }); });
app.get('/api/superadmin/online-status', verifySuperAdmin, (req, res) => {
  const onlineShops = {};
  for (const [roomName, sockets] of io.sockets.adapter.rooms.entries()) { if (roomName.startsWith('SHOP_')) onlineShops[roomName] = sockets.size; }
  res.json(onlineShops);
});
app.post('/api/superadmin/delete-tenant', verifySuperAdmin, (req, res) => {
  const { sheetId } = req.body;
  const shopDirPath = path.join(__dirname, 'public', 'uploads', sheetId);
  if (fs.existsSync(shopDirPath)) fs.rmSync(shopDirPath, { recursive: true, force: true });
  db.serialize(() => {
    db.run(`DELETE FROM tenants WHERE sheet_id = ?`, [sheetId]); db.run(`DELETE FROM users WHERE tenant_id = ?`, [sheetId]); db.run(`DELETE FROM products WHERE tenant_id = ?`, [sheetId]); db.run(`DELETE FROM sales_log WHERE tenant_id = ?`, [sheetId]); db.run(`DELETE FROM settings WHERE tenant_id = ?`, [sheetId]);
    db.run(`DELETE FROM activity_log WHERE tenant_id = ?`, [sheetId], function(err) { res.json({ status: err ? "error" : "success" }); });
  });
});
app.post('/api/superadmin/edit-tenant', verifySuperAdmin, (req, res) => { db.run(`UPDATE tenants SET password = ?, expire_date = ? WHERE sheet_id = ?`, [req.body.password, req.body.expireDate, req.body.sheetId], function(err) { res.json({ status: err ? "error" : "success" }); }); });
app.get('/api/superadmin/settings', verifySuperAdmin, (req, res) => { db.all(`SELECT key, value FROM superadmin_settings`, [], (err, rows) => { const sa = {}; if (rows) rows.forEach(r => sa[r.key] = r.value); res.json(sa); }); });
app.post('/api/superadmin/request-otp', verifySuperAdmin, (req, res) => {
  db.get(`SELECT value FROM superadmin_settings WHERE key = 'email'`, [], (err, row) => {
    const email = row ? row.value : '';
    if (!email || email.trim() === '') return res.json({ status: "no_email_bound" }); 
    const otp = Math.floor(100000 + Math.random() * 900000).toString(); otpStore["SA_OTP"] = otp; 
    transporter.sendMail({ from: transporter.options.auth.user, to: email, subject: "รหัส OTP", text: `รหัส OTP คือ: ${otp}` }).catch(()=>{});
    res.json({ status: "success", email: email });
  });
});
app.post('/api/superadmin/update-settings', verifySuperAdmin, (req, res) => {
  let { otp, newEmail, newUsername, newPassword } = req.body;
  db.get(`SELECT value FROM superadmin_settings WHERE key = 'email'`, [], (err, row) => {
    const currentEmail = row ? row.value : '';
    if (currentEmail && currentEmail.trim() !== '' && otpStore["SA_OTP"] !== otp) return res.json({ status: "error", message: "รหัส OTP ไม่ถูกต้อง" });
    if (!newEmail || newEmail.trim() === '') { newUsername = 'superadmin'; newPassword = '1234'; }
    const stmt = db.prepare(`UPDATE superadmin_settings SET value = ? WHERE key = ?`);
    stmt.run(newEmail, 'email'); stmt.run(newUsername, 'username'); stmt.run(newPassword, 'password'); stmt.finalize();
    delete otpStore["SA_OTP"]; res.json({ status: "success" });
  });
});
app.post('/api/superadmin/add-tenant', verifySuperAdmin, (req, res) => {
  const { shopName, email, phone, password, expireDate } = req.body;
  db.get(`SELECT id FROM tenants WHERE LOWER(email)=LOWER(?) OR phone=?`, [email, phone], (err, row) => {
    if (row) return res.json({ status: "error", message: "มีคนใช้งานแล้ว" });
    db.run(`INSERT INTO tenants (user, password, shop_name, email, phone, sheet_id, status, expire_date) VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE', ?)`,
      [email, password, shopName, email, phone, "SHOP_" + Date.now(), expireDate], (err) => { res.json({ status: err ? "error" : "success" }); });
  });
});
app.get('/api/package-prices', (req, res) => {
  db.all(`SELECT key, value FROM superadmin_settings WHERE key LIKE 'pkg_%'`, [], (err, rows) => {
    const pkgs = { pkg_1m: '150', pkg_3m: '400', pkg_6m: '750', pkg_12m: '1200' }; 
    if (rows) rows.forEach(r => pkgs[r.key] = r.value); res.json(pkgs);
  });
});
app.post('/api/superadmin/update-packages', verifySuperAdmin, (req, res) => {
  const { pkg_1m, pkg_3m, pkg_6m, pkg_12m } = req.body; const stmt = db.prepare(`UPDATE superadmin_settings SET value = ? WHERE key = ?`);
  if(pkg_1m) stmt.run(pkg_1m, 'pkg_1m'); if(pkg_3m) stmt.run(pkg_3m, 'pkg_3m'); if(pkg_6m) stmt.run(pkg_6m, 'pkg_6m'); if(pkg_12m) stmt.run(pkg_12m, 'pkg_12m'); stmt.finalize(); res.json({ status: "success" });
});

// =================================================================
// 🏥 CLINIC MANAGEMENT API ENDPOINTS (เพิ่มใหม่สำหรับคลินิก)
// =================================================================
app.get('/api/patients/:tenantId', (req, res) => {
  db.all(`SELECT * FROM patients WHERE tenant_id = ? ORDER BY id DESC`, [req.params.tenantId], (err, rows) => res.json(rows || []));
});
app.post('/api/patients/add', (req, res) => {
  const { tenantId, patient } = req.body; const hnCode = `HN${Date.now().toString().slice(-6)}`;
  db.run(`INSERT INTO patients (tenant_id, hn_code, id_card, prefix, first_name, last_name, phone, birthdate, gender, congenital_disease, allergy, register_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, hnCode, patient.id_card, patient.prefix, patient.first_name, patient.last_name, patient.phone, patient.birthdate, patient.gender, patient.congenital_disease, patient.allergy, new Date().toISOString().split('T')[0]],
    function(err) { res.json(err ? { status: "error", message: err.message } : { status: "success", hn_code: hnCode }); }
  );
});
app.get('/api/appointments/:tenantId', (req, res) => {
  db.all(`SELECT a.*, p.first_name, p.last_name, p.hn_code, p.phone FROM appointments a LEFT JOIN patients p ON a.patient_id = p.id WHERE a.tenant_id = ? ORDER BY a.appointment_date ASC, a.appointment_time ASC`, [req.params.tenantId], (err, rows) => res.json(rows || []));
});
app.post('/api/appointments/add', (req, res) => {
  const { tenantId, appointment } = req.body;
  db.run(`INSERT INTO appointments (tenant_id, patient_id, doctor_id, appointment_date, appointment_time, room_name, status, notes) VALUES (?, ?, ?, ?, ?, ?, 'WAITING', ?)`,
    [tenantId, appointment.patient_id, appointment.doctor_id, appointment.date, appointment.time, appointment.room, appointment.notes],
    function(err) { if(!err) io.to(tenantId).emit('refresh_queue'); res.json(err ? { status: "error", message: err.message } : { status: "success" }); }
  );
});
// --- วางต่อท้าย app.post('/api/appointments/add', ...) ใน server.js ---
app.post('/api/appointments/update-status', (req, res) => {
  const { tenantId, id, status } = req.body;
  db.run(`UPDATE appointments SET status = ? WHERE tenant_id = ? AND id = ?`, [status, tenantId, id], function(err) {
    if (err) return res.json({ status: "error", message: err.message });
    io.to(tenantId).emit('refresh_queue'); // แจ้งเตือนหน้าจออื่นให้รีเฟรชคิว
    res.json({ status: "success" });
  });
});
app.get('/api/emr/:tenantId/:patientId', (req, res) => {
  db.all(`SELECT * FROM emr_records WHERE tenant_id = ? AND patient_id = ? ORDER BY visit_date DESC`, [req.params.tenantId, req.params.patientId], (err, rows) => res.json(rows || []));
});
app.post('/api/emr/add', (req, res) => {
  const { tenantId, record } = req.body;
  db.run(`INSERT INTO emr_records (tenant_id, patient_id, doctor_id, visit_date, symptoms, diagnosis, treatment, images_json, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [tenantId, record.patient_id, record.doctor_id, new Date().toISOString(), record.symptoms, record.diagnosis, record.treatment, record.images_json, record.notes],
    function(err) { res.json(err ? { status: "error", message: err.message } : { status: "success" }); }
  );
});
app.get('/api/courses/:tenantId/:patientId', (req, res) => {
  db.all(`SELECT * FROM patient_courses WHERE tenant_id = ? AND patient_id = ? AND status = 'ACTIVE'`, [req.params.tenantId, req.params.patientId], (err, rows) => res.json(rows || []));
});
app.get('/api/courses/all/:tenantId', (req, res) => {
  db.all(`SELECT c.*, p.first_name, p.last_name, p.hn_code FROM patient_courses c LEFT JOIN patients p ON c.patient_id = p.id WHERE c.tenant_id = ? AND c.status = 'ACTIVE'`, [req.params.tenantId], (err, rows) => res.json(rows || []));
});
app.post('/api/courses/deduct', (req, res) => {
  const { tenantId, courseId, deductQty } = req.body;
  db.get(`SELECT remain_qty FROM patient_courses WHERE id = ? AND tenant_id = ?`, [courseId, tenantId], (err, row) => {
    if (!row || row.remain_qty < deductQty) return res.json({ status: "error", message: "จำนวนคอร์สไม่เพียงพอ" });
    const newRemain = row.remain_qty - deductQty;
    db.run(`UPDATE patient_courses SET used_qty = used_qty + ?, remain_qty = ?, status = ? WHERE id = ?`,
      [deductQty, newRemain, newRemain <= 0 ? 'COMPLETED' : 'ACTIVE', courseId], function(err) { res.json({ status: "success", remain: newRemain }); });
  });
});

// =================================================================
// 🌟 Socket.io: ระบบจอลูกค้าออนไลน์ (CFD)
// =================================================================
io.on('connection', (socket) => {
  socket.on('join_shop_room', (shopId) => { socket.join(shopId); console.log(`📱 จอลูกค้า (CFD) เชื่อมต่อร้าน: ${shopId}`); });
  socket.on('update_cfd', (data) => { if (data.shopId) socket.to(data.shopId).emit('cfd_data_sync', data); });
});

// 🚀 เปลี่ยน Port กลับให้ถูกต้อง
server.listen(3001, () => console.log('🚀 Clinic Application Server running on http://localhost:3001'));