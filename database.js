// ไฟล์: database.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'clinic_pos.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1. ตารางพนักงาน (Users) เพิ่ม pin TEXT
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    pin TEXT, 
    name TEXT,
    role TEXT
  )`);

  // 2. ตารางประวัติคนไข้ (Patients)
  db.run(`CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hn_code TEXT UNIQUE,
    name TEXT,
    phone TEXT,
    id_card TEXT,
    blood_group TEXT,
    allergies TEXT,
    congenital_disease TEXT,
    created_at TEXT
  )`);

  // 3. ตารางคิว (Queue)
  db.run(`CREATE TABLE IF NOT EXISTS queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    status TEXT,
    created_at TEXT
  )`);

  // 4. ตารางประวัติการรักษา (Treatments)
  db.run(`CREATE TABLE IF NOT EXISTS treatments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id INTEGER,
    doctor_id INTEGER,
    symptoms TEXT,
    diagnosis TEXT,
    prescriptions TEXT,
    created_at TEXT
  )`);

  // 5. ตารางคลังยาและบริการ (Products)
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    name TEXT,
    type TEXT,
    price REAL,
    stock INTEGER,
    unit TEXT
  )`);

  // 6. ตารางประวัติการชำระเงิน (Sales)
  db.run(`CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_no TEXT UNIQUE,
    patient_id INTEGER,
    treatment_id INTEGER,
    total_amount REAL,
    payment_method TEXT,
    created_at TEXT
  )`);

  // สร้าง Admin เริ่มต้น (username: admin / pass: 1234 / pin: 1234)
  db.run(`INSERT OR IGNORE INTO users (username, password, pin, name, role) VALUES ('admin', '1234', '1234', 'Doctor Admin', 'admin')`);
});

module.exports = db;