# 涟漪观察 Ripple Watch

> 提供全球发展大事，并解读**对普通人的影响**。变现方式：会员订阅 + 广告。
> 完整可运行产品，已自测通过；**已 Render 部署就绪**（真实模型 / 合规页 / 后台多模块 / 访问统计）。

## 当前状态

- **完整 Node 版（可上线）**：`npm start` → http://localhost:3000，含注册/登录、会员激活回跳、服务端强制付费墙、广告位、管理后台（竖版多模块导航）、访问统计（PV/UV/日活/周活/登录日志）、自动化发布、合规页。
- **公开预览版（仅演示，不接真实用户）**：https://5d3391d1f6bb4586aa91019f66f26ce3.app.workbuddy.link
  —— 静态展示版，会员付费按钮跳转小鹅通，专享内容不内联。**正式运营请用完整 Node 版部署，不要用此静态预览。**
- **支付默认走 `external`（小鹅通）模式**：因为你暂无微信支付商户号（无营业执照/门面），第三方平台自带支付牌照，无需你申请商户号。
- **AI 默认模型**：ModelScope DeepSeek-V4-Pro（`deepseek-ai/DeepSeek-V4-Pro-0813`），Key 通过环境变量 `LLM_API_KEY` 注入；RSS 默认 `live`。
- **`demoActivate: false`**：已关闭演示激活，会员只能源自真实小鹅通回跳令牌（收费前仍需接小鹅通订单回调做真实校验，见部署指南）。

## 目录结构

```
ripple-app/
├── server.js              # Express 主服务（路由 + API）
├── config.json            # 运行时配置（已生成，按需修改）
├── config.example.json    # 上线配置模板（填真实值）
├── src/
│   ├── config.js          # 配置中心（读 config.json）
│   ├── store.js           # JSON 持久化（用户/文章/订单）
│   ├── paths.js           # 统一数据目录解析（DATA_DIR 环境变量 → 持久盘）
│   ├── analytics.js       # 访问统计（PV/UV/日活/周活/登录日志，落盘 analytics.json）
│   ├── auth.js            # scrypt 密码 + 会话
│   ├── wechatPay.js       # 第三方回跳令牌（HMAC 签名 + 过期）
│   ├── ads.js             # 广告位渲染
│   ├── settings.js        # 运营设置（持久化到 data/settings.json：模型提供商/RSS/提示词/调度/合规）
│   ├── llm.js             # AI 调用（mock + OpenAI 兼容，支持任意厂商）
│   ├── rss.js             # 时事抓取（mock 示例 / live RSS 源，免 Key）
│   ├── scheduler.js       # 整点自动化调度与编排（抓取→生成→发布）
│   └── seed.js            # 示例文章 + 管理员自举
├── views/
│   ├── admin/             # 后台多模块（竖版导航）：dashboard/articles/automation/users/compliance
│   ├── partials/          # 公共头尾 + admin-sidebar
│   ├── compliance.ejs     # 公开合规页（隐私/协议/广告标识）
├── public/assets/         # 前端样式 + 交互脚本（完整版）
├── public-site/           # 对外静态预览版（部署到 CloudStudio，免备案）
│   ├── index.html / category.html / about.html / article.html / membership.html
│   └── assets/app.js      # ← 上线前把 SHOP_URL 改成你的小鹅通/有赞店铺
├── data/                  # 自动生成的 users/articles/orders/settings.json + automation.log
└── test/
    ├── selftest.js        # 会员/支付/付费墙全链路自测（26 项）
    └── automation_selftest.js  # 自动化调度自测（18 项）
```

## 本地运行（完整 Node 版）

```bash
cd ripple-app
npm install            # 已安装 express + ejs + node-cron + rss-parser
npm start              # http://localhost:3000
npm test               # 会员/支付/付费墙全链路自测（26 项）
node test/automation_selftest.js   # 自动化调度自测（18 项）
```

> 使用受管 Node：`C:\Users\86178\.workbuddy\binaries\node\versions\22.22.2\node.exe`

## 支付模式

配置在 `config.json` 的 `payment.mode`：**`external`**（默认，免商户号）/ **`wechat`**（需营业执照+商户号）。

