// ========== State ==========
let currentUser = null;
let currentPage = 'dashboard';
let currentCaseId = null;
let currentCasesPage = 1;
let searchTimeout = null;
let categories = [];

// ========== API Helper ==========
async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

// ========== Auth ==========
async function checkAuth() {
  try {
    const data = await api('/api/me');
    currentUser = data.user;
    showApp();
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('appPage').style.display = 'none';
}

function showApp() {
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appPage').style.display = 'flex';
  document.getElementById('userFullname').textContent = currentUser.fullname || currentUser.username;
  loadCategories();
  showPage('dashboard');
}

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const errEl = document.getElementById('loginError');
  errEl.style.display = 'none';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        username: document.getElementById('loginUsername').value,
        password: document.getElementById('loginPassword').value
      })
    });
    currentUser = data.user;
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  }
});

async function logout() {
  await api('/api/logout', { method: 'POST' });
  currentUser = null;
  showLogin();
}

// ========== Navigation ==========
function showPage(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelectorAll('.menu-link').forEach(l => {
    l.classList.toggle('active', l.dataset.page === page);
  });
  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
  document.querySelector('.sidebar-overlay').classList.remove('active');

  if (page === 'dashboard') loadDashboard();
  if (page === 'cases') loadCases();
  if (page === 'categories') loadCategoriesList();
  if (page === 'addCase') {
    if (!document.getElementById('caseId').value) resetCaseForm();
    populateCategorySelects();
  }
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.querySelector('.sidebar-overlay').classList.toggle('active');
}

// ========== Categories ==========
async function loadCategories() {
  try {
    categories = await api('/api/categories');
    populateCategorySelects();
  } catch {}
}

function populateCategorySelects() {
  const selects = ['caseCategory', 'filterCategory'];
  selects.forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    const current = sel.value;
    const firstOption = sel.options[0];
    sel.innerHTML = '';
    sel.appendChild(firstOption);
    categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      sel.appendChild(opt);
    });
    sel.value = current;
  });
}

async function loadCategoriesList() {
  const list = document.getElementById('categoriesList');
  if (categories.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">🏷️</div><p>ยังไม่มีหมวดหมู่</p></div>';
    return;
  }
  list.innerHTML = categories.map(c => `
    <div class="category-item">
      <span>${c.name}</span>
      <button onclick="deleteCategory(${c.id})" class="btn btn-sm btn-danger">🗑️ ลบ</button>
    </div>
  `).join('');
}

