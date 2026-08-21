'use strict';
/**
 * 运行时设置（管理员可在后台自助修改，持久化到 data/settings.json）。
 * 含：AI 模型提供商（可任意添加 OpenAI 兼容厂商）、RSS 时事源、自动化调度与提示词。
 * 与 config.json（代码级/支付等）分离：settings 是运营可改的部分。
 */
const fs = require('fs');
const { DATA_DIR, FILES } = require('./paths');
const FILE = FILES.settings;

const DEFAULT_PROMPT = `你是一位面向普通读者的「全球大事解读」主编。你的任务：把一条硬新闻，翻译成"这件事会怎样影响一个普通中国人的钱包、工作和日常生活"，输出原创、有观点、可执行的洞察（不要复述新闻，要给出影响与行动建议）。

请严格以 JSON 输出，不要使用 Markdown 代码块包裹，字段如下：
{
  "title": "20字以内的标题，从普通人视角切入，带一点悬念或反常识",
  "lead": "一句话钩子，点明这件事和普通人的关系",
  "freeHtml": "2-3 段 HTML（用 <p> 与必要的 <h2>），解释它对普通人钱包/工作/生活的直接影响，并给出 2-3 条可立即执行的应对动作。语气像朋友提醒，不端着。",
  "premiumHtml": "1-2 段更深的分析：背后的趋势、不同人群的差异化影响、值得长期关注的信号。即使免费也可读，作为增值。",
  "impacts": [ {"t":"red|green|amber", "l":"影响标签，如 物价/就业/省钱/利率"} ]  // 2-4 个
}
要求：原创、具体、有观点；避免空话；影响标签用 red(利空/涨价/风险)/green(利好/省钱/机会)/amber(需关注)。`;

const DEFAULT_COMPLIANCE = {
  privacyHtml: '<h2>隐私政策</h2><p>本网站（涟漪观察）尊重并保护用户隐私。我们仅在为你提供会员服务、内容推荐与安全防护时收集必要信息。</p><h3>1. 我们收集的信息</h3><p>账号信息（你注册时填写的账号与密码，密码经加盐哈希存储，服务端不留存明文）、你浏览与登录的行为统计（用于改进内容，不含敏感个人信息）、付费信息由第三方平台（小鹅通）处理，本站不存储你的支付凭证。</p><h3>2. 信息使用</h3><p>用于：维持登录状态、统计站点访问趋势、向你推送你订阅的栏目内容。我们不会出售你的个人信息。</p><h3>3. 信息存储与安全</h3><p>数据存放于服务器，访问受权限控制。你可随时联系管理员注销账号并删除你的数据。</p><h3>4. 第三方</h3><p>本站接入小鹅通完成会员付费；其数据使用受小鹅通隐私政策约束。</p>',
  termsHtml: '<h2>用户协议</h2><p>欢迎使用涟漪观察。访问或注册即表示你同意以下条款。</p><h3>1. 服务内容</h3><p>本站提供全球大事的普通人视角解读，部分深度内容需会员订阅后查阅。</p><h3>2. 账号责任</h3><p>你需对账号下的行为负责；不得利用本站从事违法或侵权活动。</p><h3>3. 会员订阅</h3><p>会员通过小鹅通完成付费，开通后按所选套餐周期生效；虚拟内容一经开通不支持退款，请以购买前充分了解。</p><h3>4. 内容版权</h3><p>本站原创解读内容版权归本站所有，转载需授权。</p>',
  adHtml: '<h2>广告与标识说明</h2><p>为维持运营，本站可能在信息流、侧边栏或底部展示第三方广告。所有广告内容由广告主提供，不代表本站立场。</p><p>依据相关法规，本站对商业推广内容均作明确「广告」标识，并以不同样式与正文区分，不会以新闻形式混淆呈现。</p><p>如你对某条广告有疑问，可通过页面底部联系方式反馈。</p>'
};

const DEFAULT = {
  llm: {
    // 默认激活 ModelScope DeepSeek-V4-Pro（真实模型）。API Key 走环境变量 LLM_API_KEY，避免密钥进代码仓库。
    activeProviderId: 'modelscope',
    providers: [
      { id: 'mock', name: '演示模型（占位生成，免 Key）', type: 'mock', baseUrl: '', apiKey: '', model: 'mock', enabled: true },
      { id: 'dashscope', name: '通义千问 DashScope', type: 'openai-compatible', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', model: 'qwen-plus', enabled: false },
      { id: 'modelscope', name: 'ModelScope DeepSeek-V4-Pro', type: 'openai-compatible', baseUrl: 'https://api-inference.modelscope.cn/v1', apiKey: process.env.LLM_API_KEY || '', model: 'deepseek-ai/DeepSeek-V4-Pro-0813', enabled: true }
    ]
  },
  rss: {
    mode: 'live', // 'mock' | 'live'（生产默认 live，实时抓取时事）
    feeds: [
      { name: 'BBC World', url: 'http://feeds.bbci.co.uk/news/world/rss.xml', category: '时政' },
      { name: 'UN News 中文', url: 'https://news.un.org/feed/subscribe/zh/news/', category: '时政' },
      { name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml', category: '经济' },
      { name: 'WSJ World', url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml', category: '经济' }
    ]
  },
  automation: {
    enabled: true,
    startHour: 4,
    endHour: 20,
    minute: 0,
    maxPerRun: 5,
    defaultPremium: false,
    defaultCategory: '',
    prompt: DEFAULT_PROMPT
  }
};

function ensureDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); }

function normalize(s) {
  s = s || {};
  s.llm = s.llm || {};
  s.llm.providers = (Array.isArray(s.llm.providers) && s.llm.providers.length) ? s.llm.providers : DEFAULT.llm.providers.map(p => Object.assign({}, p));
  s.llm.activeProviderId = s.llm.activeProviderId || 'mock';
  s.rss = s.rss || {};
  s.rss.mode = s.rss.mode === 'live' ? 'live' : 'mock';
  s.rss.feeds = Array.isArray(s.rss.feeds) ? s.rss.feeds : DEFAULT.rss.feeds.map(f => Object.assign({}, f));
  s.automation = Object.assign({}, DEFAULT.automation, s.automation || {});
  s.compliance = Object.assign({}, DEFAULT_COMPLIANCE, s.compliance || {});
  return s;
}

function load() {
  ensureDir();
  let raw = null;
  try { raw = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (e) { raw = null; }
  if (!raw) { raw = normalize(JSON.parse(JSON.stringify(DEFAULT))); save(raw); }
  return normalize(raw);
}

function save(s) {
  ensureDir();
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2), 'utf8');
}

function getSettings() { return load(); }

function updateSettings(patch) {
  let s = load();
  if (patch.llm) s.llm = Object.assign({}, s.llm, patch.llm);
  if (patch.rss) s.rss = Object.assign({}, s.rss, patch.rss);
  if (patch.automation) s.automation = Object.assign({}, s.automation, patch.automation);
  if (patch.compliance) s.compliance = Object.assign({}, s.compliance, patch.compliance);
  s = normalize(s);
  save(s);
  return s;
}

function getActiveProvider() {
  const s = load();
  const list = s.llm.providers || [];
  let p = list.find(x => x.id === s.llm.activeProviderId);
  if (!p || !p.enabled) p = list.find(x => x.enabled);
  if (!p) p = list.find(x => x.id === 'mock');
  return p || null;
}

module.exports = { getSettings, saveSettings: save, updateSettings, getActiveProvider, DEFAULT };