### external（小鹅通 / 有赞，免商户号）—— 当前默认

```json
"payment": {
  "mode": "external",
  "external": {
    "provider": "xiaoe",          // xiaoe(小鹅通) / youzan(有赞)
    "shopUrl": "https://你的小鹅通商品或店铺页",
    "returnPath": "/member/return",
    "demoActivate": false         // 上线务必设为 false
  }
}
```

**用户流程**
1. 在 `/membership` 点"去小鹅通开通月卡/年卡" → 后端 `/api/subscribe` 生成带签名回跳令牌的 `payUrl` → 前端跳转到店铺购买。
2. 购买后由小鹅通回跳到 `/member/return?token=...` → 校验令牌后**自动开通会员**。
3. 若回跳未自动配置，会员页提供"点此激活会员"引导。

**两种激活实现**
- 标准（安全）：回跳 URL 带 `token`（HMAC 签名，30 分钟有效），后端校验后开通。代码 `wechatPay.makeReturnToken / redeemReturnToken` + `/member/return` + `/api/activate` 已就绪。
- 过渡（仅验收）：`demoActivate: true` 时，登录用户访问 `/member/return` 可直接激活。**上线务必关掉**，并对接小鹅通/有赞开放 API 做真实订单校验（避免任意人手动激活）。

### wechat（微信支付，需商户号）

见 `config.wechatPay`：appId / mchId / apiKey / serialNo / privateKeyPath / notifyUrl / platformCertPath。
Native 付款码（`code_url`）下单、订单轮询、异步通知验签已封装在 `src/wechatPay.js`。**获取商户号前提：营业执照（可办"网络经营场所"个体户，无需门面）**。

## 自动化：整点抓取时事 → AI 生成洞察 → 自动发布

**目标**：每天 4:00–20:00 每个整点，自动获取全球最新时事，用**后台可自定义的提示词**逐条生成「对普通人的原创观点洞察」，并自动发布为文章。

**实现**
- 调度器：`src/scheduler.js` 用 `node-cron` 注册 `0 4-20 * * *`（Asia/Shanghai），每次触发：抓取 → 去重（按 sourceUrl）→ 调 AI → 发布 → 写日志。
- 时事来源：`src/rss.js`，`mode=mock`（内置示例，免网络/免 Key，用于验证）或 `mode=live`（抓取后台配置的 RSS 源，免费免 Key）。
- AI 模型：`src/llm.js`，支持两类提供商：
  - `mock`：占位生成，免 Key，用于验证整条链路；
  - `openai-compatible`：**任意 OpenAI 兼容接口**（通义千问 DashScope / OpenAI / DeepSeek / 本地 Ollama 等）。
- 提示词：`settings.automation.prompt`，后台可视化编辑，决定 AI 如何把新闻改写成"对普通人的影响 + 行动建议"。

**全部在后台「管理后台 → 自动化设置」自助配置（无需改代码）**
- 调度：启用开关、起止小时、触发分钟、每次最多篇数、是否会员专享、默认栏目；
- 提示词：多行文本框，自由改写；
- 模型提供商：卡片+弹窗增删改，**可任意添加新厂商/模型**（填 Base URL + API Key + 模型名，选"默认"即生效）；
- RSS 源：增删改订阅地址与对应栏目；
- 「⚡ 立即运行一次」：绕过时间窗手动跑一轮（验收用）；
- 运行日志：实时查看每轮抓取/发布/跳过条数。

**默认开箱即用（真实生产）**：默认激活 `modelscope` 提供商（ModelScope DeepSeek-V4-Pro），Key 来自环境变量 `LLM_API_KEY`；RSS 默认 `live`。配置好 `LLM_API_KEY` 即真实生成原创洞察并自动发布。也可在后台任意添加 DashScope/OpenAI/DeepSeek 等厂商。

**去重**：已发布过的时事（按 `sourceUrl`）不会重复生成，避免刷屏。

> 注意：`mock` RSS 的示例条目链接固定，首次运行发布、后续自动跳过（演示去重）；切到 `live` 后按真实链接去重。

## 上线前你需要提供的配置（填进 config.json）

