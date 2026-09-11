const { app, BrowserWindow, Menu, shell, Tray, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const { createServer } = require('./server');
const { initDatabase } = require('./db');

let mainWindow = null;
let tray = null;
const isQuitting = { value: false };

// Data & uploads must live in writable userData when packaged (asar is read-only)
function getDataDir() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'data')
    : process.env.CASE_DATA_DIR || path.join(__dirname, 'data');
}
function getUploadDir() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'uploads')
    : process.env.CASE_UPLOAD_DIR || path.join(__dirname, 'uploads');
}

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'ระบบจัดการสำนวนการสอบสวน',
    autoHideMenuBar: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'ระบบ',
      submenu: [
        {
          label: 'เปิดในเบราว์เซอร์',
          click: () => shell.openExternal(`http://127.0.0.1:${port}`)
        },
        {
          label: 'เปิดโฟลเดอร์ข้อมูล',
          click: () => shell.openPath(getDataDir())
        },
        {
          label: 'เปิดโฟลเดอร์ไฟล์แนบ',
          click: () => shell.openPath(getUploadDir())
        },
        { type: 'separator' },
        { label: 'ออกจากโปรแกรม', accelerator: 'Ctrl+Q', click: () => { isQuitting.value = true; app.quit(); } }
      ]
    },
    { role: 'editMenu' }
  ]);
  Menu.setApplicationMenu(menu);

  mainWindow.loadURL(`http://127.0.0.1:${port}`);

  mainWindow.on('close', (e) => {
    if (!isQuitting.value) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function setupTray(port) {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    : nativeImage.createEmpty();

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('ระบบจัดการสำนวนการสอบสวน');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'เปิดโปรแกรม', click: () => { if (mainWindow) { mainWindow.show(); } } },
    { type: 'separator' },
    { label: 'ออกจากโปรแกรม', click: () => { isQuitting.value = true; app.quit(); } }
  ]));
  tray.on('double-click', () => { if (mainWindow) { mainWindow.show(); } });
}

function findFreePort(startPort) {
  return new Promise((resolve, reject) => {
    const net = require('net');
    function tryPort(p) {
      const tester = net.createServer();
      tester.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
          tryPort(p + 1);
        } else {
          reject(err);
        }
      });
      tester.once('listening', () => {
        tester.close(() => resolve(p));
      });
      tester.listen(p, '127.0.0.1');
    }
    tryPort(startPort);
  });
}

app.whenReady().then(async () => {
  const dataDir = getDataDir();
  const uploadDir = getUploadDir();
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

  // Seed bundled data into writable userData on first run
  if (app.isPackaged) {
    const bundledDb = path.join(app.getAppPath(), 'data', 'cases.db');
    const targetDb = path.join(dataDir, 'cases.db');
    if (fs.existsSync(bundledDb) && !fs.existsSync(targetDb)) {
      try { fs.copyFileSync(bundledDb, targetDb); console.log('Seeded initial data'); } catch (e) { console.error('Seed failed:', e.message); }
    }
  }

  // Make db.js and server.js use the writable dirs
  process.env.CASE_DATA_DIR = dataDir;
  process.env.CASE_UPLOAD_DIR = uploadDir;

  // sql.js wasm package lives in app.asar (readable); point sql.js at it
  process.env.SQL_DIST = path.join(app.getAppPath(), 'node_modules', 'sql.js', 'dist');

  const port = await findFreePort(Number(process.env.PORT) || 3001);
  const { app: expressApp } = createServer({
    baseDir: __dirname,
    uploadDir,
    port,
    host: '127.0.0.1'
  });

  await initDatabase();
  expressApp.listen(port, '127.0.0.1', () => {
    console.log(`Server running at http://127.0.0.1:${port}`);
  });

  createWindow(port);
  setupTray(port);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
    else if (mainWindow) mainWindow.show();
  });
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('before-quit', () => {
  isQuitting.value = true;
});