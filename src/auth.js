'use strict';
/**
 * 鉴权：scrypt 密码哈希 + 内存会话（重启后需重新登录；会员状态持久化在 users.json）。
 */
const crypto = require('crypto');
const store = require('./store');

const sessions = new Map(); // token -> { userId, expires }
const SESSION_TTL = 7 * 24 * 3600 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, hash) {
  const h = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(hash));
}

function createSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { userId, expires: Date.now() + SESSION_TTL });
  return token;
}
function destroySession(token) { if (token) sessions.delete(token); }

function userFromToken(token) {
  if (!token) return null;
  const s = sessions.get(token);
  if (!s) return null;
  if (s.expires < Date.now()) { sessions.delete(token); return null; }
  return store.findUserById(s.userId) || null;
}

// 解析 Cookie
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach(c => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

// 请求级中间件：把当前登录用户挂到 req.user
function attachUser(req, res, next) {
  const cookies = parseCookies(req);
  req.user = userFromToken(cookies.sid) || null;
  next();
}

function isMember(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!user.isMember) return false;
  if (user.memberUntil && new Date(user.memberUntil) < new Date()) return false;
  return true;
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ ok: false, msg: '请先登录' });
  next();
}

module.exports = {
  hashPassword, verifyPassword, createSession, destroySession,
  attachUser, isMember, requireAuth
};
