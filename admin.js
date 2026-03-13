/**
 * BAR.OS — Admin Panel
 * admin.js  v2.0
 *
 * Control complet: băuturi, doze, mapare GPIO, setări server Flask, relay.
 *
 * Chei localStorage:
 *   baros_drinks   — array de băuturi (cu pin GPIO inclus)
 *   baros_doses    — array de doze
 *   baros_settings — setări complete (API, simulate, msPerMl, relay, flow rate etc.)
 */

'use strict';

/* ══════════════════════════════════════════════════════════════════
   PINII VALIZI GPIO (BCM) pe Raspberry Pi
══════════════════════════════════════════════════════════════════ */
const VALID_GPIO_PINS = [
  4, 5, 6, 12, 13, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27
];

/* ══════════════════════════════════════════════════════════════════
   STORAGE HELPERS
══════════════════════════════════════════════════════════════════ */
const Storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
  },
};

/* ══════════════════════════════════════════════════════════════════
   STATE — fără valori default hardcodate
══════════════════════════════════════════════════════════════════ */
let drinks   = Storage.get('baros_drinks',   []);
let doses    = Storage.get('baros_doses',    []);
let settings = Storage.get('baros_settings', {
  apiBase:       '',
  apiPort:       5000,
  simulate:      true,
  msPerMl:       667,          // 1000 / 1.5 ml/s implicit
  flowRateMlSec: 1.5,
  relayActiveHigh: false,
});

let editDrinkIdx  = -1;
let editDoseIdx   = -1;
let confirmCallback = null;

/* ══════════════════════════════════════════════════════════════════
   DOM HELPER
══════════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

/* ══════════════════════════════════════════════════════════════════
   TAB NAVIGATION
══════════════════════════════════════════════════════════════════ */
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const tab = btn.dataset.tab;
    ['tabDrinks','tabDoses','tabGpio','tabServer'].forEach(id => {
      $(id).classList.toggle('hidden', id !== `tab${capitalize(tab)}`);
    });
  });
});

function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/* ══════════════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════════════ */
let toastTimer = null;
function showToast(msg, type = '') {
  const el = $('toast');
  el.textContent = msg;
  el.className = 'toast visible' + (type ? ` toast--${type}` : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 2800);
}

/* ══════════════════════════════════════════════════════════════════
   CONFIRM DIALOG
══════════════════════════════════════════════════════════════════ */
function openConfirm(text, onOk) {
  $('confirmText').textContent = text;
  confirmCallback = onOk;
  openModal('confirmModal');
}
$('confirmCancel').addEventListener('click', () => closeModal('confirmModal'));
$('confirmOk').addEventListener('click', () => {
  closeModal('confirmModal');
  if (confirmCallback) { confirmCallback(); confirmCallback = null; }
});

/* ══════════════════════════════════════════════════════════════════
   MODAL HELPERS
══════════════════════════════════════════════════════════════════ */
function openModal(id)  { $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }

['drinkModal','doseModal','confirmModal'].forEach(id => {
  $(id).addEventListener('click', e => { if (e.target === $(id)) closeModal(id); });
});

/* ══════════════════════════════════════════════════════════════════
   ████  BĂUTURI  ████
══════════════════════════════════════════════════════════════════ */
function saveDrinks() { Storage.set('baros_drinks', drinks); }

