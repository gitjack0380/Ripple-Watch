'use strict';
/**
 * 自测：拉起 server.js，用真实 HTTP 请求验证核心功能，并单元校验支付令牌。
 * 运行：node test/selftest.js
 */
const { spawn } = require('child_process');
const path = require('path');
const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;

const results = [];
function check(name, cond, extra = '') {
  results.push({ name, ok: !!cond, extra });
  console.log(`${cond ? '✅' : '❌'} ${name}${extra ? '  → ' + extra : ''}`);
}

function waitServer(timeoutMs = 8000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try { const r = await fetch(BASE + '/'); if (r.ok) return resolve(); } catch (e) {}
      if (Date.now() - start > timeoutMs) return reject(new Error('server start timeout'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

async function main() {
  const server = spawn('node', ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stdout.on('data', d => process.env.VERBOSE && console.log('[server]', d.toString()));
  server.stderr.on('data', d => console.error('[server-err]', d.toString()));

  try {
    await waitServer();

    // 1. 首页
    let r = await fetch(BASE + '/');
    let html = await r.text();
    check('首页 200 且含站点名', r.ok && html.includes('涟漪观察'), 'status=' + r.status);
    check('首页渲染文章卡片', html.includes('阅读全文'));
    check('广告位渲染（演示）', html.includes('（演示）'));

    // 2. 匿名访问会员专享文章 → 应被付费墙拦截，且不泄露 premium 正文
    r = await fetch(BASE + '/article/a1');
    html = await r.text();
    check('匿名访问付费文章显示付费墙', html.includes('会员专享深度解读'));
    check('付费墙服务端不泄露专享正文', !html.includes('降息周期里普通投资者的 5 条操作红线'));

    // 3. 注册
    const account = 'tester_' + Date.now();
    r = await fetch(BASE + '/api/register', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account, password: 'secret123' })
    });
    let j = await r.json();
    check('注册成功', j.ok === true);
    const setCookie = r.headers.get('set-cookie') || '';
    const sid = (setCookie.match(/sid=([^;]+)/) || [])[1];
    check('注册返回会话 Cookie', !!sid);
    const cookie = 'sid=' + sid;

    // 4. /api/me
    r = await fetch(BASE + '/api/me', { headers: { cookie } });
    j = await r.json();
    check('登录态 /api/me 返回用户', j.ok && j.user && j.user.account === account);
    check('新用户非会员', j.isMember === false);

    // 5. 会员专享文章：免费额度内可看（验证服务端解锁 + 泄露专享正文）
    r = await fetch(BASE + '/article/a1', { headers: { cookie } });
    html = await r.text();
    check('免费额度内解锁专享正文', html.includes('已解锁会员专享内容') && html.includes('降息周期里普通投资者的 5 条操作红线'));

    // 6. 每日免费额度上限（连续读同一篇 premium 4 次：第4次应被拦截）
    let blocked = false;
    for (let i = 0; i < 4; i++) {
      r = await fetch(BASE + '/article/a1', { headers: { cookie } });
      html = await r.text();
      if (!html.includes('已解锁会员专享内容') && html.includes('会员专享深度解读')) blocked = true;
    }
    check('超出每日免费额度后被拦截', blocked);

    // 7. external 订阅（已配置小鹅通店铺 → 返回跳转 payUrl）
    r = await fetch(BASE + '/api/subscribe', {
      method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
      body: JSON.stringify({ plan: 'month' })
    });
    j = await r.json();
    check('external 订阅已配置时返回跳转链接', j.ok === true && j.mode === 'external' && /xet\.tech|xiaoeknow/.test(j.payUrl || ''), j.payUrl || j.msg || '');

    // 7b. 回跳激活（demoActivate 路径）：已登录非会员 → /member/return → 激活成为会员
    r = await fetch(BASE + '/member/return', { headers: { cookie } });
    check('回跳激活可访问(已重定向到会员页)', r.ok, 'status=' + r.status);
    r = await fetch(BASE + '/api/me', { headers: { cookie } });
    j = await r.json();
    check('回跳激活后 isMember=true', j.isMember === true);

    // 8. 会员访问专享文章始终解锁
    r = await fetch(BASE + '/article/a1', { headers: { cookie } });
    html = await r.text();
    check('会员访问专享文章解锁', html.includes('已解锁会员专享内容'));

    // 9. 会员页 / 关于 / 登录 / 栏目
    for (const p of ['/membership', '/about', '/login', '/category', '/category/经济']) {
      r = await fetch(BASE + p);
      check('页面可达 ' + p, r.ok, 'status=' + r.status);
    }

    // 10. 管理后台发布文章
    const title = '自测文章_' + Date.now();
    r = await fetch(BASE + '/api/admin/article?key=change-me-admin-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, category: '经济', lead: '测试导语', freeHtml: '<p>免费段</p>', premiumHtml: '<p>专享段</p>', impacts: '[{"t":"red","l":"物价"}]', isPremium: true })
    });
    j = await r.json();
    check('管理后台发布文章', j.ok === true && j.article);
    r = await fetch(BASE + '/article/' + j.article.id);
    html = await r.text();
    check('新发布文章可访问', r.ok && html.includes(title));

    // 11. 管理后台密钥错误拦截
    r = await fetch(BASE + '/api/admin/article?key=wrong', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'x', category: '经济' })
    });
    j = await r.json();
    check('管理后台错误密钥被拒', j.ok === false);

    // 12. 支付令牌单元校验（不依赖 HTTP）
    const wechatPay = require('../src/wechatPay');
    const token = wechatPay.makeReturnToken(123, 'year');
    const red = wechatPay.redeemReturnToken(token);
    check('回跳令牌生成/校验往返', red && red.userId === 123 && red.plan === 'year');
    check('篡改令牌被拒', wechatPay.redeemReturnToken(token + 'x') === null);
    const cfgMod = require('../src/config');
    const cryptoMod = require('crypto');
    const past = Math.floor(Date.now() / 1000) - 3600;
    const edata = `123|year|${past}`;
    const esig = cryptoMod.createHmac('sha256', cfgMod.adminKey).update(edata).digest('base64url');
    const expiredToken = Buffer.from(edata).toString('base64url') + '.' + esig;
    check('过期令牌被拒', wechatPay.redeemReturnToken(expiredToken) === null);

  } finally {
    server.kill();
  }

  const failed = results.filter(r => !r.ok);
  console.log(`\n==== 自测结果：${results.length - failed.length}/${results.length} 通过 ====`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error('自测异常：', e); process.exit(1); });
