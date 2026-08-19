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

// สร้างตารางเก็บรูปภาพคนไข้
db.run(`CREATE TABLE IF NOT EXISTS patient_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT,
  photo_type TEXT,
  image_path TEXT,
  created_at TEXT
)`);

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
  const { patient_id, symptoms, diagnosis, treatment_details, next_appointment_date, next_appointment_time, next_appointment_note } = req.body;
  const visit_date = new Date().toISOString();
  
  const sql = `INSERT INTO emr_logs (clinic_id, patient_id, doctor_id, visit_date, symptoms, diagnosis, treatment_details, next_appointment_date, next_appointment_time, next_appointment_note)
               VALUES (1, ?, 1, ?, ?, ?, ?, ?, ?, ?)`;
  
  db.run(sql, [patient_id, visit_date, symptoms, diagnosis, treatment_details, next_appointment_date || '', next_appointment_time || '', next_appointment_note || ''], function(err) {
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

// 1. ดึงรายชื่อคนที่ถูก Check-in แล้ว
app.get('/api/queue', (req, res) => {
  const sql = `
    SELECT a.id, a.patient_id as hn, p.full_name as name, a.appointment_time as time
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

// 2. อัปเดตสถานะเป็น "ตรวจเสร็จแล้ว" เมื่อบันทึก EMR
app.put('/api/queue/complete/:hn', (req, res) => {
  db.run(`UPDATE appointments SET status = 'COMPLETED' WHERE patient_id = ? AND status = 'CHECKED_IN'`, [req.params.hn], function(err) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', message: 'เคลียร์คิวสำเร็จ' });
  });
});

// เริ่มรันเซิร์ฟเวอร์
app.listen(PORT, () => {
  console.log(`🚀 Clinic Management Server is running on http://localhost:${PORT}`);
});