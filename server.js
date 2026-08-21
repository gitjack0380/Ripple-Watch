'use strict';
const express = require('express');
const path = require('path');
const config = require('./src/config');
const store = require('./src/store');
const auth = require('./src/auth');
const wechatPay = require('./src/wechatPay');
const ads = require('./src/ads');
const settings = require('./src/settings');
const scheduler = require('./src/scheduler');
const analytics = require('./src/analytics');
const { seedIfEmpty } = require('./src/seed');

seedIfEmpty();

// 预置超级管理员账号（验收用；上线前请在 data/users.json 删除或改密）
function ensureAdmin() {
  const ADMIN_ACCOUNT = 'admin';
  const ADMIN_PW = 'Admin@888';
  if (!store.findUserByAccount(ADMIN_ACCOUNT)) {
    const { salt, hash } = auth.hashPassword(ADMIN_PW);
    store.addUser({
      id: 'Uadmin', account: ADMIN_ACCOUNT, salt, hash, role: 'admin',
      isMember: true, memberUntil: null, plan: 'admin',
      dailyFreeUsed: 0, lastFreeDate: todayStr(), createdAt: new Date().toISOString()
    });
    console.log('[init] 已创建超级管理员账号  admin / ' + ADMIN_PW + '（上线前务必改密或删除）');
  }
}
ensureAdmin();


const app = express();
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', true); // Render 等代理下正确取客户端 IP
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(auth.attachUser);

// 访问统计（跳过静态资源与 API，仅统计页面浏览）
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/assets') && !req.path.startsWith('/api')) {
    try { analytics.trackPageView(req, res); } catch (e) {}
  }
  next();
});

// 工具：今天日期串（本地）
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function impactClass(t) { return t; } // red/green/amber

// 公共渲染数据（前端只暴露安全子集，敏感字段如 adminKey/wechatPay 不传出）
function baseData(req) {
  const pm = (config.payment && config.payment.mode) || 'wechat';
  return {
    siteName: config.siteName,
    siteSlogan: config.siteSlogan,
    user: req.user,
    isMember: auth.isMember(req.user),
    isAdmin: !!(req.user && req.user.role === 'admin'),
    cfg: {
      freeDailyLimit: config.freeDailyLimit,
      plans: config.plans,
      testMode: config.testMode,
      paymentMode: pm,
      paymentExternal: (config.payment && config.payment.external) || null
    }
  };
}

// 仅超级管理员可调用的 API
function requireAdmin(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  return res.status(403).json({ ok: false, msg: '需要管理员权限' });
}

// 后台页面：超级管理员登录 或 ?key= 密钥
function requireAdminOrKey(req, res, next) {
  if (req.user && req.user.role === 'admin') return next();
  // 注：仓库公开部署时 config.adminKey 留空，key 机制自动失效，仅管理员登录可进后台
  const key = (req.query.key || '');
  const keyOk = !!config.adminKey && key === config.adminKey;
  if (keyOk) return next();
  return res.status(403).send('管理后台需要管理员登录');
}

/* ---------------- 页面路由 ---------------- */

// 首页
app.get('/', (req, res) => {
  const articles = store.getArticles().sort((a, b) => (a.date < b.date ? 1 : -1));
  const hero = articles[0] || null;
  const feed = articles.slice(1);
  res.render('index', Object.assign(baseData(req), { hero, feed, adHtml: ads.adHtml }));
});

// 栏目页
app.get('/category/:cat?', (req, res) => {
  const cat = req.params.cat;
  let list = store.getArticles().sort((a, b) => (a.date < b.date ? 1 : -1));
  if (cat) list = list.filter(a => a.category === cat);
  res.render('category', Object.assign(baseData(req), { cat: cat || '全部', list, adHtml: ads.adHtml }));
});

// 文章详情（服务端强制付费墙）
app.get('/article/:id', (req, res) => {
  const art = store.findArticle(req.params.id);
  if (!art) return res.status(404).render('error', Object.assign(baseData(req), { msg: '文章不存在' }));
  store.updateArticleViews = store.updateArticleViews; // noop guard
  // 访问计数
  const all = store.getArticles();
  const i = all.findIndex(a => (a.id === art.id || a.slug === art.id));
  if (i >= 0) { all[i].views = (all[i].views || 0) + 1; store.saveArticles(all); }

  let unlocked = true;
  let reason = '';
  if (art.isPremium && !auth.isMember(req.user)) {
    if (req.user) {
      const u = req.user;
      const t = todayStr();
      if (u.lastFreeDate !== t) { u.dailyFreeUsed = 0; u.lastFreeDate = t; }
      if ((u.dailyFreeUsed || 0) < config.freeDailyLimit) {
        u.dailyFreeUsed = (u.dailyFreeUsed || 0) + 1;
        store.updateUser(u.id, { dailyFreeUsed: u.dailyFreeUsed, lastFreeDate: u.lastFreeDate });
        unlocked = true;
      } else {
        unlocked = false; reason = 'dailyLimit';
      }
    } else {
      unlocked = false; reason = 'login';
    }
  }

  res.render('article', Object.assign(baseData(req), {
    art, unlocked, reason, adHtml: ads.adHtml,
    freeDailyLimit: config.freeDailyLimit,
    dailyFreeUsed: req.user ? (req.user.dailyFreeUsed || 0) : 0
  }));
});

