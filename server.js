const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const db = require('./database');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// สร้างโฟลเดอร์ public/uploads อัตโนมัติถ้ายังไม่มี
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// เพิ่มคอลัมน์รองรับวันนัด เวลา และหมายเหตุแบบแยกช่อง
db.run(`ALTER TABLE emr_logs ADD COLUMN next_appointment_date TEXT`, () => {});
db.run(`ALTER TABLE emr_logs ADD COLUMN next_appointment_time TEXT`, () => {});
db.run(`ALTER TABLE emr_logs ADD COLUMN next_appointment_note TEXT`, () => {});


// ----------------------------------------------------
// 🌟 รวมคำสั่งอัปเดตฐานข้อมูล (ป้องกัน Database Locked)
// ----------------------------------------------------
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
  
  // 🌟 เพิ่มคอลัมน์เก็บ Vitals ในตารางประวัติการรักษา (emr_logs)
  db.run(`ALTER TABLE emr_logs ADD COLUMN bp TEXT`, () => {});
  db.run(`ALTER TABLE emr_logs ADD COLUMN pulse TEXT`, () => {});
  db.run(`ALTER TABLE emr_logs ADD COLUMN weight TEXT`, () => {});
  db.run(`ALTER TABLE emr_logs ADD COLUMN height TEXT`, () => {});
});

// ==========================================
// 💳 API ระบบคอร์สความงาม (Patient Courses)
// ==========================================
// ดึงรายการคอร์สของคนไข้ (JOIN กับตารางสินค้าเพื่อดึงชื่อและหน่วยจริงมาแสดง)
app.get('/api/patients/:id/courses', (req, res) => {
  const sql = `
    SELECT c.*, p.name as product_name, p.unit
    FROM patient_courses c
    LEFT JOIN products p ON c.product_id = p.id
    WHERE c.patient_id = ?
  `;
  db.all(sql, [req.params.id], (err, rows) => {
    res.json({ status: 'success', data: rows || [] });
  });
});

// ซื้อคอร์ส/หัตถการใหม่ (บันทึกรหัสสินค้าลงไปตรงๆ)
app.post('/api/patients/:id/courses', (req, res) => {
  const { course_name, total_qty } = req.body; // course_name ตอนนี้คือ product_id
  db.run(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, ?, 0)`, 
    [req.params.id, course_name, parseFloat(total_qty)], function(err) {
    res.json({ status: 'success', course_id: this.lastID });
  });
});

// หักยอดคอร์ส และ หักสต็อกคลังยาอัตโนมัติ 🌟
app.put('/api/courses/:id/deduct', (req, res) => {
  const deductVal = parseFloat(req.body.deduct_amount);
  // ดึงว่าคอร์สนี้ผูกกับรหัสสินค้าอะไร
  db.get(`SELECT product_id FROM patient_courses WHERE id = ?`, [req.params.id], (err, course) => {
    if (err || !course) return res.status(500).json({ status: 'error', message: 'ไม่พบคอร์ส' });
    
    // อัปเดตคอร์สคนไข้
    db.run(`UPDATE patient_courses SET used_qty = used_qty + ? WHERE id = ?`, [deductVal, req.params.id], function(err2) {
      // 🌟 หักสต็อกในคลังสินค้าตามรหัส ID
      db.run(`UPDATE products SET stock = stock - ? WHERE id = ?`, [deductVal, course.product_id], function(err3) {
        res.json({ status: 'success' });
      });
    });
  });
});



// เพิ่ม Route สำหรับหน้าใหม่
app.get('/reception.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'reception.html')); });
app.get('/doctor.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'doctor.html')); });

// Routing หน้าเว็บ
app.get('/booking.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'booking.html'));
});

app.get('/patient.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'patient.html'));
});

// API ตรวจสอบสถานะเซิร์ฟเวอร์
app.get('/api/status', (req, res) => {
  res.json({ status: 'success', message: 'Clinic API is running on port 3001' });
});

// เปิดหน้าหลัก
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 🔐 API ระบบล็อกอิน
// ==========================================
app.post('/api/login', (req, res) => {
  const { pin } = req.body;
  db.get(`SELECT id, name, role, permissions FROM users WHERE pin = ?`, [pin], (err, row) => {
    if (err) return res.status(500).json({ status: 'error', message: 'Database error' });
    if (!row) return res.json({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
    res.json({ status: 'success', user: row });
  });
});

// ==========================================
// 🏥 API ทะเบียนคนไข้ & เวชระเบียน (EMR)
// ==========================================
app.get('/api/patients', (req, res) => {
  const search = req.query.search || '';
  const sql = `SELECT * FROM patients WHERE full_name LIKE ? OR phone LIKE ? OR id LIKE ?`;
  const params = [`%${search}%`, `%${search}%`, `%${search}%`];
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: rows });
  });
});

// -----------------------------------------------------------------
// 🌟 นำไปวางต่อท้าย API ทะเบียนคนไข้เดิม (ก่อนถึง API เวชระเบียน /api/emr)
// -----------------------------------------------------------------

// ลบข้อมูลคนไข้
app.delete('/api/patients/:id', (req, res) => {
  db.run(`DELETE FROM patients WHERE id = ?`, [req.params.id], function(err) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', message: 'ลบข้อมูลคนไข้สำเร็จ' });
  });
});

// เพิ่ม Route สำหรับหน้ารายการคนไข้
app.get('/patients_list.html', (req, res) => { 
  res.sendFile(path.join(__dirname, 'public', 'patients_list.html')); 
});

app.get('/api/patients/:id', (req, res) => {
  db.get(`SELECT * FROM patients WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: row });
  });
});

