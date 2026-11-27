// ショート制限 for YouTube - content script
(() => {
  'use strict';

  // limitType : 'count'（スクロール回数）| 'time'（視聴時間）
  // resetMode : 'open'（ショートを開くたびにリセット）| 'daily'（1日の合計で制限）
  // opensOn / maxOpens : 1日にショートを開ける回数の上限
  // resetHour : 1日の区切りの時刻
  const DEFAULTS = { limitType: 'count', limit: 3, minutes: 5, resetMode: 'open', opensOn: false, maxOpens: 3, resetHour: 4 };
  const HISTORY_DAYS = 30;
  const TAB = Math.random().toString(36).slice(2);
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
  let settings = { ...DEFAULTS };
  let sess = freshSess();   // このタブの今回のセッション（開くたびモード用）
  let daily = freshDaily(); // 1日の合計（全タブで共有）。views / watch は記録用で、制限には使わない
  let lastId = null;        // このタブで直前に見ていたショート
  let overlay = null, overlayKey = '', badge = null, pauseTimer = null, ready = false, tick = 0;

  function freshSess() { return { count: 0, seconds: 0, openBlocked: false }; }
  function freshDaily() { return { day: dayKey(), opens: 0, count: 0, seconds: 0, views: 0, watch: 0 }; }
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
  function alive() { return !!(chrome.runtime && chrome.runtime.id); } // 拡張機能の更新後は古いスクリプトを止める
  function save() {
    if (!alive()) return;
    chrome.storage.local.set({ daily: { ...daily, from: TAB }, session: { ...sess, from: TAB } });
  }
  // 日付が変わったら前日の記録を履歴に残す
  function archive(d) {
    if (!alive() || !d || !d.day || !(d.views || d.watch || d.opens)) return;
    chrome.storage.local.get('history', (r) => {
      const h = r.history || {};
      const old = h[d.day] || {};
      h[d.day] = {
        views: Math.max(old.views || 0, d.views || 0),
        watch: Math.max(old.watch || 0, d.watch || 0),
        opens: Math.max(old.opens || 0, d.opens || 0),
        at: Date.now(),
      };
      const keys = Object.keys(h).sort((a, b) => h[b].at - h[a].at);
      keys.slice(HISTORY_DAYS).forEach((k) => delete h[k]);
      chrome.storage.local.set({ history: h });
    });
  }
  function checkDay() {
    if (daily.day !== dayKey()) { archive(daily); daily = freshDaily(); save(); }
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
    const next = new Date().getHours() < settings.resetHour
      ? t('resetsToday', settings.resetHour) : t('resetsTomorrow', settings.resetHour);
    if (reason === 'opens') return { title: t('titleToday'), lines: [t('opensUsedUp', settings.maxOpens), next] };
    const what = settings.limitType === 'time' ? t('timeReached', settings.minutes) : t('countReached', settings.limit);
    if (settings.resetMode === 'daily') return { title: t('titleToday'), lines: [what, next] };
    const lines = [what];
    if (settings.opensOn) {
      const left = Math.max(0, settings.maxOpens - daily.opens);
      lines.push(left > 0 ? t('opensLeft', left) : t('opensNone'));
    }
    return { title: t('titleSession'), lines };
  }
  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function showOverlay(reason) {
    const tx = texts(reason);
    const key = tx.title + tx.lines.join('\n');
    if (overlay && document.documentElement.contains(overlay) && overlayKey === key) return;
    if (overlay) overlay.remove();
    overlay = el('div');
    overlay.id = 'ysl-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    const card = el('div', 'ysl-card');
    card.appendChild(el('div', 'ysl-icon', '⏳'));
    card.appendChild(el('h1', 'ysl-title', tx.title));
    const p = el('p', 'ysl-text');
    tx.lines.forEach((line, i) => { if (i) p.appendChild(document.createElement('br')); p.appendChild(document.createTextNode(line)); });
    card.appendChild(p);
    const btn = el('button', 'ysl-home', t('goHome'));
    btn.type = 'button';
    btn.addEventListener('click', goHome);
    card.appendChild(btn);
    overlay.appendChild(card);
    overlayKey = key;
    (document.body || document.documentElement).appendChild(overlay);
    document.documentElement.classList.add('ysl-locked');
    btn.focus({ preventScroll: true });
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
  function goHome() { hideOverlay(); location.href = location.origin + '/'; }

  // 右下の残り表示（残りわずかになると色が変わる）
  function updateBadge(reason) {
    if (!onShorts() || reason) { if (badge) badge.remove(); badge = null; return; }
    if (!badge || !document.documentElement.contains(badge)) {
      badge = el('div');
      badge.id = 'ysl-badge';
      (document.body || document.documentElement).appendChild(badge);
    }
    const u = usage();
    let text, warn;
    if (settings.limitType === 'time') {
      const left = settings.minutes * 60 - u.seconds;
      text = t('badgeTime', fmt(left));
      warn = left <= 60;
    } else {
      const left = Math.max(0, settings.limit - u.count);
      text = t('badgeCount', left);
      warn = left <= 1;
    }
    if (settings.opensOn) text += ' · ' + t('badgeOpens', Math.max(0, settings.maxOpens - daily.opens));
    badge.textContent = text;
    badge.classList.toggle('ysl-warn', warn);
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
      if (e.target && overlay.contains(e.target) && (e.key === 'Enter' || e.key === ' ' || e.key === 'Tab')) return;
      if (!['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', ' ', 'j', 'k', 'Home', 'End'].includes(e.key)) return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
  }
  ['wheel', 'touchmove', 'keydown'].forEach((type) =>
    window.addEventListener(type, swallow, { capture: true, passive: false }));

  // ---------- URL の変化を監視 ----------
  let lastUrl = null;
  function onUrl() {
    if (!ready || !alive() || location.href === lastUrl) return;
    lastUrl = location.href;
    checkDay();
    const id = shortsId(location.href);
    if (!id) { lastId = null; apply(); return; }

    if (!lastId) {
      // ショートを新しく開いた（ホームなどから / 直接開いた）
      sess = freshSess();
      daily.opens += 1;
      if (settings.opensOn && daily.opens > settings.maxOpens) sess.openBlocked = true;
      if (!blockReason()) daily.views += 1;
      save();
    } else if (lastId !== id && !blockReason()) {
      // 別のショートへ移動 = 1スクロール
      daily.views += 1;
      if (settings.limitType === 'count') {
        sess.count += 1;
        if (settings.resetMode === 'daily') daily.count += 1;
      }
      save();
    }
    lastId = id;
    apply();
  }

  // ---------- 視聴時間のカウント ----------
  function onTick() {
    if (!ready || !alive()) return;
    checkDay();
    if (onShorts() && !blockReason() && document.visibilityState === 'visible') {
      daily.watch += 1;
      if (settings.limitType === 'time') {
        sess.seconds += 1;
        if (settings.resetMode === 'daily') daily.seconds += 1;
      }
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
    if (r.daily && r.daily.day && r.daily.day !== dayKey()) archive(r.daily);
    daily = r.daily && r.daily.day === dayKey() ? { ...freshDaily(), ...r.daily } : freshDaily();
    delete daily.from;
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
    else start();
  });

  chrome.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local') return;
    if (ch.settings) {
      settings = { ...DEFAULTS, ...(ch.settings.newValue || {}) };
      if (!settings.opensOn || daily.opens <= settings.maxOpens) sess.openBlocked = false;
    }
    const nv = ch.daily && ch.daily.newValue;
    if (nv && nv.from !== TAB) {
      if (nv.from === 'popup') {
        // 設定画面の「今すぐリセット」: 制限のカウントだけ戻し、今日の記録は残す
        const keep = { views: Math.max(daily.views, nv.views || 0), watch: Math.max(daily.watch, nv.watch || 0) };
        daily = { ...freshDaily(), ...keep };
        sess = freshSess();
      } else if (nv.day === dayKey()) {
        // 他のタブと 1日の合計を共有
        if (daily.day !== nv.day) daily = freshDaily();
        ['opens', 'count', 'seconds', 'views', 'watch'].forEach((k) => { daily[k] = Math.max(daily[k] || 0, nv[k] || 0); });
      }
    }
    if (ready) apply();
  });
})();
