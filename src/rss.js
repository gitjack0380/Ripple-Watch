'use strict';
/**
 * 时事抓取：mode=mock 返回内置示例（免网络/免 Key，用于验证链路）；
 * mode=live 用 rss-parser 抓取管理员配置的 RSS 源（免费、无需 Key）。
 * 归一化条目：{ title, summary, link, guid, source, category, pubDate }
 */
const Parser = require('rss-parser');

const MOCK_ITEMS = [
  {
    title: '某主要经济体宣布新一轮基建投资计划',
    summary: '该计划规模超预期，重点覆盖新能源与数字基础设施，预计拉动上下游就业与原材料需求。',
    link: 'https://example.com/news/infra-plan', source: '示例时事源', category: '经济', guid: 'mock-infra'
  },
  {
    title: '全球海运关键通道再现拥堵，运价指数跳涨',
    summary: '港口吞吐受限推高集装箱运价，进口消费品到岸成本上升，或沿供应链传导到终端零售价。',
    link: 'https://example.com/news/shipping-congestion', source: '示例时事源', category: '时政', guid: 'mock-shipping'
  },
  {
    title: '一项新的 AI 监管框架在多国同步落地',
    summary: '对高风险 AI 施加透明度义务，影响多个消费级应用的提示、撤回与人工复核体验。',
    link: 'https://example.com/news/ai-reg-framework', source: '示例时事源', category: '科技', guid: 'mock-ai'
  }
];

const parser = new Parser({ timeout: 12000 });

function normalizeItem(it, feed) {
  return {
    title: it.title || '(无标题)',
    summary: ((it.contentSnippet || it.content || it.summary || '').toString()).slice(0, 800),
    link: it.link || it.guid || '',
    guid: it.guid || it.link || '',
    source: feed ? feed.name : '',
    category: feed ? feed.category || '时政' : '时政',
    pubDate: it.isoDate || it.pubDate || ''
  };
}

async function defaultParse(xml, feed) {
  const feedObj = await parser.parseString(xml);
  return (feedObj.items || []).map(it => normalizeItem(it, feed));
}

async function defaultFetch(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 RippleWatch/1.0' } });
  if (!r.ok) throw new Error('fetch ' + url + ' -> ' + r.status);
  return await r.text();
}

async function fetchNews(feeds, opts) {
  opts = opts || {};
  const doFetch = opts.fetchFn || defaultFetch;
  const doParse = opts.parseFn || defaultParse;
  const items = [];
  for (const f of (feeds || [])) {
    try {
      const xml = await doFetch(f.url);
      const parsed = await doParse(xml, f);
      parsed.forEach(it => items.push(it));
    } catch (e) {
      // 单源失败不影响其它源
      console.warn('[rss] 抓取失败', f && f.url, e.message);
    }
  }
  // 按 link/guid 去重（跨源）
  const seen = new Set();
  const out = [];
  for (const it of items) {
    const k = it.link || it.guid;
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    out.push(it);
  }
  return out;
}

module.exports = { fetchNews, MOCK_ITEMS, normalizeItem };
