'use strict';
/**
 * AI 模型调用：支持两类 provider
 *  - 'mock'：占位生成（免 Key，用于验证整条链路）
 *  - 'openai-compatible'：任意 OpenAI 兼容接口（DashScope/Qwen、OpenAI、DeepSeek、Ollama 等）
 * 管理员可在后台任意添加/切换 provider。
 */
const settings = require('./settings');

function mockInsight(newsItem) {
  const t = (newsItem && newsItem.title) || '一条全球大事';
  return {
    title: `「${t.length > 16 ? t.slice(0, 16) + '…' : t}」会怎样悄悄改变你的生活`,
    lead: '这条全球大事，和你明天的菜篮子和工资条都有关。',
    freeHtml: `<p>${t} 正在发生。对普通人来说，最该关心的不是事件本身，而是它沿供应链与政策链传导到你身上的那一步。</p>
      <h2>三件你今天就能做的事</h2>
      <p>① 关注相关品类的价格与政策信号；② 重新审视自己的抗风险储备；③ 不盲从"焦虑式"消费建议。</p>`,
    premiumHtml: `<p>更深一层：这类事件往往预示一个中期趋势。普通人应把一次性冲击，转化为对"收入结构"与"资产配置"的长期检视。</p>`,
    impacts: [{ t: 'amber', l: '需关注' }, { t: 'green', l: '机会' }, { t: 'red', l: '波动' }]
  };
}

function stripFences(s) {
  if (!s) return s;
  let t = String(s).trim();
  const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (m) t = m[1].trim();
  return t;
}

function parseInsight(raw, newsItem) {
  try {
    const txt = stripFences(raw);
    const j = JSON.parse(txt);
    return {
      title: j.title || (newsItem && newsItem.title) || '未命名洞察',
      lead: j.lead || '',
      freeHtml: j.freeHtml || '',
      premiumHtml: j.premiumHtml || '',
      impacts: Array.isArray(j.impacts) && j.impacts.length ? j.impacts : [{ t: 'amber', l: '影响' }]
    };
  } catch (e) {
    // 解析失败时降级为占位结构，保证流程不中断
    return mockInsight(newsItem);
  }
}

async function chat(provider, messages) {
  if (provider.type === 'mock') return '';
  if (provider.type === 'openai-compatible') {
    if (!provider.apiKey) throw new Error('该提供商的 API Key 未配置');
    const url = (provider.baseUrl || '').replace(/\/$/, '') + '/chat/completions';
    const body = {
      model: provider.model || 'gpt-3.5-turbo',
      messages,
      temperature: 0.8
    };
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + provider.apiKey },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const txt = await r.text().catch(() => '');
      throw new Error('LLM HTTP ' + r.status + ' ' + txt.slice(0, 200));
    }
    const j = await r.json();
    return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
  }
  throw new Error('未知 provider 类型: ' + provider.type);
}

async function generateInsight({ provider, systemPrompt, newsItem }) {
  provider = provider || settings.getActiveProvider();
  if (!provider) throw new Error('未配置任何 AI 提供商');
  if (provider.type === 'mock') return mockInsight(newsItem);
  const messages = [
    { role: 'system', content: systemPrompt || settings.getSettings().automation.prompt },
    {
      role: 'user',
      content: `请基于以下时事信息，生成面向普通人的原创观点洞察。\n\n` +
        `标题：${newsItem.title || ''}\n` +
        `摘要：${newsItem.summary || ''}\n` +
        `来源：${newsItem.source || ''}\n` +
        `栏目：${newsItem.category || ''}\n` +
        `链接：${newsItem.link || ''}\n\n` +
        `请严格按系统提示的要求以 JSON 输出。`
    }
  ];
  const raw = await chat(provider, messages);
  return parseInsight(raw, newsItem);
}

module.exports = { generateInsight, chat, parseInsight, mockInsight };
