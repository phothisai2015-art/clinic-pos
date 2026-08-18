const express = require('express');
const path = require('path');
const cors = require('cors');
const db = require('./database'); // เรียกใช้ไฟล์ฐานข้อมูล

const app = express();
const PORT = 3001; // 🌟 กำหนด Port 3001 ตามที่คุณระบุ

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public'))); // โฟลเดอร์เก็บไฟล์หน้าเว็บ
app.get('/booking.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'booking.html'));
});

// API ตรวจสอบสถานะเซิร์ฟเวอร์
app.get('/api/status', (req, res) => {
  res.json({ status: 'success', message: 'Clinic API is running on port 3001' });
});

// เปิดหน้าหลัก (เดี๋ยวเราจะมาสร้างไฟล์ index.html ในโฟลเดอร์ public ทีหลัง)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// เริ่มรันเซิร์ฟเวอร์
app.listen(PORT, () => {
  console.log(`🚀 Clinic Management Server is running on http://localhost:${PORT}`);
});