function renderDrinks() {
  const list = $('drinkList');
  list.innerHTML = '';

  if (drinks.length === 0) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">🍾</span>Nu există băuturi. Adaugă prima!</div>`;
    renderGpioMap();
    return;
  }

  drinks.forEach((drink, idx) => {
    const pinBadge = drink.pin
      ? `<span class="gpio-badge">GPIO ${drink.pin}</span>`
      : `<span class="gpio-badge gpio-badge--warn">Fără pin!</span>`;

    const row = document.createElement('div');
    row.className = 'drink-row';
    row.dataset.idx = idx;
    row.draggable = true;

    row.innerHTML = `
      <span class="drag-handle" title="Trage pentru reordonare">⠿</span>
      <div class="drink-row-thumb">
        ${drink.image
          ? `<img src="${drink.image}" alt="${drink.name}" onerror="this.style.display='none'" />`
          : `<div class="thumb-placeholder">🍾</div>`}
      </div>
      <div class="drink-row-color" style="background:${drink.color || '#555'};"></div>
      <div class="drink-row-info">
        <div class="drink-row-name">${drink.name.toUpperCase()}</div>
        <div class="drink-row-meta">ID: <code>${drink.id}</code> · ${drink.origin || '—'}</div>
      </div>
      ${pinBadge}
      <div class="drink-row-actions">
        <button class="btn-icon" data-action="edit" data-idx="${idx}" title="Editează">✎</button>
        <button class="btn-icon btn-icon--del" data-action="del" data-idx="${idx}" title="Șterge">✕</button>
      </div>
    `;

    row.addEventListener('dragstart', onDragStart);
    row.addEventListener('dragover',  onDragOver);
    row.addEventListener('drop',      onDrop);
    row.addEventListener('dragend',   e => { e.currentTarget.style.opacity = ''; dragSrcIdx = null; });

    list.appendChild(row);
  });

  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      if (btn.dataset.action === 'edit') openDrinkModal(idx);
      if (btn.dataset.action === 'del')  confirmDeleteDrink(idx);
    });
  });

  renderGpioMap();
}

/* ── Drag & drop ───────────────────────────────────────────────── */
let dragSrcIdx = null;
function onDragStart(e) {
  dragSrcIdx = parseInt(e.currentTarget.dataset.idx);
  e.currentTarget.style.opacity = '0.4';
}
function onDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }
function onDrop(e) {
  e.preventDefault();
  const targetIdx = parseInt(e.currentTarget.dataset.idx);
  if (dragSrcIdx === null || dragSrcIdx === targetIdx) return;
  const moved = drinks.splice(dragSrcIdx, 1)[0];
  drinks.splice(targetIdx, 0, moved);
  saveDrinks();
  renderDrinks();
  showToast('Ordinea actualizată', 'ok');
}

/* ── Drink modal ───────────────────────────────────────────────── */
function buildPinSelect(selectedPin) {
  const usedPins = drinks.map(d => d.pin).filter(Boolean);
  let html = `<option value="">— Neasignat —</option>`;
  VALID_GPIO_PINS.forEach(pin => {
    const inUse = usedPins.includes(pin) && pin !== selectedPin;
    html += `<option value="${pin}" ${pin === selectedPin ? 'selected' : ''} ${inUse ? 'disabled' : ''}>
      GPIO ${pin}${inUse ? ' (ocupat)' : ''}
    </option>`;
  });
  return html;
}

function openDrinkModal(idx = -1) {
  editDrinkIdx = idx;
  const isEdit = idx >= 0;
  $('drinkModalTitle').textContent = isEdit ? 'Editează băutură' : 'Adaugă băutură';

  const d = isEdit ? drinks[idx] : { id:'', name:'', origin:'', color:'#00d4ff', image:'', pin: null };

  $('drinkName').value   = d.name   || '';
  $('drinkId').value     = d.id     || '';
  $('drinkOrigin').value = d.origin || '';
  $('drinkImage').value  = d.image  || '';
  $('drinkColor').value  = d.color  || '#00d4ff';
  $('drinkPin').innerHTML = buildPinSelect(d.pin);

  setPreviewImage(d.image, d.name);
  setPreviewColor(d.color || '#00d4ff');
  updatePreviewName(d.name);

  openModal('drinkModal');
}

