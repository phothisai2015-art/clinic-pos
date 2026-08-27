const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'clinic.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1. คลินิก / สาขา (Clinics) - เพิ่มโลโก้และเวลาเปิด-ปิด
  db.run(`CREATE TABLE IF NOT EXISTS clinics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_name TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    status TEXT DEFAULT 'ACTIVE',
    logo_url TEXT,
    promptpay TEXT,
    bank_account_name TEXT,
    address TEXT,
    open_time TEXT DEFAULT '10:00',
    close_time TEXT DEFAULT '20:00'
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

  // 4. นัดหมายและคิว (Appointments) - เพิ่ม Vitals และสถานะ Walk-in
  db.run(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    patient_id TEXT,
    doctor_id INTEGER,
    room_name TEXT,
    appointment_date TEXT,
    appointment_time TEXT,
    status TEXT DEFAULT 'WAITING',
    notes TEXT,
    is_walkin BOOLEAN DEFAULT 0,
    bp TEXT,
    pulse TEXT,
    weight TEXT,
    height TEXT,
    sales_rep TEXT
  )`);

  // 5. เวชระเบียนการรักษา (EMR Logs) - เพิ่ม Vitals และสถานะการชำระเงิน
  db.run(`CREATE TABLE IF NOT EXISTS emr_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    patient_id TEXT,
    doctor_id INTEGER,
    visit_date TEXT,
    symptoms TEXT,
    diagnosis TEXT,
    treatment_details TEXT,
    images_url TEXT,
    next_appointment_date TEXT,
    next_appointment_time TEXT,
    next_appointment_note TEXT,
    bp TEXT,
    pulse TEXT,
    weight TEXT,
    height TEXT,
    payment_status TEXT DEFAULT 'WAITING'
  )`);

  // 6. สินค้า, ยา และ คอร์ส (Products & Inventory)
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    clinic_id INTEGER,
    name TEXT,
    type TEXT,
    price REAL,
    stock INTEGER,
    min_stock INTEGER DEFAULT 5, /* 🌟 เพิ่มบรรทัดนี้ */
    unit TEXT,
    lot_number TEXT DEFAULT '-',
    expiry_date TEXT,
    bundle_items TEXT DEFAULT '[]',
    status TEXT DEFAULT 'ACTIVE'
  )`);

  // 7. คอร์สคงเหลือของคนไข้ (Patient Courses)
  db.run(`CREATE TABLE IF NOT EXISTS patient_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER,
    patient_id TEXT,
    product_id TEXT,
    total_qty INTEGER,
    used_qty INTEGER DEFAULT 0,
    bundle_state TEXT DEFAULT '[]'
  )`);

  // 8. ประวัติการทำงานระบบ (System Logs)
  db.run(`CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT,
    action TEXT,
    details TEXT,
    created_at TEXT
  )`);

  // 9. รูปภาพคนไข้ (Patient Photos)
  db.run(`CREATE TABLE IF NOT EXISTS patient_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT, 
    patient_id TEXT, 
    photo_type TEXT, 
    image_path TEXT, 
    created_at TEXT
  )`);

  // 10. บิลการชำระเงิน (Patient Bills)
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
    stock_deducted BOOLEAN DEFAULT 0,
    payment_method TEXT DEFAULT 'CASH',
    payment_history TEXT DEFAULT '[]'
  )`);
  
  // สร้างข้อมูลคลินิกเริ่มต้น หากยังไม่มี
  db.get("SELECT count(*) as count FROM clinics", (err, row) => {
    if (row && row.count === 0) {
      db.run(`INSERT INTO clinics (clinic_name, email, phone) VALUES ('Clinic Management System', 'admin@clinic.com', '-')`);
    }
  });

  console.log("✅ Database tables initialized successfully.");
});

module.exports = db;