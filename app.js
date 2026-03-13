/**
 * BAR.OS — Smart Dispenser Interface
 * app.js
 *
 * Architecture:
 *   - Pure vanilla JS, zero dependencies
 *   - Sends GET requests to Raspberry Pi Flask API
 *   - API endpoint: http://raspberrypi.local:5000/pour?drink=vodka&ml=40
 */

'use strict';

/* ══════════════════════════════════════════════════════════════════
   STORAGE HELPER — reads data saved by admin.js
══════════════════════════════════════════════════════════════════ */
function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch { return fallback; }
}

/* ══════════════════════════════════════════════════════════════════
   CONFIGURATION
   Values are read from localStorage (set in admin panel) with
   hardcoded fallbacks so the UI works even without admin setup.
══════════════════════════════════════════════════════════════════ */
const _s = lsGet('baros_settings', {});

const CONFIG = {
  apiBase:     _s.apiBase    || 'http://raspberrypi.local:5000',
  pourPath:    '/pour',
  msPerMl:     _s.msPerMl   || 800,
  simulateApi: _s.simulate !== undefined ? _s.simulate : true,
};

/* ══════════════════════════════════════════════════════════════════
   DRINK DATA  — from admin panel or defaults
══════════════════════════════════════════════════════════════════ */
const DRINKS = lsGet('baros_drinks', [
  {
    id: 'vodka',
    name: 'Vodka',
    origin: 'Russia · 40% ABV',
    color: '#00d4ff',
    image: 'https://images.unsplash.com/photo-1527689368864-3a821dbccc34?w=400&q=80',
  },
  {
    id: 'whisky',
    name: 'Whisky',
    origin: 'Scotland · 43% ABV',
    color: '#ffab00',
    image: 'https://images.unsplash.com/photo-1569529465841-dfecdab7503b?w=400&q=80',
  },
  {
    id: 'rum',
    name: 'Rum',
    origin: 'Caribbean · 40% ABV',
    color: '#d500f9',
    image: 'https://images.unsplash.com/photo-1551538827-9c037cb4f32a?w=400&q=80',
  },
  {
    id: 'gin',
    name: 'Gin',
    origin: 'London · 47% ABV',
    color: '#00e676',
    image: 'https://images.unsplash.com/photo-1608885898957-a559228e8749?w=400&q=80',
  },
]);

/* ══════════════════════════════════════════════════════════════════
   DOSE OPTIONS — from admin panel or defaults
══════════════════════════════════════════════════════════════════ */
const DOSES = lsGet('baros_doses', [
  { ml: 20, label: 'Single',  desc: 'Light pour'    },
  { ml: 40, label: 'Double',  desc: 'Standard pour' },
  { ml: 60, label: 'Triple',  desc: 'Long pour'     },
]);

/* ══════════════════════════════════════════════════════════════════
   STATE
══════════════════════════════════════════════════════════════════ */
let state = {
  selectedDrink: null,   // DRINKS object
  selectedMl:   40,      // default dose
  isPouring:    false,
};

/* ══════════════════════════════════════════════════════════════════
   DOM REFERENCES
══════════════════════════════════════════════════════════════════ */
const $ = id => document.getElementById(id);

const DOM = {
  screenHome:       $('screenHome'),
  screenDose:       $('screenDose'),
  screenPour:       $('screenPour'),

  drinkGrid:        $('drinkGrid'),
  doseImage:        $('doseImage'),
  doseGlow:         $('doseGlow'),
  doseDrinkName:    $('doseDrinkName'),
  doseDrinkOrigin:  $('doseDrinkOrigin'),
  doseButtons:      $('doseButtons'),
  btnBack:          $('btnBack'),
  btnPour:          $('btnPour'),

  pourTitle:        $('pourTitle'),
  pourDetail:       $('pourDetail'),
  pourMl:           $('pourMl'),
  pourDrinkLabel:   $('pourDrinkLabel'),
  pourProgressFill: $('pourProgressFill'),
  pourProgressLabel:$('pourProgressLabel'),
  pourIcon:         $('pourIcon'),
  dropsContainer:   $('dropsContainer'),

  statusDot:        $('statusDot'),
  statusLabel:      $('statusLabel'),
  headerTime:       $('headerTime'),
  toast:            $('toast'),
};

/* ══════════════════════════════════════════════════════════════════
   AUDIO — simple Web Audio API beep/pour sound
══════════════════════════════════════════════════════════════════ */
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

/**
 * Play a short pour-start sound using oscillators.
 * No external audio files required.
 */
