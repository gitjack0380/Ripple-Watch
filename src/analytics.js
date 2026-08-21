'use strict';
/**
 * 访问统计：PV / UV / 日活(DAU) / 周活(WAU) / 登录日志。
 * 持久化到 data/analytics.json。单进程内存计数 + 定时落盘，适合千人级 MVP。
 * 如需更高并发/更精确，可平滑替换为 SQLite（store 同类迁移）。
 */
const fs = require('fs');
const crypto = require('crypto');
const { DATA_DIR, FILES } = require('./paths');

const FILE = FILES.analytics;

function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
function todayKey() { return dateKey(new Date()); }

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

function load() {
  ensureDir();
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    raw.daily = raw.daily || {};
    raw.loginLogs = raw.loginLogs || [];
    return raw;
  } catch (e) {
    return { daily: {}, loginLogs: [] };
  }
}

let mem = load();
let dirty = false;

function flush() {
  if (!dirty) return;
  try { fs.writeFileSync(FILE, JSON.stringify(mem)); dirty = false; } catch (e) { /* ignore */ }
}

function ensureDay(key) {
  if (!mem.daily[key]) mem.daily[key] = { pv: 0, visitors: {}, activeUsers: {}, logins: 0, signups: 0 };
  return mem.daily[key];
}

function getVid(req, res) {
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|; )vid=([^;]+)/);
  let vid = m ? m[1] : null;
  if (!vid) {
    vid = crypto.randomUUID();
    res.cookie('vid', vid, { maxAge: 365 * 86400000, httpOnly: true });
  }
  return vid;
}

function trackPageView(req, res) {
  try {
    const vid = getVid(req, res);
    const day = ensureDay(todayKey());
    day.pv = (day.pv || 0) + 1;
    day.visitors[vid] = 1;
    dirty = true;
  } catch (e) { /* 统计失败不影响主流程 */ }
}

function trackLogin(userId, account, ip) {
  try {
    const day = ensureDay(todayKey());
    day.logins = (day.logins || 0) + 1;
    if (userId) day.activeUsers[userId] = 1;
    mem.loginLogs.push({ userId: userId || null, account: account || '(匿名)', time: new Date().toISOString(), ip: ip || '' });
    if (mem.loginLogs.length > 1000) mem.loginLogs = mem.loginLogs.slice(-1000);
    dirty = true;
  } catch (e) { /* ignore */ }
}

function trackSignup(userId) {
  try {
    const day = ensureDay(todayKey());
    day.signups = (day.signups || 0) + 1;
    if (userId) day.activeUsers[userId] = 1;
    dirty = true;
  } catch (e) { /* ignore */ }
}

function getStats() {
  flush();
  const today = todayKey();
  const days = [];
  const wau = new Set();
  let wpv = 0;
  for (let i = 6; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const k = dateKey(d);
    days.push(k);
    const dd = mem.daily[k];
    if (dd) {
      wpv += (dd.pv || 0);
      Object.keys(dd.activeUsers || {}).forEach(x => wau.add(x));
    }
  }
  const t = mem.daily[today] || { pv: 0, visitors: {}, activeUsers: {}, logins: 0, signups: 0 };
  return {
    today: {
      pv: t.pv || 0,
      uv: Object.keys(t.visitors || {}).length,
      dau: Object.keys(t.activeUsers || {}).length,
      logins: t.logins || 0,
      signups: t.signups || 0
    },
    week: { pv: wpv, wau: wau.size },
    recentLogins: (mem.loginLogs || []).slice(-30).reverse()
  };
}

// 定时落盘 + 退出前落盘
try { setInterval(flush, 15000); } catch (e) {}
try {
  process.on('SIGINT', flush);
  process.on('SIGTERM', flush);
} catch (e) {}

module.exports = { trackPageView, trackLogin, trackSignup, getStats, flush };
