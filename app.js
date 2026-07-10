(() => {
  'use strict';

  const MS_PER_YEAR = 365.2425 * 24 * 3600 * 1000;
  const STORAGE_KEY = 'lifeClockState_v1';
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const HAND_INFO = {
    decade: 'เข็มทศวรรษ — หมุนครบ 1 รอบตลอดช่วงชีวิตที่คาดไว้',
    year:   'เข็มปี — หมุนครบ 1 รอบทุก 10 ปี',
    month:  'เข็มเดือน — หมุนครบ 1 รอบทุกปี',
    day:    'เข็มวัน — หมุนครบ 1 รอบทุกเดือน',
    hour:   'เข็มชั่วโมง — หมุนครบ 1 รอบทุกวัน (24 ชม.)',
    minute: 'เข็มนาที — หมุนครบ 1 รอบทุกชั่วโมง',
    second: 'เข็มวินาที — หมุนครบ 1 รอบทุกนาที'
  };

  const ZODIAC_EMOJI = ['🐭', '🐮', '🐯', '🐰', '🐲', '🐍', '🐴', '🐐', '🐵', '🐔', '🐶', '🐷'];
  const ZODIAC_NAME = ['ชวด (หนู)', 'ฉลู (วัว)', 'ขาล (เสือ)', 'เถาะ (กระต่าย)', 'มะโรง (มังกร)', 'มะเส็ง (งูเล็ก)', 'มะเมีย (ม้า)', 'มะแม (แพะ)', 'วอก (ลิง)', 'ระกา (ไก่)', 'จอ (หมา)', 'กุน (หมู)'];

  function getZodiacIndex(birthDate) {
    const year = birthDate.getFullYear();
    return ((year - 2020) % 12 + 12) % 12;
  }

  // ---------- State ----------
  let state = { fullName: '', birthDate: null, lifespan: 80, goals: [] };
  let openPanel = null; // 'goals' | 'settings' | null

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) state = Object.assign(state, JSON.parse(raw));
    } catch (e) { /* ignore corrupt storage */ }
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (e) { /* storage unavailable, continue in-memory */ }
  }

  // ---------- Date math ----------
  function parseBirthDate() {
    if (!state.birthDate) return null;
    const [y, m, d] = state.birthDate.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  function getDecimalAge(birthDate, now) { return (now.getTime() - birthDate.getTime()) / MS_PER_YEAR; }

  function diffBreakdown(from, to) {
    const past = to <= from;
    const a = past ? to : from;
    const b = past ? from : to;
    let y = b.getFullYear() - a.getFullYear();
    let m = b.getMonth() - a.getMonth();
    let d = b.getDate() - a.getDate();
    if (d < 0) { m -= 1; const prevMonth = new Date(b.getFullYear(), b.getMonth(), 0); d += prevMonth.getDate(); }
    if (m < 0) { y -= 1; m += 12; }
    return { years: y, months: m, days: d, past };
  }

  function addYearsMonths(date, years, months) {
    const result = new Date(date.getTime());
    result.setFullYear(result.getFullYear() + Math.floor(years));
    result.setMonth(result.getMonth() + Math.round(months));
    return result;
  }

  function fmtBreakdown(b) {
    const parts = [];
    if (b.years > 0) parts.push(`${b.years} ปี`);
    if (b.months > 0) parts.push(`${b.months} เดือน`);
    if (b.years === 0) parts.push(`${b.days} วัน`);
    if (parts.length === 0) return '0 วัน';
    return parts.join(' ');
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // ---------- Canvas dial ----------
  const canvas = document.getElementById('dial');
  const ctx = canvas.getContext('2d');
  const tooltipEl = document.getElementById('dialTooltip');
  let cssW = 300, cssH = 300;

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    cssW = Math.round(rect.width);
    cssH = Math.round(rect.height);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  function angleFor(value, cycle) { return -Math.PI / 2 + (value / cycle) * 2 * Math.PI; }

  function drawHand(cx, cy, angle, length, width, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
    ctx.stroke();
    ctx.restore();
  }

  let highlightGoalId = null;
  let highlightUntil = 0;

  // Hit-testing registries, refreshed every draw
  let lastHandSegments = [];
  let lastGoalBadges = [];
  let lastZodiacPoint = null;

  function drawGoalBadges(cx, cy, R, life, decimalAge) {
    const parchment = cssVar('--text');
    const textDim = cssVar('--text-dim');
    const mint = cssVar('--mint');
    lastGoalBadges = [];
    if (state.goals.length === 0) return;

    const sorted = [...state.goals].sort((a, b) => a.age - b.age);
    const gapThresholdAge = (10 / 360) * life;
    let lastAge = -Infinity;
    let toggle = false;
    const pulsing = performance.now() < highlightUntil;

    sorted.forEach((g) => {
      if (g.age - lastAge < gapThresholdAge) toggle = !toggle; else toggle = false;
      lastAge = g.age;
      const radius = toggle ? R + 19 : R + 10;
      const clampedAge = clamp(g.age, 0, life);
      const a = angleFor(clampedAge, life);
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius;
      const achieved = decimalAge >= g.age;
      const isHi = pulsing && g.id === highlightGoalId;
      const badgeR = isHi ? 10.5 : 8.5;

      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.lineTo(x, y);
      ctx.strokeStyle = achieved ? textDim : mint;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.arc(x, y, badgeR, 0, 2 * Math.PI);
      ctx.fillStyle = achieved ? textDim : mint;
      ctx.fill();
      if (isHi) {
        ctx.lineWidth = 2;
        ctx.strokeStyle = parchment;
        ctx.stroke();
      }

      ctx.fillStyle = '#0d1128';
      ctx.font = "700 9.5px 'Inter', sans-serif";
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(Math.floor(g.age)), x, y + 0.5);

      lastGoalBadges.push({ goal: g, x, y, r: badgeR, achieved });
    });
  }

  function drawDial(now) {
    const birthDate = parseBirthDate();
    const cx = cssW / 2;
    const cy = cssH / 2;
    const R = Math.min(cssW, cssH) / 2 - 34;

    ctx.clearRect(0, 0, cssW, cssH);
    lastHandSegments = [];
    lastGoalBadges = [];
    lastZodiacPoint = null;
    if (!birthDate) return;

    const lifespan = state.lifespan;
    const rawAge = getDecimalAge(birthDate, now);
    const decimalAge = clamp(rawAge, 0, lifespan);
    const lived = decimalAge / lifespan;

    const parchment = cssVar('--text');
    const gold = cssVar('--gold');
    const goldDim = cssVar('--gold-dim');
    const amber = cssVar('--amber');
    const teal = cssVar('--teal');
    const coral = cssVar('--coral');
    const sky = cssVar('--sky');
    const lemon = cssVar('--lemon');
    const rose = cssVar('--rose');

    // Lived vs remaining ring — both vivid
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + lived * 2 * Math.PI);
    ctx.strokeStyle = gold;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 9;
    ctx.lineCap = 'butt';
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2 + lived * 2 * Math.PI, -Math.PI / 2 + 2 * Math.PI);
    ctx.strokeStyle = teal;
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 9;
    ctx.lineCap = 'butt';
    ctx.stroke();
    ctx.restore();

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.strokeStyle = cssVar('--line');
    ctx.lineWidth = 1;
    ctx.stroke();

    const life = Math.round(lifespan);
    for (let i = 0; i <= life; i++) {
      const isMajor = (i % 10 === 0) || (i === life);
      const a = angleFor(i, life);
      const outer = R;
      const inner = R - (isMajor ? 14 : 7);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.strokeStyle = isMajor ? gold : goldDim;
      ctx.globalAlpha = isMajor ? 0.95 : 0.5;
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (isMajor) {
        const labelR = R - 26;
        ctx.font = "600 13px 'Cormorant Garamond', serif";
        ctx.fillStyle = parchment;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i), cx + Math.cos(a) * labelR, cy + Math.sin(a) * labelR);
      }
    }

    drawGoalBadges(cx, cy, R, life, decimalAge);

    // ---- Hands: decade -> year -> month -> day -> hour(24h) -> minute -> second ----
    const decadeAngle = angleFor(decimalAge, life);
    const yearCyclePos = ((decimalAge % 10) + 10) % 10;
    const yearAngle = angleFor(yearCyclePos, 10);
    const monthCyclePos = ((decimalAge % 1) + 1) % 1;
    const monthAngle = angleFor(monthCyclePos, 1);

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayFrac = (now.getDate() - 1 + (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()) / 86400) / daysInMonth;
    const dayAngle = angleFor(dayFrac, 1);

    const hourFrac = (now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000) / 86400;
    const hourAngle = angleFor(hourFrac, 1);

    const minuteFrac = (now.getMinutes() * 60 + now.getSeconds() + now.getMilliseconds() / 1000) / 3600;
    const minuteAngle = angleFor(minuteFrac, 1);

    const secondFrac = (now.getSeconds() + now.getMilliseconds() / 1000) / 60;
    const secondAngle = angleFor(secondFrac, 1);

    const hands = [
      { key: 'minute', angle: minuteAngle, len: R * 0.88, w: 1.3, color: lemon, alpha: 0.75 },
      { key: 'hour',   angle: hourAngle,   len: R * 0.80, w: 1.6, color: sky,   alpha: 0.8 },
      { key: 'day',    angle: dayAngle,    len: R * 0.70, w: 2,   color: coral, alpha: 0.85 },
      { key: 'month',  angle: monthAngle,  len: R * 0.58, w: 2.8, color: teal,  alpha: 0.95 },
      { key: 'year',   angle: yearAngle,   len: R * 0.46, w: 3.6, color: amber, alpha: 1 },
      { key: 'decade', angle: decadeAngle, len: R * 0.32, w: 5,   color: gold,  alpha: 1 },
      { key: 'second', angle: secondAngle, len: R * 0.88, w: 1.1, color: rose,  alpha: 1 }
    ];

    hands.forEach((h) => {
      drawHand(cx, cy, h.angle, h.len, h.w, h.color, h.alpha);
      lastHandSegments.push({
        key: h.key,
        label: HAND_INFO[h.key],
        x1: cx, y1: cy,
        x2: cx + Math.cos(h.angle) * h.len,
        y2: cy + Math.sin(h.angle) * h.len
      });
    });

    // Zodiac animal riding the tip of the second hand
    const zodiacIdx = getZodiacIndex(birthDate);
    const zodiacEmoji = ZODIAC_EMOJI[zodiacIdx];
    const zodiacFontSize = clamp(Math.round(R * 0.16), 14, 20);
    const secondHand = hands.find((h) => h.key === 'second');
    const zx = cx + Math.cos(secondHand.angle) * secondHand.len;
    const zy = cy + Math.sin(secondHand.angle) * secondHand.len;
    ctx.font = `${zodiacFontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(zodiacEmoji, zx, zy);
    lastZodiacPoint = { x: zx, y: zy, r: zodiacFontSize * 0.65, label: `ปีนักษัตร: ${ZODIAC_NAME[zodiacIdx]}` };

    ctx.beginPath();
    ctx.arc(cx, cy, 5.5, 0, 2 * Math.PI);
    ctx.fillStyle = gold;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5, 0, 2 * Math.PI);
    ctx.strokeStyle = cssVar('--bg-1');
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // ---------- Hover / tap tooltips ----------
  function distToSegment(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((px - x1) * dx + (py - y1) * dy) / lenSq;
    t = clamp(t, 0, 1);
    const projX = x1 + t * dx, projY = y1 + t * dy;
    return Math.hypot(px - projX, py - projY);
  }

  function getCanvasPoint(evt) {
    const rect = canvas.getBoundingClientRect();
    const clientX = evt.touches && evt.touches.length ? evt.touches[0].clientX : evt.clientX;
    const clientY = evt.touches && evt.touches.length ? evt.touches[0].clientY : evt.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  function hitTest(x, y) {
    for (const b of lastGoalBadges) {
      if (Math.hypot(x - b.x, y - b.y) <= b.r + 3) return { type: 'goal', data: b };
    }
    if (lastZodiacPoint && Math.hypot(x - lastZodiacPoint.x, y - lastZodiacPoint.y) <= lastZodiacPoint.r + 4) {
      return { type: 'zodiac', data: lastZodiacPoint };
    }
    let best = null, bestDist = 8;
    for (const seg of lastHandSegments) {
      const d = distToSegment(x, y, seg.x1, seg.y1, seg.x2, seg.y2);
      if (d < bestDist) { bestDist = d; best = seg; }
    }
    if (best) return { type: 'hand', data: best };
    return null;
  }

  function showTooltip(x, y, text) {
    tooltipEl.textContent = text;
    tooltipEl.style.left = x + 'px';
    tooltipEl.style.top = y + 'px';
    tooltipEl.classList.add('show');
  }

  function hideTooltip() { tooltipEl.classList.remove('show'); }

  let tooltipHideTimer = null;

  function onDialInteract(evt, pinned) {
    const p = getCanvasPoint(evt);
    const hit = hitTest(p.x, p.y);
    if (!hit) { if (!pinned) hideTooltip(); return; }

    if (hit.type === 'hand') {
      showTooltip(p.x, p.y, hit.data.label);
    } else if (hit.type === 'zodiac') {
      showTooltip(p.x, p.y, hit.data.label);
    } else if (hit.type === 'goal') {
      const g = hit.data.goal;
      const yrs = Math.floor(g.age);
      const mos = Math.round((g.age - yrs) * 12);
      showTooltip(p.x, p.y, `อายุ ${yrs} ปี${mos ? ' ' + mos + ' เดือน' : ''}: ${g.text}`);
      if (pinned) {
        highlightGoalId = g.id;
        highlightUntil = performance.now() + 1600;
        drawDial(new Date());
      }
    }

    if (pinned) {
      clearTimeout(tooltipHideTimer);
      tooltipHideTimer = setTimeout(hideTooltip, 2500);
    }
  }

  function updateOwnerName() {
    const el = document.getElementById('ownerName');
    if (state.fullName && state.fullName.trim()) {
      el.textContent = `นาฬิกาชีวิตของ ${state.fullName.trim()}`;
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  // ---------- Readout ----------
  function updateReadout(now) {
    const birthDate = parseBirthDate();
    const ageEl = document.getElementById('ageValue');
    const remEl = document.getElementById('remainingValue');
    const pctEl = document.getElementById('pctValue');
    const emptyState = document.getElementById('emptyState');
    const readout = document.getElementById('readout');

    if (!birthDate) {
      emptyState.classList.remove('hidden');
      readout.style.display = 'none';
      return;
    }
    emptyState.classList.add('hidden');
    readout.style.display = '';

    const ageB = diffBreakdown(birthDate, now);
    ageEl.textContent = fmtBreakdown(ageB);

    const deathDate = addYearsMonths(birthDate, state.lifespan, 0);
    if (now >= deathDate) {
      remEl.textContent = `ครบกำหนด ${state.lifespan} ปีแล้ว`;
      pctEl.textContent = '100%';
      return;
    }
    const remB = diffBreakdown(now, deathDate);
    remEl.textContent = `${fmtBreakdown(remB)} (จนถึงอายุ ${state.lifespan})`;

    const decimalAge = getDecimalAge(birthDate, now);
    const pct = clamp((decimalAge / state.lifespan) * 100, 0, 100);
    pctEl.textContent = `${pct.toFixed(1)}%`;
  }

  // ---------- Goals list ----------
  function renderGoalList() {
    const listEl = document.getElementById('goalList');
    listEl.innerHTML = '';

    if (state.goals.length === 0) {
      const li = document.createElement('li');
      li.className = 'goal-empty';
      li.textContent = 'ยังไม่มีเป้าหมาย ลองเพิ่มสิ่งที่อยากทำในช่วงอายุต่างๆ ดูสิ';
      listEl.appendChild(li);
      return;
    }

    const birthDate = parseBirthDate();
    const now = new Date();
    const decimalAge = birthDate ? getDecimalAge(birthDate, now) : 0;

    const sorted = [...state.goals].sort((a, b) => a.age - b.age);
    sorted.forEach((g) => {
      const achieved = birthDate ? decimalAge >= g.age : false;
      const li = document.createElement('li');
      li.className = 'goal-item' + (achieved ? ' achieved' : '');
      li.dataset.id = g.id;

      const yrs = Math.floor(g.age);
      const mos = Math.round((g.age - yrs) * 12);

      let statusText = '';
      if (birthDate) {
        if (achieved) statusText = 'ผ่านมาแล้ว';
        else {
          const targetDate = addYearsMonths(birthDate, yrs, mos);
          statusText = `อีก ${fmtBreakdown(diffBreakdown(now, targetDate))}`;
        }
      }

      li.innerHTML = `
        <span class="goal-marker-dot"></span>
        <span class="goal-body">
          <span class="goal-age">อายุ ${yrs} ปี${mos ? ' ' + mos + ' เดือน' : ''}</span>
          <div class="goal-text"></div>
          <div class="goal-status">${statusText}</div>
        </span>
        <button class="goal-del" aria-label="ลบเป้าหมาย" data-id="${g.id}">×</button>
      `;
      li.querySelector('.goal-text').textContent = g.text;
      listEl.appendChild(li);
    });
  }

  // ---------- Render loop ----------
  let lastDrawTime = 0;
  const FRAME_INTERVAL = reducedMotion ? 1000 : 120;

  function frame(ts) {
    if (ts - lastDrawTime >= FRAME_INTERVAL) {
      lastDrawTime = ts;
      const now = new Date();
      drawDial(now);
      updateReadout(now);
    }
    requestAnimationFrame(frame);
  }

  function render() {
    const now = new Date();
    drawDial(now);
    updateReadout(now);
  }

  // ---------- Accordion tabs ----------
  function setOpenPanel(name) {
    openPanel = name;
    document.getElementById('panel-goals').classList.toggle('hidden', openPanel !== 'goals');
    document.getElementById('panel-settings').classList.toggle('hidden', openPanel !== 'settings');
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === openPanel));
  }

  function initTabs() {
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        setOpenPanel(openPanel === tab ? null : tab);
      });
    });
  }

  // ---------- Events ----------
  function initSettingsForm() {
    const fullNameInput = document.getElementById('fullNameInput');
    const birthInput = document.getElementById('birthDateInput');
    const lifespanInput = document.getElementById('lifespanInput');
    fullNameInput.value = state.fullName || '';
    if (state.birthDate) birthInput.value = state.birthDate;
    lifespanInput.value = state.lifespan;

    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
      const bd = birthInput.value;
      const ls = parseInt(lifespanInput.value, 10);
      if (!bd) { alert('กรุณาเลือกวันเกิดก่อน'); return; }
      if (!ls || ls < 1 || ls > 120) { alert('กรุณาใส่อายุขัยที่คาดว่าระหว่าง 1-120 ปี'); return; }
      state.fullName = fullNameInput.value.trim();
      state.birthDate = bd;
      state.lifespan = ls;
      saveState();
      render();
      renderGoalList();
      updateOwnerName();
      const msg = document.getElementById('saveMsg');
      msg.classList.add('show');
      setTimeout(() => msg.classList.remove('show'), 1800);
    });
  }

  function initGoalForm() {
    document.getElementById('goalForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const years = parseFloat(document.getElementById('goalYears').value);
      const months = parseFloat(document.getElementById('goalMonths').value) || 0;
      const text = document.getElementById('goalText').value.trim();
      if (isNaN(years) || years < 0 || years > 120 || !text) return;
      const age = years + (months / 12);
      state.goals.push({ id: 'g' + Date.now(), age, text });
      saveState();
      renderGoalList();
      render();
      e.target.reset();
    });

    document.getElementById('goalList').addEventListener('click', (e) => {
      if (e.target.classList.contains('goal-del')) {
        const id = e.target.dataset.id;
        state.goals = state.goals.filter((g) => g.id !== id);
        saveState();
        renderGoalList();
        render();
        return;
      }
      const item = e.target.closest('.goal-item');
      if (item) {
        highlightGoalId = item.dataset.id;
        highlightUntil = performance.now() + 1600;
        render();
      }
    });
  }

  function initDialInteraction() {
    canvas.addEventListener('mousemove', (e) => onDialInteract(e, false));
    canvas.addEventListener('mouseleave', hideTooltip);
    canvas.addEventListener('click', (e) => onDialInteract(e, true));
    canvas.addEventListener('touchstart', (e) => onDialInteract(e, true), { passive: true });
  }

  function init() {
    loadState();
    initTabs();
    initSettingsForm();
    initGoalForm();
    initDialInteraction();
    renderGoalList();
    resizeCanvas();
    render();
    updateOwnerName();

    setOpenPanel(state.birthDate ? null : 'settings');

    window.addEventListener('resize', () => { resizeCanvas(); render(); });
    requestAnimationFrame(frame);
  }

  document.addEventListener('DOMContentLoaded', init);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();
