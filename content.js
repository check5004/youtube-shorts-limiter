// YouTube ショート制限 - content script
(() => {
  'use strict';

  // limitType : 'count'（スクロール回数）| 'time'（視聴時間）
  // resetMode : 'open'（ショートを開くたびにリセット）| 'daily'（1日の合計で制限）
  // opensOn / maxOpens : 1日にショートを開ける回数の上限
  // resetHour : 1日の区切りの時刻
  const DEFAULTS = { limitType: 'count', limit: 3, minutes: 5, resetMode: 'open', opensOn: false, maxOpens: 3, resetHour: 4 };
  const TAB = Math.random().toString(36).slice(2);
  let settings = { ...DEFAULTS };
  let sess = freshSess();   // このタブの今回のセッション（開くたびモード用）
  let daily = freshDaily(); // 1日の合計（全タブで共有）
  let lastId = null;        // このタブで直前に見ていたショート
  let overlay = null, overlayKey = '', badge = null, pauseTimer = null, ready = false, tick = 0;

  function freshSess() { return { count: 0, seconds: 0, openBlocked: false }; }
  function freshDaily() { return { day: dayKey(), opens: 0, count: 0, seconds: 0 }; }
  function dayKey() {
    const d = new Date(Date.now() - (settings.resetHour || 0) * 3600e3);
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  function shortsId(url) {
    const m = new URL(url, location.origin).pathname.match(/^\/shorts\/([^/?#]+)/);
    return m ? m[1] : null;
  }
  function onShorts() { return !!shortsId(location.href); }
  function usage() { return settings.resetMode === 'daily' ? daily : sess; }
  function save() {
    chrome.storage.local.set({ daily: { ...daily, from: TAB }, session: { ...sess, from: TAB } });
  }
  function checkDay() {
    if (daily.day !== dayKey()) { daily = freshDaily(); save(); }
  }
  function overUsage() {
    const u = usage();
    return settings.limitType === 'time' ? u.seconds >= settings.minutes * 60 : u.count >= settings.limit;
  }
  function blockReason() {
    if (sess.openBlocked && settings.opensOn) return 'opens';
    if (overUsage()) return 'usage';
    return null;
  }
  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
  }

  // ---------- ブロック画面 ----------
  function texts(reason) {
    const next = `明日の${settings.resetHour}時にリセットされます。`;
    if (reason === 'opens') {
      return { title: '今日のショートはここまで', body: `今日ショートを開ける回数（${settings.maxOpens}回）を使い切りました。<br>${next}` };
    }
    const what = settings.limitType === 'time'
      ? `ショートの視聴時間が上限（${settings.minutes}分）に達しました。`
      : `ショートのスクロールが上限（${settings.limit}回）に達しました。`;
    if (settings.resetMode === 'daily') return { title: '今日のショートはここまで', body: `${what}<br>${next}` };
    let body = what;
    if (settings.opensOn) {
      const left = Math.max(0, settings.maxOpens - daily.opens);
      body += left > 0 ? `<br>今日はあと${left}回ショートを開けます。` : `<br>今日開ける回数はもう残っていません。`;
    }
    return { title: 'ショートはここまで', body };
  }
  function showOverlay(reason) {
    const t = texts(reason);
    const key = t.title + t.body;
    if (overlay && document.documentElement.contains(overlay) && overlayKey === key) return;
    if (overlay) overlay.remove();
    overlay = document.createElement('div');
    overlay.id = 'ysl-overlay';
    overlay.innerHTML = `
      <div class="ysl-card">
        <div class="ysl-icon">⏸</div>
        <h1 class="ysl-title">${t.title}</h1>
        <p class="ysl-text">${t.body}</p>
        <button type="button" class="ysl-home">ホームへ戻る</button>
      </div>`;
    overlayKey = key;
    overlay.querySelector('.ysl-home').addEventListener('click', goHome);
    (document.body || document.documentElement).appendChild(overlay);
    document.documentElement.classList.add('ysl-locked');
    pauseAll();
    clearInterval(pauseTimer);
    pauseTimer = setInterval(pauseAll, 300);
  }
  function hideOverlay() {
    clearInterval(pauseTimer);
    pauseTimer = null;
    if (overlay) overlay.remove();
    overlay = null;
    overlayKey = '';
    document.documentElement.classList.remove('ysl-locked');
  }
  function pauseAll() {
    document.querySelectorAll('video').forEach((v) => { if (!v.paused) v.pause(); v.muted = true; });
  }
  function goHome() { hideOverlay(); location.href = 'https://www.youtube.com/'; }

  // 右下の残り表示
  function updateBadge(reason) {
    if (!onShorts() || reason) { if (badge) badge.remove(); badge = null; return; }
    if (!badge || !document.documentElement.contains(badge)) {
      badge = document.createElement('div');
      badge.id = 'ysl-badge';
      (document.body || document.documentElement).appendChild(badge);
    }
    const u = usage();
    let text = settings.limitType === 'time'
      ? `残り ${fmt(settings.minutes * 60 - u.seconds)}`
      : `残り ${Math.max(0, settings.limit - u.count)} スクロール`;
    if (settings.opensOn) text += ` ・ 今日あと${Math.max(0, settings.maxOpens - daily.opens)}回開けます`;
    badge.textContent = text;
  }

  function apply() {
    const reason = onShorts() ? blockReason() : null;
    if (reason) showOverlay(reason); else hideOverlay();
    updateBadge(reason);
  }

  // ブロック中はスクロール・キー操作を止める
  function swallow(e) {
    if (!overlay) return;
    if (e.type === 'keydown') {
      if (e.target && overlay.contains(e.target) && (e.key === 'Enter' || e.key === ' ')) return;
      if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ', 'j', 'k', 'Home', 'End'].includes(e.key)) return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  ['wheel', 'touchmove', 'keydown'].forEach((t) =>
    window.addEventListener(t, swallow, { capture: true, passive: false }));

  // ---------- URL の変化を監視 ----------
  let lastUrl = null;
  function onUrl() {
    if (!ready || location.href === lastUrl) return;
    lastUrl = location.href;
    checkDay();
    const id = shortsId(location.href);
    if (!id) { lastId = null; apply(); return; }

    if (!lastId) {
      // ショートを新しく開いた（ホームなどから / 直接開いた）
      sess = freshSess();
      daily.opens += 1;
      if (settings.opensOn && daily.opens > settings.maxOpens) sess.openBlocked = true;
      save();
    } else if (lastId !== id && settings.limitType === 'count' && !blockReason()) {
      // 別のショートへ移動 = 1スクロール
      sess.count += 1;
      if (settings.resetMode === 'daily') daily.count += 1;
      save();
    }
    lastId = id;
    apply();
  }

  // ---------- 視聴時間のカウント ----------
  function onTick() {
    if (!ready) return;
    checkDay();
    if (settings.limitType === 'time' && onShorts() && !blockReason() && document.visibilityState === 'visible') {
      sess.seconds += 1;
      if (settings.resetMode === 'daily') daily.seconds += 1;
      if (++tick % 3 === 0 || overUsage()) save();
    }
    apply();
  }

  function start() {
    ready = true;
    onUrl();
    document.addEventListener('yt-navigate-finish', onUrl);
    window.addEventListener('popstate', onUrl);
    setInterval(onUrl, 400);
    setInterval(onTick, 1000);
  }

  chrome.storage.local.get(['settings', 'daily'], (r) => {
    settings = { ...DEFAULTS, ...(r.settings || {}) };
    daily = r.daily && r.daily.day === dayKey() ? { ...freshDaily(), ...r.daily } : freshDaily();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.settings) {
      settings = { ...DEFAULTS, ...(ch.settings.newValue || {}) };
      if (settings.opensOn && daily.opens <= settings.maxOpens) sess.openBlocked = false;
      if (!settings.opensOn) sess.openBlocked = false;
    }
    const nv = ch.daily && ch.daily.newValue;
    if (nv && nv.from !== TAB) {
      if (nv.from === 'popup') {
        daily = freshDaily();
        sess = freshSess();
      } else if (nv.day === dayKey()) {
        // 他のタブと 1日の合計を共有
        if (daily.day !== nv.day) daily = freshDaily();
        daily.opens = Math.max(daily.opens, nv.opens || 0);
        daily.count = Math.max(daily.count, nv.count || 0);
        daily.seconds = Math.max(daily.seconds, nv.seconds || 0);
      }
    }
    if (ready) apply();
  });
})();
