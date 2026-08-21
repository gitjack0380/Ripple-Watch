'use strict';
/**
 * 微信支付 v3 封装
 * - testMode=true（默认）：不调用微信，立即模拟支付成功，便于本地自测与验收。
 * - testMode=false：发起 Native 付款码支付，返回 code_url；提供异步通知验签与订单查询。
 *
 * 正式上线需 config.json 中填写：wechatPay.appId / mchId / apiKey / serialNo /
 * privateKeyPath / notifyUrl，并准备好微信支付平台证书（平台证书用于回调解密/验签）。
 */
const crypto = require('crypto');
const https = require('https');
const fs = require('fs');
const config = require('./config');
const store = require('./store');

const BASE = 'https://api.mch.weixin.qq.com';

function genOutTradeNo(userId) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `RW${ts}${String(userId).slice(-4)}${crypto.randomBytes(2).toString('hex')}`;
}

// ---- 测试模式：模拟成功 ----
function completeOrderAsPaid(order) {
  const plan = config.plans[order.plan];
  const user = store.findUserById(order.userId);
  if (!user) return;
  const until = new Date(Date.now() + plan.days * 86400000).toISOString();
  store.updateUser(user.id, { isMember: true, memberUntil: until, plan: order.plan });
  store.updateOrder(order.id, { status: 'paid', paidAt: new Date().toISOString() });
}

function createOrder({ userId, plan }) {
  if (!config.plans[plan]) throw new Error('未知套餐');
  const p = config.plans[plan];
  const order = store.addOrder({
    id: 'O' + Date.now() + crypto.randomBytes(2).toString('hex'),
    userId, plan, amount: p.price, status: 'pending',
    outTradeNo: genOutTradeNo(userId), createdAt: new Date().toISOString(), paidAt: null
  });

  if (config.testMode) {
    completeOrderAsPaid(order);
    return { test: true, paid: true, order, codeUrl: null };
  }
  // 正式模式：请求微信 Native 下单
  return createNativeOrder(order, p);
}

// ---- 正式模式：Native 下单 ----
function createNativeOrder(order, plan) {
  const wp = config.wechatPay;
  if (!wp.appId || !wp.mchId || !wp.apiKey || !wp.privateKeyPath) {
    throw new Error('微信支付未配置：请在 config.json 填写 appId/mchId/apiKey/privateKeyPath');
  }
  const body = {
    appid: wp.appId, mchid: wp.mchId,
    description: `${config.siteName} ${plan.name}`,
    out_trade_no: order.outTradeNo,
    notify_url: wp.notifyUrl,
    amount: { total: plan.price * 100, currency: 'CNY' } // 单位：分
  };
  const res = wechatRequest('POST', '/v3/pay/transactions/native', body, wp);
  if (res.code_url) {
    store.updateOrder(order.id, { codeUrl: res.code_url });
    return { test: false, paid: false, order, codeUrl: res.code_url };
  }
  throw new Error('微信下单失败：' + JSON.stringify(res));
}

// 生成微信支付鉴权头（RSA-SHA256 签名）
function buildAuthorization(method, urlPath, bodyStr, wp) {
  const mchid = wp.mchId;
  const nonce = crypto.randomBytes(16).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${bodyStr}\n`;
  const privateKey = fs.readFileSync(wp.privateKeyPath, 'utf8');
  const signature = crypto.createSign('RSA-SHA256').update(message).sign(privateKey, 'base64');
  const token = Buffer.from(
    `mchid="${mchid}",nonce_str="${nonce}",signature="${signature}",timestamp="${timestamp}",serial_no="${wp.serialNo}"`
  ).toString('utf8');
  return `WECHATPAY2-SHA256-RSA2048 ${token}`;
}

function wechatRequest(method, urlPath, bodyObj, wp) {
  return new Promise((resolve, reject) => {
    const bodyStr = bodyObj ? JSON.stringify(bodyObj) : '';
    const req = https.request({
      hostname: 'api.mch.weixin.qq.com',
      path: urlPath, method,
      headers: {
        'Authorization': buildAuthorization(method, urlPath, bodyStr, wp),
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'ripple-watch/1.0'
      }
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { resolve({ raw: data }); } });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ---- 异步通知验签（正式模式使用）----
// 需配置 wechatPay.platformCertPath（微信平台证书）用于验签与回调解密。
function verifyNotify({ signature, timestamp, nonce, serial, bodyStr }) {
  const wp = config.wechatPay;
  if (!wp.platformCertPath || !fs.existsSync(wp.platformCertPath)) {
    console.warn('[wechatPay] 未配置 platformCertPath，无法验签通知，请补全配置后再上线。');
    return false;
  }
  const cert = fs.readFileSync(wp.platformCertPath, 'utf8');
  const message = `${timestamp}\n${nonce}\n${bodyStr}\n`;
  const ok = crypto.createVerify('RSA-SHA256').update(message).verify(cert, signature, 'base64');
  return ok;
}

// ---- 第三方支付回跳令牌（external 模式）----
// 用 adminKey 做 HMAC 签名，携带 userId/plan/过期时间；用户在小鹅通/有赞付款后
// 回跳到 /member/return?token=... 时校验并自动开通会员（过渡方案，正式可接平台 API 回查）。
function makeReturnToken(userId, plan) {
  const exp = Math.floor(Date.now() / 1000) + 1800; // 30 分钟有效
  const data = `${userId}|${plan}|${exp}`;
  const sig = crypto.createHmac('sha256', config.adminKey).update(data).digest('base64url');
  return `${Buffer.from(data).toString('base64url')}.${sig}`;
}
function redeemReturnToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  try {
    const [b64, sig] = token.split('.');
    const data = Buffer.from(b64, 'base64url').toString('utf8');
    const expect = crypto.createHmac('sha256', config.adminKey).update(data).digest('base64url');
    if (sig !== expect) return null;
    const [userId, plan, exp] = data.split('|');
    if (Number(exp) < Math.floor(Date.now() / 1000)) return null;
    return { userId: Number(userId), plan };
  } catch (e) { return null; }
}

// 订单查询（轮询用）
function getOrder(id) { return store.findOrder(id); }

module.exports = { createOrder, getOrder, verifyNotify, genOutTradeNo, completeOrderAsPaid, makeReturnToken, redeemReturnToken };