function playPourSound() {
  try {
    const ctx = getAudioCtx();

    // Low rumble
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(80, ctx.currentTime);
    osc1.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.4);
    gain1.gain.setValueAtTime(0.12, ctx.currentTime);
    gain1.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(ctx.currentTime);
    osc1.stop(ctx.currentTime + 0.4);

    // High click
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = 'sine';
    osc2.frequency.setValueAtTime(800, ctx.currentTime);
    osc2.frequency.exponentialRampToValueAtTime(200, ctx.currentTime + 0.15);
    gain2.gain.setValueAtTime(0.08, ctx.currentTime);
    gain2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(ctx.currentTime);
    osc2.stop(ctx.currentTime + 0.15);
  } catch (e) {
    // Audio not critical — silently ignore
    console.warn('Audio playback failed:', e);
  }
}

/**
 * Play a cheerful 3-tone finish chime.
 */
function playFinishSound() {
  try {
    const ctx = getAudioCtx();
    const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
    notes.forEach((freq, i) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      const t    = ctx.currentTime + i * 0.12;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.1, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t);
      osc.stop(t + 0.35);
    });
  } catch (e) {
    console.warn('Finish sound failed:', e);
  }
}

/* ══════════════════════════════════════════════════════════════════
   SCREEN TRANSITIONS
══════════════════════════════════════════════════════════════════ */
function showScreen(name) {
  const screens = [DOM.screenHome, DOM.screenDose, DOM.screenPour];
  screens.forEach(s => s.classList.remove('active'));

  const map = {
    home: DOM.screenHome,
    dose: DOM.screenDose,
    pour: DOM.screenPour,
  };

  // Small delay so the transition plays after removal
  requestAnimationFrame(() => {
    const target = map[name];
    if (target) target.classList.add('active');
  });
}

/* ══════════════════════════════════════════════════════════════════
   STATUS BAR
══════════════════════════════════════════════════════════════════ */
function setStatus(label, type = 'ready') {
  DOM.statusLabel.textContent = label;
  DOM.statusDot.className = 'status-dot';
  if (type === 'busy')  DOM.statusDot.classList.add('busy');
  if (type === 'error') DOM.statusDot.classList.add('error');
}

/* ══════════════════════════════════════════════════════════════════
   TOAST
══════════════════════════════════════════════════════════════════ */
let toastTimer = null;

function showToast(message, duration = 3000) {
  DOM.toast.textContent = message;
  DOM.toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    DOM.toast.classList.remove('visible');
  }, duration);
}

/* ══════════════════════════════════════════════════════════════════
   CLOCK
══════════════════════════════════════════════════════════════════ */
function updateClock() {
  const now = new Date();
  const hh  = String(now.getHours()).padStart(2, '0');
  const mm  = String(now.getMinutes()).padStart(2, '0');
  DOM.headerTime.textContent = `${hh}:${mm}`;
}

/* ══════════════════════════════════════════════════════════════════
   BUILD HOME SCREEN
══════════════════════════════════════════════════════════════════ */
function buildDrinkGrid() {
  DOM.drinkGrid.innerHTML = '';

  DRINKS.forEach((drink, index) => {
    const card = document.createElement('div');
    card.className = 'drink-card';
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `Select ${drink.name}`);
    card.setAttribute('tabindex', '0');
    card.style.animationDelay = `${index * 0.07}s`;

    card.innerHTML = `
      <div class="drink-card-accent" style="background: linear-gradient(to right, ${drink.color}, transparent);"></div>
      <img class="drink-card-img"
           src="${drink.image}"
           alt="${drink.name}"
           loading="lazy"
           onerror="this.src='https://via.placeholder.com/300x400/111720/00e5ff?text=${drink.name}'"
      />
      <div class="drink-card-info">
        <div class="drink-card-name">${drink.name.toUpperCase()}</div>
        <div class="drink-card-abv">${drink.origin}</div>
      </div>
    `;

    // Touch / click handler
    card.addEventListener('pointerdown', () => card.classList.add('pressing'));
    card.addEventListener('pointerup',   () => card.classList.remove('pressing'));
    card.addEventListener('pointerleave',() => card.classList.remove('pressing'));

    card.addEventListener('click', () => selectDrink(drink));
    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') selectDrink(drink); });

    DOM.drinkGrid.appendChild(card);
  });
}