// 会员页
app.get('/membership', (req, res) => {
  res.render('membership', Object.assign(baseData(req), { plans: config.plans, adHtml: ads.adHtml }));
});

// 关于
app.get('/about', (req, res) => {
  res.render('about', Object.assign(baseData(req), { adHtml: ads.adHtml, articleCount: store.getArticles().length }));
});

// 登录/注册页
app.get('/login', (req, res) => {
  res.render('login', Object.assign(baseData(req), { next: req.query.next || '/membership' }));
});

// 管理后台（超级管理员账号登录 或 ?key= 密钥），多页面 + 竖版导航
app.get('/admin', requireAdminOrKey, (req, res) => {
  const stats = analytics.getStats();
  const s = settings.getSettings();
  res.render('admin/dashboard', Object.assign(baseData(req), {
    page: 'dashboard', cats: ['时政', '经济', '科技', '气候', '生活'],
    stats, totalUsers: store.getUsers().length, totalArticles: store.getArticles().length,
    activeProvider: (s.llm.providers.find(p => p.id === s.llm.activeProviderId) || {}).name || '—'
  }));
});

app.get('/admin/articles', requireAdminOrKey, (req, res) => {
  const s = settings.getSettings();
  res.render('admin/articles', Object.assign(baseData(req), {
    page: 'articles', cats: ['时政', '经济', '科技', '气候', '生活'],
    articles: store.getArticles().sort((a, b) => (a.date < b.date ? 1 : -1))
  }));
});

app.get('/admin/automation', requireAdminOrKey, (req, res) => {
  const s = settings.getSettings();
  res.render('admin/automation', Object.assign(baseData(req), {
    page: 'automation', cats: ['时政', '经济', '科技', '气候', '生活'],
    settings: s
  }));
});

app.get('/admin/users', requireAdminOrKey, (req, res) => {
  const users = store.getUsers().map(u => ({
    id: u.id, account: u.account, role: u.role, isMember: auth.isMember(u),
    memberUntil: u.memberUntil || '', createdAt: u.createdAt || '', plan: u.plan || ''
  }));
  res.render('admin/users', Object.assign(baseData(req), { page: 'users', users }));
});

app.get('/admin/compliance', requireAdminOrKey, (req, res) => {
  const s = settings.getSettings();
  res.render('admin/compliance', Object.assign(baseData(req), { page: 'compliance', compliance: s.compliance || {} }));
});

// 合规页（公开）
app.get('/privacy', (req, res) => {
  const s = settings.getSettings();
  res.render('compliance', Object.assign(baseData(req), { title: '隐私政策', html: (s.compliance && s.compliance.privacyHtml) || '' }));
});
app.get('/terms', (req, res) => {
  const s = settings.getSettings();
  res.render('compliance', Object.assign(baseData(req), { title: '用户协议', html: (s.compliance && s.compliance.termsHtml) || '' }));
});
app.get('/ad-disclosure', (req, res) => {
  const s = settings.getSettings();
  res.render('compliance', Object.assign(baseData(req), { title: '广告与标识', html: (s.compliance && s.compliance.adHtml) || '' }));
});

/* ---------------- API ---------------- */

