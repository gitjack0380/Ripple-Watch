'use strict';
/**
 * 广告位渲染：enabled=false 时显示"广告"占位（验收/测试用）；
 * enabled=true 时注入 config.ads.slots 中对应广告位代码（AdSense / 联盟 / 自定义）。
 */
const config = require('./config');

const LABELS = { feed: '信息流原生广告位', sidebar: '侧栏矩形广告位', banner: '详情页底部横幅广告位' };

function adHtml(slot, extraClass = '') {
  const code = config.ads.slots && config.ads.slots[slot];
  if (config.ads.enabled && code && code.trim()) {
    return `<div class="ad-slot ${extraClass}">${code}</div>`;
  }
  return `<div class="ad ${extraClass}" data-action="ad">
    <span class="ad-label">广告</span>${LABELS[slot] || '广告位'}（演示）
  </div>`;
}

module.exports = { adHtml };