async function addCategory() {
  const input = document.getElementById('newCategoryName');
  const name = input.value.trim();
  if (!name) return;
  try {
    await api('/api/categories', { method: 'POST', body: JSON.stringify({ name }) });
    input.value = '';
    await loadCategories();
    loadCategoriesList();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteCategory(id) {
  if (!confirm('ต้องการลบหมวดหมู่นี้?')) return;
  await api(`/api/categories/${id}`, { method: 'DELETE' });
  await loadCategories();
  loadCategoriesList();
}

// ========== Dashboard ==========
async function loadDashboard() {
  try {
    // Load deadline notifications
    const notifData = await api('/api/deadlines');
    const notifEl = document.getElementById('deadlineNotifications');
    const urgent = notifData.deadlines.filter(d => d.urgency === 'overdue' || d.urgency === 'urgent');
    const upcoming = notifData.deadlines.filter(d => d.urgency === 'upcoming');

    let notifHTML = '';
    if (urgent.length > 0) {
      notifHTML += `<div class="notification-box notification-urgent">
        <h3>🔴 ต้องรีบดำเนินการ (${urgent.length} รายการ)</h3>
        ${urgent.slice(0, 20).map(d => `
          <div class="notification-item" onclick="viewCase(${d.case_id})">
            <span class="badge ${d.urgency === 'overdue' ? 'badge-deadline-overdue' : 'badge-deadline-urgent'}">
              ${d.urgency === 'overdue' ? `เลยกำหนดแล้ว (${d.deadline_date})` : `เหลือ ${daysUntil(d.deadline_date)} วัน (${d.deadline_date})`}
            </span>
            <span>คดี ${d.case_number || '-'}: ${d.description}</span>
          </div>
        `).join('')}
      </div>`;
    }
    if (upcoming.length > 0) {
      notifHTML += `<div class="notification-box notification-soon">
        <h3>📅 กำหนดการเร็วๆ นี้ (${upcoming.length} รายการ)</h3>
        ${upcoming.slice(0, 10).map(d => `
          <div class="notification-item" onclick="viewCase(${d.case_id})">
            <span class="badge badge-deadline-soon">${d.deadline_date}</span>
            <span>คดี ${d.case_number || '-'}: ${d.description}</span>
          </div>
        `).join('')}
      </div>`;
    }
    if (!notifHTML) {
      notifHTML = '<div class="notification-box notification-none"><p>✅ ไม่มีรายการที่ต้องรีบดำเนินการ</p></div>';
    }
    notifEl.innerHTML = notifHTML;

    // Load stats
    const stats = await api('/api/stats');
    const grid = document.getElementById('statsGrid');
    grid.innerHTML = `
      <div class="stat-card">
        <div class="stat-value">${stats.totalCases}</div>
        <div class="stat-label">คดีทั้งหมด</div>
      </div>
      ${stats.byCategory.map(c => `
        <div class="stat-card">
          <div class="stat-value">${c.count}</div>
          <div class="stat-label">${c.name}</div>
        </div>
      `).join('')}
    `;

    const recent = document.getElementById('recentCases');
    if (stats.recentCases.length === 0) {
      recent.innerHTML = '<div class="empty-state"><div class="empty-icon">📁</div><p>ยังไม่มีคดี</p></div>';
    } else {
      recent.innerHTML = stats.recentCases.map(c => `
        <div class="case-item" onclick="viewCase(${c.id})">
          <div class="case-item-header">
            <span class="case-seq">เลขลำดับ ${c.case_file_number || '-'}</span>
            <span class="case-seq-divider">•</span>
            <span class="case-id-label">เลขคดี ${c.case_number || '-'}</span>
          </div>
          <div class="case-item-info">
            <p class="case-person-line"><span class="case-person-label">ผู้กล่าวหา</span> ${c.complainant_name || '—'}</p>
            <p class="case-person-line"><span class="case-person-label">ผู้ต้องหา</span> ${c.suspect_name || '—'}</p>
          </div>
          <div class="case-item-meta">
            <span class="badge badge-category">${c.category_name || 'ไม่มีหมวดหมู่'}</span>
            <span class="badge badge-status">${c.case_status}</span>
          </div>
        </div>
      `).join('');
    }
  } catch (err) {
    console.error('Dashboard error:', err);
  }
}

// ========== Cases List ==========
function debounceSearch() {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => loadCases(), 300);
}

async function loadCases(page = 1) {
  currentCasesPage = page;
  const search = document.getElementById('searchInput').value;
  const category = document.getElementById('filterCategory').value;
  const status = document.getElementById('filterStatus').value;

  const params = new URLSearchParams({ page, limit: 20 });
  if (search) params.set('search', search);
  if (category) params.set('category', category);
  if (status) params.set('status', status);

  try {
    const data = await api(`/api/cases?${params}`);
    const list = document.getElementById('casesList');

    if (data.cases.length === 0) {
      list.innerHTML = '<div class="empty-state"><div class="empty-icon">📁</div><p>ไม่พบคดี</p></div>';
      document.getElementById('casesPagination').innerHTML = '';
      return;
    }

    list.innerHTML = data.cases.map(c => {
      // Build todo/notification summary
      const pendingTodos = c.todos || [];
      const hasUrgent = pendingTodos.some(t => t.deadline_date && daysUntil(t.deadline_date) <= 3);
      const urgentTodo = pendingTodos.find(t => t.deadline_date && daysUntil(t.deadline_date) <= 14);
      let todoHTML = '';
      if (urgentTodo) {
        const dl = urgentTodo.deadline_date;
        const days = daysUntil(dl);
        const cls = days < 0 ? 'badge-deadline-overdue' : (days <= 3 ? 'badge-deadline-urgent' : 'badge-deadline-soon');
        const label = days < 0 ? `เลยกำหนด ${-days} วัน` : (days === 0 ? 'วันนี้' : (days <= 3 ? `เหลือ ${days} วัน` : `เหลือ ${days} วัน`));
        todoHTML = `<div class="case-todo">
          <span class="todo-alert ${cls}">⏰ ${label}</span>
          <span class="todo-desc">${urgentTodo.description}</span>
          <span class="todo-date">📅 ${formatDatetime(dl)}</span>
        </div>`;
      } else if (pendingTodos.length > 0) {
        todoHTML = `<div class="case-todo">
          <span class="todo-desc">📋 ยังต้องทำ ${pendingTodos.length} รายการ</span>
        </div>`;
      }
      return `
        <div class="case-item ${hasUrgent ? 'case-item-urgent' : ''}" onclick="viewCase(${c.id})">
          <div class="case-item-header">
            <span class="case-seq">เลขลำดับ ${c.case_file_number || '-'}</span>
            <span class="case-seq-divider">•</span>
            <span class="case-id-label">เลขคดี ${c.case_number || '-'}</span>
          </div>
          <div class="case-item-meta-row">
            <span class="case-meta-label">เลขประจำวัน</span>
            <span class="case-meta-value">${c.daily_number || '-'}</span>
            <span class="case-meta-date">${formatDatetime(c.daily_date) || ''}</span>
          </div>
          <div class="case-item-info">
            <p class="case-person-line">
              <span class="case-person-label">ผู้กล่าวหา</span> ${c.complainant_name || '—'}
            </p>
            <p class="case-person-line">
              <span class="case-person-label">ผู้ต้องหา</span> ${c.suspect_name || '—'}
            </p>
            ${c.offense_base ? `<p class="case-person-line"><span class="case-person-label">ฐานความผิด</span> ${c.offense_base}</p>` : ''}
            ${todoHTML}
          </div>
          <div class="case-item-meta">
            <span class="badge badge-category">${c.category_name || 'ไม่มีหมวดหมู่'}</span>
            <span class="badge badge-status">${c.case_status}</span>
          </div>
        </div>
      `;
    }).join('');

    // Pagination
    const totalPages = Math.ceil(data.total / data.limit);
    const pagination = document.getElementById('casesPagination');
    if (totalPages <= 1) {
      pagination.innerHTML = '';
      return;
    }
    let paginationHTML = '';
    for (let i = 1; i <= totalPages; i++) {
      paginationHTML += `<button class="${i === currentCasesPage ? 'active' : ''}" onclick="loadCases(${i})">${i}</button>`;
    }
    pagination.innerHTML = paginationHTML;
  } catch {}
}

// ========== Case Detail ==========
async function viewCase(id) {
  currentCaseId = id;
  try {
    const c = await api(`/api/cases/${id}`);
    showPage('caseDetail');

    document.getElementById('detailTitle').textContent = `📁 ${c.case_number || 'ไม่มีเลขคดี'}`;

    const content = document.getElementById('caseDetailContent');
    content.innerHTML = `
      <div class="detail-section">
        <h3>ข้อมูลคดี</h3>
        <div class="detail-grid">
          <div class="detail-field"><label>เลขลำดับสำนวนการสอบสวน</label><span>${c.case_file_number || '-'}</span></div>
          <div class="detail-field"><label>เลขคดี</label><span>${c.case_number || '-'}</span></div>
          <div class="detail-field"><label>เลขประจำวัน</label><span>${c.daily_number || '-'}</span></div>
          <div class="detail-field"><label>วันเดือนปี ของเลขประจำวัน</label><span>${formatDatetime(c.daily_date) || '-'}</span></div>
          <div class="detail-field"><label>ฐานความผิด</label><span>${c.offense_base || '-'}</span></div>
          <div class="detail-field"><label>หมวดหมู่</label><span>${c.category_name || '-'}</span></div>
          <div class="detail-field"><label>สถานะ</label><span class="badge badge-status">${c.case_status}</span></div>
        </div>
      </div>

      <div class="detail-section">
        <h3>เหตุการณ์</h3>
        <div class="detail-grid">
          <div class="detail-field"><label>วันเวลาเกิดเหตุ</label><span>${formatDatetime(c.incident_date) || '-'}</span></div>
          <div class="detail-field"><label>สถานที่เกิดเหตุ</label><span>${c.incident_location || '-'}</span></div>
          <div class="detail-field full-width"><label>ความเสียหาย</label><span class="detail-text">${c.damage || '-'}</span></div>
        </div>
      </div>

      <div class="detail-section">
        <h3>ผู้กล่าวหา</h3>
        <div class="detail-grid">
          <div class="detail-field"><label>ชื่อ-สกุล</label><span>${c.complainant_name || '-'}</span></div>
          <div class="detail-field"><label>เลขบัตรประชาชน</label><span>${c.complainant_id_card || '-'}</span></div>
          <div class="detail-field"><label>โทรศัพท์</label><span>${c.complainant_phone || '-'}</span></div>
          <div class="detail-field full-width"><label>ที่อยู่</label><span>${c.complainant_address || '-'}</span></div>
        </div>
      </div>

      <div class="detail-section">
        <h3>ผู้ต้องหา</h3>
        <div class="detail-grid">
          <div class="detail-field"><label>ชื่อ-สกุล</label><span>${c.suspect_name || '-'}</span></div>
          <div class="detail-field"><label>เลขบัตรประชาชน</label><span>${c.suspect_id_card || '-'}</span></div>
          <div class="detail-field"><label>โทรศัพท์</label><span>${c.suspect_phone || '-'}</span></div>
          <div class="detail-field full-width"><label>ที่อยู่</label><span>${c.suspect_address || '-'}</span></div>
        </div>
      </div>

      <div class="detail-section">
        <h3>พฤติการณ์คดี</h3>
        <div class="detail-text">${c.case_behavior || '-'}</div>
      </div>

      <div class="detail-section">
        <h3>สิ่งที่ได้ดำเนินการ</h3>
        <div class="detail-text">${c.actions_taken || '-'}</div>
      </div>

      <div class="detail-section">
        <h3>สิ่งที่ต้องดำเนินการ (To-Do List)</h3>
        <ul class="todo-list" id="todoList">
          ${(c.todos || []).map(t => `
            <li class="todo-item ${t.is_completed ? 'completed' : ''}">
              <button class="todo-btn" onclick="toggleTodo(${t.id}, ${t.is_completed ? 0 : 1})">${t.is_completed ? '☑️' : '⬜'}</button>
              <span class="todo-text">${t.description}${t.deadline_date ? `<br><small class="todo-deadline">📅 กำหนด: ${formatDatetime(t.deadline_date)} ${deadlineUrgencyLabel(t.deadline_date)}</small>` : ''}</span>
              <div class="todo-actions">
                <button class="todo-btn" onclick="editTodo(${t.id}, '${t.description.replace(/'/g, "\\'")}', '${t.deadline_date || ''}')">✏️</button>
                <button class="todo-btn" onclick="deleteTodo(${t.id})">🗑️</button>
              </div>
            </li>
          `).join('')}
        </ul>
        <div class="add-todo-form">
          <input type="text" id="newTodoInput" placeholder="เพิ่มสิ่งที่ต้องดำเนินการ..." onkeypress="if(event.key==='Enter'){addTodo();event.preventDefault();}">
          <input type="date" id="newTodoDeadline" title="กำหนดวันที่ต้องดำเนินการ">
          <button onclick="addTodo()" class="btn btn-primary btn-sm">➕ เพิ่ม</button>
        </div>
      </div>

      <div class="detail-section">
        <h3>ผู้รับผิดชอบ</h3>
        <div class="detail-grid">
          <div class="detail-field"><label>ยศ ชื่อ-นามสกุล พนักงานสอบสวน</label><span>${(c.investigator_rank ? c.investigator_rank + ' ' : '') + (c.investigator || '-')}</span></div>
          <div class="detail-field"><label>ผู้รับผิดชอบ</label><span>${c.responsible_officer || '-'}</span></div>
        </div>
      </div>

      <div class="detail-section">
        <h3>หมายเหตุ</h3>
        <div class="detail-text">${c.notes || '-'}</div>
      </div>

      <div class="detail-section">
        <h3>ไฟล์แนบ</h3>
        <div class="file-list" id="fileList">
          ${(c.attachments || []).map(a => `
            <div class="file-item">
              <a href="/uploads/${a.filename}" target="_blank">${a.original_name}</a>
              <div>
                <span style="font-size:12px;color:#999;margin-right:8px">${formatFileSize(a.file_size)}</span>
                <button onclick="deleteAttachment(${a.id})" class="todo-btn">🗑️</button>
              </div>
            </div>
          `).join('')}
          ${(c.attachments || []).length === 0 ? '<p style="color:#999;font-size:13px">ไม่มีไฟล์แนบ</p>' : ''}
        </div>
        <div class="upload-area" onclick="document.getElementById('fileInput').click()">
          <input type="file" id="fileInput" onchange="uploadFile()" multiple>
          <p>📎 คลิกเพื่อแนบไฟล์ หรือลากไฟล์มาที่นี่</p>
        </div>
      </div>
    `;
  } catch (err) {
    alert(err.message);
  }
}

