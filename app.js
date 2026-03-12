'use strict';

// ── CONSTANTS ──────────────────────────────────────────────
const GRADES = ['VB','V0','V1','V2','V3','V4','V5','V6','V7','V8','V9','V10','V11','V12','V13','V14','V15','V16','V17'];
const GRADE_COLORS = {
  'VB':'#9E9E9E','V0':'#4CAF50','V1':'#66BB6A','V2':'#FFEB3B','V3':'#FFC107',
  'V4':'#FF9800','V5':'#FF7043','V6':'#F44336','V7':'#E91E63','V8':'#9C27B0',
  'V9':'#673AB7','V10':'#3F51B5','V11':'#2196F3','V12':'#795548','V13':'#607D8B',
  'V14':'#37474F','V15':'#263238','V16':'#1a1a2e','V17':'#000000'
};

// ── STATE ──────────────────────────────────────────────────
let sb; // Supabase client
let currentUser = null;
let climbs = [];
let currentClimb = null;
let editMode = false;
let formGrade = 'V5';
let formStatus = 'project';
let formPhotoFile = null;
let formPhotoUrl = null;
let activeFilter = 'all';
let searchQuery = '';
let authMode = 'signin'; // 'signin' | 'signup'

// Drawing state
let canvas, ctx;
let isDrawing = false;
let drawTool = 'pen';
let drawColor = '#FF6B35';
let drawSize = 4;
let undoStack = [];
let arrowStart = null;
let drawingModified = false;

// ── INIT ───────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  setupGradePicker();
  setupStatusPicker();
  setupEventListeners();
  setupAuthUI();

  sb.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null;
    if (currentUser) {
      showApp();
      loadClimbs();
    } else {
      showLogin();
    }
  });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

// ── AUTH UI ────────────────────────────────────────────────
function setupAuthUI() {
  const tabSignIn = document.getElementById('tab-signin');
  const tabSignUp = document.getElementById('tab-signup');
  const confirmField = document.getElementById('auth-confirm');
  const submitBtn = document.getElementById('auth-submit-btn');

  tabSignIn.addEventListener('click', () => {
    authMode = 'signin';
    tabSignIn.classList.add('active');
    tabSignUp.classList.remove('active');
    confirmField.classList.add('hidden');
    submitBtn.textContent = 'Sign In';
    clearAuthError();
  });

  tabSignUp.addEventListener('click', () => {
    authMode = 'signup';
    tabSignUp.classList.add('active');
    tabSignIn.classList.remove('active');
    confirmField.classList.remove('hidden');
    submitBtn.textContent = 'Create Account';
    clearAuthError();
  });

  submitBtn.addEventListener('click', handleAuth);

  // Allow Enter key to submit
  ['auth-email', 'auth-password', 'auth-confirm'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') handleAuth();
    });
  });
}

