const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const SAVE_INTERVAL = 5000;

let db = null;
let saveTimer = null;

function getDataDir() {
  return process.env.CASE_DATA_DIR || path.join(__dirname, 'data');
}
function getDbPath() {
  return path.join(getDataDir(), 'cases.db');
}

function saveDatabase() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    const dbPath = getDbPath();
    const dataDir = path.dirname(dbPath);
    if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(dbPath, buffer);
  } catch (e) {
    console.error('Error saving database:', e.message);
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveDatabase, 1000);
}

async function initDatabase() {
  const SQL = await initSqlJs(process.env.SQL_DIST
    ? { locateFile: (file) => path.join(process.env.SQL_DIST, file) }
    : {});
  const dbPath = getDbPath();
  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA journal_mode = WAL');
  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    fullname TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_number TEXT,
    case_file_number TEXT,
    daily_number TEXT,
    daily_date TEXT,
    offense_base TEXT,
    complainant_name TEXT,
    complainant_address TEXT,
    complainant_id_card TEXT,
    complainant_phone TEXT,
    suspect_name TEXT,
    suspect_address TEXT,
    suspect_id_card TEXT,
    suspect_phone TEXT,
    case_behavior TEXT,
    category_id INTEGER,
    case_status TEXT DEFAULT 'อยู่ระหว่างสอบสวน',
    actions_taken TEXT,
    incident_date TEXT,
    incident_location TEXT,
    damage TEXT,
    investigator TEXT,
    investigator_rank TEXT,
    responsible_officer TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS todo_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    description TEXT NOT NULL,
    deadline_date TEXT,
    is_completed INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS attachments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    case_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size INTEGER,
    file_type TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE
  )`);

  // Insert default categories
  const defaultCategories = ['คดีอาญา', 'คดีจราจร', 'คดีออนไลน์'];
  for (const cat of defaultCategories) {
    try {
      db.run('INSERT INTO categories (name) VALUES (?)', [cat]);
    } catch {}
  }

  // Migrate: add new columns to cases if missing
  const caseResult = db.exec('PRAGMA table_info(cases)');
  const caseCols = caseResult.length > 0 ? caseResult[0].values.map(v => v[1]) : [];
  const caseNewCols = [
    ['case_file_number', 'TEXT'],
    ['daily_date', 'TEXT'],
    ['incident_date', 'TEXT'],
    ['incident_location', 'TEXT'],
    ['damage', 'TEXT'],
    ['investigator', 'TEXT'],
    ['investigator_rank', 'TEXT'],
    ['responsible_officer', 'TEXT'],
    ['notes', 'TEXT']
  ];
  for (const [name, type] of caseNewCols) {
    if (!caseCols.includes(name)) {
      try {
        db.run(`ALTER TABLE cases ADD COLUMN ${name} ${type}`);
      } catch {}
    }
  }

  // Migrate: add deadline_date to todo_items if missing
  const todoResult = db.exec('PRAGMA table_info(todo_items)');
  const todoCols = todoResult.length > 0 ? todoResult[0].values.map(v => v[1]) : [];
  if (!todoCols.includes('deadline_date')) {
    try {
      db.run('ALTER TABLE todo_items ADD COLUMN deadline_date TEXT');
    } catch {}
  }

  // Insert default admin
  try {
    const adminCheck = db.exec("SELECT id FROM users WHERE username = 'admin'");
    if (adminCheck.length === 0 || adminCheck[0].values.length === 0) {
      const hashed = bcrypt.hashSync('admin123', 10);
      db.run("INSERT INTO users (username, password, fullname, role) VALUES (?, ?, ?, ?)",
        ['admin', hashed, 'ผู้ดูแลระบบ', 'admin']);
    }
  } catch {}

  saveDatabase();

  // Auto-save periodically
  setInterval(saveDatabase, SAVE_INTERVAL);

  process.on('SIGINT', () => { saveDatabase(); process.exit(); });
  process.on('SIGTERM', () => { saveDatabase(); process.exit(); });

  return db;
}

function sanitizeParams(params) {
  return (params || []).map(p => (p === undefined ? null : p));
}

// Helper: query returns array of row objects
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(sanitizeParams(params));
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: query returns first row object
function queryOne(sql, params = []) {
  const rows = queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: run (INSERT/UPDATE/DELETE)
function run(sql, params = []) {
  db.run(sql, sanitizeParams(params));
  scheduleSave();
  // Get last insert rowid
  const result = db.exec('SELECT last_insert_rowid() as id');
  return result.length > 0 ? result[0].values[0][0] : null;
}

// Helper: count
function count(sql, params = []) {
  const row = queryOne(sql, params);
  return row ? row.total || row.count || 0 : 0;
}

module.exports = { initDatabase, queryAll, queryOne, run, count, saveDatabase };