// ========== Case Form ==========
function resetCaseForm() {
  document.getElementById('caseId').value = '';
  document.getElementById('caseForm').reset();
  document.getElementById('caseFormTitle').textContent = '➕ เพิ่มคดีใหม่';
}

function editCurrentCase() {
  if (!currentCaseId) return;
  api(`/api/cases/${currentCaseId}`).then(c => {
    showPage('addCase');
    document.getElementById('caseFormTitle').textContent = '✏️ แก้ไขคดี';
    document.getElementById('caseId').value = c.id;
    document.getElementById('caseFileNumber').value = c.case_file_number || '';
    document.getElementById('caseNumber').value = c.case_number || '';
    document.getElementById('dailyNumber').value = c.daily_number || '';
    document.getElementById('dailyDate').value = c.daily_date || '';
    document.getElementById('offenseBase').value = c.offense_base || '';
    document.getElementById('complainantName').value = c.complainant_name || '';
    document.getElementById('complainantAddress').value = c.complainant_address || '';
    document.getElementById('complainantIdCard').value = c.complainant_id_card || '';
    document.getElementById('complainantPhone').value = c.complainant_phone || '';
    document.getElementById('suspectName').value = c.suspect_name || '';
    document.getElementById('suspectAddress').value = c.suspect_address || '';
    document.getElementById('suspectIdCard').value = c.suspect_id_card || '';
    document.getElementById('suspectPhone').value = c.suspect_phone || '';
    document.getElementById('caseBehavior').value = c.case_behavior || '';
    document.getElementById('caseStatus').value = c.case_status || '';
    document.getElementById('actionsTaken').value = c.actions_taken || '';
    document.getElementById('incidentDate').value = c.incident_date || '';
    document.getElementById('incidentLocation').value = c.incident_location || '';
    document.getElementById('damage').value = c.damage || '';
    document.getElementById('investigator').value = c.investigator || '';
    document.getElementById('investigatorRank').value = c.investigator_rank || '';
    document.getElementById('responsibleOfficer').value = c.responsible_officer || '';
    document.getElementById('notes').value = c.notes || '';
    populateCategorySelects();
    setTimeout(() => {
      document.getElementById('caseCategory').value = c.category_id || '';
    }, 100);
  });
}