app.post('/api/register', (req, res) => {
  const { account, password } = req.body || {};
  if (!account || !password || password.length < 6) return res.status(400).json({ ok: false, msg: '账号与密码(≥6位)必填' });
  if (store.findUserByAccount(account)) return res.status(409).json({ ok: false, msg: '该账号已注册' });
  const { salt, hash } = auth.hashPassword(password);
  const user = store.addUser({
    id: 'U' + Date.now(), account, salt, hash, role: 'user',
    isMember: false, memberUntil: null, plan: null,
    dailyFreeUsed: 0, lastFreeDate: todayStr(), createdAt: new Date().toISOString()
  });
  const token = auth.createSession(user.id);
  analytics.trackSignup(user.id);
  res.cookie('sid', token, { httpOnly: true, maxAge: 7 * 86400000 });
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { account, password } = req.body || {};
  const user = store.findUserByAccount(account);
  if (!user || !auth.verifyPassword(password, user.salt, user.hash)) {
    return res.status(401).json({ ok: false, msg: '账号或密码错误' });
  }
  const token = auth.createSession(user.id);
  analytics.trackLogin(user.id, user.account, req.ip);
  res.cookie('sid', token, { httpOnly: true, maxAge: 7 * 86400000 });
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/logout', (req, res) => {
  const c = req.headers.cookie || '';
  const m = c.match(/sid=([^;]+)/);
  if (m) auth.destroySession(m[1]);
  res.clearCookie('sid');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ ok: true, user: req.user ? publicUser(req.user) : null, isMember: auth.isMember(req.user) });
});

// 订阅/下单（按 payment.mode 分流：external 跳转第三方 / wechat 走微信支付）
app.post('/api/subscribe', auth.requireAuth, (req, res) => {
  const { plan } = req.body || {};
  const mode = (config.payment && config.payment.mode) || 'wechat';
  try {
    if (mode === 'external') {
      const ext = (config.payment && config.payment.external) || {};
      const base = (plan === 'year' && ext.yearUrl) ? ext.yearUrl
                 : (plan === 'month' && ext.monthUrl) ? ext.monthUrl
                 : ext.shopUrl;
      if (!base) {
        return res.status(400).json({ ok: false, msg: '第三方店铺尚未配置：请在 config.json 的 payment.external 填写小鹅通/有赞店铺或商品页地址' });
      }
      const siteBase = config.siteUrl || `${req.protocol}://${req.get('host')}`;
      const token = wechatPay.makeReturnToken(req.user.id, plan);
      const returnUrl = `${siteBase}${ext.returnPath || '/member/return'}?token=${token}&plan=${plan}`;
      const payUrl = base + (base.includes('?') ? '&' : '?') + 'redirect=' + encodeURIComponent(returnUrl);
      return res.json({ ok: true, mode: 'external', payUrl });
    }
    // wechat 模式
    const result = wechatPay.createOrder({ userId: req.user.id, plan });
    if (result.test) {
      return res.json({ ok: true, mode: 'wechat', test: true, paid: true, msg: '测试模式：已模拟支付成功，你已成为会员', user: publicUser(store.findUserById(req.user.id)) });
    }
    return res.json({ ok: true, mode: 'wechat', test: false, paid: false, codeUrl: result.codeUrl, orderId: result.order.id });
  } catch (e) {
    return res.status(400).json({ ok: false, msg: e.message });
  }
});

// 第三方支付回跳：校验令牌自动开通会员；或演示态（demoActivate）对登录用户直接开通
function activateMemberByToken(token, req, res) {
  const info = wechatPay.redeemReturnToken(token);
  if (info) {
    const user = store.findUserById(info.userId);
    if (!user) return res.status(400).render('error', Object.assign(baseData(req), { msg: '用户不存在' }));
    return grantMember(user, info.plan, 'external', res, req);
  }
  // 无 token：演示态允许（仅本地验收，上线务必关闭 demoActivate 并接平台 API）
  const ext = (config.payment && config.payment.external) || {};
  if (ext.demoActivate && req.user && !auth.isMember(req.user)) {
    return grantMember(req.user, 'month', 'external-demo', res, req);
  }
  return res.status(400).render('error', Object.assign(baseData(req), {
    msg: '缺少有效激活令牌。请通过会员页"去小鹅通开通"按钮进入并完成购买，支付成功后会自动跳回此处激活；若未自动跳回，请在小鹅通订单中复制订单号联系客服。'
  }));
}
function grantMember(user, plan, source, res, req) {
  const p = config.plans[plan] || config.plans.month;
  const until = new Date(Date.now() + p.days * 86400000).toISOString();
  store.updateUser(user.id, { isMember: true, memberUntil: until, plan: p.id, paySource: source });
  return res.redirect('/membership?activated=1');
}

app.get('/member/return', (req, res) => {
  activateMemberByToken(req.query.token, req, res);
});