app.post('/api/patients', (req, res) => {
  const { id, full_name, id_card, phone, dob, allergies, congenital_disease } = req.body;
  const created_at = new Date().toISOString();
  let patientId = id;
  if (!patientId) patientId = 'HN-' + Math.floor(100000 + Math.random() * 900000); 

  const sql = `INSERT INTO patients (id, clinic_id, full_name, id_card, phone, dob, allergies, congenital_disease, created_at) 
               VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET 
               full_name=excluded.full_name, id_card=excluded.id_card, phone=excluded.phone, 
               dob=excluded.dob, allergies=excluded.allergies, congenital_disease=excluded.congenital_disease`;
  
  db.run(sql, [patientId, full_name, id_card, phone, dob, allergies, congenital_disease, created_at], function(err) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', message: 'บันทึกข้อมูลสำเร็จ', patient_id: patientId });
  });
});

app.post('/api/emr', (req, res) => {
  // 🌟 รับค่า Vitals เพิ่มเติมเข้ามาด้วย
  const { patient_id, symptoms, diagnosis, treatment_details, next_appointment_date, next_appointment_time, next_appointment_note, bp, pulse, weight, height } = req.body;
  const visit_date = new Date().toISOString();
  
  const sql = `INSERT INTO emr_logs (clinic_id, patient_id, doctor_id, visit_date, symptoms, diagnosis, treatment_details, next_appointment_date, next_appointment_time, next_appointment_note, bp, pulse, weight, height)
               VALUES (1, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  
  db.run(sql, [patient_id, visit_date, symptoms, diagnosis, treatment_details, next_appointment_date || '', next_appointment_time || '', next_appointment_note || '', bp || '', pulse || '', weight || '', height || ''], function(err) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });

    if (next_appointment_date) {
      db.run(`INSERT INTO appointments (clinic_id, patient_id, doctor_id, appointment_date, appointment_time, notes) VALUES (1, ?, 1, ?, ?, ?)`,
        [patient_id, next_appointment_date, next_appointment_time || '10:00', next_appointment_note || 'นัดติดตามผลจาก EMR']);
    }
    res.json({ status: 'success', message: 'บันทึก EMR สำเร็จ' });
  });
});

app.get('/api/emr/:patient_id', (req, res) => {
  db.all(`SELECT * FROM emr_logs WHERE patient_id = ? ORDER BY id DESC`, [req.params.patient_id], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: rows });
  });
});

// ==========================================
// 📸 API บันทึก ดึงข้อมูล และลบรูปภาพคนไข้
// ==========================================
app.post('/api/patients/photos', (req, res) => {
  const { patient_id, photo_type, image_data } = req.body;
  if (!patient_id || !image_data) return res.status(400).json({ status: 'error', message: 'กรุณาเลือกคนไข้และระบุรูปภาพ' });

  try {
    const base64Data = image_data.replace(/^data:image\/\w+;base64,/, '');
    const fileName = `photo_${patient_id}_${Date.now()}.png`;
    const filePath = path.join(uploadDir, fileName);

    fs.writeFileSync(filePath, base64Data, { encoding: 'base64' });
    const image_path = `/uploads/${fileName}`;
    const created_at = new Date().toISOString();

    const sql = `INSERT INTO patient_photos (patient_id, photo_type, image_path, created_at) VALUES (?, ?, ?, ?)`;
    db.run(sql, [patient_id, photo_type || 'MARKING', image_path, created_at], function(err) {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      res.json({ status: 'success', message: 'บันทึกรูปภาพเรียบร้อยแล้ว', photo_path: image_path });
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'ไม่สามารถบันทึกไฟล์รูปภาพได้' });
  }
});

app.get('/api/patients/:id/photos', (req, res) => {
  db.all(`SELECT * FROM patient_photos WHERE patient_id = ? ORDER BY id DESC`, [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: rows });
  });
});

app.delete('/api/patients/photos/:id', (req, res) => {
  const photoId = req.params.id;
  db.get(`SELECT image_path FROM patient_photos WHERE id = ?`, [photoId], (err, row) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    if (!row) return res.status(404).json({ status: 'error', message: 'ไม่พบรูปภาพในระบบ' });

    const fullPath = path.join(__dirname, 'public', row.image_path);
    if (fs.existsSync(fullPath)) {
      try { fs.unlinkSync(fullPath); } catch (e) { console.error('Delete file error:', e); }
    }
    db.run(`DELETE FROM patient_photos WHERE id = ?`, [photoId], function(err) {
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      res.json({ status: 'success', message: 'ลบรูปภาพเรียบร้อยแล้ว' });
    });
  });
});

// ==========================================
// 🗓️ API ระบบนัดหมาย (Appointments)
// ==========================================
app.get('/api/appointments', (req, res) => {
  const sql = `
    SELECT 
      a.id,
      a.appointment_date as date, 
      a.appointment_time as time, 
      a.patient_id as hn, 
      p.full_name as name, 
      p.phone,
      a.notes as note,
      a.status
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.id
    ORDER BY a.appointment_date ASC, a.appointment_time ASC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: rows });
  });
});

