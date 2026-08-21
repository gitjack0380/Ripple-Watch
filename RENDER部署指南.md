# 涟漪观察 Ripple Watch · Render 部署指南（境外 · 免备案）

本指南覆盖把完整 Node 版（注册/登录/会员/自动发布/统计）上线到 Render 的全部步骤。  
静态预览版（`public-site/`）仅用于演示，不接真实用户，请勿用于正式运营。

---

## 〇、关键事实（先读，避免踩坑）

1. **数据存在服务器的持久盘上，不在代码仓库里。**  
   本项目用 JSON 文件存储（`data/*.json` + `analytics.json` + `automation.log`），通过 `src/paths.js` 统一解析：
   - 本地：`ripple-app/data/`
   - 生产：环境变量 `DATA_DIR` 指向 Render 持久盘（本配置为 `/var/data`）  
     （后续到千人级可平滑切 SQLite，接口不变，见文末。）
2. **Render 默认磁盘是临时的！** 免费档（free）重启/重新部署会清空文件，数据全丢。  
   → 必须用 **starter 及以上付费实例**（约 $7/月，常驻 + 支持持久盘）。本 `render.yaml` 已配好磁盘。
3. **密钥不进代码。** AI 模型 Key 通过环境变量 `LLM_API_KEY` 注入（已在 `settings.js` 的 DEFAULT 里读 `process.env.LLM_API_KEY`）。本地 `data/settings.json` 里的 Key 已被 `.gitignore` 排除，不会上传。
4. **国内访问：** 站点部署在 Render 境外节点（默认 singapore），免 ICP 备案，但国内用户访问速度可能略慢、偶发波动，属正常。

---

## 一、准备 GitHub 仓库（Render 从 Git 拉代码）

```bash
cd ripple-app
git init
git add .
git commit -m "feat: 涟漪观察 v1 — Render-ready（真实模型/合规页/后台多模块/统计）"
```

然后在 GitHub 新建一个私有仓库（如 `ripple-watch`），推送：

```bash
git remote add origin https://github.com/<你的用户名>/ripple-watch.git
git branch -M main
git push -u origin main
```

> 已 `.gitignore` 的内容（node_modules / data / .env / public-site）不会上传，安全。

---

## 二、Render 控制台操作

1. 登录 <https://render.com> → **New → Web Service**。
2. 选择刚推送的 GitHub 仓库 `ripple-watch`。
3. Render 会自动读到仓库根目录的 `render.yaml`，大部分配置已填好，核对即可：
   - **Runtime**: Node
   - **Plan**: `starter`（重要：free 不支持持久盘，数据会丢）
   - **Region**: `singapore`（离国内最近、免备案）
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/`
4. **挂载持久盘（关键）**：在 Disk 区域确认已存在
   - Name: `ripple-data`
   - Mount Path: `/var/data`
   - Size: `1 GB`（千人级足够）
5. **填写环境变量**（Environment）：
   - `NODE_ENV` = `production`（yaml 已含）
   - `PORT` = `10000`（yaml 已含，Render 会覆盖注入）
   - `DATA_DIR` = `/var/data`（yaml 已含）
   - **`LLM_API_KEY`**（务必手动添加为 Secret）：填 `ms-73af1602-bb24-42c0-a52f-bd6c7aef8381`
     > 在 Render 控制台加环境变量时勾选 "Secret"，它不会显示在日志里。  
     > 若你后续在 ModelScope 换了 Key，这里同步改即可。
6. 点击 **Create Web Service**，等待构建（约 1–2 分钟）。

部署成功后，Render 会给你一个地址，形如：  
`https://ripple-watch.onrender.com`

---

## 三、上线后必做（否则不能对外收费/运营）

| 项                  | 操作                                                                                        | 位置                  |
| ------------------ | ----------------------------------------------------------------------------------------- | ------------------- |
| ① 改管理员密码           | 登录后台 → 用户管理，或本地改 `data/users.json` 的哈希；最稳妥是删默认 admin 自建                                   | 后台 `/admin/users`   |
| ② 轮换 adminKey      | 改 `config.json` 的 `adminKey` 为一个随机串（避免别人用默认密钥进后台）                                         | `config.json`       |
| ③ 验证自动化真实运行        | 后台「自动化设置」点「立即运行一次」，看日志是否真调通 ModelScope 并发布文章                                              | `/admin/automation` |
| ④ 小鹅通真实订单校验（收费前必须） | 当前 external 模式在「订阅即发回跳令牌」，**未校验是否真付款**。正式收费前需接小鹅通订单回调（webhook）做真实校验，否则用户可不付款激活会员。详见「安全补强」 | `src/wechatPay.js`  |
| ⑤ 自定义域名（可选）        | 在 Render → Settings → Custom Domains 绑定 `ripple.watch` 之类，比默认链接可信好记                       | Render 控制台          |
| ⑥ 内容合规备案（可选）       | 站点放境外免 ICP，但若日活做大、接国内支付，需补个体户执照 + ICP                                                     | —                   |



---

## 四、日常运维

- **看自动化日志**：后台「自动化设置 → 运行日志」，或服务器 `DATA_DIR/automation.log`。
- **看访问数据**：后台「数据概览 / 用户&登录」，含 PV/UV/日活/周活/登录日志。
- **重启**：Render 控制台 Restart，或 git push 触发重新部署（数据在持久盘，不丢）。
- **备份**：在 Render 控制台对磁盘做 Snapshot，或写 cron 把 `/var/data` 打包到对象存储。

---

## 五、到千人级：平滑切 SQLite（接口零改动）

`src/store.js` 已把全部读写抽象成 `getUsers/addUser/updateUser/getArticles/addArticle...`。  
切 SQLite 只需：

1. `npm install better-sqlite3`；数据库即单文件 `DATA_DIR/app.db`。
2. 新建表（users/articles/orders/settings/analytics）字段与现有 JSON 一一对应。
3. **只重写 `store.js` 内部**：每个函数改成一条 SQL，函数名/参数完全不变 → `server.js`、所有路由零改动。
4. 写一次性迁移脚本 `scripts/migrate-json-to-sqlite.js`，把现有 `data/*.json` 读入 `app.db`，跑一次平滑过渡。
5. `DATA_DIR` 仍指向持久盘（`/var/data`），`DB_PATH` 可覆盖具体文件名。

千人以内 JSON 完全够用；建议日活接近 500–800 再切，留缓冲。

---

## 六、安全补强（收费前必做）

当前 external 支付流程：  
`用户点订阅 → /api/subscribe 生成 HMAC 回跳令牌 → 跳小鹅通付款 → 付款后回 /member/return?token= 激活`

**风险**：令牌在「点击订阅」时即生成（早于付款），30 分钟内有效；技术用户可复制回跳链接直接激活，**未校验是否真付款**。  
**修复**：接小鹅通「订单支付成功」回调（webhook），在回调里用 `wechatPay.redeemReturnToken` 或独立订单校验来激活，丢弃"点击即发令牌"的链路。该改动只在 `server.js` 的 `/api/subscribe` 与新增 `/api/xiaoe/notify` 两处，不影响前端。

---

## 七、回滚 / 本地对照

- 本地跑：`PORT=3000 npm start`，访问 `http://localhost:3000`，管理员 `admin / Admin@888`。
- 若 Render 部署异常：看 Render 的 Deploy Logs；常见是 `LLM_API_KEY` 没填（自动化报错 "API Key 未配置"）或磁盘没挂（数据写不进）。
