'use strict';
/**
 * 统一数据目录解析。
 * 默认：项目内 ./data
 * 生产（Render 等）：用环境变量 DATA_DIR 指向持久盘挂载点，例如 /var/data
 * 这样重启/重新部署不会丢失用户、会员、文章与统计。
 */
const path = require('path');

const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', 'data');

const FILES = {
  users: path.join(DATA_DIR, 'users.json'),
  articles: path.join(DATA_DIR, 'articles.json'),
  orders: path.join(DATA_DIR, 'orders.json'),
  settings: path.join(DATA_DIR, 'settings.json'),
  analytics: path.join(DATA_DIR, 'analytics.json'),
  automationLog: path.join(DATA_DIR, 'automation.log')
};

module.exports = { DATA_DIR, FILES };
