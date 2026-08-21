'use strict';
/**
 * 简易 JSON 持久化存储（适合 MVP / 单人运营）。
 * 生产可平滑替换为 SQLite / PostgreSQL，接口保持不变。
 */
const fs = require('fs');
const { DATA_DIR, FILES } = require('./paths');

function ensure() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  for (const k in FILES) {
    if (!fs.existsSync(FILES[k])) fs.writeFileSync(FILES[k], '[]', 'utf8');
  }
}
ensure();

function read(key) {
  try { return JSON.parse(fs.readFileSync(FILES[key], 'utf8')); }
  catch (e) { return []; }
}
function write(key, data) {
  fs.writeFileSync(FILES[key], JSON.stringify(data, null, 2), 'utf8');
}

// ---- Users ----
function getUsers() { return read('users'); }
function saveUsers(u) { write('users', u); }
function findUserByAccount(acc) { return getUsers().find(u => u.account === acc); }
function findUserById(id) { return getUsers().find(u => u.id === id); }
function addUser(user) { const u = getUsers(); u.push(user); saveUsers(u); return user; }
function updateUser(id, patch) {
  const u = getUsers();
  const i = u.findIndex(x => x.id === id);
  if (i >= 0) { u[i] = Object.assign({}, u[i], patch); saveUsers(u); return u[i]; }
  return null;
}

// ---- Articles ----
function getArticles() { return read('articles'); }
function saveArticles(a) { write('articles', a); }
function findArticle(id) { return getArticles().find(a => a.id === id || a.slug === id); }
function addArticle(a) { const list = getArticles(); list.unshift(a); saveArticles(list); return a; }

// ---- Orders ----
function getOrders() { return read('orders'); }
function saveOrders(o) { write('orders', o); }
function findOrder(id) { return getOrders().find(o => o.id === id); }
function addOrder(o) { const list = getOrders(); list.push(o); saveOrders(list); return o; }
function updateOrder(id, patch) {
  const list = getOrders();
  const i = list.findIndex(o => o.id === id);
  if (i >= 0) { list[i] = Object.assign({}, list[i], patch); saveOrders(list); return list[i]; }
  return null;
}

module.exports = {
  getUsers, saveUsers, findUserByAccount, findUserById, addUser, updateUser,
  getArticles, saveArticles, findArticle, addArticle,
  getOrders, saveOrders, findOrder, addOrder, updateOrder
};
