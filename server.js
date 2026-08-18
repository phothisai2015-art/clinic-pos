const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./database'); // เรียกใช้ไฟล์ฐานข้อมูล

const app = express();
const PORT = 3001; // 🌟 กำหนด Port 3001 ตามที่คุณระบุ

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // โฟลเดอร์เก็บไฟล์หน้าเว็บ
app.get('/booking.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'booking.html'));
});

// API ตรวจสอบสถานะเซิร์ฟเวอร์
app.get('/api/status', (req, res) => {
  res.json({ status: 'success', message: 'Clinic API is running on port 3001' });
});

// เปิดหน้าหลัก (เดี๋ยวเราจะมาสร้างไฟล์ index.html ในโฟลเดอร์ public ทีหลัง)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ==========================================
// 🔐 API ระบบล็อกอิน
// ==========================================
app.post('/api/login', (req, res) => {
  const { pin } = req.body;
  
  db.get(`SELECT id, name, role, permissions FROM users WHERE pin = ?`, [pin], (err, row) => {
    if (err) {
      return res.status(500).json({ status: 'error', message: 'Database error' });
    }
    if (!row) {
      return res.json({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
    }
    // ถ้าพินถูกต้อง ส่งข้อมูลกลับไป
    res.json({ status: 'success', user: row });
  });
});

// ==========================================
// 🏥 API ทะเบียนคนไข้ & เวชระเบียน (EMR)
// ==========================================

// 1. ค้นหาคนไข้
app.get('/api/patients', (req, res) => {
  const search = req.query.search || '';
  const sql = `SELECT * FROM patients WHERE full_name LIKE ? OR phone LIKE ? OR id LIKE ?`;
  const params = [`%${search}%`, `%${search}%`, `%${search}%`];
  db.all(sql, params, (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: rows });
  });
});

// 2. ดึงข้อมูลคนไข้ 1 คน ตาม HN
app.get('/api/patients/:id', (req, res) => {
  db.get(`SELECT * FROM patients WHERE id = ?`, [req.params.id], (err, row) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: row });
  });
});

// 3. บันทึก/อัปเดตข้อมูลคนไข้ใหม่
app.post('/api/patients', (req, res) => {
  const { id, full_name, id_card, phone, dob, allergies, congenital_disease } = req.body;
  const created_at = new Date().toISOString();

  // ถ้าไม่มี HN ให้สร้างรหัสอัตโนมัติ (HN-รหัส 6 หลัก)
  let patientId = id;
  if (!patientId) {
    patientId = 'HN-' + Math.floor(100000 + Math.random() * 900000); 
  }

  // คำสั่งบันทึก (ถ้ามี HN แล้วจะทำการ Update ข้อมูลแทน)
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

// 4. บันทึกประวัติการรักษา (EMR)
app.post('/api/emr', (req, res) => {
  const { patient_id, symptoms, diagnosis, treatment_details } = req.body;
  const visit_date = new Date().toISOString();
  
  const sql = `INSERT INTO emr_logs (clinic_id, patient_id, doctor_id, visit_date, symptoms, diagnosis, treatment_details)
               VALUES (1, ?, 1, ?, ?, ?, ?)`;
  
  db.run(sql, [patient_id, visit_date, symptoms, diagnosis, treatment_details], function(err) {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', message: 'บันทึก EMR สำเร็จ' });
  });
});

// 5. ดึงประวัติย้อนหลังของคนไข้
app.get('/api/emr/:patient_id', (req, res) => {
  db.all(`SELECT * FROM emr_logs WHERE patient_id = ? ORDER BY id DESC`, [req.params.patient_id], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: rows });
  });
});

// เริ่มรันเซิร์ฟเวอร์
app.listen(PORT, () => {
  console.log(`🚀 Clinic Management Server is running on http://localhost:${PORT}`);
});