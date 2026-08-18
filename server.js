// ไฟล์: server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const bodyParser = require('body-parser');
const db = require('./database'); // ดึงการเชื่อมต่อฐานข้อมูลมาจาก database.js

const app = express();
const PORT = 3001; // เปิด Port 3001 สำหรับ Clinic POS

// ตั้งค่า Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ==========================================
// 1. Routing หน้าเว็บ HTML ทั้ง 9 หน้า
// ==========================================
app.get('/shop', (req, res) => res.sendFile(path.join(__dirname, 'public', 'shop_clinic_menu.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html'))); // หน้าเข้าสู่ระบบ
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html'))); // แดชบอร์ด
app.get('/patients', (req, res) => res.sendFile(path.join(__dirname, 'public', 'patients.html'))); // ประวัติคนไข้
app.get('/queue', (req, res) => res.sendFile(path.join(__dirname, 'public', 'queue.html'))); // ระบบคิว
app.get('/doctor', (req, res) => res.sendFile(path.join(__dirname, 'public', 'doctor.html'))); // ห้องตรวจ
app.get('/pos', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pos.html'))); // แคชเชียร์
app.get('/inventory', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inventory.html'))); // คลังยา
app.get('/reports', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reports.html'))); // รายงาน
app.get('/settings', (req, res) => res.sendFile(path.join(__dirname, 'public', 'settings.html'))); // ตั้งค่า

app.post('/api/login-pin', (req, res) => {
  const { pin } = req.body;
  db.get(`SELECT id, name, role FROM users WHERE pin = ?`, [pin], (err, row) => {
    if (err) return res.json({ status: 'error', message: err.message });
    if (row) return res.json({ status: 'success', user: row });
    res.json({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
  });
});

// ==========================================
// 2. API พื้นฐาน (Authentication)
// ==========================================
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT id, name, role FROM users WHERE username = ? AND password = ?`, [username, password], (err, row) => {
    if (err) return res.json({ status: 'error', message: err.message });
    if (row) return res.json({ status: 'success', user: row });
    res.json({ status: 'error', message: 'ข้อมูลไม่ถูกต้อง' });
  });
});

// ==========================================
// 3. API ระบบประวัติคนไข้ (Patients)
// ==========================================

// ดึงข้อมูลคนไข้ทั้งหมด หรือ ค้นหาด้วยคีย์เวิร์ด
app.get('/api/patients', (req, res) => {
  const search = req.query.search || '';
  const query = `SELECT * FROM patients WHERE name LIKE ? OR hn_code LIKE ? OR phone LIKE ? ORDER BY id DESC`;
  db.all(query, [`%${search}%`, `%${search}%`, `%${search}%`], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json(rows);
  });
});

// เพิ่มข้อมูลคนไข้ใหม่ (ลงทะเบียน)
app.post('/api/patients', (req, res) => {
  const { hn_code, name, phone, id_card, blood_group, allergies, congenital_disease } = req.body;
  const created_at = new Date().toLocaleString('th-TH');
  
  const query = `INSERT INTO patients (hn_code, name, phone, id_card, blood_group, allergies, congenital_disease, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  
  db.run(query, [hn_code, name, phone, id_card, blood_group, allergies, congenital_disease, created_at], function(err) {
    if (err) {
      // ดักจับกรณีใส่รหัส HN ซ้ำ
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.json({ status: 'error', message: 'รหัส HN นี้มีในระบบแล้ว' });
      }
      return res.json({ status: 'error', message: err.message });
    }
    res.json({ status: 'success', id: this.lastID });
  });
});

// ==========================================
// 4. API ระบบห้องตรวจและคลังยา (Doctor & Products)
// ==========================================

// ดึงรายการยาและบริการทั้งหมด
app.get('/api/products', (req, res) => {
  db.all(`SELECT * FROM products ORDER BY name ASC`, [], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json(rows);
  });
});

// บันทึกการตรวจรักษา (ส่งเข้าหน้าแคชเชียร์)
app.post('/api/treatments', (req, res) => {
  const { patient_id, symptoms, diagnosis, prescriptions } = req.body;
  const created_at = new Date().toLocaleString('th-TH');
  
  // แปลงรายการยาให้อยู่ในรูป JSON String
  const prescriptionsJson = JSON.stringify(prescriptions);

  const query = `INSERT INTO treatments (patient_id, doctor_id, symptoms, diagnosis, prescriptions, created_at) VALUES (?, ?, ?, ?, ?, ?)`;
  
  // สมมติว่า doctor_id = 1 (เป็น Admin ชั่วคราว)
  db.run(query, [patient_id, 1, symptoms, diagnosis, prescriptionsJson, created_at], function(err) {
    if (err) return res.json({ status: 'error', message: err.message });
    res.json({ status: 'success', treatment_id: this.lastID });
  });
});

// ==========================================
// 5. API ระบบแคชเชียร์ (POS & Billing)
// ==========================================

// ดึงรายการรอชำระเงิน (ดึงมาจากห้องตรวจ ที่ยังไม่มีการจ่ายเงิน)
app.get('/api/pending-payments', (req, res) => {
  const query = `
    SELECT t.id as treatment_id, t.patient_id, t.prescriptions, p.name as patient_name, p.hn_code
    FROM treatments t
    JOIN patients p ON t.patient_id = p.id
    LEFT JOIN sales s ON t.id = s.treatment_id
    WHERE s.id IS NULL
    ORDER BY t.id ASC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json(rows);
  });
});

// บันทึกการรับชำระเงิน และตัดสต็อกยา
app.post('/api/checkout', (req, res) => {
  const { treatment_id, patient_id, total_amount, payment_method, items } = req.body;
  
  // สร้างเลขที่ใบเสร็จอัตโนมัติ (เช่น REC-20231025-12345)
  const d = new Date();
  const dateStr = d.getFullYear().toString() + (d.getMonth()+1).toString().padStart(2,'0') + d.getDate().toString().padStart(2,'0');
  const receipt_no = `REC-${dateStr}-${Math.floor(10000 + Math.random() * 90000)}`;
  const created_at = d.toLocaleString('th-TH');

  db.run(`INSERT INTO sales (receipt_no, patient_id, treatment_id, total_amount, payment_method, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [receipt_no, patient_id, treatment_id, total_amount, payment_method, created_at], function(err) {
      if (err) return res.json({ status: 'error', message: err.message });

      // ทำการตัดสต็อกยาในฐานข้อมูล
      if (items && items.length > 0) {
        items.forEach(item => {
          db.run(`UPDATE products SET stock = stock - ? WHERE id = ?`, [item.qty, item.id]);
        });
      }
      res.json({ status: 'success', receipt_no: receipt_no });
  });
});

// ==========================================
// เริ่มต้นการทำงานของ Server
// ==========================================
// ==========================================
// 6. API ระบบคลังยาและบริการ (Inventory)
// ==========================================

// เพิ่มรายการยา/บริการใหม่
app.post('/api/products', (req, res) => {
  const { id, name, type, price, stock, unit } = req.body;
  const query = `INSERT INTO products (id, name, type, price, stock, unit) VALUES (?, ?, ?, ?, ?, ?)`;
  
  db.run(query, [id, name, type, price, stock, unit], function(err) {
    if (err) {
      if (err.message.includes('UNIQUE constraint failed')) {
        return res.json({ status: 'error', message: 'รหัสสินค้านี้มีในระบบแล้ว' });
      }
      return res.json({ status: 'error', message: err.message });
    }
    res.json({ status: 'success' });
  });
});

// แก้ไขข้อมูลยา/บริการ
app.put('/api/products/:id', (req, res) => {
  const { name, type, price, stock, unit } = req.body;
  const query = `UPDATE products SET name=?, type=?, price=?, stock=?, unit=? WHERE id=?`;
  
  db.run(query, [name, type, price, stock, unit, req.params.id], function(err) {
    if (err) return res.json({ status: 'error', message: err.message });
    res.json({ status: 'success' });
  });
});

// ลบข้อมูลยา/บริการ
app.delete('/api/products/:id', (req, res) => {
  db.run(`DELETE FROM products WHERE id=?`, [req.params.id], function(err) {
    if (err) return res.json({ status: 'error', message: err.message });
    res.json({ status: 'success' });
  });
});

// ==========================================
// 7. API ระบบคิว (Queue)
// ==========================================

// ดึงรายการคิว (ที่ไม่ใช่สถานะ 'เสร็จสิ้น')
app.get('/api/queue', (req, res) => {
  const query = `
    SELECT q.id as queue_id, q.status, q.created_at, p.id as patient_id, p.hn_code, p.name 
    FROM queue q
    JOIN patients p ON q.patient_id = p.id
    WHERE q.status != 'เสร็จสิ้น'
    ORDER BY q.id ASC
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json(rows);
  });
});

// ส่งคนไข้เข้าคิวใหม่
app.post('/api/queue', (req, res) => {
  const { patient_id } = req.body;
  const created_at = new Date().toLocaleString('th-TH');
  
  db.run(`INSERT INTO queue (patient_id, status, created_at) VALUES (?, 'รอซักประวัติ', ?)`, 
    [patient_id, created_at], function(err) {
      if (err) return res.json({ status: 'error', message: err.message });
      res.json({ status: 'success', queue_id: this.lastID });
  });
});

// เปลี่ยนสถานะคิว
app.put('/api/queue/:id', (req, res) => {
  const { status } = req.body;
  db.run(`UPDATE queue SET status = ? WHERE id = ?`, [status, req.params.id], function(err) {
    if (err) return res.json({ status: 'error', message: err.message });
    res.json({ status: 'success' });
  });
});


app.listen(PORT, () => {
  console.log(`🏥 Clinic POS Server running on http://localhost:${PORT}`);
});