app.put('/api/appointments/:id/status', (req, res) => {
  const { status } = req.body;
  db.run(`UPDATE appointments SET status = ? WHERE id = ?`, [status, req.params.id], function(err) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', message: 'อัปเดตสถานะสำเร็จ' });
  });
});

// ==========================================
// 🛎️ API จัดการคิวหน้าห้องตรวจ (Real-time Queue)
// ==========================================

// 1. ดึงรายชื่อคนที่ถูก Check-in แล้ว (อัปเดตให้ดึง Pulse มาด้วย)
app.get('/api/queue', (req, res) => {
  const sql = `
    SELECT a.id, a.patient_id as hn, p.full_name as name, a.appointment_time as time,
           a.is_walkin, a.bp, a.pulse, a.weight, a.height, a.notes 
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE a.status = 'CHECKED_IN'
    ORDER BY a.appointment_date ASC, a.appointment_time ASC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: rows });
  });
});

// 2. API ส่งเข้าห้องตรวจ (ซักประวัติ Vitals แบบละเอียด)
app.post('/api/queue/send-doctor', (req, res) => {
  // 🌟 เพิ่ม notes เข้ามารับค่าด้วย
  const { patient_id, bp, pulse, weight, height, notes } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const timeStr = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;

  db.get(`SELECT id FROM appointments WHERE patient_id = ? AND appointment_date = ? AND status IN ('WAITING', 'CONFIRMED', 'CHECKED_IN') ORDER BY id DESC LIMIT 1`, [patient_id, today], (err, row) => {
    if (row) {
      // 🌟 อัปเดต notes ทับของเดิมด้วย
      db.run(`UPDATE appointments SET status = 'CHECKED_IN', bp = ?, pulse = ?, weight = ?, height = ?, notes = ? WHERE id = ?`, [bp, pulse, weight, height, notes || 'Walk-in', row.id], function(updateErr) {
        if (updateErr) return res.status(500).json({status: 'error', message: 'DB Error: ' + updateErr.message});
        res.json({status: 'success', message: 'อัปเดต Vitals และส่งเข้าห้องตรวจสำเร็จ'});
      });
    } else {
      // 🌟 นำ notes ที่ได้ไปบันทึก
      db.run(`INSERT INTO appointments (clinic_id, patient_id, doctor_id, appointment_date, appointment_time, status, is_walkin, bp, pulse, weight, height, notes) 
              VALUES (1, ?, 1, ?, ?, 'CHECKED_IN', 1, ?, ?, ?, ?, ?)`, [patient_id, today, timeStr, bp, pulse, weight, height, notes || 'Walk-in'], function(insertErr) {
        if (insertErr) return res.status(500).json({status: 'error', message: 'DB Error: ' + insertErr.message});
        res.json({status: 'success', message: 'สร้างคิว Walk-in หน้าห้องตรวจสำเร็จ'});
      });
    }
  });
});

// 3. อัปเดตสถานะเป็น "ตรวจเสร็จแล้ว" เมื่อบันทึก EMR
app.put('/api/queue/complete/:hn', (req, res) => {
  db.run(`UPDATE appointments SET status = 'COMPLETED' WHERE patient_id = ? AND status = 'CHECKED_IN'`, [req.params.hn], function(err) {
    res.json({ status: 'success' });
  });
});

// ==========================================
// 💰 API ระบบ POS (จุดชำระเงิน)
// ==========================================

// ส่งคนไข้ไปห้องชำระเงิน (กดจากหน้า EMR ของหมอ)
app.put('/api/pos/send/:hn', (req, res) => {
  const hn = req.params.hn;
  const today = new Date().toISOString().split('T')[0];
  const now = new Date();
  const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // เช็คก่อนว่าวันนี้คนไข้มีคิวในระบบหรือยัง
  db.get(`SELECT id FROM appointments WHERE patient_id = ? AND appointment_date = ? ORDER BY id DESC LIMIT 1`, [hn, today], (err, row) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });

    if (row) {
      // 1. ถ้ามีคิวของวันนี้อยู่แล้ว ให้อัปเดตสถานะเป็น รอชำระเงิน
      db.run(`UPDATE appointments SET status = 'WAITING_PAYMENT' WHERE id = ?`, [row.id], function(updateErr) {
        if (updateErr) return res.status(500).json({ status: 'error', message: updateErr.message });
        res.json({ status: 'success', message: 'ส่งไปหน้าชำระเงินเรียบร้อย' });
      });
    } else {
      // 2. ถ้าเป็นเคส Walk-in (ไม่มีคิวมาก่อน) ให้สร้างคิวใหม่สำหรับวันนี้ เพื่อให้ไปโผล่ที่หน้า POS ทันที
      db.run(`INSERT INTO appointments (clinic_id, patient_id, doctor_id, appointment_date, appointment_time, status, notes) 
              VALUES (1, ?, 1, ?, ?, 'WAITING_PAYMENT', 'Walk-in (ส่งจากห้องตรวจ)')`, 
      [hn, today, timeStr], function(insertErr) {
        if (insertErr) return res.status(500).json({ status: 'error', message: insertErr.message });
        res.json({ status: 'success', message: 'สร้างคิวและส่งไปหน้าชำระเงินเรียบร้อย' });
      });
    }
  });
});

// ดึงรายการคิวรอชำระเงิน (ไปโชว์ที่หน้า POS)
app.get('/api/pos/queue', (req, res) => {
  const sql = `
    SELECT 
      a.id as appt_id,
      a.patient_id as hn, 
      p.full_name as name, 
      a.appointment_time as time,
      (SELECT treatment_details FROM emr_logs WHERE patient_id = a.patient_id ORDER BY id DESC LIMIT 1) as treatment_details
    FROM appointments a
    LEFT JOIN patients p ON a.patient_id = p.id
    WHERE a.status = 'WAITING_PAYMENT'
    ORDER BY a.id ASC
  `;
  db.all(sql, [], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: rows });
  });
});

// ชำระเงินเสร็จสิ้น (เคลียร์คิวและเก็บยอดเซลล์)
app.put('/api/pos/pay/:id', (req, res) => {
  const { sales_rep } = req.body;
  db.run(`UPDATE appointments SET status = 'PAID', sales_rep = ? WHERE id = ?`, [sales_rep || '-', req.params.id], function(err) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', message: 'ชำระเงินสำเร็จ' });
  });
});

// ==========================================
// 📦 API ระบบคลังยาและเวชภัณฑ์ (Inventory)
// ==========================================

// ==========================================
// 📦 API ระบบคลังยาและเวชภัณฑ์ (Inventory)
// ==========================================
app.get('/api/inventory', (req, res) => {
  db.all(`SELECT * FROM products ORDER BY type ASC, name ASC`, [], (err, rows) => {
    res.json({ status: 'success', data: rows });
  });
});

app.post('/api/inventory', (req, res) => {
  const { id, name, type, price, stock, unit, lot_number, expiry_date, bundle_items } = req.body;
  const sql = `INSERT INTO products (id, clinic_id, name, type, price, stock, unit, lot_number, expiry_date, bundle_items) 
               VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET 
               name=excluded.name, type=excluded.type, price=excluded.price, stock=excluded.stock, 
               unit=excluded.unit, lot_number=excluded.lot_number, expiry_date=excluded.expiry_date, bundle_items=excluded.bundle_items`;
  
  db.run(sql, [id, name, type, price, stock, unit, lot_number || '-', expiry_date || '', bundle_items || '[]'], function(err) {
    res.json({ status: 'success' });
  });
});

// ปรับปรุงสต็อกแมนนวล / ลบสินค้า (ใช้ API เดิมที่มีอยู่ได้เลย)
app.put('/api/inventory/:id/stock', (req, res) => {
  db.run(`UPDATE products SET stock = stock + ? WHERE id = ?`, [req.body.adjust_qty, req.params.id], () => res.json({status: 'success'}));
});
app.delete('/api/inventory/:id', (req, res) => {
  db.run(`DELETE FROM products WHERE id = ?`, [req.params.id], () => res.json({status: 'success'}));
});

// เพิ่ม Route สำหรับหน้า Inventory
app.get('/inventory.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'inventory.html')); });


// เริ่มรันเซิร์ฟเวอร์
app.listen(PORT, () => {
  console.log(`🚀 Clinic Management Server is running on http://localhost:${PORT}`);
});