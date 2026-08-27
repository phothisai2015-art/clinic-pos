const express = require('express');
const path = require('path');
const cors = require('cors');
const fs = require('fs');
const fsPromises = require('fs').promises; // 🌟 ใช้สำหรับเซฟไฟล์แบบ Async
const db = require('./database');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

const uploadDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadDir)) { fs.mkdirSync(uploadDir, { recursive: true }); }

// ==========================================
// 🌟 Helper ฟังก์ชัน (Async DB) - ใช้ครอบคลุมทั้งระบบแล้ว
// ==========================================
const dbGet = (sql, params = []) => new Promise((resolve, reject) => db.get(sql, params, (err, row) => err ? reject(err) : resolve(row)));
const dbRun = (sql, params = []) => new Promise((resolve, reject) => db.run(sql, params, function(err) { err ? reject(err) : resolve(this) }));
const dbAll = (sql, params = []) => new Promise((resolve, reject) => db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows)));

// ==========================================
// 🔒 Middleware ตรวจสอบสิทธิ์ (Security)
// ==========================================
app.use('/api', (req, res, next) => {
  // ยกเว้น API ที่ไม่ต้องล็อกอิน
  const publicRoutes = ['/login', '/status', '/check-setup', '/setup-admin', '/clinic'];
  if (publicRoutes.includes(req.path)) return next();

  const userId = req.headers['x-user-id'];
  if (!userId) {
    console.warn(`⚠️ [Security] ตรวจพบการเข้าถึง API ${req.path} โดยไม่มี Token/User ID`);
    // ในอนาคตสามารถปลดคอมเมนต์บรรทัดล่างเพื่อบล็อก 100% ได้ (เมื่อหน้าเว็บส่ง Token ทุกครั้งแล้ว)
    return res.status(401).json({ status: 'error', message: 'Unauthorized Access' });
  }
  next();
});

// ==========================================
// 📄 Page Routes (หน้าเว็บ)
// ==========================================
app.get('/reception.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reception.html')));