function autoGenId() {
  $('drinkId').value = $('drinkName').value
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

$('drinkName').addEventListener('input', () => {
  updatePreviewName($('drinkName').value);
  if (editDrinkIdx < 0) autoGenId();
});

$('drinkColor').addEventListener('input', () => {
  setPreviewColor($('drinkColor').value);
  syncColorPresets($('drinkColor').value);
});

$('btnPreviewImg').addEventListener('click', () => {
  setPreviewImage($('drinkImage').value, $('drinkName').value);
});

$('drinkImage').addEventListener('keydown', e => {
  if (e.key === 'Enter') setPreviewImage($('drinkImage').value, $('drinkName').value);
});

document.querySelectorAll('.color-preset').forEach(btn => {
  btn.addEventListener('click', () => {
    const c = btn.dataset.color;
    $('drinkColor').value = c;
    setPreviewColor(c);
    syncColorPresets(c);
  });
});

function syncColorPresets(color) {
  document.querySelectorAll('.color-preset').forEach(b => b.classList.toggle('selected', b.dataset.color === color));
}
function setPreviewColor(color) {
  $('previewWrap').style.borderColor = color + '55';
  $('previewBadge').style.borderColor = color + '88';
  $('previewBadge').style.color = color;
}
function setPreviewImage(url, name) {
  const img = $('previewImg');
  const ph  = $('previewPlaceholder');
  if (!url) { img.classList.remove('loaded'); img.src=''; ph.style.display='flex'; return; }
  img.onload  = () => { img.classList.add('loaded'); ph.style.display='none'; };
  img.onerror = () => { img.classList.remove('loaded'); ph.style.display='flex'; showToast('Imaginea nu a putut fi încărcată','err'); };
  img.src = url;
}
function updatePreviewName(name) {
  $('previewName').textContent = (name || 'PREVIEW').toUpperCase();
  $('previewBadge').style.display = name ? '' : 'none';
}

$('drinkModalClose').addEventListener('click',  () => closeModal('drinkModal'));
$('drinkModalCancel').addEventListener('click', () => closeModal('drinkModal'));

$('drinkModalSave').addEventListener('click', () => {
  const name   = $('drinkName').value.trim();
  const id     = $('drinkId').value.trim();
  const origin = $('drinkOrigin').value.trim();
  const image  = $('drinkImage').value.trim();
  const color  = $('drinkColor').value;
  const pin    = parseInt($('drinkPin').value) || null;

  if (!name) { showToast('⚠ Numele este obligatoriu', 'err'); return; }
  if (!id)   { showToast('⚠ ID-ul este obligatoriu', 'err'); return; }
  if (!/^[a-z0-9_]+$/.test(id)) { showToast('⚠ ID-ul poate conține doar litere mici, cifre și _', 'err'); return; }

  const dupIdx = drinks.findIndex((d, i) => d.id === id && i !== editDrinkIdx);
  if (dupIdx >= 0) { showToast('⚠ Există deja o băutură cu acest ID', 'err'); return; }

  const drink = { id, name, origin, color, image, pin };

  if (editDrinkIdx >= 0) {
    drinks[editDrinkIdx] = drink;
    showToast('Băutură actualizată ✓', 'ok');
  } else {
    drinks.push(drink);
    showToast('Băutură adăugată ✓', 'ok');
  }

  saveDrinks();
  renderDrinks();
  closeModal('drinkModal');
});

function confirmDeleteDrink(idx) {
  openConfirm(`Ștergi băutura "${drinks[idx].name}"?`, () => {
    drinks.splice(idx, 1);
    saveDrinks();
    renderDrinks();
    showToast('Băutură ștearsă', 'ok');
  });
}

$('btnAddDrink').addEventListener('click', () => openDrinkModal(-1));

/* ══════════════════════════════════════════════════════════════════
   ████  MAPARE GPIO  ████
   Tab dedicat cu vizualizare pinout + alocare rapidă per băutură
══════════════════════════════════════════════════════════════════ */
function renderGpioMap() {
  const container = $('gpioMap');
  if (!container) return;

  // Build pin→drink lookup
  const pinMap = {};
  drinks.forEach(d => { if (d.pin) pinMap[d.pin] = d; });

  container.innerHTML = '';

  // ── Tabel mapare rapidă ─────────────────────────────────────────
  const section = document.createElement('div');
  section.className = 'gpio-section';
  section.innerHTML = `<h3 class="gpio-section-title">Alocare Pini — Băuturi</h3>`;

  if (drinks.length === 0) {
    section.innerHTML += `<div class="empty-state"><span class="empty-icon">⚡</span>Adaugă băuturi mai întâi din tab-ul Băuturi.</div>`;
  } else {
    const table = document.createElement('div');
    table.className = 'gpio-table';

    drinks.forEach(drink => {
      const row = document.createElement('div');
      row.className = 'gpio-row';

      const usedPins = drinks.filter(d => d.id !== drink.id).map(d => d.pin).filter(Boolean);

      let pinOptions = `<option value="">— Neasignat —</option>`;
      VALID_GPIO_PINS.forEach(pin => {
        const occupied = usedPins.includes(pin);
        pinOptions += `<option value="${pin}" ${pin === drink.pin ? 'selected' : ''} ${occupied ? 'disabled' : ''}>
          GPIO ${pin}${occupied ? ' (ocupat)' : ''}
        </option>`;
      });

      row.innerHTML = `
        <div class="gpio-drink-info">
          <div class="gpio-color-dot" style="background:${drink.color || '#555'}"></div>
          <div>
            <div class="gpio-drink-name">${drink.name.toUpperCase()}</div>
            <div class="gpio-drink-id"><code>${drink.id}</code></div>
          </div>
        </div>
        <div class="gpio-arrow">→</div>
        <div class="gpio-select-wrap">
          <select class="gpio-select field-input" data-drink-id="${drink.id}">
            ${pinOptions}
          </select>
        </div>
        <div class="gpio-relay-info" id="relay-info-${drink.id}">
          ${drink.pin ? relayPinInfo(drink.pin) : '<span class="gpio-unset">Neasignat</span>'}
        </div>
      `;

      table.appendChild(row);
    });

    section.appendChild(table);

    // Save GPIO assignments
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn-primary gpio-save-btn';
    saveBtn.textContent = '💾 Salvează maparea GPIO';
    saveBtn.addEventListener('click', saveGpioMap);
    section.appendChild(saveBtn);
  }

  container.appendChild(section);

  // ── Pinout vizual ────────────────────────────────────────────────
  const pinoutSection = document.createElement('div');
  pinoutSection.className = 'gpio-section';
  pinoutSection.innerHTML = `<h3 class="gpio-section-title">Pinout Raspberry Pi (BCM)</h3>`;
  pinoutSection.appendChild(buildPinoutVisual(pinMap));
  container.appendChild(pinoutSection);

  // ── Config server.py generat ─────────────────────────────────────
  const codeSection = document.createElement('div');
  codeSection.className = 'gpio-section';
  codeSection.innerHTML = `
    <h3 class="gpio-section-title">Config generată pentru server.py</h3>
    <div class="code-block-wrap">
      <pre class="code-block" id="serverCodePreview">${generateServerConfig()}</pre>
      <button class="btn-copy" id="btnCopyConfig" title="Copiază">📋 Copiază</button>
    </div>
  `;
  container.appendChild(codeSection);

  $('btnCopyConfig').addEventListener('click', () => {
    navigator.clipboard.writeText(generateServerConfig())
      .then(() => showToast('Config copiat în clipboard ✓', 'ok'))
      .catch(() => showToast('Clipboard indisponibil', 'err'));
  });

  // Update relay info live on select change
  container.querySelectorAll('.gpio-select').forEach(sel => {
    sel.addEventListener('change', () => {
      const drinkId = sel.dataset.drinkId;
      const pin = parseInt(sel.value) || null;
      const infoEl = $(`relay-info-${drinkId}`);
      if (infoEl) infoEl.innerHTML = pin ? relayPinInfo(pin) : '<span class="gpio-unset">Neasignat</span>';
    });
  });
}

function relayPinInfo(pin) {
  return `<span class="gpio-pin-badge">BCM ${pin}</span>`;
}

function saveGpioMap() {
  const selects = document.querySelectorAll('.gpio-select');
  const pinCounts = {};

  selects.forEach(sel => {
    const pin = parseInt(sel.value) || null;
    if (pin) pinCounts[pin] = (pinCounts[pin] || 0) + 1;
  });

  const hasDuplicates = Object.values(pinCounts).some(c => c > 1);
  if (hasDuplicates) {
    showToast('⚠ Același pin nu poate fi alocat la două băuturi!', 'err');
    return;
  }

  selects.forEach(sel => {
    const drinkId = sel.dataset.drinkId;
    const pin = parseInt(sel.value) || null;
    const idx = drinks.findIndex(d => d.id === drinkId);
    if (idx >= 0) drinks[idx].pin = pin;
  });

  saveDrinks();
  renderDrinks();
  showToast('Mapare GPIO salvată ✓', 'ok');

  // Refresh code preview
  const prev = $('serverCodePreview');
  if (prev) prev.textContent = generateServerConfig();
}

/* ── Pinout visual ─────────────────────────────────────────────── */
function buildPinoutVisual(pinMap) {
  // Physical pin layout → BCM numbers (0 = power/ground/NC)
  const layout = [
    [null, null],   // 3v3 / 5V
    [2,    null],   // GPIO2 / 5V
    [3,    null],   // GPIO3 / GND
    [4,    null],   // GPIO4 / GPIO14
    [null, null],   // GND / GPIO15
    [17,   null],   // GPIO17 / GPIO18
    [27,   null],   // GPIO27 / GND
    [22,   null],   // GPIO22 / GPIO23
    [null, null],   // 3v3 / GPIO24
    [10,   null],   // GPIO10 / GND
    [9,    null],   // GPIO9 / GPIO25
    [11,   null],   // GPIO11 / GPIO8
    [null, null],   // GND / GPIO7
    [null, null],   // ID_SD / ID_SC
    [5,    null],
    [null, null],
    [6,    null],
    [12,   null],
    [null, null],
    [13,   null],
    [null, null],
    [19,   null],
    [null, null],
    [16,   null],
    [26,   null],
    [20,   null],
    [null, null],
    [21,   null],
  ];

  const wrap = document.createElement('div');
  wrap.className = 'pinout-wrap';

  const grid = document.createElement('div');
  grid.className = 'pinout-grid';

  layout.forEach(([leftBcm, rightBcm]) => {
    const makePin = (bcm, side) => {
      const div = document.createElement('div');
      if (bcm === null) {
        div.className = 'pinout-pin pinout-pin--power';
        div.textContent = '—';
        return div;
      }
      const drink = pinMap[bcm];
      div.className = 'pinout-pin' + (drink ? ' pinout-pin--used' : ' pinout-pin--free');
      if (drink) div.style.borderColor = drink.color || '#00e676';
      div.innerHTML = drink
        ? `<span class="pinout-bcm">${bcm}</span><span class="pinout-drink" style="color:${drink.color}">${drink.name}</span>`
        : `<span class="pinout-bcm">${bcm}</span>`;
      div.title = drink ? `GPIO ${bcm} → ${drink.name}` : `GPIO ${bcm} — liber`;
      return div;
    };

    grid.appendChild(makePin(leftBcm,  'left'));
    grid.appendChild(makePin(rightBcm, 'right'));
  });

  wrap.appendChild(grid);

  // Legend
  wrap.insertAdjacentHTML('beforeend', `
    <div class="pinout-legend">
      <span class="legend-item"><span class="legend-dot" style="background:#00e676"></span>Liber (GPIO valid)</span>
      <span class="legend-item"><span class="legend-dot" style="background:#ff3d57"></span>Ocupat (alocat)</span>
      <span class="legend-item"><span class="legend-dot" style="background:#333"></span>Power/GND/NC</span>
    </div>
  `);

  return wrap;
}

/* ── Generate server.py config snippet ─────────────────────────── */
function generateServerConfig() {
  const apiBase = settings.apiBase || '0.0.0.0';
  const apiPort = settings.apiPort || 5000;
  const flowRate = settings.flowRateMlSec || 1.5;
  const relayHigh = !!settings.relayActiveHigh;

  let drinkPins = 'DRINK_PINS = {\n';
  drinks.forEach(d => {
    drinkPins += `    '${d.id}': ${d.pin || 'None'},   # ${d.name}\n`;
  });
  drinkPins += '}';

  return `# ════════════════════════════════
# BAR.OS — Configurație generată
# ════════════════════════════════

${drinkPins}

FLOW_RATE_ML_PER_SEC = ${flowRate}
RELAY_ACTIVE_HIGH    = ${relayHigh ? 'True' : 'False'}

# În app.run():
#   host='${apiBase}', port=${apiPort}`;
}

/* ══════════════════════════════════════════════════════════════════
   ████  DOZE  ████
══════════════════════════════════════════════════════════════════ */
function saveDoses() { Storage.set('baros_doses', doses); }

function renderDoses() {
  const list = $('doseList');
  list.innerHTML = '';

  if (doses.length === 0) {
    list.innerHTML = `<div class="empty-state"><span class="empty-icon">⚗</span>Nu există doze. Adaugă cel puțin una.</div>`;
    return;
  }

  doses.forEach((dose, idx) => {
    const row = document.createElement('div');
    row.className = 'dose-row';
    row.dataset.idx = idx;
    row.draggable = true;

    row.innerHTML = `
      <span class="drag-handle">⠿</span>
      <div class="dose-row-ml">${dose.ml}<small>ml</small></div>
      <div class="dose-row-info">
        <div class="dose-row-label">${dose.label || '—'}</div>
        <div class="dose-row-desc">${dose.desc  || '—'}</div>
      </div>
      <div class="dose-row-actions">
        <button class="btn-icon" data-action="edit" data-idx="${idx}">✎</button>
        <button class="btn-icon btn-icon--del" data-action="del" data-idx="${idx}">✕</button>
      </div>
    `;

    let dragDoseIdx = null;
    row.addEventListener('dragstart', e => { dragDoseIdx = parseInt(e.currentTarget.dataset.idx); e.currentTarget.style.opacity='0.4'; });
    row.addEventListener('dragover',  e => { e.preventDefault(); });
    row.addEventListener('drop',      e => {
      e.preventDefault();
      const ti = parseInt(e.currentTarget.dataset.idx);
      if (dragDoseIdx === null || dragDoseIdx === ti) return;
      const m = doses.splice(dragDoseIdx, 1)[0];
      doses.splice(ti, 0, m);
      saveDoses();
      renderDoses();
    });
    row.addEventListener('dragend', e => { e.currentTarget.style.opacity=''; });

    list.appendChild(row);
  });

  list.querySelectorAll('[data-action]').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      if (btn.dataset.action === 'edit') openDoseModal(idx);
      if (btn.dataset.action === 'del')  confirmDeleteDose(idx);
    });
  });

  renderTestButtons();
}

