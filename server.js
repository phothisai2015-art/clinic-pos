const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const db = require('./database');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir, { recursive: true }); }

db.run(`ALTER TABLE emr_logs ADD COLUMN next_appointment_date TEXT`, () => {});
db.run(`ALTER TABLE emr_logs ADD COLUMN next_appointment_time TEXT`, () => {});
db.run(`ALTER TABLE emr_logs ADD COLUMN next_appointment_note TEXT`, () => {});

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS patient_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT, photo_type TEXT, image_path TEXT, created_at TEXT)`);
  db.run(`ALTER TABLE appointments ADD COLUMN is_walkin BOOLEAN DEFAULT 0`, () => {});
  db.run(`ALTER TABLE appointments ADD COLUMN bp TEXT`, () => {});
  db.run(`ALTER TABLE appointments ADD COLUMN pulse TEXT`, () => {});
  db.run(`ALTER TABLE appointments ADD COLUMN weight TEXT`, () => {});
  db.run(`ALTER TABLE appointments ADD COLUMN height TEXT`, () => {});
  db.run(`ALTER TABLE appointments ADD COLUMN sales_rep TEXT`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN lot_number TEXT DEFAULT '-'`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN expiry_date TEXT`, () => {});
  db.run(`ALTER TABLE products ADD COLUMN bundle_items TEXT DEFAULT '[]'`, () => {});
  
  db.run(`ALTER TABLE emr_logs ADD COLUMN bp TEXT`, () => {});
  db.run(`ALTER TABLE emr_logs ADD COLUMN pulse TEXT`, () => {});
  db.run(`ALTER TABLE emr_logs ADD COLUMN weight TEXT`, () => {});
  db.run(`ALTER TABLE emr_logs ADD COLUMN height TEXT`, () => {});
  
  db.run(`ALTER TABLE clinics ADD COLUMN logo_url TEXT`, () => {});
  db.run(`ALTER TABLE clinics ADD COLUMN promptpay TEXT`, () => {});
  db.run(`ALTER TABLE clinics ADD COLUMN bank_account_name TEXT`, () => {});
  db.run(`ALTER TABLE clinics ADD COLUMN address TEXT`, () => {});
  
  db.get("SELECT count(*) as count FROM clinics", (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO clinics (clinic_name, email, phone) VALUES ('Clinic Management System', 'admin@clinic.com', '-')`);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS patient_bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    patient_id TEXT,
    bill_date TEXT,
    item_name TEXT,
    type TEXT,
    product_id TEXT,
    qty REAL DEFAULT 1,
    total_price REAL,
    paid_amount REAL DEFAULT 0,
    status TEXT DEFAULT 'UNPAID',
    stock_deducted BOOLEAN DEFAULT 0
  )`);
});

// ==========================================
// 💳 API ระบบคอร์สความงาม (Patient Courses)
// ==========================================
app.get('/api/patients/:id/courses', (req, res) => {
  const sql = `SELECT c.*, p.name as product_name, p.unit FROM patient_courses c LEFT JOIN products p ON c.product_id = p.id WHERE c.patient_id = ?`;
  db.all(sql, [req.params.id], (err, rows) => { res.json({ status: 'success', data: rows || [] }); });
});

app.post('/api/patients/:id/courses', (req, res) => {
  const { course_name, total_qty } = req.body;
  db.run(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, ?, 0)`, 
    [req.params.id, course_name, parseFloat(total_qty)], function(err) { res.json({ status: 'success', course_id: this.lastID }); });
});

app.put('/api/courses/:id/deduct', (req, res) => {
  const deductVal = parseFloat(req.body.deduct_amount);
  db.get(`SELECT product_id FROM patient_courses WHERE id = ?`, [req.params.id], (err, course) => {
    if (err || !course) return res.status(500).json({ status: 'error', message: 'ไม่พบคอร์ส' });
    db.run(`UPDATE patient_courses SET used_qty = used_qty + ? WHERE id = ?`, [deductVal, req.params.id], function(err2) {
      db.run(`UPDATE products SET stock = stock - ? WHERE id = ?`, [deductVal, course.product_id], function(err3) { res.json({ status: 'success' }); });
    });
  });
});

