const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./database'); // เรียกใช้ไฟล์ฐานข้อมูลที่เราสร้างใหม่

const app = express();
const PORT = 3001; 

// Middleware พื้นฐาน
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // เปิดให้เข้าถึงโฟลเดอร์ public

// ==========================================
// 🌟 Routing ระบบคลินิก
// ==========================================

// หน้าเมนูหลัก (ล็อกอิน & เมนู)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// โมดูล 1: ตารางคิวและนัดหมาย
app.get('/booking.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'booking.html'));
});

// ==========================================

app.listen(PORT, () => {
  console.log(`🚀 Clinic Application Server running on http://localhost:${PORT}`);
});
