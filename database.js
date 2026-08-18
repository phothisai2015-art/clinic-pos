const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// สร้างไฟล์ฐานข้อมูลชื่อ clinic.db
const dbPath = path.join(__dirname, 'clinic.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1. คลินิก / สาขา (Clinics)
  db.run(`CREATE TABLE IF NOT EXISTS clinics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_name TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    status TEXT DEFAULT 'ACTIVE'
  )`);

  // 2. พนักงาน และ แพทย์ (Users)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    pin TEXT,
    name TEXT,
    role TEXT,
    permissions TEXT
  )`);

  // 3. ทะเบียนคนไข้ (Patients)
  db.run(`CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    clinic_id INTEGER,
    full_name TEXT,
    id_card TEXT,
    phone TEXT,
    dob TEXT,
    allergies TEXT,
    congenital_disease TEXT,
    created_at TEXT
  )`);

  // 4. นัดหมายและคิว (Appointments)
  db.run(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    patient_id TEXT,
    doctor_id INTEGER,
    room_name TEXT,
    appointment_date TEXT,
    appointment_time TEXT,
    status TEXT DEFAULT 'WAITING',
    notes TEXT
  )`);

  // 5. เวชระเบียนการรักษา (EMR Logs)
  db.run(`CREATE TABLE IF NOT EXISTS emr_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    patient_id TEXT,
    doctor_id INTEGER,
    visit_date TEXT,
    symptoms TEXT,
    diagnosis TEXT,
    treatment_details TEXT,
    images_url TEXT
  )`);

  // 6. สินค้า, ยา และ คอร์ส (Products & Inventory)
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    clinic_id INTEGER,
    name TEXT,
    type TEXT,
    price REAL,
    stock INTEGER,
    unit TEXT
  )`);

  // 7. คอร์สคงเหลือของคนไข้ (Patient Courses)
  db.run(`CREATE TABLE IF NOT EXISTS patient_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    patient_id TEXT,
    product_id TEXT,
    total_qty INTEGER,
    used_qty INTEGER DEFAULT 0
  )`);
  
  console.log("✅ Database tables initialized successfully.");

  // 🌟 ย้ายมาอยู่ด้านในนี้ เพื่อรอให้ตารางสร้างเสร็จก่อนถึงจะเพิ่ม PIN
  db.get("SELECT count(*) as count FROM users", (err, row) => {
    if (err) {
      console.error("Database Error:", err);
      return;
    }
    if (row && row.count === 0) {
      db.run(`INSERT INTO users (pin, name, role, permissions) VALUES ('1234', 'ผู้บริหาร (Admin)', 'ADMIN', 'ADMIN,BOOKING,PATIENT,POS,STOCK,HR,DASH')`);
      console.log("👤 สร้างผู้ใช้งานเริ่มต้นสำเร็จ: ใช้ PIN 1234 ในการเข้าสู่ระบบ");
    }
  });
});

module.exports = db;