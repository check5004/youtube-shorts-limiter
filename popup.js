// 設定画面: 数値は −／＋ のクリックでも、キーボードでの直接入力でも変えられる。変更はすぐ保存される
const DEFAULTS = { limitType: 'count', limit: 3, minutes: 5, resetMode: 'open', opensOn: false, maxOpens: 3, resetHour: 4, badgeOn: false, badgeCount: 3, badgeMinutes: 2 };
const $ = (id) => document.getElementById(id);
const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
const MINUTES = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240];
// 直接入力で受け付ける範囲
const BOUNDS = { limit: [1, 99], minutes: [1, 240], maxOpens: [1, 20], resetHour: [0, 23], badgeCount: [1, 99], badgeMinutes: [1, 240] };
let s = { ...DEFAULTS };
let msgTimer = null;

document.documentElement.lang = chrome.i18n.getUILanguage().startsWith('ja') ? 'ja' : 'en';
document.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });

function field(key) {
  const time = s.limitType === 'time';
  if (key === 'amount') return time ? 'minutes' : 'limit';
  if (key === 'badgeFrom') return time ? 'badgeMinutes' : 'badgeCount';
  return key;
}
// −／＋ ボタンで移動する値の候補
function steps(key) {
  const f = field(key);
  if (f === 'minutes' || f === 'badgeMinutes') return MINUTES;
  const [a, b] = BOUNDS[f];
  const r = [];
  for (let i = a; i <= b; i++) r.push(i);
  return r;
}
function unit(key) {
  const f = field(key);
  if (f === 'minutes' || f === 'badgeMinutes') return t('sufMinutes');
  if (f === 'resetHour') return t('sufHour');
  return t('sufTimes');
}
function clamp(key, v) {
  const [a, b] = BOUNDS[field(key)];
  return Math.max(a, Math.min(b, v));
}

document.querySelectorAll('.stepper').forEach((el) => {
  const key = el.dataset.key;
  el.innerHTML = '<button type="button" class="minus">−</button>'
    + '<label class="val"><input type="text" inputmode="numeric" maxlength="3" autocomplete="off"><span class="unit"></span></label>'
    + '<button type="button" class="plus">＋</button>';
  el.querySelector('.minus').setAttribute('aria-label', t('decrease'));
  el.querySelector('.plus').setAttribute('aria-label', t('increase'));
  const input = el.querySelector('input');
  const move = (dir) => {
    const list = steps(key), cur = s[field(key)];
    let i;
    if (dir > 0) { i = list.findIndex((x) => x > cur); if (i < 0) i = key === 'resetHour' ? 0 : list.length - 1; }
    else { i = list.length - 1 - [...list].reverse().findIndex((x) => x < cur); if (i >= list.length) i = key === 'resetHour' ? list.length - 1 : 0; }
    s[field(key)] = list[i];
    commit();
  };
  el.querySelector('.minus').addEventListener('click', () => move(-1));
  el.querySelector('.plus').addEventListener('click', () => move(1));
  // キーボードでの直接入力（Enter か、欄から離れたときに確定。↑↓キーでも増減）
  const fromInput = () => {
    const n = parseInt(input.value.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)), 10);
    if (Number.isFinite(n) && n !== s[field(key)]) { s[field(key)] = clamp(key, n); commit(); } else paint();
    input.value = s[field(key)];
  };
  input.addEventListener('change', fromInput);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); fromInput(); input.select(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(1); input.select(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); move(-1); input.select(); }
    else if (e.key === 'Escape') { paint(); input.blur(); }
  });
  input.addEventListener('focus', () => input.select());
  input.addEventListener('input', () => { input.style.width = `${Math.max(1, input.value.length) + 0.6}ch`; });
});

document.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', () => { s.limitType = r.value; commit(); }));
document.querySelectorAll('input[name=reset]').forEach((r) => r.addEventListener('change', () => { s.resetMode = r.value; commit(); }));
$('opensOn').addEventListener('change', () => { s.opensOn = $('opensOn').checked; commit(); });
$('badgeOn').addEventListener('change', () => { s.badgeOn = $('badgeOn').checked; commit(); });

function paint() {
  document.querySelector(`input[name=type][value=${s.limitType}]`).checked = true;
  document.querySelector(`input[name=reset][value=${s.resetMode}]`).checked = true;
  $('opensOn').checked = s.opensOn;
  $('amountLabel').textContent = s.limitType === 'time' ? t('labelTime') : t('labelCount');
  $('opensRow').classList.toggle('dim', !s.opensOn);
  $('badgeOn').checked = s.badgeOn;
  $('badgeLabel').textContent = s.limitType === 'time' ? t('labelBadgeTime') : t('labelBadgeCount');
  $('badgeRow').classList.toggle('dim', !s.badgeOn);
  document.querySelectorAll('.stepper').forEach((el) => {
    const key = el.dataset.key, list = steps(key), v = s[field(key)];
    const input = el.querySelector('input');
    if (document.activeElement !== input) input.value = v;
    input.style.width = `${Math.max(1, String(input.value).length) + 0.6}ch`;
    el.querySelector('.unit').textContent = unit(key);
    const off = (key === 'maxOpens' && !s.opensOn) || (key === 'badgeFrom' && !s.badgeOn);
    const wrap = key === 'resetHour';
    input.disabled = off;
    el.querySelector('.minus').disabled = off || (!wrap && v <= list[0]);
    el.querySelector('.plus').disabled = off || (!wrap && v >= list[list.length - 1]);
  });
}

