(() => {
  'use strict';

  const MS_PER_YEAR = 365.2425 * 24 * 3600 * 1000;
  const STORAGE_KEY = 'lifeClockState_v1';

  // ---------- State ----------
  let state = {
    birthDate: null,   // 'YYYY-MM-DD'
    lifespan: 80,
    goals: []          // {id, age: decimalYears, text}
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        state = Object.assign(state, parsed);
      }
    } catch (e) { /* ignore corrupt storage */ }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) { /* storage unavailable, continue in-memory */ }
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

  // Calendar-accurate breakdown of the span between two dates (a <= b).
  function diffBreakdown(from, to) {
    const past = to <= from;
    const a = past ? to : from;
    const b = past ? from : to;
    let y = b.getFullYear() - a.getFullYear();
    let m = b.getMonth() - a.getMonth();
    let d = b.getDate() - a.getDate();
    if (d < 0) {
      m -= 1;
      const prevMonth = new Date(b.getFullYear(), b.getMonth(), 0);
      d += prevMonth.getDate();
    }
    if (m < 0) {
      y -= 1;
      m += 12;
    }
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

  // ---------- Canvas dial ----------
  const canvas = document.getElementById('dial');
  const ctx = canvas.getContext('2d');
  let cssSize = 300;

  function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    cssSize = Math.round(rect.width);
    const dpr = window.devicePixelRatio || 1;
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

  function angleFor(ageValue, lifespan) {
    const frac = ageValue / lifespan;
    return -Math.PI / 2 + frac * 2 * Math.PI;
  }

  function drawHand(cx, cy, angle, length, width, color, cap) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = cap || 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * length, cy + Math.sin(angle) * length);
    ctx.stroke();
    ctx.restore();
  }

  let highlightGoalId = null;
  let highlightUntil = 0;

  function drawDial(now) {
    const birthDate = parseBirthDate();
    const size = cssSize;
    const cx = size / 2;
    const cy = size / 2;
    const R = size / 2 - 30;

    ctx.clearRect(0, 0, size, size);
    if (!birthDate) return;

    const lifespan = state.lifespan;
    const rawAge = getDecimalAge(birthDate, now);
    const decimalAge = Math.max(0, Math.min(rawAge, lifespan));
    const lived = decimalAge / lifespan;

    const parchment = cssVar('--parchment');
    const parchmentDim = cssVar('--parchment-dim');
    const brass = cssVar('--brass');
    const brassBright = cssVar('--brass-bright');
    const brassDim = cssVar('--brass-dim');
    const sage = cssVar('--sage');
    const sageBright = cssVar('--sage-bright');
    const line = cssVar('--line');

    // Lived-fraction ring (subtle progress annulus)
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + lived * 2 * Math.PI);
    ctx.strokeStyle = brass;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 10;
    ctx.lineCap = 'butt';
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, -Math.PI / 2 + lived * 2 * Math.PI, -Math.PI / 2 + 2 * Math.PI);
    ctx.strokeStyle = line;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 10;
    ctx.lineCap = 'butt';
    ctx.stroke();
    ctx.restore();

    // Outer ring
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, 2 * Math.PI);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1;
    ctx.stroke();

    // Ticks + numbers
    const life = Math.round(lifespan);
    for (let i = 0; i <= life; i++) {
      const isMajor = (i % 10 === 0) || (i === life);
      const a = angleFor(i, life);
      const outer = R;
      const inner = R - (isMajor ? 14 : 7);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer);
      ctx.lineTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner);
      ctx.strokeStyle = isMajor ? brass : brassDim;
      ctx.globalAlpha = isMajor ? 0.9 : 0.45;
      ctx.lineWidth = isMajor ? 2 : 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      if (isMajor) {
        const labelR = R - 27;
        ctx.font = "600 14px 'Cormorant Garamond', serif";
        ctx.fillStyle = parchment;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i), cx + Math.cos(a) * labelR, cy + Math.sin(a) * labelR);
      }
    }

    // Goal markers
    const now_pulse = (performance.now() < highlightUntil);
    state.goals.forEach((g) => {
      const clampedAge = Math.max(0, Math.min(g.age, life));
      const a = angleFor(clampedAge, life);
      const achieved = decimalAge >= g.age;
      const isHighlighted = now_pulse && g.id === highlightGoalId;
      const markerR = R + 9 + (isHighlighted ? 4 : 0);
      const px = cx + Math.cos(a) * markerR;
      const py = cy + Math.sin(a) * markerR;

      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
      ctx.lineTo(cx + Math.cos(a) * (R + 6), cy + Math.sin(a) * (R + 6));
      ctx.strokeStyle = achieved ? parchmentDim : sage;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;

      ctx.beginPath();
      ctx.arc(px, py, isHighlighted ? 5.5 : 3.5, 0, 2 * Math.PI);
      if (achieved) {
        ctx.fillStyle = parchmentDim;
        ctx.fill();
      } else {
        ctx.fillStyle = isHighlighted ? sageBright : sage;
        ctx.fill();
      }
    });

    // Hands: decade (short/thick), year (medium), month (long/thin)
    const decadeAngle = angleFor(decimalAge, life);
    const yearCyclePos = ((decimalAge % 10) + 10) % 10;
    const yearAngle = -Math.PI / 2 + (yearCyclePos / 10) * 2 * Math.PI;
    const monthCyclePos = ((decimalAge % 1) + 1) % 1;
    const monthAngle = -Math.PI / 2 + monthCyclePos * 2 * Math.PI;

    drawHand(cx, cy, yearAngle, R * 0.74, 2.5, parchment);
    drawHand(cx, cy, monthAngle, R * 0.90, 1.3, sageBright);
    drawHand(cx, cy, decadeAngle, R * 0.5, 5, brassBright);

    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
    ctx.fillStyle = brassBright;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, 2 * Math.PI);
    ctx.strokeStyle = cssVar('--bg');
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
    const pct = Math.max(0, Math.min(100, (decimalAge / state.lifespan) * 100));
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
        if (achieved) {
          statusText = 'ผ่านมาแล้ว';
        } else {
          const targetDate = addYearsMonths(birthDate, yrs, mos);
          const b = diffBreakdown(now, targetDate);
          statusText = `อีก ${fmtBreakdown(b)}`;
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
  function render() {
    const now = new Date();
    resizeCanvas();
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
      drawDial(new Date());
      e.target.reset();
    });

    document.getElementById('goalList').addEventListener('click', (e) => {
      if (e.target.classList.contains('goal-del')) {
        const id = e.target.dataset.id;
        state.goals = state.goals.filter((g) => g.id !== id);
        saveState();
        renderGoalList();
        drawDial(new Date());
        return;
      }
      const item = e.target.closest('.goal-item');
      if (item) {
        highlightGoalId = item.dataset.id;
        highlightUntil = performance.now() + 1600;
        drawDial(new Date());
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
    render();

    // Open settings by default on first run
    if (!state.birthDate) {
      document.querySelector('.tab-btn[data-tab="settings"]').click();
    }

    window.addEventListener('resize', render);
    setInterval(render, 1000);
  }

  document.addEventListener('DOMContentLoaded', init);

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('service-worker.js').catch(() => {});
    });
  }
})();