/* ══════════════════════════════════════════════════════════════════
   SELECT DRINK → show dose screen
══════════════════════════════════════════════════════════════════ */
function selectDrink(drink) {
  state.selectedDrink = drink;
  state.selectedMl    = 40; // reset to default

  // Populate dose screen
  DOM.doseImage.src     = drink.image;
  DOM.doseImage.alt     = drink.name;
  DOM.doseImage.onerror = () => {
    DOM.doseImage.src = `https://via.placeholder.com/200x280/111720/00e5ff?text=${drink.name}`;
  };
  DOM.doseDrinkName.textContent   = drink.name.toUpperCase();
  DOM.doseDrinkOrigin.textContent = drink.origin;

  // Glow behind bottle image
  DOM.doseGlow.style.background = `radial-gradient(circle, ${drink.color}, transparent 70%)`;

  // Build dose buttons
  buildDoseButtons(drink);

  showScreen('dose');
}

/* ══════════════════════════════════════════════════════════════════
   BUILD DOSE BUTTONS
══════════════════════════════════════════════════════════════════ */
function buildDoseButtons(drink) {
  DOM.doseButtons.innerHTML = '';

  DOSES.forEach(dose => {
    const btn = document.createElement('button');
    btn.className = 'btn-dose';
    if (dose.ml === state.selectedMl) btn.classList.add('selected');
    btn.setAttribute('aria-label', `${dose.ml} ml — ${dose.label}`);

    btn.innerHTML = `
      <div class="btn-dose-ml" style="color: ${drink.color};">${dose.ml} <small>ML</small></div>
      <div class="btn-dose-desc">
        <span class="label">${dose.label}</span>
        <span class="sublabel">${dose.desc}</span>
      </div>
    `;

    btn.addEventListener('click', e => {
      // Ripple
      addRipple(btn, e);
      // Select
      state.selectedMl = dose.ml;
      DOM.doseButtons.querySelectorAll('.btn-dose').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });

    DOM.doseButtons.appendChild(btn);
  });
}

/* ── Ripple helper ──────────────────────────────────────────────── */
function addRipple(el, event) {
  const rect   = el.getBoundingClientRect();
  const size   = Math.max(rect.width, rect.height);
  const x      = (event.clientX - rect.left) - size / 2;
  const y      = (event.clientY - rect.top)  - size / 2;
  const ripple = document.createElement('span');
  ripple.className = 'ripple';
  ripple.style.cssText = `width:${size}px; height:${size}px; left:${x}px; top:${y}px;`;
  el.appendChild(ripple);
  ripple.addEventListener('animationend', () => ripple.remove());
}

/* ══════════════════════════════════════════════════════════════════
   POUR — send API request + animate
══════════════════════════════════════════════════════════════════ */
async function startPour() {
  if (state.isPouring) return;
  if (!state.selectedDrink)  { showToast('Please select a drink first.'); return; }

  state.isPouring = true;
  DOM.btnPour.disabled = true;
  setStatus('POURING', 'busy');

  const drink = state.selectedDrink;
  const ml    = state.selectedMl;

  // Transition to pour screen
  setupPourScreen(drink, ml);
  showScreen('pour');

  // Play sound
  playPourSound();

  // Start falling drops animation
  startDrops();

  // Animate progress bar
  const duration = ml * CONFIG.msPerMl;
  animateProgress(duration);

  // Fire API request (or simulate)
  let success = false;
  try {
    if (CONFIG.simulateApi) {
      // Fake delay matching the pour duration
      await delay(duration);
      success = true;
    } else {
      const url = `${CONFIG.apiBase}${CONFIG.pourPath}?drink=${encodeURIComponent(drink.id)}&ml=${ml}`;
      const response = await fetchWithTimeout(url, 60000);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      success = true;
    }
  } catch (err) {
    console.error('Pour API error:', err);
    success = false;
    showToast(`⚠️ Connection error: ${err.message}`);
  }

  // Finish
  stopDrops();
  finishPour(drink, ml, success);
}

/* ── Setup pour screen labels ───────────────────────────────────── */
function setupPourScreen(drink, ml) {
  const pourContent = DOM.screenPour.querySelector('.pour-content');
  pourContent.classList.remove('finished');

  DOM.pourIcon.textContent     = '⚗';
  DOM.pourTitle.textContent    = 'POURING…';
  DOM.pourMl.textContent       = ml;
  DOM.pourDrinkLabel.textContent = drink.name;
  DOM.pourProgressFill.style.width   = '0%';
  DOM.pourProgressLabel.textContent  = '0%';
}

/* ── Progress animation ─────────────────────────────────────────── */
let progressInterval = null;

