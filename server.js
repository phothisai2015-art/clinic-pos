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

// ✅ เพิ่มฟังก์ชันช่วยกรอง Error แจ้งเตือนเฉพาะเรื่องที่ผิดปกติจริงๆ
const alterLog = (err) => { 
  if (err && !err.message.includes('duplicate column')) {
    console.warn('⚠️ Database Warning:', err.message); 
  }
};

db.run(`ALTER TABLE emr_logs ADD COLUMN next_appointment_date TEXT`, alterLog);
db.run(`ALTER TABLE emr_logs ADD COLUMN next_appointment_time TEXT`, alterLog);
db.run(`ALTER TABLE emr_logs ADD COLUMN next_appointment_note TEXT`, alterLog);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS patient_photos (id INTEGER PRIMARY KEY AUTOINCREMENT, patient_id TEXT, photo_type TEXT, image_path TEXT, created_at TEXT)`);
  db.run(`ALTER TABLE appointments ADD COLUMN is_walkin BOOLEAN DEFAULT 0`, alterLog);
  db.run(`ALTER TABLE appointments ADD COLUMN bp TEXT`, alterLog);
  db.run(`ALTER TABLE appointments ADD COLUMN pulse TEXT`, alterLog);
  db.run(`ALTER TABLE appointments ADD COLUMN weight TEXT`, alterLog);
  db.run(`ALTER TABLE appointments ADD COLUMN height TEXT`, alterLog);
  db.run(`ALTER TABLE appointments ADD COLUMN sales_rep TEXT`, alterLog);
  db.run(`ALTER TABLE products ADD COLUMN lot_number TEXT DEFAULT '-'`, alterLog);
  db.run(`ALTER TABLE products ADD COLUMN expiry_date TEXT`, alterLog);
  db.run(`ALTER TABLE products ADD COLUMN bundle_items TEXT DEFAULT '[]'`, alterLog);
  
  db.run(`ALTER TABLE emr_logs ADD COLUMN bp TEXT`, alterLog);
  db.run(`ALTER TABLE emr_logs ADD COLUMN pulse TEXT`, alterLog);
  db.run(`ALTER TABLE emr_logs ADD COLUMN weight TEXT`, alterLog);
  db.run(`ALTER TABLE emr_logs ADD COLUMN height TEXT`, alterLog);
  db.run(`ALTER TABLE emr_logs ADD COLUMN payment_status TEXT DEFAULT 'WAITING'`, alterLog);
  // 🌟 เพิ่มคอลัมน์ bundle_state ลงใน patient_courses เพื่อเก็บรายการย่อยในกล่อง
  db.run(`ALTER TABLE patient_courses ADD COLUMN bundle_state TEXT DEFAULT '[]'`, alterLog);
  
  db.run(`ALTER TABLE clinics ADD COLUMN logo_url TEXT`, alterLog);
  db.run(`ALTER TABLE clinics ADD COLUMN promptpay TEXT`, alterLog);
  db.run(`ALTER TABLE clinics ADD COLUMN bank_account_name TEXT`, alterLog);
  db.run(`ALTER TABLE clinics ADD COLUMN address TEXT`, alterLog);
  db.run(`ALTER TABLE patient_bills ADD COLUMN payment_method TEXT DEFAULT 'CASH'`, alterLog);
  
  db.run(`ALTER TABLE patient_bills ADD COLUMN payment_history TEXT DEFAULT '[]'`, alterLog);
  
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
// 🌟 Helper ฟังก์ชัน (Async DB)
// ==========================================
const dbGet = (sql, params) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const dbRun = (sql, params) => new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this) }));

// ==========================================
// 📄 Page Routes (หน้าเว็บ)
// ==========================================
app.get('/reception.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'reception.html')); });
app.get('/doctor.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'doctor.html')); });
app.get('/booking.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'booking.html')); });
app.get('/patient.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'patient.html')); });
app.get('/patients_list.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'patients_list.html')); });
app.get('/inventory.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'inventory.html')); });
app.get('/setting.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'setting.html')); });
app.get('/reports.html', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'reports.html')); });
app.get('/', (req, res) => { res.sendFile(path.join(__dirname, 'public', 'index.html')); });

app.get('/api/status', (req, res) => { res.json({ status: 'success' }); });

// ==========================================
// 🔐 API เข้าสู่ระบบ (Login)
// ==========================================
app.post('/api/login', (req, res) => {
  const { pin } = req.body;
  db.get(`SELECT id, name, role, permissions FROM users WHERE pin = ?`, [pin], (err, row) => {
    if (!row) return res.json({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
    res.json({ status: 'success', user: row });
  });
});

// ==========================================
// 🧑‍⚕️ API ระบบคนไข้และคอร์ส (Patients & Courses)
// ==========================================
app.get('/api/patients', (req, res) => {
  const search = req.query.search || '';
  const sql = `SELECT * FROM patients WHERE full_name LIKE ? OR phone LIKE ? OR id LIKE ?`;
  db.all(sql, [`%${search}%`, `%${search}%`, `%${search}%`], (err, rows) => { res.json({ status: 'success', data: rows }); });
});

app.get('/api/patients/:id', (req, res) => {
  db.get(`SELECT * FROM patients WHERE id = ?`, [req.params.id], (err, row) => { res.json({ status: 'success', data: row }); });
});

app.post('/api/patients', (req, res) => {
  const { id, full_name, id_card, phone, dob, allergies, congenital_disease } = req.body;
  const created_at = new Date().toISOString();
  let patientId = id || ('HN-' + Math.floor(100000 + Math.random() * 900000)); 
  
  // 🌟 ฟังก์ชันบันทึกข้อมูล (แยกออกมาเพื่อเรียกใช้ทีหลัง)
  const proceedToSave = () => {
    const sql = `INSERT INTO patients (id, clinic_id, full_name, id_card, phone, dob, allergies, congenital_disease, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name, id_card=excluded.id_card, phone=excluded.phone, dob=excluded.dob, allergies=excluded.allergies, congenital_disease=excluded.congenital_disease`;
    db.run(sql, [patientId, full_name, id_card, phone, dob, allergies, congenital_disease, created_at], function(err) { 
      res.json({ status: 'success', patient_id: patientId }); 
    });
  };

  // 🌟 ดักเช็คเลขบัตรประชาชนซ้ำ (ต้องมีเลขส่งมา และต้องไม่ใช่ HN ตัวเองกรณีแก้ไขประวัติ)
  if (id_card && id_card.trim() !== '') {
    db.get(`SELECT id, full_name FROM patients WHERE id_card = ? AND id != ?`, [id_card, patientId], (err, row) => {
      if (row) {
        // ถ้าเจอเลขบัตรซ้ำ ส่งข้อความ Error กลับไปหาหน้าเว็บ
        return res.json({ 
          status: 'error', 
          message: `เลขบัตรประชาชนนี้ถูกลงทะเบียนไว้แล้วในชื่อ:<br><b class="text-primary fs-5">${row.full_name} (${row.id})</b><br><br><small class="text-muted">กรุณาใช้ช่องค้นหาด้านซ้ายมือเพื่อดึงประวัติคนไข้</small>` 
        });
      } else {
        proceedToSave();
      }
    });
  } else {
    // ถ้าไม่ได้กรอกเลขบัตรมา (เช่น ต่างชาติ หรือเด็ก) ให้ข้ามไปเซฟเลย
    proceedToSave();
  }
});

app.delete('/api/patients/:id', (req, res) => {
  db.run(`DELETE FROM patients WHERE id = ?`, [req.params.id], function(err) { res.json({ status: 'success' }); });
});

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
  const { deduct_amount, bundle_state, stock_deductions } = req.body;
  db.get(`SELECT * FROM patient_courses WHERE id = ?`, [req.params.id], (err, course) => {
    if (err || !course) return res.status(500).json({ status: 'error', message: 'ไม่พบคอร์ส' });
    
    let sql = `UPDATE patient_courses SET used_qty = used_qty + ?`;
    let params = [parseFloat(deduct_amount || 0)];
    
    if (bundle_state) {
      sql += `, bundle_state = ?`;
      params.push(bundle_state);
    }
    sql += ` WHERE id = ?`;
    params.push(req.params.id);

    db.run(sql, params, function(err2) {
      // 🌟 หักสต็อกของแถมย่อยในกล่อง
      if (stock_deductions && stock_deductions.length > 0) {
         stock_deductions.forEach(sd => {
            db.run(`UPDATE products SET stock = stock - ? WHERE id = ?`, [parseFloat(sd.amount), sd.product_id]);
         });
         res.json({ status: 'success' });
      } else {
         // 🌟 หักสต็อกคอร์สเดี่ยวแบบปกติ
         db.get(`SELECT type FROM products WHERE id = ?`, [course.product_id], (err3, prod) => {
           if (prod && (prod.type === 'INJECTABLE' || prod.type === 'MEDICINE' || prod.type === 'SKINCARE')) {
             db.run(`UPDATE products SET stock = stock - ? WHERE id = ?`, [parseFloat(deduct_amount || 0), course.product_id], () => { 
               res.json({ status: 'success' }); 
             });
           } else {
             res.json({ status: 'success' });
           }
         });
      }
    });
  });
});

app.post('/api/patients/:id/assign-promo', async (req, res) => {
  const { product_id } = req.body;
  const patient_id = req.params.id;
  try {
    const prod = await dbGet(`SELECT * FROM products WHERE id = ?`, [product_id]);
    if (!prod) return res.status(500).json({status: 'error', message: 'ไม่พบโปรโมชั่น'});
    const today = new Date().toISOString().split('T')[0];

    await dbRun(`INSERT INTO patient_bills (clinic_id, patient_id, bill_date, item_name, type, product_id, qty, total_price, paid_amount, status) VALUES (1, ?, ?, ?, ?, ?, 1, ?, 0, 'UNPAID')`,
      [patient_id, today, prod.name, prod.type, prod.id, prod.price]);

    let course_id = null;
    if (prod.type === 'PROMOTION') {
      let items = JSON.parse(prod.bundle_items || '[]');
      let bundleState = items.map(i => ({ id: i.id, name: i.name, total: i.qty, used: 0 }));
      let result = await dbRun(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty, bundle_state) VALUES (1, ?, ?, 1, 0, ?)`, 
        [patient_id, prod.id, JSON.stringify(bundleState)]);
      course_id = result.lastID;
    } else {
      let result = await dbRun(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, 1, 0)`, [patient_id, prod.id]);
      course_id = result.lastID;
    }
    res.json({status: 'success', course_id: course_id});
  } catch (err) { res.status(500).json({status: 'error'}); }
});

// ==========================================
// 📝 API ระบบเวชระเบียน (EMR)
// ==========================================
app.post('/api/emr', (req, res) => {
  // 🌟 เพิ่มการรับค่า doctor_id เข้ามา
  const { patient_id, doctor_id, symptoms, diagnosis, treatment_details, next_appointment_date, next_appointment_time, next_appointment_note, bp, pulse, weight, height, prescribed_meds } = req.body;
  const visit_date = new Date().toISOString();
  
  // 🌟 เปลี่ยนจากฟิกซ์เลข 1 ให้ใช้ค่า doctor_id หรือ 1 เป็นค่าเริ่มต้น
  const sql = `INSERT INTO emr_logs (clinic_id, patient_id, doctor_id, visit_date, symptoms, diagnosis, treatment_details, next_appointment_date, next_appointment_time, next_appointment_note, bp, pulse, weight, height) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  
  db.run(sql, [patient_id, doctor_id || 1, visit_date, symptoms, diagnosis, treatment_details, next_appointment_date || '', next_appointment_time || '', next_appointment_note || '', bp || '', pulse || '', weight || '', height || ''], function(err) {
    if (next_appointment_date) {
      db.run(`INSERT INTO appointments (clinic_id, patient_id, doctor_id, appointment_date, appointment_time, notes) VALUES (1, ?, ?, ?, ?, ?)`, [patient_id, doctor_id || 1, next_appointment_date, next_appointment_time || '10:00', next_appointment_note || 'นัดติดตามผลจาก EMR']);
    }

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
  // 🌟 เพิ่มคำสั่ง JOIN เพื่อดึงชื่อผู้ตรวจจากตาราง users
  const sql = `
    SELECT e.*, u.name as doctor_name 
    FROM emr_logs e 
    LEFT JOIN users u ON e.doctor_id = u.id 
    WHERE e.patient_id = ? 
    ORDER BY e.id DESC
  `;
  db.all(sql, [req.params.patient_id], (err, rows) => { res.json({ status: 'success', data: rows }); });
});

// ==========================================
// 📸 API รูปภาพ 
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
// 🗓️ API นัดหมายและคิว
// ==========================================
app.get('/api/appointments', (req, res) => {
  db.all(`SELECT a.id, a.appointment_date as date, a.appointment_time as time, a.patient_id as hn, p.full_name as name, p.phone, a.notes as note, a.status FROM appointments a LEFT JOIN patients p ON a.patient_id = p.id ORDER BY a.appointment_date ASC, a.appointment_time ASC`, [], (err, rows) => { res.json({ status: 'success', data: rows }); });
});
// 🌟 API สำหรับสร้างนัดหมายใหม่ด้วยตัวเอง (Manual Booking)
app.post('/api/appointments', (req, res) => {
  const { patient_id, appointment_date, appointment_time, notes } = req.body;
  db.run(`INSERT INTO appointments (clinic_id, patient_id, doctor_id, appointment_date, appointment_time, status, notes) VALUES (1, ?, 1, ?, ?, 'WAITING', ?)`, 
    [patient_id, appointment_date, appointment_time, notes || 'นัดหมายล่วงหน้า'], 
    function(err) { res.json({ status: 'success', id: this.lastID }); });
});

// 🌟 API สำหรับลบ/ยกเลิกนัดหมาย
app.delete('/api/appointments/:id', (req, res) => {
  db.run(`DELETE FROM appointments WHERE id = ?`, [req.params.id], function(err) { res.json({ status: 'success' }); });
});
// 🌟 API สำหรับ Check-in นัดหมายพร้อมบันทึกข้อมูล Vitals
// 🌟 API Check-in ส่งเข้าห้องตรวจ (หน้า Booking)
app.put('/api/appointments/:id/checkin', (req, res) => {
  const { bp, pulse, weight, height, notes } = req.body;
  db.run(`UPDATE appointments SET status = 'CHECKED_IN', bp = ?, pulse = ?, weight = ?, height = ?, notes = ? WHERE id = ?`, 
    [bp || '', pulse || '', weight || '', height || '', notes || '', req.params.id], 
    function(err) { 
      if (err) return res.status(500).json({ status: 'error', message: err.message });
      res.json({ status: 'success' }); 
    });
});
app.put('/api/appointments/:id/status', (req, res) => {
  db.run(`UPDATE appointments SET status = ? WHERE id = ?`, [req.body.status, req.params.id], function(err) { res.json({ status: 'success' }); });
});

app.get('/api/queue', (req, res) => {
  db.all(`SELECT a.id, a.patient_id as hn, p.full_name as name, a.appointment_time as time, a.is_walkin, a.bp, a.pulse, a.weight, a.height, a.notes FROM appointments a LEFT JOIN patients p ON a.patient_id = p.id WHERE a.status = 'CHECKED_IN' ORDER BY a.appointment_date ASC, a.appointment_time ASC`, [], (err, rows) => { res.json({ status: 'success', data: rows }); });
});
// 🌟 API ส่งคนไข้เข้าห้องตรวจ (หน้า Reception) - เพิ่มตัวดัก Error กันค้าง
app.post('/api/queue/send-doctor', (req, res) => {
  const { patient_id, bp, pulse, weight, height, notes } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const timeStr = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
  
  db.get(`SELECT id FROM appointments WHERE patient_id = ? AND appointment_date = ? AND status IN ('WAITING', 'CONFIRMED', 'CHECKED_IN') ORDER BY id DESC LIMIT 1`, [patient_id, today], (err, row) => {
    if (err) return res.status(500).json({ status: 'error', message: err.message });
    
    if (row) {
      db.run(`UPDATE appointments SET status = 'CHECKED_IN', bp = ?, pulse = ?, weight = ?, height = ?, notes = ? WHERE id = ?`, 
        [bp || '', pulse || '', weight || '', height || '', notes || 'Walk-in', row.id], 
        (err2) => {
          if (err2) return res.status(500).json({ status: 'error', message: err2.message });
          res.json({ status: 'success' });
        });
    } else {
      db.run(`INSERT INTO appointments (clinic_id, patient_id, doctor_id, appointment_date, appointment_time, status, is_walkin, bp, pulse, weight, height, notes) VALUES (1, ?, 1, ?, ?, 'CHECKED_IN', 1, ?, ?, ?, ?, ?)`, 
        [patient_id, today, timeStr, bp || '', pulse || '', weight || '', height || '', notes || 'Walk-in'], 
        (err2) => {
          if (err2) return res.status(500).json({ status: 'error', message: err2.message });
          res.json({ status: 'success' });
        });
    }
  });
});
app.put('/api/queue/complete/:hn', (req, res) => {
  db.run(`UPDATE appointments SET status = 'COMPLETED' WHERE patient_id = ? AND status = 'CHECKED_IN'`, [req.params.hn], function(err) {
    res.json({ status: 'success' });
  });
});

// ==========================================
// 💳 API ระบบ POS และการชำระเงิน
// 🌟 API ดึงข้อมูลบิลคนไข้ตาม HN (สำหรับจุดคัดกรอง Reception และ Booking)
app.get('/api/pos/bill/:hn', (req, res) => {
  db.all(`SELECT * FROM patient_bills WHERE patient_id = ?`, [req.params.hn], (err, rows) => {
    if (err) return res.json({ status: 'error', data: [] });
    res.json({ status: 'success', data: rows || [] });
  });
});

// ==========================================
app.put('/api/pos/send/:hn', (req, res) => {
  db.get(`SELECT id FROM appointments WHERE patient_id = ? AND status IN ('CHECKED_IN', 'COMPLETED') ORDER BY id DESC LIMIT 1`, [req.params.hn], (err, row) => {
    if (row) { 
      db.run(`UPDATE appointments SET status = 'WAITING_PAYMENT' WHERE id = ?`, [row.id]); 
    } 
    // 🌟 บันทึกสถานะการส่งไปการเงินลงใน EMR Log ใบล่าสุดของคนไข้โดยตรง!
    db.run(`UPDATE emr_logs SET payment_status = 'SENT' WHERE patient_id = ? AND id = (SELECT MAX(id) FROM emr_logs WHERE patient_id = ?)`, [req.params.hn, req.params.hn], () => {
      res.json({ status: 'success' });
    });
  });
});

app.get('/api/pos/queue', (req, res) => {
  db.all(`SELECT a.id as appt_id, a.patient_id as hn, p.full_name as name, a.appointment_time as time FROM appointments a LEFT JOIN patients p ON a.patient_id = p.id WHERE a.status = 'WAITING_PAYMENT' ORDER BY a.id ASC`, [], (err, rows) => { res.json({ status: 'success', data: rows }); });
});

// 🌟 API ค้นหาบิลคนไข้รองรับทั้ง HN, ชื่อ, เบอร์โทร และเลขบัตร ปชช.
app.get('/api/pos/patient-search', (req, res) => {
  const search = req.query.search || '';
  const sql = `SELECT * FROM patients WHERE id = ? OR full_name LIKE ? OR phone = ? OR id_card = ? LIMIT 1`;
  db.get(sql, [search, `%${search}%`, search, search], (err, patient) => {
    if (err || !patient) return res.json({ status: 'error', message: 'ไม่พบข้อมูลคนไข้ในระบบ' });
    
    const today = new Date().toISOString().split('T')[0];
    db.all(`SELECT * FROM patient_bills WHERE patient_id = ? AND (status != 'PAID' OR bill_date = ?) ORDER BY id ASC`, [patient.id, today], (err2, bills) => {
      res.json({ status: 'success', patient: patient, data: bills || [] });
    });
  });
});

// 🌟 API รับชำระเงิน POS (อัปเดตระบบบันทึกประวัติแบ่งจ่าย)
app.put('/api/pos/pay/:hn', async (req, res) => {
  const { sales_rep, payments, new_items, payment_method } = req.body; 
  const hn = req.params.hn; 
  const today = new Date().toISOString().split('T')[0];
  const currentPayMethod = payment_method || 'CASH'; // รับค่าช่องทางชำระเงิน

  try {
    await dbRun("BEGIN TRANSACTION");

    if (payments && payments.length > 0) {
      for (let p of payments) {
        let bill = await dbGet(`SELECT * FROM patient_bills WHERE id = ?`, [p.bill_id]);
        if (bill) {
          let balance = bill.total_price - bill.paid_amount;
          let safePayAmount = p.pay_amount > balance ? balance : p.pay_amount;

          let newPaid = bill.paid_amount + safePayAmount;
          let newStatus = newPaid >= bill.total_price ? 'PAID' : 'PARTIAL';
          
          // 🌟 สร้างประวัติการแบ่งจ่าย
          let history = [];
          try { history = JSON.parse(bill.payment_history || '[]'); } catch(e){}
          if(safePayAmount > 0) {
            history.push({ date: new Date().toISOString(), amount: safePayAmount, method: p.payment_method || currentPayMethod });
          }

          // 🌟 อัปเดตทั้งยอดเงิน สถานะ และยัดประวัติการจ่ายเก็บไว้ในช่อง payment_history
          await dbRun(`UPDATE patient_bills SET paid_amount = ?, status = ?, payment_method = ?, payment_history = ? WHERE id = ?`, 
            [newPaid, newStatus, p.payment_method || currentPayMethod, JSON.stringify(history), p.bill_id]);

          if ((bill.type === 'MEDICINE' || bill.type === 'SKINCARE') && bill.stock_deducted === 0 && safePayAmount > 0) {
            await dbRun(`UPDATE products SET stock = stock - ? WHERE id = ?`, [bill.qty, bill.product_id]);
            await dbRun(`UPDATE patient_bills SET stock_deducted = 1 WHERE id = ?`, [p.bill_id]);
          }
        }
      }
    }

    if (new_items && new_items.length > 0) {
      for (let item of new_items) {
        let total = item.qty * item.price;
        let safePayAmount = item.pay_amount > total ? total : item.pay_amount;
        let newStatus = safePayAmount >= total ? 'PAID' : 'PARTIAL';
        
        let history = [];
        if(safePayAmount > 0) {
          history.push({ date: new Date().toISOString(), amount: safePayAmount, method: item.payment_method || currentPayMethod });
        }

        let insertRes = await dbRun(`INSERT INTO patient_bills (clinic_id, patient_id, bill_date, item_name, type, product_id, qty, total_price, paid_amount, status, stock_deducted, payment_method, payment_history) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [1, hn, today, item.name, item.type, item.product_id, item.qty, total, safePayAmount, newStatus, 0, item.payment_method || currentPayMethod, JSON.stringify(history)]);
          
        if (item.is_new_course) {
           let prod = await dbGet(`SELECT type, bundle_items FROM products WHERE id = ?`, [item.product_id]);
           if (prod && prod.type === 'PROMOTION') {
              let bItems = JSON.parse(prod.bundle_items || '[]');
              // 🌟 สร้างสถานะของแถมในกล่อง (คูณด้วยจำนวนเซ็ตที่ซื้อ)
              let bundleState = bItems.map(i => ({ id: i.id, name: i.name, total: i.qty * item.qty, used: 0 }));
              await dbRun(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty, bundle_state) VALUES (1, ?, ?, 1, 0, ?)`, 
                [hn, item.product_id, JSON.stringify(bundleState)]);
           } else {
              await dbRun(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, ?, 0)`, [hn, item.product_id, item.qty]);
           }
        } else if ((item.type === 'MEDICINE' || item.type === 'SKINCARE') && safePayAmount > 0) {
           // 🌟 โค้ดตัดสต็อกยาส่วนนี้ที่เผลอลบหายไป เอากลับมาให้แล้วครับ
           await dbRun(`UPDATE products SET stock = stock - ? WHERE id = ?`, [item.qty, item.product_id]);
           await dbRun(`UPDATE patient_bills SET stock_deducted = 1 WHERE id = ?`, [insertRes.lastID]);
        }
      }
    }

    await dbRun(`UPDATE appointments SET status = 'PAID', sales_rep = ? WHERE patient_id = ? AND status = 'WAITING_PAYMENT'`, [sales_rep || '-', hn]);
    await dbRun(`UPDATE emr_logs SET payment_status = 'PAID' WHERE patient_id = ? AND payment_status = 'SENT'`, [hn]);
    await dbRun("COMMIT");
    res.json({ status: 'success' });
  } catch (err) {
    await dbRun("ROLLBACK").catch(() => {});
    res.status(500).json({ status: 'error', message: err.message });
  }
});

// ==========================================
// 📦 API ระบบคลังสินค้า (Inventory)
// ==========================================
app.get('/api/inventory', (req, res) => { db.all(`SELECT * FROM products ORDER BY type ASC, name ASC`, [], (err, rows) => { res.json({ status: 'success', data: rows }); }); });
app.post('/api/inventory', (req, res) => {
  const { id, name, type, price, stock, unit, lot_number, expiry_date, bundle_items } = req.body;
  const sql = `INSERT INTO products (id, clinic_id, name, type, price, stock, unit, lot_number, expiry_date, bundle_items) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, price=excluded.price, stock=excluded.stock, unit=excluded.unit, lot_number=excluded.lot_number, expiry_date=excluded.expiry_date, bundle_items=excluded.bundle_items`;
  db.run(sql, [id, name, type, price, stock, unit, lot_number || '-', expiry_date || '', bundle_items || '[]'], () => res.json({ status: 'success' }));
});
app.put('/api/inventory/:id/stock', (req, res) => { db.run(`UPDATE products SET stock = stock + ? WHERE id = ?`, [req.body.adjust_qty, req.params.id], () => res.json({status: 'success'})); });
app.delete('/api/inventory/:id', (req, res) => { db.run(`DELETE FROM products WHERE id = ?`, [req.params.id], () => res.json({status: 'success'})); });

// ==========================================
// ⚙️ API ระบบตั้งค่า (Settings - Users & Clinic)
// ==========================================
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
    if (row) return res.json({ status: 'error', message: 'รหัส PIN นี้ถูกใช้ไปแล้ว' });
    db.run(`UPDATE users SET name=?, pin=?, role=?, permissions=? WHERE id=?`, [name, pin, role, permissions, req.params.id], function(err) { res.json({ status: 'success' }); });
  });
});
app.delete('/api/users/:id', (req, res) => { db.run(`DELETE FROM users WHERE id=?`, [req.params.id], function(err) { res.json({ status: 'success' }); }); });

app.get('/api/check-setup', (req, res) => {
  db.get("SELECT count(*) as count FROM users", (err, row) => { res.json({ status: 'success', needsSetup: row.count === 0 }); });
});
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

// ==========================================
// 📊 API สำหรับหน้ารายงาน (Reports & Dashboard)
// ==========================================
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

app.listen(PORT, () => { console.log(`🚀 Clinic Management Server is running on http://localhost:${PORT}`); });