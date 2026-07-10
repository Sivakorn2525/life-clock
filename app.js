(() => {
  'use strict';

  const MS_PER_YEAR = 365.2425 * 24 * 3600 * 1000;
  const STORAGE_KEY = 'lifeClockState_v1';
  const reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------- State ----------
  let state = { birthDate: null, lifespan: 80, goals: [] };

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

  function getDecimalAge(birthDate, now) {
    return (now.getTime() - birthDate.getTime()) / MS_PER_YEAR;
  }

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
  let cssW = 300, cssH = 200;

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

  function angleFor(value, cycle) {
    const frac = value / cycle;
    return -Math.PI / 2 + frac * 2 * Math.PI;
  }

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

  function truncateToWidth(text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxWidth) t = t.slice(0, -1);
    return t + '…';
  }

  function layoutGoalTags(goals, cx, cy, R, life, decimalAge) {
    const items = goals.map((g) => {
      const clampedAge = clamp(g.age, 0, life);
      const a = angleFor(clampedAge, life);
      const anchorX = cx + Math.cos(a) * (R + 3);
      const anchorY = cy + Math.sin(a) * (R + 3);
      const side = Math.cos(a) >= 0 ? 'right' : 'left';
      return { goal: g, anchorX, anchorY, side, achieved: decimalAge >= g.age };
    });
    const rightItems = items.filter((i) => i.side === 'right').sort((a, b) => a.anchorY - b.anchorY);
    const leftItems = items.filter((i) => i.side === 'left').sort((a, b) => a.anchorY - b.anchorY);
    const labelXRight = cx + R + 18;
    const labelXLeft = cx - R - 18;
    const minGap = 21;
    const topBound = 12, bottomBound = cssH - 12;

    function resolveColumn(arr) {
      let prevY = -Infinity;
      arr.forEach((item) => {
        let y = Math.max(item.anchorY, topBound);
        if (y - prevY < minGap) y = prevY + minGap;
        item.labelY = y;
        prevY = y;
      });
      if (arr.length && arr[arr.length - 1].labelY > bottomBound) {
        const shift = arr[arr.length - 1].labelY - bottomBound;
        arr.forEach((item) => { item.labelY -= shift; });
      }
    }
    resolveColumn(rightItems);
    resolveColumn(leftItems);
    rightItems.forEach((i) => { i.labelX = labelXRight; });
    leftItems.forEach((i) => { i.labelX = labelXLeft; });
    return [...rightItems, ...leftItems];
  }

  function drawGoalTags(cx, cy, R, life, decimalAge) {
    const parchment = cssVar('--text');
    const textDim = cssVar('--text-dim');
    const mint = cssVar('--mint');
    const fontSize = clamp(Math.round(cssW * 0.03), 9, 11.5);
    ctx.font = `600 ${fontSize}px 'Inter', sans-serif`;
    const maxTextWidth = Math.max(46, Math.min(96, cssW * 0.22));

    const laid = layoutGoalTags(state.goals, cx, cy, R, life, decimalAge);
    const pulsing = performance.now() < highlightUntil;

    laid.forEach((item) => {
      const isHi = pulsing && item.goal.id === highlightGoalId;
      const dotColor = item.achieved ? textDim : mint;

      // leader line
      ctx.save();
      ctx.strokeStyle = dotColor;
      ctx.globalAlpha = isHi ? 0.9 : 0.5;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(item.anchorX, item.anchorY);
      ctx.lineTo(item.labelX, item.labelY);
      ctx.stroke();
      ctx.restore();

      // anchor dot on the ring
      ctx.beginPath();
      ctx.arc(item.anchorX, item.anchorY, isHi ? 4 : 2.8, 0, 2 * Math.PI);
      ctx.fillStyle = dotColor;
      ctx.fill();

      // tag text
      const yrs = Math.floor(item.goal.age);
      const label = truncateToWidth(`${yrs}: ${item.goal.text}`, maxTextWidth);
      const textW = ctx.measureText(label).width;
      const tagW = textW + 14;
      const tagH = fontSize + 9;
      const tagX = item.side === 'right' ? item.labelX : item.labelX - tagW;
      const tagY = item.labelY - tagH / 2;

      ctx.save();
      ctx.globalAlpha = isHi ? 1 : (item.achieved ? 0.55 : 0.88);
      ctx.fillStyle = 'rgba(13,17,40,0.72)';
      ctx.strokeStyle = dotColor;
      ctx.lineWidth = isHi ? 1.4 : 1;
      const r = 5;
      ctx.beginPath();
      ctx.moveTo(tagX + r, tagY);
      ctx.arcTo(tagX + tagW, tagY, tagX + tagW, tagY + tagH, r);
      ctx.arcTo(tagX + tagW, tagY + tagH, tagX, tagY + tagH, r);
      ctx.arcTo(tagX, tagY + tagH, tagX, tagY, r);
      ctx.arcTo(tagX, tagY, tagX + tagW, tagY, r);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = item.achieved ? textDim : parchment;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, tagX + 7, item.labelY + 0.5);
      ctx.restore();
    });
  }

  function drawDial(now) {
    const birthDate = parseBirthDate();
    const cx = cssW / 2;
    const cy = cssH / 2;
    const R = cssH / 2 - 38;

    ctx.clearRect(0, 0, cssW, cssH);
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

    // Lived vs remaining ring — both vivid, no "used up / dead" grey
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

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.strokeStyle = cssVar('--line');
    ctx.lineWidth = 1;
    ctx.stroke();

    // Ticks + decade numbers
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

    drawGoalTags(cx, cy, R, life, decimalAge);

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

    drawHand(cx, cy, minuteAngle, R * 0.88, 1.3, lemon, 0.75);
    drawHand(cx, cy, hourAngle, R * 0.80, 1.6, sky, 0.8);
    drawHand(cx, cy, dayAngle, R * 0.70, 2, coral, 0.85);
    drawHand(cx, cy, monthAngle, R * 0.58, 2.8, teal, 0.95);
    drawHand(cx, cy, yearAngle, R * 0.46, 3.6, amber, 1);
    drawHand(cx, cy, decadeAngle, R * 0.32, 5, gold, 1);
    drawHand(cx, cy, secondAngle, R * 0.95, 1.1, rose, 1);

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

  // ---------- Events ----------
  function initSettingsForm() {
    const birthInput = document.getElementById('birthDateInput');
    const lifespanInput = document.getElementById('lifespanInput');
    if (state.birthDate) birthInput.value = state.birthDate;
    lifespanInput.value = state.lifespan;

    document.getElementById('saveSettingsBtn').addEventListener('click', () => {
      const bd = birthInput.value;
      const ls = parseInt(lifespanInput.value, 10);
      if (!bd) { alert('กรุณาเลือกวันเกิดก่อน'); return; }
      if (!ls || ls < 1 || ls > 120) { alert('กรุณาใส่อายุขัยที่คาดว่าระหว่าง 1-120 ปี'); return; }
      state.birthDate = bd;
      state.lifespan = ls;
      saveState();
      render();
      renderGoalList();
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

  function initTabs() {
    const buttons = document.querySelectorAll('.tab-btn');
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        document.getElementById('panel-goals').classList.toggle('hidden', btn.dataset.tab !== 'goals');
        document.getElementById('panel-settings').classList.toggle('hidden', btn.dataset.tab !== 'settings');
      });
    });
  }

  function init() {
    loadState();
    initTabs();
    initSettingsForm();
    initGoalForm();
    renderGoalList();
    resizeCanvas();
    render();

    if (!state.birthDate) {
      document.querySelector('.tab-btn[data-tab="settings"]').click();
    }

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