async function handleAuth() {
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const confirm = document.getElementById('auth-confirm').value;
  const btn = document.getElementById('auth-submit-btn');

  if (!email || !password) {
    showAuthError('Please enter your email and password.');
    return;
  }

  btn.disabled = true;
  btn.textContent = '...';
  clearAuthError();

  try {
    if (authMode === 'signup') {
      if (password !== confirm) throw new Error('Passwords do not match.');
      if (password.length < 6) throw new Error('Password must be at least 6 characters.');
      const { error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
      showAuthNote('✅ Check your email to confirm your account, then sign in.');
      btn.textContent = 'Create Account';
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
  } catch (err) {
    showAuthError(err.message);
    btn.textContent = authMode === 'signin' ? 'Sign In' : 'Create Account';
  } finally {
    btn.disabled = false;
  }
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function clearAuthError() {
  const el = document.getElementById('auth-error');
  el.textContent = '';
  el.classList.add('hidden');
  document.getElementById('auth-note').textContent = '';
}

function showAuthNote(msg) {
  document.getElementById('auth-note').textContent = msg;
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-screen').classList.add('hidden');
}

function showApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  showView('list-view');
}

// ── SUPABASE DATA ──────────────────────────────────────────
async function loadClimbs() {
  const grid = document.getElementById('climbs-grid');
  grid.innerHTML = '<div class="loading">Loading your climbs...</div>';
  try {
    const { data, error } = await sb
      .from('climbs')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    climbs = data || [];
    renderClimbsList();
  } catch (err) {
    showToast('Error loading climbs', 'error');
    console.error(err);
  }
}

async function saveClimbData(data) {
  try {
    if (editMode && currentClimb) {
      const { error } = await sb
        .from('climbs')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', currentClimb.id);
      if (error) throw error;
      const idx = climbs.findIndex(c => c.id === currentClimb.id);
      if (idx !== -1) climbs[idx] = { ...climbs[idx], ...data };
    } else {
      const { data: inserted, error } = await sb
        .from('climbs')
        .insert({
          ...data,
          user_id: currentUser.id,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      climbs.unshift(inserted);
    }
    renderClimbsList();
    showToast(editMode ? 'Climb updated!' : 'Climb added!');
    showView('list-view');
  } catch (err) {
    showToast('Error saving climb', 'error');
    console.error(err);
  }
}

async function deleteClimbById(climbId) {
  try {
    const { error } = await sb.from('climbs').delete().eq('id', climbId);
    if (error) throw error;
    climbs = climbs.filter(c => c.id !== climbId);
    renderClimbsList();
    showToast('Climb deleted');
    showView('list-view');
  } catch (err) {
    showToast('Error deleting climb', 'error');
    console.error(err);
  }
}

// ── STORAGE ────────────────────────────────────────────────
async function uploadFile(file, bucket, path) {
  const { error } = await sb.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

async function uploadBlob(blob, bucket, path) {
  const { error } = await sb.storage
    .from(bucket)
    .upload(path, blob, { contentType: 'image/png', upsert: true });
  if (error) throw error;
  const { data } = sb.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

// ── VIEWS ──────────────────────────────────────────────────
function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
  if (id === 'detail-view') setTimeout(initCanvas, 50);
}

// ── LIST VIEW ──────────────────────────────────────────────
function renderClimbsList() {
  const grid = document.getElementById('climbs-grid');
  const filtered = climbs.filter(c => {
    const matchFilter = activeFilter === 'all' || c.status === activeFilter;
    const q = searchQuery.toLowerCase();
    const matchSearch = !q || (c.name || '').toLowerCase().includes(q) || (c.grade || '').toLowerCase().includes(q);
    return matchFilter && matchSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state"><div class="empty-icon">🧗</div><p>${climbs.length === 0 ? 'No climbs yet. Add your first one!' : 'No climbs match your filter.'}</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(c => {
    const color = GRADE_COLORS[c.grade] || '#9E9E9E';
    const statusEmoji = { project: '🎯', attempted: '💪', sent: '✅' }[c.status] || '🎯';
    const textColor = isLight(color) ? '#000' : '#fff';
    return `
      <div class="climb-card" data-id="${c.id}">
        ${c.photo_url
          ? `<div class="card-photo-wrapper">
               <img class="card-photo" src="${c.photo_url}" alt="${esc(c.name)}" loading="lazy">
               ${c.drawing_url ? `<img class="card-drawing-overlay" src="${c.drawing_url}" alt="">` : ''}
             </div>`
          : `<div class="card-photo-placeholder" style="background:${color}20"><span style="font-size:2.5rem">🧗</span></div>`}
        <div class="card-info">
          <div class="card-header">
            <span class="grade-badge" style="background:${color};color:${textColor}">${esc(c.grade || '?')}</span>
            <span class="status-emoji">${statusEmoji}</span>
          </div>
          <div class="card-name">${esc(c.name || 'Unnamed')}</div>
        </div>
      </div>`;
  }).join('');

  grid.querySelectorAll('.climb-card').forEach(card => {
    card.addEventListener('click', () => openClimbDetail(card.dataset.id));
  });
}

// ── ADD / EDIT VIEW ────────────────────────────────────────
function openAddClimb() {
  editMode = false;
  currentClimb = null;
  formGrade = 'V5';
  formStatus = 'project';
  formPhotoFile = null;
  formPhotoUrl = null;
  document.getElementById('edit-title').textContent = 'Add Climb';
  document.getElementById('climb-name-input').value = '';
  document.getElementById('climb-notes-input').value = '';
  document.getElementById('edit-photo-preview').classList.add('hidden');
  document.getElementById('photo-placeholder').classList.remove('hidden');
  updateGradePickerUI();
  updateStatusPickerUI();
  showView('edit-view');
}

function openEditClimb(climb) {
  editMode = true;
  currentClimb = climb;
  formGrade = climb.grade || 'V5';
  formStatus = climb.status || 'project';
  formPhotoFile = null;
  formPhotoUrl = climb.photo_url || null;
  document.getElementById('edit-title').textContent = 'Edit Climb';
  document.getElementById('climb-name-input').value = climb.name || '';
  document.getElementById('climb-notes-input').value = climb.notes || '';
  const preview = document.getElementById('edit-photo-preview');
  if (climb.photo_url) {
    preview.src = climb.photo_url;
    preview.classList.remove('hidden');
    document.getElementById('photo-placeholder').classList.add('hidden');
  } else {
    preview.classList.add('hidden');
    document.getElementById('photo-placeholder').classList.remove('hidden');
  }
  updateGradePickerUI();
  updateStatusPickerUI();
  showView('edit-view');
}

async function handleSaveClimb() {
  const name = document.getElementById('climb-name-input').value.trim();
  if (!name) { showToast('Please enter a name', 'error'); return; }

  const btn = document.getElementById('save-climb-btn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    let photoUrl = formPhotoUrl;
    if (formPhotoFile) {
      const ext = formPhotoFile.name.split('.').pop() || 'jpg';
      const path = `${currentUser.id}/${Date.now()}.${ext}`;
      photoUrl = await uploadFile(formPhotoFile, 'climb-photos', path);
    }
    await saveClimbData({
      name,
      grade: formGrade,
      status: formStatus,
      notes: document.getElementById('climb-notes-input').value.trim(),
      photo_url: photoUrl || null,
      drawing_url: (editMode && currentClimb) ? (currentClimb.drawing_url || null) : null,
    });
  } catch (err) {
    showToast('Error saving', 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ── DETAIL VIEW ────────────────────────────────────────────
function openClimbDetail(climbId) {
  const climb = climbs.find(c => c.id === climbId);
  if (!climb) return;
  currentClimb = climb;

  document.getElementById('detail-title').textContent = climb.name || 'Climb';

  const photo = document.getElementById('detail-photo');
  const container = document.getElementById('photo-canvas-container');
  if (climb.photo_url) {
    photo.src = climb.photo_url;
    photo.classList.remove('hidden');
    container.classList.remove('no-photo');
  } else {
    photo.src = '';
    photo.classList.add('hidden');
    container.classList.add('no-photo');
  }

  const color = GRADE_COLORS[climb.grade] || '#9E9E9E';
  const gradeEl = document.getElementById('detail-grade');
  gradeEl.textContent = climb.grade || '?';
  gradeEl.style.background = color;
  gradeEl.style.color = isLight(color) ? '#000' : '#fff';

  const sc = { project: '🎯 Project', attempted: '💪 Attempted', sent: '✅ Sent!' };
  document.getElementById('detail-status').textContent = sc[climb.status] || sc.project;
  document.getElementById('detail-notes').textContent = climb.notes || '';

  const dateEl = document.getElementById('detail-date');
  if (climb.created_at) {
    const d = new Date(climb.created_at);
    dateEl.textContent = d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  } else {
    dateEl.textContent = '';
  }

  showView('detail-view');
}

// ── DRAWING CANVAS ─────────────────────────────────────────
function initCanvas() {
  canvas = document.getElementById('drawing-canvas');
  if (!canvas) return;
  ctx = canvas.getContext('2d');
  undoStack = [];
  drawingModified = false;

  const photo = document.getElementById('detail-photo');
  const container = document.getElementById('photo-canvas-container');

  const setup = () => {
    if (photo && !photo.classList.contains('hidden') && photo.naturalWidth > 0) {
      canvas.width = photo.naturalWidth;
      canvas.height = photo.naturalHeight;
    } else {
      canvas.width = container.clientWidth || 400;
      canvas.height = container.clientHeight || 300;
    }
    if (currentClimb && currentClimb.drawing_url) {
      loadDrawing(currentClimb.drawing_url);
    } else {
      saveUndo();
    }
  };

  if (photo && !photo.classList.contains('hidden')) {
    if (photo.complete && photo.naturalWidth > 0) setup();
    else photo.onload = setup;
  } else {
    setup();
  }

  setupCanvasEvents();
}

function loadDrawing(url) {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    saveUndo();
  };
  img.onerror = () => saveUndo();
  img.src = url + '?t=' + Date.now();
}

function saveUndo() {
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (undoStack.length > 20) undoStack.shift();
}

function setupCanvasEvents() {
  canvas.addEventListener('mousedown', onStart);
  canvas.addEventListener('mousemove', onMove);
  canvas.addEventListener('mouseup', onEnd);
  canvas.addEventListener('mouseleave', onEnd);
  canvas.addEventListener('touchstart', e => { e.preventDefault(); onStart(e); }, { passive: false });
  canvas.addEventListener('touchmove', e => { e.preventDefault(); onMove(e); }, { passive: false });
  canvas.addEventListener('touchend', e => { e.preventDefault(); onEnd(e); }, { passive: false });
}

function getPos(e) {
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  const src = e.touches ? e.touches[0] : e;
  return { x: (src.clientX - rect.left) * sx, y: (src.clientY - rect.top) * sy };
}

function onStart(e) {
  isDrawing = true;
  drawingModified = true;
  const pos = getPos(e);
  saveUndo();
  if (drawTool === 'arrow') {
    arrowStart = pos;
  } else {
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.lineWidth = drawSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (drawTool === 'eraser') {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.strokeStyle = 'rgba(0,0,0,1)';
      ctx.lineWidth = drawSize * 4;
    } else {
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = drawColor;
    }
  }
}

function onMove(e) {
  if (!isDrawing) return;
  const pos = getPos(e);
  if (drawTool === 'arrow' && arrowStart) {
    const saved = undoStack[undoStack.length - 1];
    if (saved) ctx.putImageData(saved, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    drawArrow(arrowStart.x, arrowStart.y, pos.x, pos.y);
  } else if (drawTool !== 'arrow') {
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
  }
}

function onEnd(e) {
  if (!isDrawing) return;
  isDrawing = false;
  if (drawTool === 'arrow' && arrowStart) {
    let pos;
    if (e.changedTouches && e.changedTouches[0]) {
      const t = e.changedTouches[0];
      const rect = canvas.getBoundingClientRect();
      const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
      pos = { x: (t.clientX - rect.left) * sx, y: (t.clientY - rect.top) * sy };
    } else {
      pos = getPos(e);
    }
    const saved = undoStack[undoStack.length - 1];
    if (saved) ctx.putImageData(saved, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    drawArrow(arrowStart.x, arrowStart.y, pos.x, pos.y);
    arrowStart = null;
  }
  ctx.globalCompositeOperation = 'source-over';
}

function drawArrow(x1, y1, x2, y2) {
  const headLen = Math.max(14, drawSize * 5);
  const angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = drawColor;
  ctx.lineWidth = drawSize;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
  ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
  ctx.stroke();
}

function undo() {
  if (undoStack.length <= 1) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    undoStack = [];
    return;
  }
  undoStack.pop();
  ctx.putImageData(undoStack[undoStack.length - 1], 0, 0);
}

function clearDrawing() {
  if (!confirm('Clear drawing?')) return;
  saveUndo();
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawingModified = true;
}

async function saveDrawing() {
  if (!canvas || !currentClimb) return;
  const btn = document.getElementById('save-drawing-btn');
  btn.disabled = true;
  btn.textContent = '⏳';
  try {
    const blob = await new Promise(res => canvas.toBlob(res, 'image/png'));
    const path = `${currentUser.id}/${currentClimb.id}.png`;
    const url = await uploadBlob(blob, 'climb-drawings', path);

    const { error } = await sb
      .from('climbs')
      .update({ drawing_url: url, updated_at: new Date().toISOString() })
      .eq('id', currentClimb.id);
    if (error) throw error;

    currentClimb.drawing_url = url;
    const idx = climbs.findIndex(c => c.id === currentClimb.id);
    if (idx !== -1) climbs[idx].drawing_url = url;
    drawingModified = false;
    showToast('Drawing saved!');
  } catch (err) {
    showToast('Error saving drawing', 'error');
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾';
  }
}

// ── GRADE PICKER ───────────────────────────────────────────
function setupGradePicker() {
  const container = document.getElementById('grade-picker');
  container.innerHTML = GRADES.map(g => {
    const c = GRADE_COLORS[g];
    const tc = isLight(c) ? '#000' : '#fff';
    return `<button class="grade-btn" data-grade="${g}" style="background:${c};color:${tc}">${g}</button>`;
  }).join('');
  container.addEventListener('click', e => {
    const btn = e.target.closest('.grade-btn');
    if (!btn) return;
    formGrade = btn.dataset.grade;
    updateGradePickerUI();
  });
}

function updateGradePickerUI() {
  document.querySelectorAll('.grade-btn').forEach(b => b.classList.toggle('selected', b.dataset.grade === formGrade));
}

// ── STATUS PICKER ──────────────────────────────────────────
function setupStatusPicker() {
  document.getElementById('status-picker').addEventListener('click', e => {
    const btn = e.target.closest('.status-btn');
    if (!btn) return;
    formStatus = btn.dataset.status;
    updateStatusPickerUI();
  });
}

function updateStatusPickerUI() {
  document.querySelectorAll('.status-btn').forEach(b => b.classList.toggle('active', b.dataset.status === formStatus));
}

// ── EVENT LISTENERS ────────────────────────────────────────
function setupEventListeners() {
  document.getElementById('signout-btn').addEventListener('click', () => {
    if (confirm('Sign out?')) sb.auth.signOut();
  });

  document.getElementById('add-climb-btn').addEventListener('click', openAddClimb);
  document.getElementById('edit-back-btn').addEventListener('click', () => showView('list-view'));
  document.getElementById('save-climb-btn').addEventListener('click', handleSaveClimb);

  // Photo
  const photoArea = document.getElementById('photo-upload-area');
  const photoInput = document.getElementById('photo-input');
  photoArea.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    formPhotoFile = file;
    formPhotoUrl = null;
    const reader = new FileReader();
    reader.onload = ev => {
      const preview = document.getElementById('edit-photo-preview');
      preview.src = ev.target.result;
      preview.classList.remove('hidden');
      document.getElementById('photo-placeholder').classList.add('hidden');
    };
    reader.readAsDataURL(file);
  });

  // Detail
  document.getElementById('detail-back-btn').addEventListener('click', () => {
    if (drawingModified && !confirm('Discard unsaved drawing changes?')) return;
    showView('list-view');
  });
  document.getElementById('edit-climb-btn').addEventListener('click', () => {
    if (currentClimb) openEditClimb(currentClimb);
  });
  document.getElementById('delete-climb-btn').addEventListener('click', () => {
    if (currentClimb && confirm(`Delete "${currentClimb.name}"?`)) deleteClimbById(currentClimb.id);
  });

  // Drawing tools
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      drawTool = btn.dataset.tool;
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  document.querySelectorAll('.color-swatch').forEach(sw => {
    sw.addEventListener('click', () => {
      drawColor = sw.dataset.color;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
      if (drawTool === 'eraser') {
        drawTool = 'pen';
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.toggle('active', b.dataset.tool === 'pen'));
      }
    });
  });

  document.getElementById('undo-btn').addEventListener('click', undo);
  document.getElementById('clear-drawing-btn').addEventListener('click', clearDrawing);
  document.getElementById('save-drawing-btn').addEventListener('click', saveDrawing);

  // Search & filter
  document.getElementById('search-input').addEventListener('input', e => {
    searchQuery = e.target.value;
    renderClimbsList();
  });
  document.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      activeFilter = chip.dataset.filter;
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderClimbsList();
    });
  });
}

// ── HELPERS ────────────────────────────────────────────────
function isLight(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0,2), 16), g = parseInt(h.slice(2,4), 16), b = parseInt(h.slice(4,6), 16);
  return (r*299 + g*587 + b*114) / 1000 > 128;
}

function esc(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

let toastTimer;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 3000);
}