function openDoseModal(idx = -1) {
  editDoseIdx = idx;
  const isEdit = idx >= 0;
  $('doseModalTitle').textContent = isEdit ? 'Editează doză' : 'Adaugă doză';
  const d = isEdit ? doses[idx] : { ml: 40, label: '', desc: '' };
  $('doseMl').value    = d.ml    || 40;
  $('doseLabel').value = d.label || '';
  $('doseDesc').value  = d.desc  || '';
  openModal('doseModal');
}

document.querySelectorAll('.ml-step').forEach(btn => {
  btn.addEventListener('click', () => {
    const step  = parseInt(btn.dataset.dir);
    const input = $('doseMl');
    input.value = Math.max(5, Math.min(500, (parseInt(input.value) || 40) + step));
  });
});

$('doseModalClose').addEventListener('click',  () => closeModal('doseModal'));
$('doseModalCancel').addEventListener('click', () => closeModal('doseModal'));

$('doseModalSave').addEventListener('click', () => {
  const ml    = parseInt($('doseMl').value);
  const label = $('doseLabel').value.trim();
  const desc  = $('doseDesc').value.trim();

  if (!ml || ml < 5 || ml > 500) { showToast('⚠ Cantitate invalidă (5–500 ml)', 'err'); return; }

  const dose = { ml, label: label || `${ml}ml`, desc: desc || '' };

  if (editDoseIdx >= 0) {
    doses[editDoseIdx] = dose;
    showToast('Doză actualizată ✓', 'ok');
  } else {
    if (doses.length >= 5) { showToast('⚠ Maxim 5 doze permise', 'err'); return; }
    doses.push(dose);
    showToast('Doză adăugată ✓', 'ok');
  }

  saveDoses();
  renderDoses();
  closeModal('doseModal');
});