function flash(text) {
  $('msg').textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { $('msg').textContent = ''; }, 1500);
}

function commit() {
  paint();
  chrome.storage.local.set({ settings: { ...s } }, () => { flash(t('saved')); refreshStatus(); });
}

function dayKey(h, back = 0) {
  const d = new Date(Date.now() - h * 3600e3);
  d.setDate(d.getDate() - back);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}
function minutes(sec) { return Math.floor((sec || 0) / 60); }

function refreshStatus() {
  chrome.storage.local.get(['daily', 'session', 'history'], (r) => {
    const empty = { opens: 0, count: 0, seconds: 0, views: 0, watch: 0 };
    const daily = r.daily && r.daily.day === dayKey(s.resetHour) ? { ...empty, ...r.daily } : empty;
    const u = s.resetMode === 'daily' ? daily : (r.session || empty);
    const time = s.limitType === 'time';
    const used = time ? minutes(u.seconds) : u.count || 0;
    const max = time ? s.minutes : s.limit;
    const unitText = time ? t('unitMin') : t('unitScrolls');
    const scope = s.resetMode === 'daily' ? t('scopeToday') : t('scopeSession');
    const over = time ? (u.seconds || 0) >= max * 60 : used >= max;
    let html = over ? t('statusBlocked', scope, max, unitText) : t('statusUsage', scope, used, max, unitText);
    if (s.opensOn) html += '<br>' + t('statusOpens', Math.min(daily.opens, s.maxOpens), s.maxOpens);
    $('status').innerHTML = html; // 文言は拡張機能に同梱したもの、値は数値のみ

    $('stViews').textContent = t('unitViews', daily.views);
    $('stWatch').textContent = t('unitMinutes', minutes(daily.watch));
    $('stOpens').textContent = t('unitTimes', daily.opens);
    drawChart(daily, r.history || {});
  });
}

function drawChart(today, history) {
  const days = [];
  for (let back = 6; back >= 0; back--) {
    const key = dayKey(s.resetHour, back);
    const rec = back === 0 ? today : history[key] || {};
    const d = new Date(Date.now() - s.resetHour * 3600e3);
    d.setDate(d.getDate() - back);
    days.push({ views: rec.views || 0, label: d.toLocaleDateString(chrome.i18n.getUILanguage(), { weekday: 'narrow' }), today: back === 0 });
  }
  const top = Math.max(1, ...days.map((d) => d.views));
  const chart = $('chart');
  chart.textContent = '';
  days.forEach((d) => {
    const col = document.createElement('div');
    col.className = 'col' + (d.today ? ' today' : '');
    const num = document.createElement('div'); num.className = 'num'; num.textContent = d.views;
    const bar = document.createElement('div'); bar.className = 'bar'; bar.style.height = `${Math.round((d.views / top) * 40)}px`;
    const day = document.createElement('div'); day.className = 'day'; day.textContent = d.label;
    col.append(num, bar, day);
    chart.appendChild(col);
  });
}

chrome.storage.local.get('settings', (r) => {
  s = { ...DEFAULTS, ...(r.settings || {}) };
  paint();
  refreshStatus();
});

// 「今すぐカウントをリセット」は2回確認してから実行する（簡単に制限を外せないように）
function showStep(n) {
  $('resetNow').hidden = n !== 0;
  $('confirm1').hidden = n !== 1;
  $('confirm2').hidden = n !== 2;
}
$('resetNow').addEventListener('click', () => showStep(1));
$('c1No').addEventListener('click', () => showStep(0));
$('c2No').addEventListener('click', () => showStep(0));
$('c1Yes').addEventListener('click', () => showStep(2));
$('c2Yes').addEventListener('click', () => {
  showStep(0);
  chrome.storage.local.get('daily', (r) => {
    const cur = r.daily && r.daily.day === dayKey(s.resetHour) ? r.daily : {};
    chrome.storage.local.set({
      // 制限のカウントだけ戻す。今日の記録（見た本数・視聴時間）は残す
      daily: { day: dayKey(s.resetHour), opens: 0, count: 0, seconds: 0, views: cur.views || 0, watch: cur.watch || 0, from: 'popup', t: Date.now() },
      session: { count: 0, seconds: 0 },
    }, () => { flash(t('resetDone')); refreshStatus(); });
  });
});
chrome.storage.onChanged.addListener(() => refreshStatus());