function animateProgress(duration) {
  clearInterval(progressInterval);
  const startTime = Date.now();

  progressInterval = setInterval(() => {
    const elapsed = Date.now() - startTime;
    const pct     = Math.min(100, Math.round((elapsed / duration) * 100));
    DOM.pourProgressFill.style.width   = `${pct}%`;
    DOM.pourProgressLabel.textContent  = `${pct}%`;
    if (pct >= 100) clearInterval(progressInterval);
  }, 80);
}

/* ── Finish pour ────────────────────────────────────────────────── */
function finishPour(drink, ml, success) {
  clearInterval(progressInterval);
  DOM.pourProgressFill.style.width  = '100%';
  DOM.pourProgressLabel.textContent = '100%';

  const pourContent = DOM.screenPour.querySelector('.pour-content');

  if (success) {
    pourContent.classList.add('finished');
    DOM.pourIcon.textContent  = '🍸';
    DOM.pourTitle.textContent = 'ENJOY YOUR DRINK';
    DOM.pourTitle.style.textShadow = '0 0 30px rgba(0, 230, 118, 0.4)';
    DOM.pourDetail.innerHTML  = `<span style="color: #00e676;">${ml}ml of ${drink.name} dispensed</span>`;
    playFinishSound();
    setStatus('READY', 'ready');
  } else {
    DOM.pourIcon.textContent  = '⚠️';
    DOM.pourTitle.textContent = 'ERROR';
    DOM.pourDetail.textContent = 'Could not reach the dispenser.';
    setStatus('ERROR', 'error');
  }

  // Auto-return to home after 4 seconds
  setTimeout(() => {
    returnHome();
  }, 4000);
}

/* ── Return to home ─────────────────────────────────────────────── */
function returnHome() {
  state.isPouring   = false;
  state.selectedDrink = null;
  DOM.btnPour.disabled = false;
  DOM.pourTitle.style.textShadow = '';
  setStatus('READY', 'ready');
  showScreen('home');
}

/* ══════════════════════════════════════════════════════════════════
   RAIN DROPS ANIMATION
══════════════════════════════════════════════════════════════════ */
let dropInterval = null;

function startDrops() {
  DOM.dropsContainer.innerHTML = '';
  dropInterval = setInterval(() => {
    spawnDrop();
  }, 120);
}

function stopDrops() {
  clearInterval(dropInterval);
  // Fade remaining drops naturally
  setTimeout(() => {
    DOM.dropsContainer.innerHTML = '';
  }, 2000);
}

function spawnDrop() {
  const drop = document.createElement('div');
  drop.className = 'drop';

  const x        = Math.random() * 100;
  const height   = 10 + Math.random() * 30;
  const duration = 0.8 + Math.random() * 1.2;
  const delay_s  = Math.random() * 0.3;
  const color    = state.selectedDrink ? state.selectedDrink.color : 'var(--neon-cyan)';

  drop.style.cssText = `
    left: ${x}%;
    top: 0;
    height: ${height}px;
    background: linear-gradient(to bottom, ${color}, transparent);
    animation-duration: ${duration}s;
    animation-delay: ${delay_s}s;
  `;

  DOM.dropsContainer.appendChild(drop);
  drop.addEventListener('animationend', () => drop.remove());
}

/* ══════════════════════════════════════════════════════════════════
   UTILITY FUNCTIONS
══════════════════════════════════════════════════════════════════ */

/** Promise-based delay */
function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * fetch() with a timeout.
 * @param {string} url
 * @param {number} timeout - milliseconds
 */
function fetchWithTimeout(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const id = setTimeout(() => {
      controller.abort();
      reject(new Error('Request timed out'));
    }, timeout);

    fetch(url, { signal: controller.signal })
      .then(res => { clearTimeout(id); resolve(res); })
      .catch(err => { clearTimeout(id); reject(err); });
  });
}

/* ══════════════════════════════════════════════════════════════════
   EVENT LISTENERS
══════════════════════════════════════════════════════════════════ */
DOM.btnBack.addEventListener('click', () => {
  if (!state.isPouring) showScreen('home');
});

DOM.btnPour.addEventListener('click', () => {
  startPour();
});

// Prevent accidental double tap zoom on iOS
document.addEventListener('dblclick', e => e.preventDefault(), { passive: false });

// Keep screen awake (where supported)
if ('wakeLock' in navigator) {
  navigator.wakeLock.request('screen').catch(() => {/* not critical */});
}

/* ══════════════════════════════════════════════════════════════════
   INIT
══════════════════════════════════════════════════════════════════ */
function init() {
  buildDrinkGrid();
  updateClock();
  setInterval(updateClock, 15000);

  if (CONFIG.simulateApi) {
    showToast('Demo mode — API calls are simulated', 4000);
  }
}

init();