function confirmDeleteDose(idx) {
  openConfirm(`Ștergi doza de ${doses[idx].ml}ml?`, () => {
    doses.splice(idx, 1);
    saveDoses();
    renderDoses();
    showToast('Doză ștearsă', 'ok');
  });
}

$('btnAddDose').addEventListener('click', () => {
  if (doses.length >= 5) { showToast('⚠ Maxim 5 doze permise', 'err'); return; }
  openDoseModal(-1);
});

/* ══════════════════════════════════════════════════════════════════
   ████  SERVER & RELAY SETTINGS  ████
══════════════════════════════════════════════════════════════════ */
function saveSettings() { Storage.set('baros_settings', settings); }

function loadSettingsUI() {
  $('settingApiBase').value         = settings.apiBase       || '';
  $('settingApiPort').value         = settings.apiPort       || 5000;
  $('settingSimulate').checked      = !!settings.simulate;
  $('simulateLabel').textContent    = settings.simulate ? 'Activat' : 'Dezactivat';
  $('settingFlowRate').value        = settings.flowRateMlSec || 1.5;
  $('flowRateValue').textContent    = (settings.flowRateMlSec || 1.5) + ' ml/s';
  $('settingMsPerMl').value         = settings.msPerMl       || 667;
  $('msPerMlValue').textContent     = (settings.msPerMl      || 667) + ' ms';

  // Relay logic radio
  const relayVal = settings.relayActiveHigh ? 'high' : 'low';
  document.querySelectorAll('input[name="relayLogic"]').forEach(r => {
    r.checked = r.value === relayVal;
  });

  updateRelayStatusDisplay();
  renderTestButtons();
}

