const fs = require('fs');
const path = require('path');

console.log('กำลังล้างข้อมูลระบบ...');

// 1. ลบไฟล์ฐานข้อมูล (clinic.db)
const dbPath = path.join(__dirname, 'clinic.db');
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('✅ ลบฐานข้อมูล (clinic.db) สำเร็จ');
} else {
  console.log('⚠️ ไม่พบไฟล์ฐานข้อมูล (อาจจะถูกลบไปแล้ว)');
}

// 2. ลบรูปภาพทั้งหมดในโฟลเดอร์ public/uploads
const uploadDir = path.join(__dirname, 'public', 'uploads');
if (fs.existsSync(uploadDir)) {
  let deletedCount = 0;
  const files = fs.readdirSync(uploadDir);
  for (const file of files) {
    // ลบเฉพาะไฟล์ ไม่ลบโฟลเดอร์
    const filePath = path.join(uploadDir, file);
    if (fs.lstatSync(filePath).isFile()) {
      fs.unlinkSync(filePath);
      deletedCount++;
    }
  }
  console.log(`✅ ลบรูปภาพ EMR และลายเซ็นจำนวน ${deletedCount} ไฟล์ สำเร็จ`);
} else {
  console.log('⚠️ ไม่พบโฟลเดอร์รูปภาพ');
}

console.log('🎉 ล้างระบบเสร็จสมบูรณ์ 100%! คุณสามารถเริ่มระบบใหม่ได้เลยครับ');