app.post('/api/activate', auth.requireAuth, (req, res) => {
  const { token } = req.body || {};
  const ext = (config.payment && config.payment.external) || {};
  if (token) {
    const info = wechatPay.redeemReturnToken(token);
    if (!info || info.userId !== req.user.id) return res.status(400).json({ ok: false, msg: '激活令牌无效或不属于当前账号' });
    const p = config.plans[info.plan] || config.plans.month;
    const until = new Date(Date.now() + p.days * 86400000).toISOString();
    store.updateUser(req.user.id, { isMember: true, memberUntil: until, plan: p.id, paySource: 'external' });
    return res.json({ ok: true, msg: '会员已激活' });
  }
  if (ext.demoActivate) {
    const p = config.plans.month;
    const until = new Date(Date.now() + p.days * 86400000).toISOString();
    store.updateUser(req.user.id, { isMember: true, memberUntil: until, plan: 'month', paySource: 'external-demo' });
    return res.json({ ok: true, msg: '演示激活成功' });
  }
  return res.status(400).json({ ok: false, msg: '需要激活令牌或平台 API 对接' });
});

// 订单轮询
app.get('/api/order/:id', (req, res) => {
  const o = wechatPay.getOrder(req.params.id);
  if (!o) return res.status(404).json({ ok: false, msg: '订单不存在' });
  res.json({ ok: true, status: o.status, paid: o.status === 'paid' });
});

// 微信支付异步通知（正式模式）
app.post('/api/wechat/notify', express.raw({ type: 'application/json' }), (req, res) => {
  try {
    const body = JSON.parse(req.body.toString());
    // 此处应先用平台证书验签 + 解密 resource，再标记订单已支付。
    // 见 src/wechatPay.js verifyNotify 与微信文档。
    const outTradeNo = body.out_trade_no;
    const order = store.getOrders().find(o => o.outTradeNo === outTradeNo);
    if (order && order.status !== 'paid') {
      wechatPay.completeOrderAsPaid(order);
    }
    res.json({ code: 'SUCCESS', message: '成功' });
  } catch (e) {
    res.status(400).json({ code: 'FAIL', message: e.message });
  }
});

// 管理：发布文章（超级管理员账号登录 或 ?key= 密钥）
app.post('/api/admin/article', (req, res) => {
  const key = req.query.key || req.body.key || '';
  const isAdminUser = req.user && req.user.role === 'admin';
  if (key !== config.adminKey && !isAdminUser) return res.status(403).json({ ok: false, msg: '密钥错误' });
  const { title, category, lead, freeHtml, premiumHtml, impacts, isPremium } = req.body || {};
  if (!title || !category) return res.status(400).json({ ok: false, msg: '标题与栏目必填' });
  let imp = [];
  try { imp = impacts ? JSON.parse(impacts) : []; } catch (e) { imp = []; }
  const art = store.addArticle({
    id: 'a' + Date.now(), slug: 'art-' + Date.now(),
    category, author: '涟漪观察', date: todayStr(),
    title, lead: lead || '', isPremium: !!isPremium, views: 0,
    freeHtml: freeHtml || '', premiumHtml: premiumHtml || '',
    impacts: imp.length ? imp : [{ t: 'amber', l: '影响' }]
  });
  res.json({ ok: true, article: art });
});

function publicUser(u) {
  return {
    id: u.id, account: u.account, isMember: auth.isMember(u),
    memberUntil: u.memberUntil, plan: u.plan,
    dailyFreeUsed: u.dailyFreeUsed || 0
  };
}

/* ---------------- 自动化设置（仅管理员） ---------------- */

// 读取设置（API Key 脱敏为 ***）
app.get('/api/admin/settings', requireAdmin, (req, res) => {
  const s = settings.getSettings();
  const out = JSON.parse(JSON.stringify(s));
  (out.llm.providers || []).forEach(p => { if (p.apiKey) p.apiKey = '***'; });
  res.json({ ok: true, settings: out });
});

// 保存设置（自动化/ RSS / LLM 提供商）
app.post('/api/admin/settings', requireAdmin, (req, res) => {
  const patch = req.body || {};
  const cur = settings.getSettings();
  const allowed = {};
  if (patch.automation) allowed.automation = patch.automation;
  if (patch.rss) allowed.rss = patch.rss;
  if (patch.llm) {
    const llmPatch = { activeProviderId: patch.llm.activeProviderId || cur.llm.activeProviderId, providers: [] };
    (patch.llm.providers || []).forEach(p => {
      const ex = (cur.llm.providers || []).find(x => x.id === p.id);
      let apiKey = p.apiKey;
      if (apiKey === '***' && ex) apiKey = ex.apiKey; // 未改动则保留原值
      llmPatch.providers.push({
        id: p.id || ('p' + Date.now() + Math.random().toString(36).slice(2, 4)),
        name: p.name || '未命名提供商',
        type: p.type || 'openai-compatible',
        baseUrl: p.baseUrl || '',
        apiKey: apiKey || '',
        model: p.model || '',
        enabled: p.enabled !== false
      });
    });
    allowed.llm = llmPatch;
  }
  const saved = settings.updateSettings(allowed);
  scheduler.startScheduler(); // 重新按新调度规则排程
  const out = JSON.parse(JSON.stringify(saved));
  (out.llm.providers || []).forEach(p => { if (p.apiKey) p.apiKey = '***'; });
  res.json({ ok: true, settings: out });
});

