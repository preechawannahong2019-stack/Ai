const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { initDatabase, queryAll, queryOne, run, count } = require('./db');

function createServer(opts = {}) {
  const baseDir = opts.baseDir || __dirname;
  const uploadDir = opts.uploadDir || path.join(baseDir, 'uploads');
  const port = opts.port || process.env.PORT || 3001;
  const host = opts.host || '0.0.0.0';

  const app = express();

  // Multer config
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
      cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
      cb(null, uniqueSuffix + path.extname(file.originalname));
    }
  });
  const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

  // Auth middleware
  function requireAuth(req, res, next) {
    if (req.session && req.session.user) return next();
    res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });
  }

  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
  });
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  app.use(session({
    secret: process.env.SESSION_SECRET || 'case-management-secret-key-2024',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: !!process.env.SESSION_SECURE, maxAge: 24 * 60 * 60 * 1000 }
  }));

  app.use(express.static(path.join(baseDir, 'public')));
  app.use('/uploads', express.static(uploadDir));

  // ========== AUTH ==========
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'กรุณากรอกข้อมูลให้ครบ' });
    const user = queryOne('SELECT * FROM users WHERE username = ?', [username]);
    if (!user || !bcrypt.compareSync(password, user.password)) {
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    req.session.user = { id: user.id, username: user.username, fullname: user.fullname, role: user.role };
    res.json({ success: true, user: req.session.user });
  });

  app.post('/api/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

  app.get('/api/me', (req, res) => {
    if (req.session && req.session.user) res.json({ user: req.session.user });
    else res.status(401).json({ error: 'not logged in' });
  });

  // ========== CATEGORIES ==========
  app.get('/api/categories', requireAuth, (req, res) => {
    res.json(queryAll('SELECT * FROM categories ORDER BY name'));
  });

  app.post('/api/categories', requireAuth, (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'กรุณาระบุชื่อหมวดหมู่' });
    try {
      const id = run('INSERT INTO categories (name) VALUES (?)', [name]);
      res.json({ id, name });
    } catch (e) {
      res.status(400).json({ error: 'มีหมวดหมู่นี้อยู่แล้ว' });
    }
  });

  app.delete('/api/categories/:id', requireAuth, (req, res) => {
    run('DELETE FROM categories WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ success: true });
  });

  // ========== CASES ==========
  app.get('/api/cases', requireAuth, (req, res) => {
    const { search, category, status, page = 1, limit = 20 } = req.query;
    let where = ' WHERE 1=1';
    const params = [];

    if (search) {
      where += ` AND (c.case_number LIKE ? OR c.case_file_number LIKE ? OR c.daily_number LIKE ? OR c.complainant_name LIKE ?
                OR c.suspect_name LIKE ? OR c.offense_base LIKE ? OR c.case_behavior LIKE ?)`;
      const s = `%${search}%`;
      for (let i = 0; i < 7; i++) params.push(s);
    }
    if (category) { where += ' AND c.category_id = ?'; params.push(parseInt(category)); }
    if (status) { where += ' AND c.case_status = ?'; params.push(status); }

    const total = count(`SELECT COUNT(*) as total FROM cases c ${where}`, params);
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const cases = queryAll(
      `SELECT c.*, cat.name as category_name FROM cases c
       LEFT JOIN categories cat ON c.category_id = cat.id ${where}
       ORDER BY c.updated_at DESC LIMIT ? OFFSET ?`,
      [...params, parseInt(limit), offset]
    );

    // Attach incomplete todos with deadlines for each case
    const caseIds = cases.map(c => c.id);
    if (caseIds.length > 0) {
      const placeholders = caseIds.map(() => '?').join(',');
      const todos = queryAll(
        `SELECT * FROM todo_items WHERE case_id IN (${placeholders}) AND is_completed = 0
         ORDER BY COALESCE(deadline_date, '9999-12-31'), created_at`,
        caseIds
      );
      const todosByCase = todos.reduce((acc, t) => {
        if (!acc[t.case_id]) acc[t.case_id] = [];
        acc[t.case_id].push(t);
        return acc;
      }, {});
      for (const c of cases) {
        c.todos = todosByCase[c.id] || [];
      }
    }

    res.json({ cases, total, page: parseInt(page), limit: parseInt(limit) });
  });

  app.get('/api/cases/:id', requireAuth, (req, res) => {
    const c = queryOne(
      `SELECT c.*, cat.name as category_name FROM cases c
       LEFT JOIN categories cat ON c.category_id = cat.id WHERE c.id = ?`,
      [parseInt(req.params.id)]
    );
    if (!c) return res.status(404).json({ error: 'ไม่พบคดี' });
    const todos = queryAll('SELECT * FROM todo_items WHERE case_id = ? ORDER BY created_at', [parseInt(req.params.id)]);
    const attachments = queryAll('SELECT * FROM attachments WHERE case_id = ? ORDER BY created_at', [parseInt(req.params.id)]);
    res.json({ ...c, todos, attachments });
  });

  app.post('/api/cases', requireAuth, (req, res) => {
    const b = req.body;
    const id = run(`INSERT INTO cases (
      case_number, case_file_number, daily_number, daily_date, offense_base,
      complainant_name, complainant_address, complainant_id_card, complainant_phone,
      suspect_name, suspect_address, suspect_id_card, suspect_phone,
      case_behavior, category_id, case_status, actions_taken,
      incident_date, incident_location, damage, investigator, investigator_rank, responsible_officer, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
      b.case_number, b.case_file_number, b.daily_number, b.daily_date, b.offense_base,
      b.complainant_name, b.complainant_address, b.complainant_id_card, b.complainant_phone,
      b.suspect_name, b.suspect_address, b.suspect_id_card, b.suspect_phone,
      b.case_behavior, b.category_id || null, b.case_status || 'อยู่ระหว่างสอบสวน', b.actions_taken,
      b.incident_date, b.incident_location, b.damage, b.investigator, b.investigator_rank, b.responsible_officer, b.notes
    ]);
    res.json({ id, success: true });
  });

  app.put('/api/cases/:id', requireAuth, (req, res) => {
    const b = req.body;
    run(`UPDATE cases SET
      case_number=?, case_file_number=?, daily_number=?, daily_date=?, offense_base=?,
      complainant_name=?, complainant_address=?, complainant_id_card=?, complainant_phone=?,
      suspect_name=?, suspect_address=?, suspect_id_card=?, suspect_phone=?,
      case_behavior=?, category_id=?, case_status=?, actions_taken=?,
      incident_date=?, incident_location=?, damage=?, investigator=?, investigator_rank=?, responsible_officer=?, notes=?,
      updated_at=CURRENT_TIMESTAMP WHERE id=?`, [
      b.case_number, b.case_file_number, b.daily_number, b.daily_date, b.offense_base,
      b.complainant_name, b.complainant_address, b.complainant_id_card, b.complainant_phone,
      b.suspect_name, b.suspect_address, b.suspect_id_card, b.suspect_phone,
      b.case_behavior, b.category_id || null, b.case_status, b.actions_taken,
      b.incident_date, b.incident_location, b.damage, b.investigator, b.investigator_rank, b.responsible_officer, b.notes,
      parseInt(req.params.id)
    ]);
    res.json({ success: true });
  });

  app.delete('/api/cases/:id', requireAuth, (req, res) => {
    const attachments = queryAll('SELECT * FROM attachments WHERE case_id = ?', [parseInt(req.params.id)]);
    for (const att of attachments) {
      const filePath = path.join(uploadDir, att.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
    run('DELETE FROM cases WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ success: true });
  });

  // ========== TODOS ==========
  app.post('/api/cases/:id/todos', requireAuth, (req, res) => {
    const { description, deadline_date } = req.body;
    if (!description) return res.status(400).json({ error: 'กรุณาระบุรายละเอียด' });
    const id = run('INSERT INTO todo_items (case_id, description, deadline_date) VALUES (?, ?, ?)',
      [parseInt(req.params.id), description, deadline_date || null]);
    res.json({ id, description, deadline_date: deadline_date || null, is_completed: 0 });
  });

  app.put('/api/todos/:id', requireAuth, (req, res) => {
    const { is_completed, description, deadline_date } = req.body;
    if (description !== undefined) run('UPDATE todo_items SET description = ? WHERE id = ?', [description, parseInt(req.params.id)]);
    if (deadline_date !== undefined) run('UPDATE todo_items SET deadline_date = ? WHERE id = ?', [deadline_date || null, parseInt(req.params.id)]);
    if (is_completed !== undefined) run('UPDATE todo_items SET is_completed = ? WHERE id = ?', [is_completed ? 1 : 0, parseInt(req.params.id)]);
    res.json({ success: true });
  });

  app.delete('/api/todos/:id', requireAuth, (req, res) => {
    run('DELETE FROM todo_items WHERE id = ?', [parseInt(req.params.id)]);
    res.json({ success: true });
  });

  // ========== ATTACHMENTS ==========
  app.post('/api/cases/:id/attachments', requireAuth, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'ไม่พบไฟล์' });
    const id = run('INSERT INTO attachments (case_id, filename, original_name, file_size, file_type) VALUES (?, ?, ?, ?, ?)',
      [parseInt(req.params.id), req.file.filename, req.file.originalname, req.file.size, req.file.mimetype]);
    res.json({ id, filename: req.file.filename, original_name: req.file.originalname });
  });

  app.delete('/api/attachments/:id', requireAuth, (req, res) => {
    const att = queryOne('SELECT * FROM attachments WHERE id = ?', [parseInt(req.params.id)]);
    if (att) {
      const filePath = path.join(uploadDir, att.filename);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      run('DELETE FROM attachments WHERE id = ?', [parseInt(req.params.id)]);
    }
    res.json({ success: true });
  });

  // ========== STATS ==========
  app.get('/api/stats', requireAuth, (req, res) => {
    const totalCases = count('SELECT COUNT(*) as count FROM cases');
    const byCategory = queryAll(`SELECT cat.name, COUNT(c.id) as count FROM categories cat
                                  LEFT JOIN cases c ON c.category_id = cat.id GROUP BY cat.id`);
    const byStatus = queryAll('SELECT case_status, COUNT(*) as count FROM cases GROUP BY case_status');
    const recentCases = queryAll(`SELECT c.id, c.case_number, c.case_file_number, c.complainant_name, c.suspect_name,
                                   c.case_status, cat.name as category_name
                                   FROM cases c LEFT JOIN categories cat ON c.category_id = cat.id
                                   ORDER BY c.updated_at DESC LIMIT 5`);
    res.json({ totalCases, byCategory, byStatus, recentCases });
  });

  // ========== DEADLINES (NOTIFICATIONS) ==========
  app.get('/api/deadlines', requireAuth, (req, res) => {
    const twoWeeksLater = new Date();
    twoWeeksLater.setDate(twoWeeksLater.getDate() + 14);
    const isoDate = (d) => d.toISOString().slice(0, 10);

    const todos = queryAll(
      `SELECT t.*, c.case_number, c.daily_number, c.suspect_name, c.complainant_name, c.case_status
       FROM todo_items t JOIN cases c ON t.case_id = c.id
       WHERE t.is_completed = 0 AND t.deadline_date IS NOT NULL AND t.deadline_date <= ?
       ORDER BY t.deadline_date ASC`,
      [isoDate(twoWeeksLater)]
    );

    const today = isoDate(new Date());
    const results = todos.map(t => {
      let urgency = 'upcoming';
      if (t.deadline_date < today) urgency = 'overdue';
      else {
        const daysLeft = Math.ceil((new Date(t.deadline_date) - new Date(today)) / (1000 * 60 * 60 * 24));
        if (daysLeft <= 3) urgency = 'urgent';
      }
      return { ...t, urgency };
    });

    // Also count outstanding todos without deadline
    const totalOpenTodos = count('SELECT COUNT(*) as count FROM todo_items WHERE is_completed = 0');

    res.json({ deadlines: results, totalOpenTodos });
  });

  // ========== EXPORT ==========
  app.get('/api/cases/:id/export', requireAuth, (req, res) => {
    const c = queryOne(
      `SELECT c.*, cat.name as category_name FROM cases c
       LEFT JOIN categories cat ON c.category_id = cat.id WHERE c.id = ?`,
      [parseInt(req.params.id)]
    );
    if (!c) return res.status(404).json({ error: 'ไม่พบคดี' });

    const todos = queryAll('SELECT * FROM todo_items WHERE case_id = ?', [parseInt(req.params.id)]);
    const attachments = queryAll('SELECT * FROM attachments WHERE case_id = ?', [parseInt(req.params.id)]);

    let report = `========================================\n`;
    report += `          รายงานการสอบสวนคดี\n`;
    report += `========================================\n\n`;
    report += `เลขลำดับสำนวนการสอบสวน: ${c.case_file_number || '-'}\n`;
    report += `เลขคดี: ${c.case_number || '-'}\n`;
    report += `เลขประจำวัน: ${c.daily_number || '-'}\n`;
    report += `วันเดือนปี ของเลขประจำวัน: ${c.daily_date || '-'}\n`;
    report += `ฐานความผิด: ${c.offense_base || '-'}\n`;
    report += `หมวดหมู่: ${c.category_name || '-'}\n`;
    report += `สถานะ: ${c.case_status || '-'}\n\n`;
    report += `--- เหตุการณ์ ---\n`;
    report += `วันเวลาเกิดเหตุ: ${c.incident_date || '-'}\n`;
    report += `สถานที่เกิดเหตุ: ${c.incident_location || '-'}\n`;
    report += `ความเสียหาย: ${c.damage || '-'}\n\n`;
    report += `--- ข้อมูลผู้กล่าวหา ---\n`;
    report += `ชื่อ: ${c.complainant_name || '-'}\n`;
    report += `ที่อยู่: ${c.complainant_address || '-'}\n`;
    report += `เลขบัตรประชาชน: ${c.complainant_id_card || '-'}\n`;
    report += `โทรศัพท์: ${c.complainant_phone || '-'}\n\n`;
    report += `--- ข้อมูลผู้ต้องหา ---\n`;
    report += `ชื่อ: ${c.suspect_name || '-'}\n`;
    report += `ที่อยู่: ${c.suspect_address || '-'}\n`;
    report += `เลขบัตรประชาชน: ${c.suspect_id_card || '-'}\n`;
    report += `โทรศัพท์: ${c.suspect_phone || '-'}\n\n`;
    report += `--- พฤติการณ์คดี ---\n${c.case_behavior || '-'}\n\n`;
    report += `--- สิ่งที่ได้ดำเนินการ ---\n${c.actions_taken || '-'}\n\n`;
    report += `--- สิ่งที่ต้องดำเนินการ ---\n`;
    if (todos.length > 0) {
      todos.forEach((t, i) => {
        const dl = t.deadline_date ? ` (กำหนด: ${t.deadline_date})` : '';
        report += `${i + 1}. [${t.is_completed ? '✓' : ' '}] ${t.description}${dl}\n`;
      });
    } else { report += `- ไม่มีข้อมูล -\n`; }
    report += `\n--- ผู้รับผิดชอบ ---\n`;
    report += `พนักงานสอบสวน: ${c.investigator_rank ? c.investigator_rank + ' ' : ''}${c.investigator || '-'}\n`;
    report += `ผู้รับผิดชอบ: ${c.responsible_officer || '-'}\n`;
    report += `หมายเหตุ: ${c.notes || '-'}\n\n`;
    report += `--- ไฟล์แนบ ---\n`;
    if (attachments.length > 0) {
      attachments.forEach((a, i) => { report += `${i + 1}. ${a.original_name}\n`; });
    } else { report += `- ไม่มีไฟล์แนบ -\n`; }
    report += `\n========================================\n`;
    report += `วันที่สร้างรายงาน: ${new Date().toLocaleString('th-TH')}\n`;

    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const safeName = (c.case_number || 'case-' + c.id).replace(/[^\w\-.]+/g, '_');
    res.setHeader('Content-Disposition', `attachment; filename="case-${safeName}.txt"`);
    res.send(report);
  });

  // Request logger for debugging
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    next();
  });

  // Serve main page (catch-all AFTER API routes)
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api/')) {
      return res.sendFile(path.join(baseDir, 'public', 'index.html'));
    }
    next();
  });

  // Error handler
  app.use((err, req, res, next) => {
    console.error('Server error:', err && err.message ? err.message : err);
    console.error('Full error object:', JSON.stringify(err, Object.getOwnPropertyNames(err)));
    res.status(500).json({ error: 'เกิดข้อผิดพลาดในเซิร์ฟเวอร์' });
  });

  return { app, port, host, baseDir, uploadDir };
}

async function startStandalone() {
  const { app, port, host } = createServer();
  await initDatabase();
  app.listen(port, host, () => {
    console.log(`========================================`);
    console.log(`  ระบบจัดการสำนวนการสอบสวน`);
    console.log(`  Server running at http://localhost:${port}`);
    console.log(`========================================`);
    console.log(`  Default login: admin / admin123`);
  });
}

module.exports = { createServer };

if (require.main === module) {
  startStandalone().catch(err => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}