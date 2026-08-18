const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const db = require('./database'); // เรียกใช้ไฟล์ฐานข้อมูล[cite: 4]

const app = express();
const PORT = 3001; // 🌟 กำหนด Port 3001 ตามที่คุณระบุ[cite: 4]

// Middleware
app.use(cors()); //[cite: 4]
// 🌟 ปรับเพิ่มขนาด Body Parser ให้รองรับไฟล์รูปภาพ Base64 ขนาดใหญ่
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

app.use(express.static(path.join(__dirname, 'public'))); // โฟลเดอร์เก็บไฟล์หน้าเว็บ[cite: 4]

// 🌟 สร้างโฟลเดอร์ public/uploads อัตโนมัติถ้ายังไม่มี
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// 🌟 สร้างตารางเก็บรูปภาพคนไข้
db.run(`CREATE TABLE IF NOT EXISTS patient_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT,
  photo_type TEXT,
  image_path TEXT,
  created_at TEXT
)`);

// Routing หน้าเว็บ
app.get('/booking.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'booking.html')); //[cite: 4]
});

app.get('/patient.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'patient.html'));
});

// API ตรวจสอบสถานะเซิร์ฟเวอร์
app.get('/api/status', (req, res) => {
  res.json({ status: 'success', message: 'Clinic API is running on port 3001' }); //[cite: 4]
});

// เปิดหน้าหลัก[cite: 4]
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html')); //[cite: 4]
});

// ==========================================
// 🔐 API ระบบล็อกอิน
// ==========================================
app.post('/api/login', (req, res) => {
  const { pin } = req.body; //[cite: 4]
  
  db.get(`SELECT id, name, role, permissions FROM users WHERE pin = ?`, [pin], (err, row) => { //[cite: 4]
    if (err) {
      return res.status(500).json({ status: 'error', message: 'Database error' }); //[cite: 4]
    }
    if (!row) {
      return res.json({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' }); //[cite: 4]
    }
    // ถ้าพินถูกต้อง ส่งข้อมูลกลับไป[cite: 4]
    res.json({ status: 'success', user: row }); //[cite: 4]
  });
});

// ==========================================
// 🏥 API ทะเบียนคนไข้ & เวชระเบียน (EMR)
// ==========================================

// 1. ค้นหาคนไข้[cite: 4]
app.get('/api/patients', (req, res) => {
  const search = req.query.search || ''; //[cite: 4]
  const sql = `SELECT * FROM patients WHERE full_name LIKE ? OR phone LIKE ? OR id LIKE ?`; //[cite: 4]
  const params = [`%${search}%`, `%${search}%`, `%${search}%`]; //[cite: 4]
  db.all(sql, params, (err, rows) => { //[cite: 4]
    if (err) return res.status(500).json({ status: 'error', message: err.message }); //[cite: 4]
    res.json({ status: 'success', data: rows }); //[cite: 4]
  });
});

// 2. ดึงข้อมูลคนไข้ 1 คน ตาม HN[cite: 4]
app.get('/api/patients/:id', (req, res) => {
  db.get(`SELECT * FROM patients WHERE id = ?`, [req.params.id], (err, row) => { //[cite: 4]
    if (err) return res.status(500).json({ status: 'error', message: err.message }); //[cite: 4]
    res.json({ status: 'success', data: row }); //[cite: 4]
  });
});

// 3. บันทึก/อัปเดตข้อมูลคนไข้ใหม่[cite: 4]
app.post('/api/patients', (req, res) => {
  const { id, full_name, id_card, phone, dob, allergies, congenital_disease } = req.body; //[cite: 4]
  const created_at = new Date().toISOString(); //[cite: 4]

  // ถ้าไม่มี HN ให้สร้างรหัสอัตโนมัติ (HN-รหัส 6 หลัก)[cite: 4]
  let patientId = id; //[cite: 4]
  if (!patientId) {
    patientId = 'HN-' + Math.floor(100000 + Math.random() * 900000); //[cite: 4]
  }

  // คำสั่งบันทึก (ถ้ามี HN แล้วจะทำการ Update ข้อมูลแทน)[cite: 4]
  const sql = `INSERT INTO patients (id, clinic_id, full_name, id_card, phone, dob, allergies, congenital_disease, created_at) 
               VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET 
               full_name=excluded.full_name, id_card=excluded.id_card, phone=excluded.phone, 
               dob=excluded.dob, allergies=excluded.allergies, congenital_disease=excluded.congenital_disease`; //[cite: 4]
  
  db.run(sql, [patientId, full_name, id_card, phone, dob, allergies, congenital_disease, created_at], function(err) { //[cite: 4]
    if (err) return res.status(500).json({ status: 'error', message: err.message }); //[cite: 4]
    res.json({ status: 'success', message: 'บันทึกข้อมูลสำเร็จ', patient_id: patientId }); //[cite: 4]
  });
});

// 4. บันทึกประวัติการรักษา (EMR)[cite: 4]
app.post('/api/emr', (req, res) => {
  const { patient_id, symptoms, diagnosis, treatment_details } = req.body; //[cite: 4]
  const visit_date = new Date().toISOString(); //[cite: 4]
  
  const sql = `INSERT INTO emr_logs (clinic_id, patient_id, doctor_id, visit_date, symptoms, diagnosis, treatment_details)
               VALUES (1, ?, 1, ?, ?, ?, ?)`; //[cite: 4]
  
  db.run(sql, [patient_id, visit_date, symptoms, diagnosis, treatment_details], function(err) { //[cite: 4]
    if (err) return res.status(500).json({ status: 'error', message: err.message }); //[cite: 4]
    res.json({ status: 'success', message: 'บันทึก EMR สำเร็จ' }); //[cite: 4]
  });
});

// 5. ดึงประวัติย้อนหลังของคนไข้[cite: 4]
app.get('/api/emr/:patient_id', (req, res) => {
  db.all(`SELECT * FROM emr_logs WHERE patient_id = ? ORDER BY id DESC`, [req.params.patient_id], (err, rows) => { //[cite: 4]
    if (err) return res.status(500).json({ status: 'error', message: err.message }); //[cite: 4]
    res.json({ status: 'success', data: rows }); //[cite: 4]
  });
});

// ==========================================
// 📸 API บันทึกและดึงรูปภาพคนไข้ (Photo Gallery)
// ==========================================

// 6. บันทึกรูปภาพคนไข้ลง Server
app.post('/api/patients/photos', (req, res) => {
  const { patient_id, photo_type, image_data } = req.body;
  
  if (!patient_id || !image_data) {
    return res.status(400).json({ status: 'error', message: 'กรุณาเลือกคนไข้และระบุรูปภาพ' });
  }

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
      res.json({ status: 'success', message: 'บันทึกรูปภาพลงประวัติเรียบร้อยแล้ว', photo_path: image_path });
    });
  } catch (error) {
    res.status(500).json({ status: 'error', message: 'ไม่สามารถบันทึกไฟล์รูปภาพได้' });
  }
});

// 7. ดึงประวัติรูปภาพทั้งหมดของคนไข้รายนั้น
app.get('/api/patients/:id/photos', (req, res) => {
  db.all(`SELECT * FROM patient_photos WHERE patient_id = ? ORDER BY id DESC`, [req.params.id], (err, rows) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    res.json({ status: 'success', data: rows });
  });
});

// เริ่มรันเซิร์ฟเวอร์[cite: 4]
app.listen(PORT, () => {
  console.log(`🚀 Clinic Management Server is running on http://localhost:${PORT}`); //[cite: 4]
});