// 单独添加提供商（即时反馈，不必依赖"保存全部设置"）
app.post('/api/admin/provider', requireAdmin, (req, res) => {
  const b = req.body || {};
  const cur = settings.getSettings();
  const id = 'p' + Date.now().toString(36);
  const prov = {
    id,
    name: (b.name || '新提供商').trim(),
    type: b.type || 'openai-compatible',
    baseUrl: (b.baseUrl || '').trim(),
    apiKey: b.apiKey || '',
    model: (b.model || '').trim(),
    enabled: b.enabled !== false
  };
  const providers = (cur.llm.providers || []).map(p => Object.assign({}, p));
  providers.push(prov);
  const patch = { llm: { activeProviderId: b.setDefault ? id : cur.llm.activeProviderId, providers } };
  const saved = settings.updateSettings(patch);
  const out = JSON.parse(JSON.stringify(saved));
  (out.llm.providers || []).forEach(p => { if (p.apiKey) p.apiKey = '***'; });
  res.json({ ok: true, settings: out, addedId: id });
});

// 删除提供商（mock 演示模型禁止删除）
app.delete('/api/admin/provider/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  if (id === 'mock') return res.status(400).json({ ok: false, msg: '演示模型不可删除' });
  const cur = settings.getSettings();
  const providers = (cur.llm.providers || []).filter(p => p.id !== id);
  let activeProviderId = cur.llm.activeProviderId;
  if (activeProviderId === id) activeProviderId = (providers.find(p => p.enabled) || {}).id || 'mock';
  const saved = settings.updateSettings({ llm: { activeProviderId, providers } });
  const out = JSON.parse(JSON.stringify(saved));
  (out.llm.providers || []).forEach(p => { if (p.apiKey) p.apiKey = '***'; });
  res.json({ ok: true, settings: out });
});

// 立即运行一次（绕过时间窗，用于验收）
app.post('/api/admin/run-once', requireAdmin, async (req, res) => {
  try {
    const r = await scheduler.runPipeline();
    res.json(Object.assign({ ok: true }, r));
  } catch (e) {
    res.status(500).json({ ok: false, msg: e.message });
  }
});

// 运行日志
app.get('/api/admin/automation-log', requireAdmin, (req, res) => {
  res.json({ ok: true,  log: scheduler.getRecentLog(60) });
});

// 统计数据
app.get('/api/admin/analytics', requireAdmin, (req, res) => {
  const stats = analytics.getStats();
  stats.totalUsers = store.getUsers().length;
  stats.totalArticles = store.getArticles().length;
  res.json({ ok: true, stats });
});

// 文章列表（后台）
app.get('/api/admin/articles', requireAdmin, (req, res) => {
  res.json({ ok: true, articles: store.getArticles().sort((a, b) => (a.date < b.date ? 1 : -1)) });
});

// 删除文章
app.delete('/api/admin/article/:id', requireAdmin, (req, res) => {
  const id = req.params.id;
  const list = store.getArticles();
  const next = list.filter(a => a.id !== id && a.slug !== id);
  if (next.length === list.length) return res.status(404).json({ ok: false, msg: '文章不存在' });
  store.saveArticles(next);
  res.json({ ok: true, count: next.length });
});

// 保存合规页内容
app.post('/api/admin/compliance', requireAdmin, (req, res) => {
  const b = req.body || {};
  const patch = { compliance: {} };
  if (typeof b.privacyHtml === 'string') patch.compliance.privacyHtml = b.privacyHtml;
  if (typeof b.termsHtml === 'string') patch.compliance.termsHtml = b.termsHtml;
  if (typeof b.adHtml === 'string') patch.compliance.adHtml = b.adHtml;
  const saved = settings.updateSettings(patch);
  res.json({ ok: true, compliance: saved.compliance });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ ok: false, msg: '服务器错误' });
});

const PORT = process.env.PORT || config.port || 3000;
app.listen(PORT, () => {
  console.log(`✅ ${config.siteName} 已启动： http://localhost:${PORT}  (testMode=${config.testMode})`);
  // 启动自动化调度（整点抓取→生成→发布）
  try { scheduler.startScheduler(); } catch (e) { console.error('[scheduler] 启动失败', e.message); }
});