/* Flow rate → auto-calc msPerMl */
$('settingFlowRate').addEventListener('input', () => {
  const fr = parseFloat($('settingFlowRate').value) || 1.5;
  const ms = Math.round(1000 / fr);
  $('flowRateValue').textContent = fr + ' ml/s';
  $('settingMsPerMl').value = ms;
  $('msPerMlValue').textContent = ms + ' ms';
  settings.flowRateMlSec = fr;
  settings.msPerMl = ms;
  saveSettings();
  renderTestButtons();
  updateGeneratedConfig();
});

/* msPerMl manual override */
$('settingMsPerMl').addEventListener('input', () => {
  const ms = parseInt($('settingMsPerMl').value);
  $('msPerMlValue').textContent = ms + ' ms';
  const fr = Math.round((1000 / ms) * 100) / 100;
  $('settingFlowRate').value = fr;
  $('flowRateValue').textContent = fr + ' ml/s';
  settings.msPerMl = ms;
  settings.flowRateMlSec = fr;
  saveSettings();
  renderTestButtons();
  updateGeneratedConfig();
});

$('settingApiBase').addEventListener('change', () => {
  settings.apiBase = $('settingApiBase').value.trim();
  saveSettings();
  showToast('IP server salvat ✓', 'ok');
  updateGeneratedConfig();
});