// ==========================================
// 🌟 Helper ฟังก์ชันป้องกันเซิร์ฟเวอร์ค้าง (Async DB)
// ==========================================
const dbGet = (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const dbRun = (sql, params) => new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this) }));

// ==========================================
// 🌟 API แตกโปรโมชั่น (แก้ไขบั๊กโปรโมชั่นไม่มีของแถม)
// ==========================================
app.post('/api/patients/:id/assign-promo', async (req, res) => {
  const { product_id } = req.body;
  const patient_id = req.params.id;
  try {
    const prod = await dbGet(`SELECT * FROM products WHERE id = ?`, [product_id]);
    if (!prod) return res.status(500).json({status: 'error', message: 'ไม่พบโปรโมชั่น'});
    const today = new Date().toISOString().split('T')[0];

    // 1. ตั้งหนี้ในบิล
    await dbRun(`INSERT INTO patient_bills (clinic_id, patient_id, bill_date, item_name, type, product_id, qty, total_price, paid_amount, status) VALUES (1, ?, ?, ?, ?, ?, 1, ?, 0, 'UNPAID')`,
      [patient_id, today, prod.name, prod.type, prod.id, prod.price]);

    // 2. แตกไอเท็มย่อยใส่คอร์สให้ลูกค้า
    if (prod.type === 'PROMOTION') {
      let items = [];
      try { items = JSON.parse(prod.bundle_items || '[]'); } catch(e){}
      
      if (items.length > 0) {
        for (let item of items) { 
          await dbRun(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, ?, 0)`, [patient_id, item.id, item.qty]); 
        }
      } else {
        // 🌟 ถ้าโปรโมชั่นไม่มีของย่อย ให้ตั้งชื่อโปรนั้นเป็นคอร์ส 1 ครั้ง
        await dbRun(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, 1, 0)`, [patient_id, prod.id]);
      }
    } else {
      await dbRun(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, 1, 0)`, [patient_id, prod.id]);
    }
    res.json({status: 'success'});
  } catch (err) { res.status(500).json({status: 'error'}); }
});

// ==========================================
// 🌟 API ดึงบิล POS
// ==========================================
app.get('/api/pos/bill/:hn', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.all(`SELECT * FROM patient_bills WHERE patient_id = ? AND (status != 'PAID' OR bill_date = ?) ORDER BY id ASC`, [req.params.hn, today], (err, rows) => {
    res.json({status: 'success', data: rows});
  });
});

// ==========================================
// 🌟 API รับชำระเงิน POS (แก้คูณจำนวนคอร์ส และโปรไม่มีของแถม)
// ==========================================
app.put('/api/pos/pay/:hn', async (req, res) => {
  const { sales_rep, payments, new_items } = req.body; 
  const hn = req.params.hn; const today = new Date().toISOString().split('T')[0];

  try {
    if (payments && payments.length > 0) {
      for (let p of payments) {
        let bill = await dbGet(`SELECT * FROM patient_bills WHERE id = ?`, [p.bill_id]);
        if (bill) {
          let newPaid = bill.paid_amount + p.pay_amount;
          let newStatus = newPaid >= bill.total_price ? 'PAID' : 'PARTIAL';
          await dbRun(`UPDATE patient_bills SET paid_amount = ?, status = ? WHERE id = ?`, [newPaid, newStatus, p.bill_id]);

          if ((bill.type === 'MEDICINE' || bill.type === 'SKINCARE') && bill.stock_deducted === 0 && p.pay_amount > 0) {
            await dbRun(`UPDATE products SET stock = stock - ? WHERE id = ?`, [bill.qty, bill.product_id]);
            await dbRun(`UPDATE patient_bills SET stock_deducted = 1 WHERE id = ?`, [p.bill_id]);
          }
        }
      }
    }

    if (new_items && new_items.length > 0) {
      for (let item of new_items) {
        let total = item.qty * item.price;
        let newStatus = item.pay_amount >= total ? 'PAID' : 'PARTIAL';
        let insertRes = await dbRun(`INSERT INTO patient_bills (clinic_id, patient_id, bill_date, item_name, type, product_id, qty, total_price, paid_amount, status, stock_deducted) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [hn, today, item.name, item.type, item.product_id, item.qty, total, item.pay_amount, newStatus, 0]);
          
        if (item.is_new_course) {
           let prod = await dbGet(`SELECT bundle_items FROM products WHERE id = ?`, [item.product_id]);
           let bItems = [];
           if (prod && prod.bundle_items) { try { bItems = JSON.parse(prod.bundle_items); } catch(e){} }
           
           if (bItems.length > 0) {
              for (let b of bItems) { await dbRun(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, ?, 0)`, [hn, b.id, b.qty * item.qty]); }
           } else {
              // 🌟 ถ้าซื้อจาก POS แล้วเป็นโปรที่ไม่มีของย่อย ก็บันทึกคอร์สตามจำนวนที่ซื้อไปเลย
              await dbRun(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, ?, 0)`, [hn, item.product_id, item.qty]);
           }
        } else if ((item.type === 'MEDICINE' || item.type === 'SKINCARE') && item.pay_amount > 0) {
           await dbRun(`UPDATE products SET stock = stock - ? WHERE id = ?`, [item.qty, item.product_id]);
           await dbRun(`UPDATE patient_bills SET stock_deducted = 1 WHERE id = ?`, [insertRes.lastID]);
        }
      }
    }

    await dbRun(`UPDATE appointments SET status = 'PAID', sales_rep = ? WHERE patient_id = ? AND status = 'WAITING_PAYMENT'`, [sales_rep || '-', hn]);
    res.json({ status: 'success' });
  } catch (err) {
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ==========================================
// 📦 API ระบบอื่นๆ (Inventory, Users, EMR, Settings)
// ==========================================
app.get('/api/inventory', (req, res) => { db.all(`SELECT * FROM products ORDER BY type ASC, name ASC`, [], (err, rows) => { res.json({ status: 'success', data: rows }); }); });
app.post('/api/inventory', (req, res) => {
  const { id, name, type, price, stock, unit, lot_number, expiry_date, bundle_items } = req.body;
  const sql = `INSERT INTO products (id, clinic_id, name, type, price, stock, unit, lot_number, expiry_date, bundle_items) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, price=excluded.price, stock=excluded.stock, unit=excluded.unit, lot_number=excluded.lot_number, expiry_date=excluded.expiry_date, bundle_items=excluded.bundle_items`;
  db.run(sql, [id, name, type, price, stock, unit, lot_number || '-', expiry_date || '', bundle_items || '[]'], () => res.json({ status: 'success' }));
});
app.put('/api/inventory/:id/stock', (req, res) => { db.run(`UPDATE products SET stock = stock + ? WHERE id = ?`, [req.body.adjust_qty, req.params.id], () => res.json({status: 'success'})); });
app.delete('/api/inventory/:id', (req, res) => { db.run(`DELETE FROM products WHERE id = ?`, [req.params.id], () => res.json({status: 'success'})); });

app.get('/setting.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'setting.html')); });
app.get('/api/users', (req, res) => { db.all(`SELECT id, name, pin, role, permissions FROM users ORDER BY id ASC`, [], (err, rows) => { res.json({ status: 'success', data: rows }); }); });
app.post('/api/users', (req, res) => {
  const { name, pin, role, permissions } = req.body;
  db.get(`SELECT id FROM users WHERE pin = ?`, [pin], (err, row) => {
    if (row) return res.json({ status: 'error', message: 'รหัส PIN นี้มีผู้ใช้งานแล้ว กรุณาตั้งรหัสใหม่' });
    db.run(`INSERT INTO users (clinic_id, pin, name, role, permissions) VALUES (1, ?, ?, ?, ?)`, [pin, name, role, permissions], function(err) { res.json({ status: 'success', user_id: this.lastID }); });
  });
});
app.put('/api/users/:id', (req, res) => {
  const { name, pin, role, permissions } = req.body;
  db.get(`SELECT id FROM users WHERE pin = ? AND id != ?`, [pin, req.params.id], (err, row) => {
    if (row) return res.json({ status: 'error', message: 'รหัส PIN นี้ถูกใช้ไปแล้ว กรุณาตั้งรหัสใหม่' });
    db.run(`UPDATE users SET name=?, pin=?, role=?, permissions=? WHERE id=?`, [name, pin, role, permissions, req.params.id], function(err) { res.json({ status: 'success' }); });
  });
});
app.delete('/api/users/:id', (req, res) => { db.run(`DELETE FROM users WHERE id=?`, [req.params.id], function(err) { res.json({ status: 'success' }); }); });

app.get('/reports.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'reports.html')); });
app.get('/api/reports/dashboard', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  db.get(`SELECT SUM(paid_amount) as total_revenue FROM patient_bills WHERE status = 'PAID' AND bill_date = ?`, [today], (err, revRow) => {
    const todayRevenue = revRow ? (revRow.total_revenue || 0) : 0;
    db.get(`SELECT COUNT(id) as total_appt FROM appointments WHERE appointment_date = ?`, [today], (err, apptRow) => {
      const todayAppt = apptRow ? (apptRow.total_appt || 0) : 0;
      db.all(`SELECT bill_date, SUM(paid_amount) as revenue FROM patient_bills WHERE status = 'PAID' GROUP BY bill_date ORDER BY bill_date DESC LIMIT 7`, [], (err, chartRows) => { res.json({ status: 'success', today_revenue: todayRevenue, today_appt: todayAppt, chart_data: chartRows || [] }); });
    });
  });
});

app.get('/api/check-setup', (req, res) => { db.get("SELECT count(*) as count FROM users", (err, row) => { res.json({ status: 'success', needsSetup: row.count === 0 }); }); });
app.post('/api/setup-admin', (req, res) => {
  const { name, pin } = req.body;
  db.get("SELECT count(*) as count FROM users", (err, row) => {
    if (row && row.count > 0) return res.json({ status: 'error', message: 'ระบบถูกตั้งค่าผู้ดูแลระบบไปแล้ว' });
    db.run(`INSERT INTO users (clinic_id, pin, name, role, permissions) VALUES (1, ?, ?, 'ADMIN', 'ADMIN,BOOKING,PATIENT,POS,STOCK,HR,DASH')`, [pin, name], function(err) { res.json({ status: 'success' }); });
  });
});

app.get('/api/clinic', (req, res) => { db.get(`SELECT * FROM clinics ORDER BY id ASC LIMIT 1`, [], (err, row) => { res.json({ status: 'success', data: row || {} }); }); });
app.put('/api/clinic', (req, res) => {
  const { clinic_name, phone, promptpay, bank_account_name, address } = req.body;
  db.run(`UPDATE clinics SET clinic_name=?, phone=?, promptpay=?, bank_account_name=?, address=? WHERE id=1`, [clinic_name, phone, promptpay, bank_account_name, address], function(err) { res.json({ status: 'success' }); });
});
app.post('/api/clinic/logo', (req, res) => {
  const { image_data } = req.body;
  const base64Data = image_data.replace(/^data:image\/\w+;base64,/, '');
  const fileName = `logo_${Date.now()}.png`;
  fs.writeFileSync(path.join(uploadDir, fileName), base64Data, { encoding: 'base64' });
  db.run(`UPDATE clinics SET logo_url = ? WHERE id = 1`, [`/uploads/${fileName}`], function(err) { res.json({ status: 'success', logo_url: `/uploads/${fileName}` }); });
});

app.listen(PORT, () => { console.log(`🚀 Clinic Management Server is running on http://localhost:${PORT}`); });