| 配置项 | 用途 | 获取方式 |
| --- | --- | --- |
| `payment.external.shopUrl` | 小鹅通/有赞店铺或商品页 | 在小鹅通/有赞开通内容店铺后复制链接 |
| `payment.external.provider` | 平台标识（影响文案） | `xiaoe` / `youzan` |
| `payment.external.demoActivate` | 演示激活开关 | **上线设 `false`** |
| `payment.external.shopUrl`（静态版） | 公开预览版跳转地址 | 改 `public-site/assets/app.js` 的 `SHOP_URL` |
| `wechatPay.*`（如走 wechat） | 微信支付凭证 | 需营业执照+商户号 |
| `ads.*` | 广告位代码（AdSense/联盟/自定义） | 各广告平台申请后粘贴 |
| `adminKey` | 管理后台密钥 | 改成随机长字符串 |
| `LLM_API_KEY`（环境变量） | AI 模型密钥 | ModelScope 的 `ms-...`；**不写进代码，部署时在 Render 控制台填为 Secret** |
| `DATA_DIR`（环境变量） | 数据目录 | 本地默认 `data/`；Render 持久盘设为 `/var/data` |
| `siteUrl` | 站点基址（构造回跳） | 你的公网域名（可用 `req.host` 自动取，可不填） |
| 自动化设置（模型/RSS/提示词/调度） | 后台「自动化设置」 | 在管理后台可视化配置，持久化到 `data/settings.json`；AI 提供商填 ModelScope/DashScope/OpenAI 等 Base URL+Key 即可新增 |

## 部署（完整 Node 版 → Render，境外免备案）

完整步骤见 **`RENDER部署指南.md`**，要点：

1. `git init` 提交代码 → 推到 GitHub 私有仓库。
2. Render 控制台 New → Web Service，连仓库；`render.yaml` 已配好（Node / starter 实例 / singapore / 持久盘 `/var/data`）。
3. 控制台填写环境变量 **`LLM_API_KEY`**（Secret）= `ms-73af1602-bb24-42c0-a52f-bd6c7aef8381`。
4. 部署后得到 `https://ripple-watch.onrender.com`，登录 `/admin` 用 `admin / Admin@888` 验收。
5. **上线前必做**：改管理员密码、轮换 `adminKey`、验证自动化真跑通、接小鹅通订单回调做真实收款校验（否则用户可不付款激活）。

> ⚠️ **务必用 starter 及以上实例**：free 档磁盘临时，重启/重部署会清空用户与会员数据。持久盘保证数据安全。
> 国内访问：境外节点免 ICP 备案，但速度略慢、偶发波动，属正常。

- **公开预览版（仅演示）**：`public-site/` 静态版，改 `SHOP_URL` 后可重新部署，但**不接真实用户**，仅用于展示。
- **数据库**：当前 JSON 文件存储于持久盘，适合千人内单人运营；量大时把 `src/store.js` 换成 SQLite（接口不变，详见部署指南第五节）。

## 合规提醒（重要）

- **免备案先上**：服务器放境外（香港/新加坡/CloudStudio 沙箱等）可免 ICP 备案直接公网访问；缺点是国内访问偏慢。
- **境内备案**：放境内服务器必须 ICP 备案，否则域名无法解析。
- **经营性资质**：会员收费属经营性互联网信息服务，长期依法需 **ICP 经营许可证（EDI）**，个体户办不了 EDI。最稳妥是走**小鹅通/有赞等持牌平台**（由平台持证），规避此门槛。
- **必备文档**：《隐私政策》《用户协议》；广告须标注"广告"、遵守《广告法》；不碰医疗/金融诱导。

## 安全说明

- 付费墙由**服务端强制**：非会员响应中不包含专享正文（已自测验证不泄露）。
- 密码用 scrypt 加盐哈希，会话用 httpOnly Cookie。
- 第三方回跳令牌用 HMAC 签名 + 过期时间，防篡改/重放。
- 管理后台当前用密钥参数校验，生产建议改为独立管理员账号 + 审计日志。
- 前端只接收安全配置子集（plans/免费额度/支付模式），`adminKey`、微信支付密钥不传到浏览器。