$('settingApiPort').addEventListener('change', () => {
  settings.apiPort = parseInt($('settingApiPort').value) || 5000;
  saveSettings();
  showToast('Port salvat ✓', 'ok');
  updateGeneratedConfig();
});

$('settingSimulate').addEventListener('change', () => {
  settings.simulate = $('settingSimulate').checked;
  $('simulateLabel').textContent = settings.simulate ? 'Activat' : 'Dezactivat';
  saveSettings();
  showToast(settings.simulate ? 'Mod simulare activat' : 'Mod simulare dezactivat', 'ok');
});

document.querySelectorAll('input[name="relayLogic"]').forEach(r => {
  r.addEventListener('change', () => {
    settings.relayActiveHigh = r.value === 'high';
    saveSettings();
    updateRelayStatusDisplay();
    updateGeneratedConfig();
    showToast(`Relay logic: ACTIVE ${r.value.toUpperCase()} salvat ✓`, 'ok');
  });
});

function updateRelayStatusDisplay() {
  const el = $('relayStatusDesc');
  if (!el) return;
  const isHigh = settings.relayActiveHigh;
  el.innerHTML = isHigh
    ? `<span class="badge badge--warn">ACTIVE HIGH</span> — Semnalul HIGH activează pompa. (Relay SSR / mosfet fără inversare)`
    : `<span class="badge badge--ok">ACTIVE LOW</span>  — Semnalul LOW activează pompa. (Modulele relay clasice cu optocuplor)`;
}

