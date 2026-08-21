'use strict';
// 管理员验收自测：admin 账号登录、后台访问、发布文章、月卡/年卡链接分流
const BASE = 'http://127.0.0.1:3000';
let pass = 0, fail = 0;
function check(name, cond) {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name); }
}
async function jpost(path, body, cookie) {
  const h = { 'Content-Type': 'application/json' };
  if (cookie) h.Cookie = cookie;
  const r = await fetch(BASE + path, { method: 'POST', headers: h, body: JSON.stringify(body) });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data, cookie: r.headers.get('set-cookie') };
}
async function jget(path, cookie) {
  const h = {};
  if (cookie) h.Cookie = cookie;
  const r = await fetch(BASE + path, { headers: h });
  return { status: r.status, text: await r.text() };
}
(async () => {
  console.log('— 管理员验收自测 —');
  // 1. admin 登录
  const al = await jpost('/api/login', { account: 'admin', password: 'Admin@888' });
  check('超级管理员可登录', al.status === 200 && al.data.ok === true);
  const adminCookie = al.cookie;

  // 2. 匿名访问 /admin 应 403
  const anonAdmin = await jget('/admin');
  check('匿名访问后台被拒(403)', anonAdmin.status === 403);

  // 3. admin 登录访问 /admin 应 200
  const admAdmin = await jget('/admin', adminCookie);
  check('管理员登录可进后台(200)', admAdmin.status === 200 && admAdmin.text.includes('发布'));

  // 4. admin 发布文章
  const pub = await jpost('/api/admin/article', {
    title: '自测文章：某国新政对你的影响', category: '经济', lead: '测试',
    freeHtml: '<p>免费段</p>', premiumHtml: '<p>专享段</p>', isPremium: 'on',
    impacts: JSON.stringify([{ t: 'red', l: '物价' }])
  }, adminCookie);
  check('管理员可发布文章', pub.status === 200 && pub.data.ok === true && pub.data.article);

  // 5. 普通用户注册并登录
  const u = 'tester_' + Date.now();
  const reg = await jpost('/api/register', { account: u, password: 'pw123456' });
  check('普通用户可注册登录', reg.status === 200 && reg.data.ok === true);
  const userCookie = reg.cookie;

  // 6. 普通用户订阅月卡 → payUrl 含月卡链接
  const subM = await jpost('/api/subscribe', { plan: 'month' }, userCookie);
  check('月卡订阅跳转月卡商品链接', subM.data.payUrl && subM.data.payUrl.includes('3VK78h'));

  // 7. 普通用户订阅年卡 → payUrl 含年卡链接
  const subY = await jpost('/api/subscribe', { plan: 'year' }, userCookie);
  check('年卡订阅跳转年卡商品链接', subY.data.payUrl && subY.data.payUrl.includes('27WUSn'));

  // 8. 普通用户无法直接调后台发布（无 key 非 admin）
  const bad = await jpost('/api/admin/article', { title: 'x', category: 'y' }, userCookie);
  check('普通用户不能发布文章(403)', bad.status === 403);

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
  process.exit(fail ? 1 : 0);
})();