document.getElementById('caseForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('caseId').value;
  const body = {
    case_number: document.getElementById('caseNumber').value,
    case_file_number: document.getElementById('caseFileNumber').value,
    daily_number: document.getElementById('dailyNumber').value,
    daily_date: document.getElementById('dailyDate').value,
    offense_base: document.getElementById('offenseBase').value,
    complainant_name: document.getElementById('complainantName').value,
    complainant_address: document.getElementById('complainantAddress').value,
    complainant_id_card: document.getElementById('complainantIdCard').value,
    complainant_phone: document.getElementById('complainantPhone').value,
    suspect_name: document.getElementById('suspectName').value,
    suspect_address: document.getElementById('suspectAddress').value,
    suspect_id_card: document.getElementById('suspectIdCard').value,
    suspect_phone: document.getElementById('suspectPhone').value,
    case_behavior: document.getElementById('caseBehavior').value,
    category_id: document.getElementById('caseCategory').value || null,
    case_status: document.getElementById('caseStatus').value,
    actions_taken: document.getElementById('actionsTaken').value,
    incident_date: document.getElementById('incidentDate').value,
    incident_location: document.getElementById('incidentLocation').value,
    damage: document.getElementById('damage').value,
    investigator: document.getElementById('investigator').value,
    investigator_rank: document.getElementById('investigatorRank').value,
    responsible_officer: document.getElementById('responsibleOfficer').value,
    notes: document.getElementById('notes').value
  };

  try {
    if (id) {
      await api(`/api/cases/${id}`, { method: 'PUT', body: JSON.stringify(body) });
      alert('แก้ไขคดีสำเร็จ');
      viewCase(id);
    } else {
      const result = await api('/api/cases', { method: 'POST', body: JSON.stringify(body) });
      alert('เพิ่มคดีสำเร็จ');
      viewCase(result.id);
    }
  } catch (err) {
    alert(err.message);
  }
});