/* Test duration */
function renderTestButtons() {
  const row = $('testDoseRow');
  if (!row) return;
  row.innerHTML = '';

  doses.forEach(dose => {
    const btn = document.createElement('button');
    btn.className = 'btn-test';
    btn.textContent = `${dose.ml}ml`;
    btn.addEventListener('click', () => {
      const dur = dose.ml * (settings.msPerMl || 667);
      $('testResult').textContent = `→ ${dose.ml}ml = ${(dur/1000).toFixed(2)}s la ${settings.flowRateMlSec || 1.5} ml/s`;
    });
    row.appendChild(btn);
  });
}

/* Ping server */
$('btnPingServer').addEventListener('click', async () => {
  const base = settings.apiBase;
  const port = settings.apiPort || 5000;
  if (!base) { showToast('⚠ Setează IP-ul serverului mai întâi', 'err'); return; }
  const url = `http://${base.replace(/^https?:\/\//, '')}:${port}/status`;
  $('pingResult').textContent = '⏳ Se conectează...';
  try {
    const r = await Promise.race([
      fetch(url),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000))
    ]);
    const data = await r.json();
    $('pingResult').innerHTML = `<span style="color:#00e676">✓ Online — Status: ${data.status} | Băuturi: ${(data.drinks||[]).join(', ')} | Flow: ${data.flow_rate} ml/s</span>`;
  } catch(e) {
    $('pingResult').innerHTML = `<span style="color:#ff3d57">✗ Nu răspunde: ${e.message}</span>`;
  }
});

function updateGeneratedConfig() {
  const el = $('serverCodePreview');
  if (el) el.textContent = generateServerConfig();
}

/* ── Reset all ────────────────────────────────────────────────── */
$('btnReset').addEventListener('click', () => {
  openConfirm('Resetezi TOATE datele? Băuturi, doze și setări vor fi șterse complet.', () => {
    drinks   = [];
    doses    = [];
    settings = {
      apiBase: '', apiPort: 5000, simulate: true,
      msPerMl: 667, flowRateMlSec: 1.5, relayActiveHigh: false,
    };
    saveDrinks(); saveDoses(); saveSettings();
    renderDrinks(); renderDoses(); loadSettingsUI(); renderGpioMap();
    showToast('Resetare completă ✓', 'ok');
  });
});

/* ══════════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════════ */
function init() {
  renderDrinks();
  renderDoses();
  loadSettingsUI();
  renderGpioMap();
}

init();