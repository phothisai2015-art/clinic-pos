const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'pos.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1. ตาราง Master Tenants (ร้านค้าทั้งหมด)[cite: 3]
  db.run(`CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT UNIQUE,
    password TEXT,
    shop_name TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    sheet_id TEXT UNIQUE,
    status TEXT DEFAULT 'ACTIVE',
    expire_date TEXT
  )`);

  // 2. ตาราง Users (พนักงานประจำร้าน)
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    pin TEXT,
    name TEXT,
    permissions TEXT
  )`);

  // 3. ตาราง Products (สินค้า)
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT,
    tenant_id TEXT,
    name TEXT,
    price REAL,
    image TEXT,
    category TEXT,
    stock TEXT,
    min_stock TEXT,
    unit TEXT,
    PRIMARY KEY (tenant_id, id)
  )`);

  // 4. ตาราง Sales Log (ประวัติการขาย)[cite: 4]
  db.run(`CREATE TABLE IF NOT EXISTS sales_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    timestamp TEXT,
    receipt_id TEXT,
    customer_name TEXT,
    items_str TEXT,
    total REAL,
    payment_method TEXT,
    phone TEXT,
    seller TEXT
  )`);

  // 5. ตาราง Settings (ตั้งค่าร้าน)[cite: 4]
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    tenant_id TEXT,
    key TEXT,
    value TEXT,
    PRIMARY KEY (tenant_id, key)
  )`);

  // 6. ตาราง Activity Log (ประวัติการใช้งาน)[cite: 4]
  db.run(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    timestamp TEXT,
    staff_name TEXT,
    action TEXT,
    detail TEXT
  )`);
  // 7. ตารางประวัติสลิป (Slip Logs) - สร้างใหม่เพื่อป้องกันสลิปซ้ำ
  db.run(`CREATE TABLE IF NOT EXISTS slip_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_no TEXT UNIQUE,        -- เลขอ้างอิงสลิป (ตั้งเป็น UNIQUE เพื่อป้องกันการบันทึกเลขซ้ำเด็ดขาด)
    email TEXT,                -- อีเมลของร้านค้าที่อัปโหลดสลิป
    amount REAL,               -- ยอดเงินที่โอน
    package TEXT,              -- แพ็กเกจที่เลือกต่ออายุ
    timestamp TEXT,            -- วันเวลาที่อัปโหลด
    status TEXT DEFAULT 'USED' -- สถานะสลิป (ถูกใช้ไปแล้ว)
  )`);
  // ---------------------------------------------------------
  // 🏥 เพิ่มตารางสำหรับระบบ Clinic Management System
  // ---------------------------------------------------------

  // 1. ตารางคนไข้ (Patients)
  db.run(`CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    hn_code TEXT UNIQUE,
    full_name TEXT,
    id_card TEXT,
    phone TEXT,
    dob TEXT,
    allergies TEXT,
    congenital_disease TEXT,
    created_at TEXT
  )`);

  // 2. ตารางนัดหมายและคิว (Appointments & Queues)
  db.run(`CREATE TABLE IF NOT EXISTS appointments (
    id TEXT PRIMARY KEY,
    tenant_id TEXT,
    patient_id TEXT,
    doctor_id TEXT,
    room_name TEXT,
    appointment_date TEXT,
    appointment_time TEXT,
    status TEXT DEFAULT 'WAITING', -- WAITING, IN_ROOM, DONE, CANCELLED
    notes TEXT
  )`);

  // 3. ตารางคอร์สคงเหลือของคนไข้ (Patient Courses)
  db.run(`CREATE TABLE IF NOT EXISTS patient_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    patient_id TEXT,
    product_id TEXT,
    receipt_id TEXT,
    total_qty INTEGER,
    used_qty INTEGER DEFAULT 0,
    expire_date TEXT
  )`);

  // 4. ตารางบันทึกการรักษา (EMR / Treatment History)
  db.run(`CREATE TABLE IF NOT EXISTS emr_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    patient_id TEXT,
    doctor_id TEXT,
    visit_date TEXT,
    symptoms TEXT,
    diagnosis TEXT,
    treatment_details TEXT,
    before_img TEXT,
    after_img TEXT
  )`);

  // 5. ตารางค่ามือแพทย์และค่าคอม (Doctor Fee & Commission)
  db.run(`CREATE TABLE IF NOT EXISTS commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    receipt_id TEXT,
    staff_id TEXT,
    role_type TEXT, -- DOCTOR, SALES, THERAPIST
    amount REAL,
    calculated_date TEXT
  )`);
});

module.exports = db;