app.get('/booking.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'booking.html')));

app.get('/patients_list.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'patients_list.html')));
app.get('/pos.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'pos.html')));
app.get('/inventory.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'inventory.html')));
app.get('/setting.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'setting.html')));
app.get('/reports.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'reports.html')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/api/status', (req, res) => res.json({ status: 'success' }));

// ==========================================
// 🔐 API เข้าสู่ระบบ (Login)
// ==========================================
app.post('/api/login', async (req, res) => {
  try {
    const { pin } = req.body;
    const user = await dbGet(`SELECT id, name, role, permissions FROM users WHERE pin = ?`, [pin]);
    
    if (!user) return res.json({ status: 'error', message: 'รหัส PIN ไม่ถูกต้อง' });
    
    const time = new Date().toISOString();
    await dbRun(`INSERT INTO system_logs (user_name, action, details, created_at) VALUES (?, 'LOGIN', 'เข้าสู่ระบบ', ?)`, [user.name, time]);
    
    res.json({ status: 'success', user: user });
  } catch (err) { res.status(500).json({ status: 'error' }); }
});

// ==========================================
// 📋 API สำหรับระบบประวัติการทำงาน (Logs)
// ==========================================
app.get('/api/logs', async (req, res) => {
  try {
    const rows = await dbAll(`SELECT * FROM system_logs ORDER BY id DESC LIMIT 500`);
    res.json({ status: 'success', data: rows || [] });
  } catch (err) { res.status(500).json({ status: 'error' }); }
});

app.post('/api/logs', async (req, res) => {
  try {
    const { user_name, action, details } = req.body;
    await dbRun(`INSERT INTO system_logs (user_name, action, details, created_at) VALUES (?, ?, ?, ?)`, 
      [user_name, action, details, new Date().toISOString()]);
    res.json({ status: 'success' });
  } catch (err) { res.status(500).json({ status: 'error' }); }
});

// ==========================================
// 🧑‍⚕️ API ระบบคนไข้และคอร์ส (Patients & Courses)
// ==========================================
app.get('/api/patients', async (req, res) => {
  try {
    const search = req.query.search || '';
    const rows = await dbAll(`SELECT * FROM patients WHERE full_name LIKE ? OR phone LIKE ? OR id LIKE ?`, [`%${search}%`, `%${search}%`, `%${search}%`]);
    res.json({ status: 'success', data: rows });
  } catch (err) { res.status(500).json({ status: 'error' }); }
});

app.get('/api/patients/:id', async (req, res) => {
  try {
    const row = await dbGet(`SELECT * FROM patients WHERE id = ?`, [req.params.id]);
    res.json({ status: 'success', data: row });
  } catch (err) { res.status(500).json({ status: 'error' }); }
});

app.post('/api/patients', async (req, res) => {
  try {
    const { id, full_name, id_card, phone, dob, allergies, congenital_disease } = req.body;
    let patientId = id || ('HN-' + Math.floor(100000 + Math.random() * 900000)); 
    
    if (id_card && id_card.trim() !== '') {
      const existing = await dbGet(`SELECT id, full_name FROM patients WHERE id_card = ? AND id != ?`, [id_card, patientId]);
      if (existing) {
        return res.json({ status: 'error', message: `เลขบัตรนี้ลงทะเบียนไว้แล้วในชื่อ: ${existing.full_name}` });
      }
    }

    await dbRun(`INSERT INTO patients (id, clinic_id, full_name, id_card, phone, dob, allergies, congenital_disease, created_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET full_name=excluded.full_name, id_card=excluded.id_card, phone=excluded.phone, dob=excluded.dob, allergies=excluded.allergies, congenital_disease=excluded.congenital_disease`, 
      [patientId, full_name, id_card, phone, dob, allergies, congenital_disease, new Date().toISOString()]);
    
    res.json({ status: 'success', patient_id: patientId }); 
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.delete('/api/patients/:id', async (req, res) => {
  try {
    await dbRun(`DELETE FROM patients WHERE id = ?`, [req.params.id]);
    res.json({ status: 'success' });
  } catch (err) { res.status(500).json({ status: 'error' }); }
});

app.get('/api/patients/:id/courses', async (req, res) => {
  try {
    const rows = await dbAll(`SELECT c.*, p.name as product_name, p.unit FROM patient_courses c LEFT JOIN products p ON c.product_id = p.id WHERE c.patient_id = ?`, [req.params.id]);
    res.json({ status: 'success', data: rows || [] });
  } catch (err) { res.status(500).json({ status: 'error' }); }
});

app.put('/api/courses/:id/deduct', async (req, res) => {
  try {
    const { deduct_amount, bundle_state, stock_deductions } = req.body;
    const course = await dbGet(`SELECT * FROM patient_courses WHERE id = ?`, [req.params.id]);
    if (!course) return res.status(404).json({ status: 'error' });

    let sql = `UPDATE patient_courses SET used_qty = used_qty + ?`;
    let params = [parseFloat(deduct_amount || 0)];
    if (bundle_state) { sql += `, bundle_state = ?`; params.push(bundle_state); }
    sql += ` WHERE id = ?`; params.push(req.params.id);

    await dbRun("BEGIN TRANSACTION");
    await dbRun(sql, params);

    if (stock_deductions && stock_deductions.length > 0) {
       for (let sd of stock_deductions) {
          await dbRun(`UPDATE products SET stock = stock - ? WHERE id = ?`, [parseFloat(sd.amount), sd.product_id]);
       }
    } else {
       const prod = await dbGet(`SELECT type FROM products WHERE id = ?`, [course.product_id]);
       if (prod && ['INJECTABLE', 'MEDICINE', 'SKINCARE'].includes(prod.type)) {
         await dbRun(`UPDATE products SET stock = stock - ? WHERE id = ?`, [parseFloat(deduct_amount || 0), course.product_id]);
       }
    }
    await dbRun("COMMIT");
    res.json({ status: 'success' });
  } catch (err) { 
    await dbRun("ROLLBACK").catch(()=>{}); 
    res.status(500).json({ status: 'error' }); 
  }
});

app.post('/api/patients/:id/assign-promo', async (req, res) => {
  try {
    const { product_id } = req.body;
    const patient_id = req.params.id;
    const prod = await dbGet(`SELECT * FROM products WHERE id = ?`, [product_id]);
    if (!prod) return res.status(500).json({status: 'error'});

    await dbRun("BEGIN TRANSACTION");
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
    await dbRun("COMMIT");
    res.json({status: 'success', course_id: course_id});
  } catch (err) { 
    await dbRun("ROLLBACK").catch(()=>{});
    res.status(500).json({status: 'error'}); 
  }
});

// ==========================================
// 📝 API ระบบเวชระเบียน (EMR) - ปรับใช้ Transaction แล้ว
// ==========================================
app.post('/api/emr', async (req, res) => {
  try {
    const { patient_id, doctor_id, symptoms, diagnosis, treatment_details, next_appointment_date, next_appointment_time, next_appointment_note, bp, pulse, weight, height, prescribed_meds } = req.body;
    const visit_date = new Date().toISOString();
    
    await dbRun("BEGIN TRANSACTION");

    await dbRun(`INSERT INTO emr_logs (clinic_id, patient_id, doctor_id, visit_date, symptoms, diagnosis, treatment_details, next_appointment_date, next_appointment_time, next_appointment_note, bp, pulse, weight, height) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      [patient_id, doctor_id || 1, visit_date, symptoms, diagnosis, treatment_details, next_appointment_date || '', next_appointment_time || '', next_appointment_note || '', bp || '', pulse || '', weight || '', height || '']);
    
    if (next_appointment_date) {
      await dbRun(`INSERT INTO appointments (clinic_id, patient_id, doctor_id, appointment_date, appointment_time, notes) VALUES (1, ?, ?, ?, ?, ?)`, 
        [patient_id, doctor_id || 1, next_appointment_date, next_appointment_time || '10:00', next_appointment_note || 'นัดติดตามผลจาก EMR']);
    }

    if (prescribed_meds && prescribed_meds.length > 0) {
      for (let med of prescribed_meds) {
        const total = med.qty * med.price;
        await dbRun(`INSERT INTO patient_bills (clinic_id, patient_id, bill_date, item_name, type, product_id, qty, total_price, paid_amount, status, stock_deducted) VALUES (1, ?, ?, ?, 'MEDICINE', ?, ?, ?, 0, 'UNPAID', 0)`,
          [patient_id, visit_date.split('T')[0], med.name, med.product_id, med.qty, total]);
      }
    }

    await dbRun("COMMIT");
    res.json({ status: 'success', message: 'บันทึก EMR สำเร็จ' });
  } catch (err) {
    await dbRun("ROLLBACK").catch(()=>{});
    res.status(500).json({ status: 'error', message: err.message });
  }
});

app.get('/api/emr/:patient_id', async (req, res) => {
  try {
    const rows = await dbAll(`SELECT e.*, u.name as doctor_name FROM emr_logs e LEFT JOIN users u ON e.doctor_id = u.id WHERE e.patient_id = ? ORDER BY e.id DESC`, [req.params.patient_id]);
    res.json({ status: 'success', data: rows });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

// ==========================================
// 📸 API รูปภาพ (แก้เป็น Async File System)
// ==========================================
app.post('/api/patients/photos', async (req, res) => {
  try {
    const { patient_id, photo_type, image_data } = req.body;
    const base64Data = image_data.replace(/^data:image\/\w+;base64,/, '');
    const fileName = `photo_${patient_id}_${Date.now()}.png`;
    
    // 🌟 เปลี่ยนมาใช้ fsPromises
    await fsPromises.writeFile(path.join(uploadDir, fileName), base64Data, { encoding: 'base64' });
    
    await dbRun(`INSERT INTO patient_photos (patient_id, photo_type, image_path, created_at) VALUES (?, ?, ?, ?)`, 
      [patient_id, photo_type || 'MARKING', `/uploads/${fileName}`, new Date().toISOString()]);
      
    res.json({ status: 'success' });
  } catch (err) { res.status(500).json({ status: 'error' }); }
});

app.get('/api/patients/:id/photos', async (req, res) => { 
  try {
    const rows = await dbAll(`SELECT * FROM patient_photos WHERE patient_id = ? ORDER BY id DESC`, [req.params.id]);
    res.json({ status: 'success', data: rows }); 
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.delete('/api/patients/photos/:id', async (req, res) => {
  try {
    const row = await dbGet(`SELECT image_path FROM patient_photos WHERE id = ?`, [req.params.id]);
    if (row && fs.existsSync(path.join(__dirname, 'public', row.image_path))) {
      await fsPromises.unlink(path.join(__dirname, 'public', row.image_path)).catch(()=>{});
    }
    await dbRun(`DELETE FROM patient_photos WHERE id = ?`, [req.params.id]);
    res.json({ status: 'success' });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

// ==========================================
// 🗓️ API นัดหมายและคิว
// ==========================================
app.get('/api/appointments', async (req, res) => {
  try {
    const rows = await dbAll(`SELECT a.id, a.appointment_date as date, a.appointment_time as time, a.patient_id as hn, p.full_name as name, p.phone, a.notes as note, a.status FROM appointments a LEFT JOIN patients p ON a.patient_id = p.id ORDER BY a.appointment_date ASC, a.appointment_time ASC`);
    res.json({ status: 'success', data: rows });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.post('/api/appointments', async (req, res) => {
  try {
    const { patient_id, appointment_date, appointment_time, notes } = req.body;
    const result = await dbRun(`INSERT INTO appointments (clinic_id, patient_id, doctor_id, appointment_date, appointment_time, status, notes) VALUES (1, ?, 1, ?, ?, 'WAITING', ?)`, 
      [patient_id, appointment_date, appointment_time, notes || 'นัดหมายล่วงหน้า']);
    res.json({ status: 'success', id: result.lastID });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.delete('/api/appointments/:id', async (req, res) => {
  try {
    await dbRun(`DELETE FROM appointments WHERE id = ?`, [req.params.id]);
    res.json({ status: 'success' });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

// 🌟 [เพิ่มโค้ดนี้ลงไป] API สำหรับกดโทรคอนเฟิร์มนัดหมายพรุ่งนี้
app.put('/api/appointments/:id/confirm', async (req, res) => {
  try {
    await dbRun(`UPDATE appointments SET status = 'CONFIRMED' WHERE id = ?`, [req.params.id]);
    res.json({ status: 'success' });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.get('/api/queue', async (req, res) => {
  try {
    const rows = await dbAll(`SELECT a.id, a.patient_id as hn, p.full_name as name, a.appointment_time as time, a.is_walkin, a.bp, a.pulse, a.weight, a.height, a.notes FROM appointments a LEFT JOIN patients p ON a.patient_id = p.id WHERE a.status = 'CHECKED_IN' ORDER BY a.appointment_date ASC, a.appointment_time ASC`);
    res.json({ status: 'success', data: rows });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.post('/api/queue/send-doctor', async (req, res) => {
  try {
    const { patient_id, bp, pulse, weight, height, notes } = req.body;
    const today = new Date().toISOString().split('T')[0];
    const timeStr = `${String(new Date().getHours()).padStart(2, '0')}:${String(new Date().getMinutes()).padStart(2, '0')}`;
    
    const row = await dbGet(`SELECT id FROM appointments WHERE patient_id = ? AND appointment_date = ? AND status IN ('WAITING', 'CONFIRMED', 'CHECKED_IN') ORDER BY id DESC LIMIT 1`, [patient_id, today]);
    
    if (row) {
      await dbRun(`UPDATE appointments SET status = 'CHECKED_IN', bp = ?, pulse = ?, weight = ?, height = ?, notes = ? WHERE id = ?`, [bp || '', pulse || '', weight || '', height || '', notes || 'Walk-in', row.id]);
    } else {
      await dbRun(`INSERT INTO appointments (clinic_id, patient_id, doctor_id, appointment_date, appointment_time, status, is_walkin, bp, pulse, weight, height, notes) VALUES (1, ?, 1, ?, ?, 'CHECKED_IN', 1, ?, ?, ?, ?, ?)`, 
        [patient_id, today, timeStr, bp || '', pulse || '', weight || '', height || '', notes || 'Walk-in']);
    }
    res.json({ status: 'success' });
  } catch (err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.put('/api/queue/complete/:hn', async (req, res) => {
  try {
    await dbRun(`UPDATE appointments SET status = 'COMPLETED' WHERE patient_id = ? AND status = 'CHECKED_IN'`, [req.params.hn]);
    res.json({ status: 'success' });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

// ==========================================
// 💳 API ระบบ POS และการชำระเงิน
// ==========================================
app.get('/api/pos/bill/:hn', async (req, res) => {
  try {
    const rows = await dbAll(`SELECT * FROM patient_bills WHERE patient_id = ?`, [req.params.hn]);
    res.json({ status: 'success', data: rows || [] });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.put('/api/pos/send/:hn', async (req, res) => {
  try {
    const row = await dbGet(`SELECT id FROM appointments WHERE patient_id = ? AND status IN ('CHECKED_IN', 'COMPLETED') ORDER BY id DESC LIMIT 1`, [req.params.hn]);
    if (row) await dbRun(`UPDATE appointments SET status = 'WAITING_PAYMENT' WHERE id = ?`, [row.id]); 
    
    await dbRun(`UPDATE emr_logs SET payment_status = 'SENT' WHERE patient_id = ? AND id = (SELECT MAX(id) FROM emr_logs WHERE patient_id = ?)`, [req.params.hn, req.params.hn]);
    res.json({ status: 'success' });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.get('/api/pos/patient-search', async (req, res) => {
  try {
    const search = req.query.search || '';
    const patient = await dbGet(`SELECT * FROM patients WHERE id = ? OR full_name LIKE ? OR phone = ? OR id_card = ? LIMIT 1`, [search, `%${search}%`, search, search]);
    if (!patient) return res.json({ status: 'error', message: 'ไม่พบข้อมูลคนไข้ในระบบ' });
    
    const today = new Date().toISOString().split('T')[0];
    const bills = await dbAll(`SELECT * FROM patient_bills WHERE patient_id = ? AND (status != 'PAID' OR bill_date = ?) ORDER BY id ASC`, [patient.id, today]);
    res.json({ status: 'success', patient: patient, data: bills || [] });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.put('/api/pos/pay/:hn', async (req, res) => {
  const { sales_rep, payments, new_items, payment_method } = req.body; 
  const hn = req.params.hn; 
  const today = new Date().toISOString().split('T')[0];
  const currentPayMethod = payment_method || 'CASH'; 

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
          
          let history = [];
          try { history = JSON.parse(bill.payment_history || '[]'); } catch(e){}
          if(safePayAmount > 0) {
            history.push({ date: new Date().toISOString(), amount: safePayAmount, method: p.payment_method || currentPayMethod });
          }

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
          [hn, today, item.name, item.type, item.product_id, item.qty, total, safePayAmount, newStatus, 0, item.payment_method || currentPayMethod, JSON.stringify(history)]);
		  
        if (item.is_new_course) {
           let prod = await dbGet(`SELECT type, bundle_items FROM products WHERE id = ?`, [item.product_id]);
           if (prod && prod.type === 'PROMOTION') {
              let bItems = JSON.parse(prod.bundle_items || '[]');
              let bundleState = bItems.map(i => ({ id: i.id, name: i.name, total: i.qty * item.qty, used: 0 }));
              await dbRun(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty, bundle_state) VALUES (1, ?, ?, 1, 0, ?)`, 
                [hn, item.product_id, JSON.stringify(bundleState)]);
           } else {
              await dbRun(`INSERT INTO patient_courses (clinic_id, patient_id, product_id, total_qty, used_qty) VALUES (1, ?, ?, ?, 0)`, [hn, item.product_id, item.qty]);
           }
        } else if ((item.type === 'MEDICINE' || item.type === 'SKINCARE') && safePayAmount > 0) {
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
app.get('/api/inventory', async (req, res) => { 
  try {
    const rows = await dbAll(`SELECT * FROM products ORDER BY type ASC, name ASC`);
    res.json({ status: 'success', data: rows }); 
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.post('/api/inventory', async (req, res) => {
  try {
    const { id, name, type, price, stock, min_stock, unit, lot_number, expiry_date, bundle_items, status } = req.body;
    await dbRun(`INSERT INTO products (id, clinic_id, name, type, price, stock, min_stock, unit, lot_number, expiry_date, bundle_items, status) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, 'ACTIVE')) ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, price=excluded.price, stock=excluded.stock, min_stock=excluded.min_stock, unit=excluded.unit, lot_number=excluded.lot_number, expiry_date=excluded.expiry_date, bundle_items=excluded.bundle_items, status=excluded.status`, 
      [id, name, type, price, stock, min_stock || 5, unit, lot_number || '-', expiry_date || '', bundle_items || '[]', status || 'ACTIVE']);
    res.json({ status: 'success' });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.put('/api/inventory/:id/status', async (req, res) => { 
  try {
    await dbRun(`UPDATE products SET status = ? WHERE id = ?`, [req.body.status, req.params.id]);
    res.json({status: 'success'});
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.put('/api/inventory/:id/stock', async (req, res) => { 
  try {
    await dbRun(`UPDATE products SET stock = stock + ? WHERE id = ?`, [req.body.adjust_qty, req.params.id]);
    res.json({status: 'success'}); 
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.delete('/api/inventory/:id', async (req, res) => { 
  try {
    await dbRun(`DELETE FROM products WHERE id = ?`, [req.params.id]);
    res.json({status: 'success'}); 
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

// ==========================================
// ⚙️ API ระบบตั้งค่า (Settings - Users, Clinic, Hours)
// ==========================================
// 🌟 API ดึงเวลาเปิด-ปิดร้าน (แก้บั๊กตามที่คุณแจ้ง)
app.get('/api/settings', async (req, res) => {
  try {
    const row = await dbGet(`SELECT open_time, close_time FROM clinics ORDER BY id ASC LIMIT 1`);
    res.json({ status: 'success', data: row || { open_time: '10:00', close_time: '20:00' } });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { open_time, close_time } = req.body;
    // เอา WHERE id=1 ออก เพื่อป้องกันบั๊กกรณี ID เลื่อน
    await dbRun(`UPDATE clinics SET open_time=?, close_time=?`, [open_time, close_time]);
    res.json({ status: 'success' });
  } catch(err) { res.status(500).json({ status: 'error', message: err.message }); }
});

app.get('/api/users', async (req, res) => { 
  try {
    const rows = await dbAll(`SELECT id, name, pin, role, permissions FROM users ORDER BY id ASC`);
    res.json({ status: 'success', data: rows });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.post('/api/users', async (req, res) => {
  try {
    const { name, pin, role, permissions } = req.body;
    const row = await dbGet(`SELECT id FROM users WHERE pin = ?`, [pin]);
    if (row) return res.json({ status: 'error', message: 'รหัส PIN นี้มีผู้ใช้งานแล้ว' });
    
    const result = await dbRun(`INSERT INTO users (clinic_id, pin, name, role, permissions) VALUES (1, ?, ?, ?, ?)`, [pin, name, role, permissions]);
    res.json({ status: 'success', user_id: result.lastID });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.put('/api/users/:id', async (req, res) => {
  try {
    const { name, pin, role, permissions } = req.body;
    const row = await dbGet(`SELECT id FROM users WHERE pin = ? AND id != ?`, [pin, req.params.id]);
    if (row) return res.json({ status: 'error', message: 'รหัส PIN นี้ถูกใช้ไปแล้ว' });
    
    await dbRun(`UPDATE users SET name=?, pin=?, role=?, permissions=? WHERE id=?`, [name, pin, role, permissions, req.params.id]);
    res.json({ status: 'success' });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.delete('/api/users/:id', async (req, res) => { 
  try {
    await dbRun(`DELETE FROM users WHERE id=?`, [req.params.id]);
    res.json({ status: 'success' });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.get('/api/check-setup', async (req, res) => {
  try {
    const row = await dbGet("SELECT count(*) as count FROM users");
    res.json({ status: 'success', needsSetup: row.count === 0 });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.post('/api/setup-admin', async (req, res) => {
  try {
    const { name, pin } = req.body;
    const row = await dbGet("SELECT count(*) as count FROM users");
    if (row && row.count > 0) return res.json({ status: 'error', message: 'ระบบถูกตั้งค่าแล้ว' });
    
    await dbRun(`INSERT INTO users (clinic_id, pin, name, role, permissions) VALUES (1, ?, ?, 'ADMIN', 'ADMIN,BOOKING,PATIENT,POS,STOCK,HR,DASH')`, [pin, name]);
    res.json({ status: 'success' });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.get('/api/clinic', async (req, res) => { 
  try {
    const row = await dbGet(`SELECT * FROM clinics ORDER BY id ASC LIMIT 1`);
    res.json({ status: 'success', data: row || {} });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.put('/api/clinic', async (req, res) => {
  try {
    const { clinic_name, phone, promptpay, bank_account_name, address } = req.body;
    await dbRun(`UPDATE clinics SET clinic_name=?, phone=?, promptpay=?, bank_account_name=?, address=? WHERE id=1`, [clinic_name, phone, promptpay, bank_account_name, address]);
    res.json({ status: 'success' });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.post('/api/clinic/logo', async (req, res) => {
  try {
    const { image_data } = req.body;
    const base64Data = image_data.replace(/^data:image\/\w+;base64,/, '');
    const fileName = `logo_${Date.now()}.png`;
    
    await fsPromises.writeFile(path.join(uploadDir, fileName), base64Data, { encoding: 'base64' });
    await dbRun(`UPDATE clinics SET logo_url = ? WHERE id = 1`, [`/uploads/${fileName}`]);
    
    res.json({ status: 'success', logo_url: `/uploads/${fileName}` });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

// ==========================================
// 📊 API สำหรับหน้ารายงาน (Dashboard & Analytics) 
// ==========================================
app.get('/api/reports/dashboard', async (req, res) => {
  try {
    const todayStr = new Date().toISOString().split('T')[0];
    const startDate = req.query.start_date || todayStr;
    const endDate = req.query.end_date || todayStr;

    const allBills = await dbAll(`SELECT b.*, p.full_name, p.phone FROM patient_bills b LEFT JOIN patients p ON b.patient_id = p.id`);

    let totalRevenue = 0;
    let methodTotals = { CASH: 0, QR: 0, CREDIT: 0 };
    let paidPatients = [];
    let unpaidPatients = [];
    let topSellersMap = {};

    let chartDataMap = {};
    let start = new Date(startDate);
    let end = new Date(endDate);
    if (start > end) { let temp = start; start = end; end = temp; }
    
    let current = new Date(start);
    while (current <= end) {
      chartDataMap[current.toISOString().split('T')[0]] = 0;
      current.setDate(current.getDate() + 1);
    }

    let billLogs = [];

    allBills.forEach(bill => {
        let history = [];
        try { history = JSON.parse(bill.payment_history || '[]'); } catch(e){}

        let paidOnTarget = 0;
        history.forEach(h => {
            let hDate = h.date.split('T')[0];
            if (hDate >= startDate && hDate <= endDate) {
                if (chartDataMap[hDate] !== undefined) chartDataMap[hDate] += h.amount;
                totalRevenue += h.amount;
                let method = h.method || 'CASH';
                if(!methodTotals[method]) methodTotals[method] = 0;
                methodTotals[method] += h.amount;
                paidOnTarget += h.amount;

                billLogs.push({ time: h.date, patient_name: bill.full_name || 'ไม่ระบุชื่อ', item_name: bill.item_name, amount: h.amount, method: method });
            }
        });

        if (paidOnTarget > 0) {
            paidPatients.push({ name: bill.full_name || 'ไม่ระบุชื่อ', amount: paidOnTarget, item: bill.item_name });
        }

        if (bill.bill_date >= startDate && bill.bill_date <= endDate) {
            let balance = bill.total_price - bill.paid_amount;
            if (balance > 0) unpaidPatients.push({ name: bill.full_name || 'ไม่ระบุชื่อ', item: bill.item_name, balance: balance, full_price: bill.total_price });

            let cleanItemName = bill.item_name.split(' (ในคอร์ส:')[0].trim();
            if (!topSellersMap[cleanItemName]) topSellersMap[cleanItemName] = { name: cleanItemName, type: bill.type, qty: 0, revenue: 0 };
            topSellersMap[cleanItemName].qty += bill.qty;
            topSellersMap[cleanItemName].revenue += bill.total_price;
        }
    });

    let topSellers = Object.values(topSellersMap).sort((a,b) => b.qty - a.qty).slice(0, 10);
    billLogs.sort((a,b) => new Date(b.time) - new Date(a.time));

    res.json({
        status: 'success', start_date: startDate, end_date: endDate,
        total_revenue: totalRevenue, methods: methodTotals,
        chart_data: Object.keys(chartDataMap).map(k => ({ date: k, revenue: chartDataMap[k] })),
        paid_patients: paidPatients, unpaid_patients: unpaidPatients,
        top_sellers: topSellers, bill_logs: billLogs
    });
  } catch(err) { res.status(500).json({ status: 'error' }); }
});

app.listen(PORT, () => { console.log(`🚀 Clinic Management Server is running on http://192.168.1.69:${3001}`); });