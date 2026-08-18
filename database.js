const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'pos.db');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  // 1. ตาราง Master Tenants (คลินิก/สาขา)[cite: 8]
  db.run(`CREATE TABLE IF NOT EXISTS tenants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user TEXT UNIQUE,
    password TEXT,
    shop_name TEXT,
    email TEXT UNIQUE,
    phone TEXT,
    sheet_id TEXT UNIQUE,
    status TEXT DEFAULT 'ACTIVE',
    expire_date TEXT,
    renew_status TEXT DEFAULT 'NONE',
    renew_notified INTEGER DEFAULT 1
  )`);

  // 2. ตาราง Users (พนักงาน: แพทย์, แอดมิน, เซลล์, ทรีตเมนต์)[cite: 8]
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    pin TEXT,
    name TEXT,
    role TEXT,
    permissions TEXT
  )`);

  // 3. ตาราง Products & Services (สินค้า, ยา, คอร์ส, หัตถการ) - แก้ไขเพิ่ม lot, expire, type, course_qty[cite: 8]
  db.run(`CREATE TABLE IF NOT EXISTS products (
    id TEXT,
    tenant_id TEXT,
    name TEXT,
    type TEXT DEFAULT 'PRODUCT', -- 'PRODUCT', 'COURSE', 'SERVICE'
    price REAL,
    image TEXT,
    category TEXT,
    stock TEXT,
    min_stock TEXT,
    unit TEXT,
    course_qty INTEGER DEFAULT 1,
    lot TEXT,
    expire TEXT,
    PRIMARY KEY (tenant_id, id)
  )`);

  // 4. ตาราง Patients (ทะเบียนคนไข้)[cite: 8]
  db.run(`CREATE TABLE IF NOT EXISTS patients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    hn_code TEXT,
    id_card TEXT,
    prefix TEXT,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    birthdate TEXT,
    gender TEXT,
    address TEXT,
    congenital_disease TEXT,
    allergy TEXT,
    register_date TEXT,
    UNIQUE(tenant_id, hn_code)
  )`);

  // 5. ตาราง Appointments (ตารางนัดหมาย)[cite: 8]
  db.run(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    patient_id INTEGER,
    doctor_id INTEGER,
    appointment_date TEXT,
    appointment_time TEXT,
    room_name TEXT,
    status TEXT DEFAULT 'WAITING',
    notes TEXT
  )`);

  // 6. ตาราง EMR (ประวัติการรักษา/เวชระเบียน)[cite: 8]
  db.run(`CREATE TABLE IF NOT EXISTS emr_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    patient_id INTEGER,
    doctor_id INTEGER,
    visit_date TEXT,
    symptoms TEXT,
    diagnosis TEXT,
    treatment TEXT,
    images_json TEXT,
    notes TEXT
  )`);

  // 7. ตาราง Patient Courses (คอร์สคงเหลือของคนไข้)[cite: 8]
  db.run(`CREATE TABLE IF NOT EXISTS patient_courses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    patient_id INTEGER,
    product_id TEXT,
    course_name TEXT,
    total_qty INTEGER,
    used_qty INTEGER DEFAULT 0,
    remain_qty INTEGER,
    expire_date TEXT,
    status TEXT DEFAULT 'ACTIVE'
  )`);

  // 8. ตาราง Sales Log (ประวัติการขาย/เปิดบิล)[cite: 8]
  db.run(`CREATE TABLE IF NOT EXISTS sales_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    timestamp TEXT,
    receipt_id TEXT,
    patient_id INTEGER,
    patient_name TEXT,
    customer_name TEXT,
    items_str TEXT,
    total REAL,
    payment_method TEXT,
    phone TEXT,
    seller TEXT
  )`);

  // 9. ตาราง HR & Commission (ค่ามือแพทย์, ค่าคอมมิชชัน)[cite: 8]
  db.run(`CREATE TABLE IF NOT EXISTS hr_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    receipt_id TEXT,
    staff_id INTEGER,
    staff_name TEXT,
    role TEXT,
    job_type TEXT,
    amount REAL,
    timestamp TEXT,
    status TEXT DEFAULT 'PENDING'
  )`);

  // 10. ตาราง Settings (ตั้งค่าคลินิก)[cite: 8]
  db.run(`CREATE TABLE IF NOT EXISTS settings (
    tenant_id TEXT,
    key TEXT,
    value TEXT,
    PRIMARY KEY (tenant_id, key)
  )`);

  // 11. ตาราง Activity Log (ประวัติการใช้งาน)[cite: 8]
  db.run(`CREATE TABLE IF NOT EXISTS activity_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT,
    timestamp TEXT,
    staff_name TEXT,
    action TEXT,
    detail TEXT
  )`);

  // 12. ตารางประวัติสลิป (Slip Logs)[cite: 8]
  db.run(`CREATE TABLE IF NOT EXISTS slip_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ref_no TEXT UNIQUE,
    email TEXT,
    amount REAL,
    package TEXT,
    timestamp TEXT,
    status TEXT DEFAULT 'USED'
  )`);
});

module.exports = db;