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

  // 🌟 ตารางใหม่: ระบบบิลและหนี้สิน (รองรับการแบ่งจ่าย)
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

// 🌟 API แตกโปรโมชั่น (นำราคาไปตั้งเป็นยอดหนี้ใน patient_bills ด้วย)
app.post('/api/patients/:id/assign-promo', (req, res) => {
  const { product_id } = req.body;
  const patient_id = req.params.id;
  db.get(`SELECT * FROM products WHERE id = ?`, [product_id], (err, prod) => {
    if (err || !prod) return res.status(500).json({status: 'error'});
    
    const today = new Date().toISOString().split('T')[0];
    
    // ตั้งหนี้โปรโมชั่นในบิล
    db.run(`INSERT INTO patient_bills (clinic_id, patient_id, bill_date, item_name, type, product_id, qty, total_price, paid_amount, status) VALUES (1, ?, ?, ?, ?, ?, 1, ?, 0, 'UNPAID')`,
      [patient_id, today, prod.name, prod.type, prod.id, prod.price], function(errBill) {
        
        // แตกไอเท็มย่อยใส่คอร์สให้ลูกค้า
        if (prod.type === 'PROMOTION') {
          let items = [];
          try { items = JSON.parse(prod.bundle_items || '[]'); } catch(e){}
          if(items.length === 0) return res.json({status: 'success'});
          let completed = 0;
          items.forEach(item => {
            db.run(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, ?, 0)`, [patient_id, item.id, item.qty], () => {
              completed++; if (completed === items.length) res.json({status: 'success'});
            });
          });
        } else {
          db.run(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, 1, 0)`, [patient_id, prod.id], () => { res.json({status: 'success'}); });
        }
    });
  });
});

app.get('/reception.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'reception.html')); });
app.get('/doctor.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'doctor.html')); });
app.get('/booking.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'booking.html')); });
app.get('/patient.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'patient.html')); });
app.get('/patients_list.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'patients_list.html')); });
app.get('/inventory.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'inventory.html')); });
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.get('/api/status', (req, res) => { res.json({ status: 'success' }); });

app.post('/api/login', (req, res) => {
  const { pin } = req.body;
  db.get(`SELECT id, name, role, permissions FROM users WHERE pin = ?`, [pin], (err, row) => {
    if (!row) return res.json({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
    res.json({ status: 'success', user: row });
  });
});

app.get('/api/patients', (req, res) => {
  const search = req.query.search || '';
  const sql = `SELECT * FROM patients WHERE full_name LIKE ? OR phone LIKE ? OR id LIKE ?`;
  db.all(sql, [`%${search}%`, `%${search}%`, `%${search}%`], (err, rows) => { res.json({ status: 'success', data: rows }); });
});

app.delete('/api/patients/:id', (req, res) => {
  db.run(`DELETE FROM patients WHERE id = ?`, [req.params.id], function(err) { res.json({ status: 'success' }); });
});

app.get('/api/patients/:id', (req, res) => {
  db.get(`SELECT * FROM patients WHERE id = ?`, [req.params.id], (err, row) => { res.json({ status: 'success', data: row }); });
});

app.post('/api/patients', (req, res) => {
  const { id, full_name, id_card, phone, dob, allergies, congenital_disease } = req.body;
  const created_at = new Date().toISOString();
  let patientId = id || ('HN-' + Math.floor(100000 + Math.random() * 900000)); 
  const sql = `INSERT INTO patients (id, clinic_id, full_name, id_card, phone, dob, allergies, congenital_disease, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name, id_card=excluded.id_card, phone=excluded.phone, dob=excluded.dob, allergies=excluded.allergies, congenital_disease=excluded.congenital_disease`;
  db.run(sql, [patientId, full_name, id_card, phone, dob, allergies, congenital_disease, created_at], function(err) { res.json({ status: 'success', patient_id: patientId }); });
});

app.post('/api/emr', (req, res) => {
  const { patient_id, symptoms, diagnosis, treatment_details, next_appointment_date, next_appointment_time, next_appointment_note, bp, pulse, weight, height, prescribed_meds } = req.body;
  const visit_date = new Date().toISOString();
  
  const sql = `INSERT INTO emr_logs (clinic_id, patient_id, doctor_id, visit_date, symptoms, diagnosis, treatment_details, next_appointment_date, next_appointment_time, next_appointment_note, bp, pulse, weight, height) VALUES (1, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  
  db.run(sql, [patient_id, visit_date, symptoms, diagnosis, treatment_details, next_appointment_date || '', next_appointment_time || '', next_appointment_note || '', bp || '', pulse || '', weight || '', height || ''], function(err) {
    if (next_appointment_date) {
      db.run(`INSERT INTO appointments (clinic_id, patient_id, doctor_id, appointment_date, appointment_time, notes) VALUES (1, ?, 1, ?, ?, ?)`, [patient_id, next_appointment_date, next_appointment_time || '10:00', next_appointment_note || 'นัดติดตามผลจาก EMR']);
    }

    // 🌟 โยนรายการยาที่หมอสั่ง เข้าไปตั้งหนี้ในระบบบิล
    if (prescribed_meds && prescribed_meds.length > 0) {
      prescribed_meds.forEach(med => {
        const total = med.qty * med.price;
        db.run(`INSERT INTO patient_bills (clinic_id, patient_id, bill_date, item_name, type, product_id, qty, total_price, paid_amount, status, stock_deducted) VALUES (1, ?, ?, ?, 'MEDICINE', ?, ?, ?, 0, 'UNPAID', 0)`,
          [patient_id, visit_date.split('T')[0], med.name, med.product_id, med.qty, total]);
      });
    }

    res.json({ status: 'success', message: 'บันทึก EMR สำเร็จ' });
  });
});

app.get('/api/emr/:patient_id', (req, res) => {
  db.all(`SELECT * FROM emr_logs WHERE patient_id = ? ORDER BY id DESC`, [req.params.patient_id], (err, rows) => { res.json({ status: 'success', data: rows }); });
});

// ==========================================
// 📸 API รูปภาพ (ย่อโค้ด)
// ==========================================
app.post('/api/patients/photos', (req, res) => {
  const { patient_id, photo_type, image_data } = req.body;
  const base64Data = image_data.replace(/^data:image\/\w+;base64,/, '');
  const fileName = `photo_${patient_id}_${Date.now()}.png`;
  fs.writeFileSync(path.join(uploadDir, fileName), base64Data, { encoding: 'base64' });
  db.run(`INSERT INTO patient_photos (patient_id, photo_type, image_path, created_at) VALUES (?, ?, ?, ?)`, [patient_id, photo_type || 'MARKING', `/uploads/${fileName}`, new Date().toISOString()], function(err) { res.json({ status: 'success' }); });
});
app.get('/api/patients/:id/photos', (req, res) => { db.all(`SELECT * FROM patient_photos WHERE patient_id = ? ORDER BY id DESC`, [req.params.id], (err, rows) => { res.json({ status: 'success', data: rows }); }); });
app.delete('/api/patients/photos/:id', (req, res) => {
  db.get(`SELECT image_path FROM patient_photos WHERE id = ?`, [req.params.id], (err, row) => {
    if (row && fs.existsSync(path.join(__dirname, 'public', row.image_path))) fs.unlinkSync(path.join(__dirname, 'public', row.image_path));
    db.run(`DELETE FROM patient_photos WHERE id = ?`, [req.params.id], () => { res.json({ status: 'success' }); });
  });
});

// ==========================================
// 🗓️ API คิวและการชำระเงิน
// ==========================================
app.get('/api/appointments', (req, res) => {
  db.all(`SELECT a.id, a.appointment_date as date, a.appointment_time as time, a.patient_id as hn, p.full_name as name, p.phone, a.notes as note, a.status FROM appointments a LEFT JOIN patients p ON a.patient_id = p.id ORDER BY a.appointment_date ASC, a.appointment_time ASC`, [], (err, rows) => { res.json({ status: 'success', data: rows }); });
});
app.put('/api/appointments/:id/status', (req, res) => {
  db.run(`UPDATE appointments SET status = ? WHERE id = ?`, [req.body.status, req.params.id], function(err) { res.json({ status: 'success' }); });
});

app.get('/api/queue', (req, res) => {
  db.all(`SELECT a.id, a.patient_id as hn, p.full_name as name, a.appointment_time as time, a.is_walkin, a.bp, a.pulse, a.weight, a.height, a.notes FROM appointments a LEFT JOIN patients p ON a.patient_id = p.id WHERE a.status = 'CHECKED_IN' ORDER BY a.appointment_date ASC, a.appointment_time ASC`, [], (err, rows) => { res.json({ status: 'success', data: rows }); });
});
app.post('/api/queue/send-doctor', (req, res) => {
  const { patient_id, bp, pulse, weight, height, notes } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const timeStr = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
  db.get(`SELECT id FROM appointments WHERE patient_id = ? AND appointment_date = ? AND status IN ('WAITING', 'CONFIRMED', 'CHECKED_IN') ORDER BY id DESC LIMIT 1`, [patient_id, today], (err, row) => {
    if (row) { db.run(`UPDATE appointments SET status = 'CHECKED_IN', bp = ?, pulse = ?, weight = ?, height = ?, notes = ? WHERE id = ?`, [bp, pulse, weight, height, notes || 'Walk-in', row.id], () => res.json({status: 'success'})); } 
    else { db.run(`INSERT INTO appointments (clinic_id, patient_id, doctor_id, appointment_date, appointment_time, status, is_walkin, bp, pulse, weight, height, notes) VALUES (1, ?, 1, ?, ?, 'CHECKED_IN', 1, ?, ?, ?, ?, ?)`, [patient_id, today, timeStr, bp, pulse, weight, height, notes || 'Walk-in'], () => res.json({status: 'success'})); }
  });
});

app.put('/api/pos/send/:hn', (req, res) => {
  db.get(`SELECT id FROM appointments WHERE patient_id = ? AND status = 'CHECKED_IN' ORDER BY id DESC LIMIT 1`, [req.params.hn], (err, row) => {
    if (row) { db.run(`UPDATE appointments SET status = 'WAITING_PAYMENT' WHERE id = ?`, [row.id], () => res.json({ status: 'success' })); } 
    else { res.json({ status: 'error', message: 'ไม่พบคิวที่กำลังตรวจ' }); }
  });
});

app.get('/api/pos/queue', (req, res) => {
  db.all(`SELECT a.id as appt_id, a.patient_id as hn, p.full_name as name, a.appointment_time as time FROM appointments a LEFT JOIN patients p ON a.patient_id = p.id WHERE a.status = 'WAITING_PAYMENT' ORDER BY a.id ASC`, [], (err, rows) => { res.json({ status: 'success', data: rows }); });
});

// 🌟 API ดึงบิลที่ค้างชำระทั้งหมดของคนไข้คนนี้
app.get('/api/pos/bill/:hn', (req, res) => {
  db.all(`SELECT * FROM patient_bills WHERE patient_id = ? AND status != 'PAID'`, [req.params.hn], (err, rows) => {
    res.json({status: 'success', data: rows});
  });
});

// 🌟 API รับชำระเงิน (อัปเดตยอดแบ่งจ่าย และตัดสต็อกยา)
app.put('/api/pos/pay/:hn', (req, res) => {
  const { sales_rep, payments, new_items } = req.body; 
  const hn = req.params.hn;
  const today = new Date().toISOString().split('T')[0];

  // 1. จัดการบิลที่ค้างอยู่ในระบบ (แบ่งจ่าย)
  if (payments && payments.length > 0) {
    payments.forEach(p => {
      db.get(`SELECT * FROM patient_bills WHERE id = ?`, [p.bill_id], (err, bill) => {
        if (bill) {
          let newPaid = bill.paid_amount + p.pay_amount;
          let newStatus = newPaid >= bill.total_price ? 'PAID' : 'PARTIAL';
          db.run(`UPDATE patient_bills SET paid_amount = ?, status = ? WHERE id = ?`, [newPaid, newStatus, p.bill_id]);

          // ตัดสต็อกคลังยา (ตัดครั้งเดียวเมื่อมีการจ่ายเงิน)
          if ((bill.type === 'MEDICINE' || bill.type === 'SKINCARE') && bill.stock_deducted === 0 && p.pay_amount > 0) {
            db.run(`UPDATE products SET stock = stock - ? WHERE id = ?`, [bill.qty, bill.product_id]);
            db.run(`UPDATE patient_bills SET stock_deducted = 1 WHERE id = ?`, [p.bill_id]);
          }
        }
      });
    });
  }

  // 2. จัดการรายการที่พนักงานเพิ่งกดเพิ่มหน้าเคาน์เตอร์ POS
  if (new_items && new_items.length > 0) {
    new_items.forEach(item => {
      let total = item.qty * item.price;
      let newStatus = item.pay_amount >= total ? 'PAID' : 'PARTIAL';
      
      db.run(`INSERT INTO patient_bills (clinic_id, patient_id, bill_date, item_name, type, product_id, qty, total_price, paid_amount, status, stock_deducted) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [hn, today, item.name, item.type, item.product_id, item.qty, total, item.pay_amount, newStatus, 0], function(err) {
          let newBillId = this.lastID;
          
          if (item.is_new_course) {
             db.get(`SELECT bundle_items FROM products WHERE id = ?`, [item.product_id], (err, prod) => {
                if (prod && prod.bundle_items && prod.bundle_items !== '[]') {
                   let bItems = JSON.parse(prod.bundle_items);
                   bItems.forEach(b => { db.run(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, ?, 0)`, [hn, b.id, b.qty]); });
                } else {
                   db.run(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, ?, 0)`, [hn, item.product_id, item.qty]);
                }
             });
          } else if ((item.type === 'MEDICINE' || item.type === 'SKINCARE') && item.pay_amount > 0) {
             db.run(`UPDATE products SET stock = stock - ? WHERE id = ?`, [item.qty, item.product_id]);
             db.run(`UPDATE patient_bills SET stock_deducted = 1 WHERE id = ?`, [newBillId]);
          }
      });
    });
  }

  // เคลียร์คิวหน้าห้องการเงิน
  db.run(`UPDATE appointments SET status = 'PAID', sales_rep = ? WHERE patient_id = ? AND status = 'WAITING_PAYMENT'`, [sales_rep || '-', hn], function(err) {
    res.json({ status: 'success' });
  });
});

app.get('/api/inventory', (req, res) => { db.all(`SELECT * FROM products ORDER BY type ASC, name ASC`, [], (err, rows) => { res.json({ status: 'success', data: rows }); }); });
app.post('/api/inventory', (req, res) => {
  const { id, name, type, price, stock, unit, lot_number, expiry_date, bundle_items } = req.body;
  const sql = `INSERT INTO products (id, clinic_id, name, type, price, stock, unit, lot_number, expiry_date, bundle_items) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, price=excluded.price, stock=excluded.stock, unit=excluded.unit, lot_number=excluded.lot_number, expiry_date=excluded.expiry_date, bundle_items=excluded.bundle_items`;
  db.run(sql, [id, name, type, price, stock, unit, lot_number || '-', expiry_date || '', bundle_items || '[]'], () => res.json({ status: 'success' }));
});
app.put('/api/inventory/:id/stock', (req, res) => { db.run(`UPDATE products SET stock = stock + ? WHERE id = ?`, [req.body.adjust_qty, req.params.id], () => res.json({status: 'success'})); });
app.delete('/api/inventory/:id', (req, res) => { db.run(`DELETE FROM products WHERE id = ?`, [req.params.id], () => res.json({status: 'success'})); });

// ==========================================
// ⚙️ API ระบบตั้งค่า (Settings - Users)
// ==========================================
app.get('/setting.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'setting.html')); });

app.get('/api/users', (req, res) => {
  db.all(`SELECT id, name, pin, role, permissions FROM users ORDER BY id ASC`, [], (err, rows) => {
    res.json({ status: 'success', data: rows });
  });
});

app.post('/api/users', (req, res) => {
  const { name, pin, role, permissions } = req.body;
  // เช็ค PIN ซ้ำก่อนบันทึก
  db.get(`SELECT id FROM users WHERE pin = ?`, [pin], (err, row) => {
    if (row) return res.json({ status: 'error', message: 'รหัส PIN นี้มีผู้ใช้งานแล้ว กรุณาตั้งรหัสใหม่' });
    
    db.run(`INSERT INTO users (clinic_id, pin, name, role, permissions) VALUES (1, ?, ?, ?, ?)`,
      [pin, name, role, permissions], function(err) {
        if(err) return res.json({ status: 'error', message: err.message });
        res.json({ status: 'success', user_id: this.lastID });
    });
  });
});

app.put('/api/users/:id', (req, res) => {
  const { name, pin, role, permissions } = req.body;
  // เช็ค PIN ซ้ำ (ยกเว้นตัวเอง)
  db.get(`SELECT id FROM users WHERE pin = ? AND id != ?`, [pin, req.params.id], (err, row) => {
    if (row) return res.json({ status: 'error', message: 'รหัส PIN นี้ถูกใช้ไปแล้ว กรุณาตั้งรหัสใหม่' });
    
    db.run(`UPDATE users SET name=?, pin=?, role=?, permissions=? WHERE id=?`,
      [name, pin, role, permissions, req.params.id], function(err) {
        if(err) return res.json({ status: 'error', message: err.message });
        res.json({ status: 'success' });
    });
  });
});

app.delete('/api/users/:id', (req, res) => {
  db.run(`DELETE FROM users WHERE id=?`, [req.params.id], function(err) {
    res.json({ status: 'success' });
  });
});

// ==========================================
// 📊 API สำหรับหน้ารายงาน (Reports & Dashboard)
// ==========================================
app.get('/reports.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'reports.html')); });

app.get('/api/reports/dashboard', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  
  // ยอดขายวันนี้ (จากบิลที่จ่ายแล้ว)
  db.get(`SELECT SUM(paid_amount) as total_revenue FROM patient_bills WHERE status = 'PAID' AND bill_date = ?`, [today], (err, revRow) => {
    const todayRevenue = revRow ? (revRow.total_revenue || 0) : 0;
    
    // คิววันนี้
    db.get(`SELECT COUNT(id) as total_appt FROM appointments WHERE appointment_date = ?`, [today], (err, apptRow) => {
      const todayAppt = apptRow ? (apptRow.total_appt || 0) : 0;
      
      // ดึงข้อมูล 7 วันย้อนหลังเพื่อทำกราฟ
      db.all(`SELECT bill_date, SUM(paid_amount) as revenue FROM patient_bills WHERE status = 'PAID' GROUP BY bill_date ORDER BY bill_date DESC LIMIT 7`, [], (err, chartRows) => {
        res.json({ status: 'success', today_revenue: todayRevenue, today_appt: todayAppt, chart_data: chartRows || [] });
      });
    });
  });
});

// ==========================================
// 🚀 API สำหรับ First-time Setup (ตั้งค่าครั้งแรก)
// ==========================================
app.get('/api/check-setup', (req, res) => {
  db.get("SELECT count(*) as count FROM users", (err, row) => {
    if (err) {
      console.error("❌ DB Error (check-setup):", err.message);
      return res.json({ status: 'error', message: err.message });
    }
    console.log("🔎 ตรวจสอบระบบ: พบพนักงานจำนวน", row.count, "คน");
    res.json({ status: 'success', needsSetup: row.count === 0 });
  });
});

app.post('/api/setup-admin', (req, res) => {
  const { name, pin } = req.body;
  // ป้องกันการแอบยิง API เข้ามา ถ้ามีพนักงานอยู่แล้วจะไม่ยอมให้สร้าง
  db.get("SELECT count(*) as count FROM users", (err, row) => {
    if (row && row.count > 0) return res.json({ status: 'error', message: 'ระบบถูกตั้งค่าผู้ดูแลระบบไปแล้ว' });
    
    // บันทึก Admin คนแรกให้มีสิทธิ์ครบทุกเมนู (ADMIN)
    db.run(`INSERT INTO users (clinic_id, pin, name, role, permissions) VALUES (1, ?, ?, 'ADMIN', 'ADMIN,BOOKING,PATIENT,POS,STOCK,HR,DASH')`,
      [pin, name], function(err) {
        if (err) return res.json({ status: 'error', message: err.message });
        res.json({ status: 'success' });
    });
  });
});

app.listen(PORT, () => { console.log(`🚀 Clinic Management Server is running on http://localhost:${PORT}`); });