async function deleteCurrentCase() {
  if (!currentCaseId) return;
  if (!confirm('ต้องการลบคดีนี้? การกระทำนี้ไม่สามารถย้อนกลับได้')) return;
  try {
    await api(`/api/cases/${currentCaseId}`, { method: 'DELETE' });
    alert('ลบคดีสำเร็จ');
    showPage('cases');
  } catch (err) {
    alert(err.message);
  }
}

function exportCurrentCase() {
  if (currentCaseId) {
    window.open(`/api/cases/${currentCaseId}/export`, '_blank');
  }
}

// ========== Todos ==========
async function addTodo() {
  const input = document.getElementById('newTodoInput');
  const deadlineInput = document.getElementById('newTodoDeadline');
  const desc = input.value.trim();
  const deadline = deadlineInput ? deadlineInput.value : '';
  if (!desc || !currentCaseId) return;
  try {
    await api(`/api/cases/${currentCaseId}/todos`, {
      method: 'POST',
      body: JSON.stringify({ description: desc, deadline_date: deadline })
    });
    input.value = '';
    if (deadlineInput) deadlineInput.value = '';
    viewCase(currentCaseId);
  } catch (err) {
    alert(err.message);
  }
}

async function toggleTodo(id, completed) {
  await api(`/api/todos/${id}`, { method: 'PUT', body: JSON.stringify({ is_completed: completed }) });
  viewCase(currentCaseId);
}

