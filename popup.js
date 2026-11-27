// 設定はクリックだけで変更でき、変更するとすぐ保存される
const DEFAULTS = { limitType: 'count', limit: 3, minutes: 5, resetMode: 'open', opensOn: false, maxOpens: 3, resetHour: 4 };
const $ = (id) => document.getElementById(id);
const MINUTES = [1, 2, 3, 5, 10, 15, 20, 30, 45, 60, 90, 120];
let s = { ...DEFAULTS };
let msgTimer = null;

// 各ステッパーの値の候補
function steps(key) {
  if (key === 'amount') return s.limitType === 'time' ? MINUTES : range(1, 20);
  if (key === 'maxOpens') return range(1, 10);
  if (key === 'resetHour') return range(0, 23);
}
function range(a, b) { const r = []; for (let i = a; i <= b; i++) r.push(i); return r; }
function getVal(key) {
  if (key === 'amount') return s.limitType === 'time' ? s.minutes : s.limit;
  return s[key];
}
function setVal(key, v) {
  if (key === 'amount') { if (s.limitType === 'time') s.minutes = v; else s.limit = v; }
  else s[key] = v;
}
function label(key, v) {
  if (key === 'amount') return s.limitType === 'time' ? `${v}分` : `${v}回`;
  if (key === 'maxOpens') return `${v}回`;
  if (key === 'resetHour') return `${v}時`;
}

document.querySelectorAll('.stepper').forEach((el) => {
  const key = el.dataset.key;
  el.innerHTML = '<button type="button" class="minus" aria-label="減らす">−</button><span class="val"></span><button type="button" class="plus" aria-label="増やす">＋</button>';
  const move = (dir) => {
    const list = steps(key);
    let i = list.indexOf(getVal(key));
    if (i < 0) i = list.findIndex((x) => x >= getVal(key)), i = i < 0 ? list.length - 1 : i;
    i += dir;
    if (key === 'resetHour') i = (i + list.length) % list.length; // 時刻は一周する
    i = Math.max(0, Math.min(list.length - 1, i));
    setVal(key, list[i]);
    commit();
  };
  el.querySelector('.minus').addEventListener('click', () => move(-1));
  el.querySelector('.plus').addEventListener('click', () => move(1));
});

document.querySelectorAll('input[name=type]').forEach((r) => r.addEventListener('change', () => { s.limitType = r.value; commit(); }));
document.querySelectorAll('input[name=reset]').forEach((r) => r.addEventListener('change', () => { s.resetMode = r.value; commit(); }));
$('opensOn').addEventListener('change', () => { s.opensOn = $('opensOn').checked; commit(); });

function paint() {
  document.querySelector(`input[name=type][value=${s.limitType}]`).checked = true;
  document.querySelector(`input[name=reset][value=${s.resetMode}]`).checked = true;
  $('opensOn').checked = s.opensOn;
  $('amountLabel').textContent = s.limitType === 'time' ? '上限の時間' : '上限の回数';
  $('opensRow').classList.toggle('dim', !s.opensOn);
  document.querySelectorAll('.stepper').forEach((el) => {
    const key = el.dataset.key, list = steps(key), v = getVal(key);
    el.querySelector('.val').textContent = label(key, v);
    const wrap = key === 'resetHour';
    el.querySelector('.minus').disabled = (!wrap && v <= list[0]) || (key === 'maxOpens' && !s.opensOn);
    el.querySelector('.plus').disabled = (!wrap && v >= list[list.length - 1]) || (key === 'maxOpens' && !s.opensOn);
  });
}

function flash(text) {
  $('msg').textContent = text;
  clearTimeout(msgTimer);
  msgTimer = setTimeout(() => { $('msg').textContent = ''; }, 1500);
}

function commit() {
  paint();
  chrome.storage.local.set({ settings: { ...s } }, () => { flash('保存しました'); refreshStatus(); });
}

function dayKey(h) {
  const d = new Date(Date.now() - h * 3600e3);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

function refreshStatus() {
  chrome.storage.local.get(['daily', 'session'], (r) => {
    const daily = r.daily && r.daily.day === dayKey(s.resetHour) ? r.daily : { opens: 0, count: 0, seconds: 0 };
    const u = s.resetMode === 'daily' ? daily : (r.session || { count: 0, seconds: 0 });
    const time = s.limitType === 'time';
    const used = time ? Math.floor((u.seconds || 0) / 60) : u.count || 0;
    const max = time ? s.minutes : s.limit;
    const unit = time ? '分' : 'スクロール';
    const scope = s.resetMode === 'daily' ? '今日' : '今回';
    let html = used >= max ? `<b>ブロック中</b>（${scope}の上限 ${max}${unit}）` : `${scope}の使用量 <b>${used}</b> / ${max}${unit}`;
    if (s.opensOn) html += `<br>今日開いた回数 <b>${Math.min(daily.opens, s.maxOpens)}</b> / ${s.maxOpens}回`;
    $('status').innerHTML = html;
  });
}

chrome.storage.local.get('settings', (r) => {
  s = { ...DEFAULTS, ...(r.settings || {}) };
  paint();
  refreshStatus();
});

$('resetNow').addEventListener('click', () => {
  chrome.storage.local.set({
    daily: { day: '', opens: 0, count: 0, seconds: 0, from: 'popup', t: Date.now() },
    session: { count: 0, seconds: 0 },
  }, () => { flash('リセットしました'); refreshStatus(); });
});
