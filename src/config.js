'use strict';
/**
 * 配置中心
 * 上线前请把 config.json 中的占位符替换为真实值。
 * 默认 testMode=true：所有支付走模拟成功，便于本地自测与验收。
 */
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

const DEFAULTS = {
  siteName: '涟漪观察',
  siteSlogan: '世界发生的每一件大事，都与你有关。',
  port: 3000,
  // testMode=true 时：支付立即模拟成功，不调用真实微信支付
  testMode: true,
  freeDailyLimit: 3,            // 非会员每日可免费读的"会员专享"文章数
  plans: {
    month: { id: 'month', name: '会员月卡', price: 19, days: 31,  desc: '深度解读自由看' },
    year:  { id: 'year',  name: '会员年卡', price: 199, days: 366, desc: '折合 ¥16.6/月' }
  },
  wechatPay: {
    appId: '',                  // 微信公众平台/开放平台 AppID
    mchId: '',                  // 微信支付商户号
    apiKey: '',                 // APIv3 密钥
    serialNo: '',               // 商户 API 证书序列号
    privateKeyPath: '',         // 商户私钥 apiclient_key.pem 路径
    notifyUrl: ''               // 支付结果异步通知地址（需公网可访问）
  },
  ads: {
    enabled: false,             // true 时注入真实广告代码；false 显示"广告"占位
    provider: '',               // adsense / baidu / chuanxianjing / custom
    slots: { feed: '', sidebar: '', banner: '' } // 各广告位代码/ID
  },
  adminKey: 'change-me-admin-key' // 管理后台访问密钥（请务必修改）
};

let cfg = Object.assign({}, DEFAULTS);
try {
  if (fs.existsSync(CONFIG_PATH)) {
    const user = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    cfg = deepMerge(DEFAULTS, user);
  } else {
    // 首次运行：写出一份 config.json 方便用户填写
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2), 'utf8');
  }
} catch (e) {
  console.warn('[config] 读取失败，使用默认配置：', e.message);
}

function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : Object.assign({}, base);
  for (const k in over) {
    if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], over[k]);
    } else {
      out[k] = over[k];
    }
  }
  return out;
}

module.exports = cfg;