async function editTodo(id, currentDesc, currentDeadline) {
  const newDesc = prompt('แก้ไขรายการ:', currentDesc);
  if (newDesc && newDesc.trim()) {
    const newDeadline = prompt('กำหนดวันที่ (เช่น 2026-09-15 หรือเว้นว่าง):', currentDeadline || '');
    await api(`/api/todos/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ description: newDesc.trim(), deadline_date: newDeadline || null })
    });
    viewCase(currentCaseId);
  }
}

async function deleteTodo(id) {
  if (!confirm('ลบรายการนี้?')) return;
  await api(`/api/todos/${id}`, { method: 'DELETE' });
  viewCase(currentCaseId);
}

// ========== Attachments ==========
async function uploadFile() {
  const input = document.getElementById('fileInput');
  if (!input.files.length || !currentCaseId) return;

  for (const file of input.files) {
    const formData = new FormData();
    formData.append('file', file);
    try {
      await fetch(`/api/cases/${currentCaseId}/attachments`, {
        method: 'POST',
        body: formData
      });
    } catch (err) {
      alert('เกิดข้อผิดพลาดในการอัปโหลดไฟล์');
    }
  }
  input.value = '';
  viewCase(currentCaseId);
}

async function deleteAttachment(id) {
  if (!confirm('ลบไฟล์นี้?')) return;
  await api(`/api/attachments/${id}`, { method: 'DELETE' });
  viewCase(currentCaseId);
}

// ========== Utils ==========
function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + sizes[i];
}

function formatDatetime(value) {
  if (!value) return '';
  // value may be "2026-09-15T08:30" (datetime-local) or "2026-09-15" (date)
  const parts = value.split('T');
  const datePart = parts[0];
  let result = datePart || '';
  if (parts.length > 1 && parts[1]) {
    result += ' ' + parts[1];
  }
  return result;
}

function daysUntil(dateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + 'T00:00:00');
  return Math.ceil((target - today) / (1000 * 60 * 60 * 24));
}

function deadlineUrgencyLabel(deadline) {
  if (!deadline) return '';
  const days = daysUntil(deadline);
  if (days < 0) return `<span class="badge badge-deadline-overdue">⏰ เลยกำหนด ${-days} วัน</span>`;
  if (days === 0) return `<span class="badge badge-deadline-urgent">🔴 วันนี้</span>`;
  if (days <= 3) return `<span class="badge badge-deadline-urgent">⚠️ ${days} วัน</span>`;
  if (days <= 7) return `<span class="badge badge-deadline-soon">📅 ${days} วัน</span>`;
  return '';
}

function urgencyFromTodo(t) {
  // t is a todo object
  const days = t.deadline_date ? daysUntil(t.deadline_date) : Infinity;
  if (days < 0) return 'overdue';
  if (days <= 3) return 'urgent';
  if (days <= 14) return 'soon';
  return 'none';
}

// ========== Init ==========
checkAuth();