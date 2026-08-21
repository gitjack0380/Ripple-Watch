#!/usr/bin/env node
/**
 * 一键部署到 Render（API 方式）
 * 前置：
 *   1) 代码已 push 到 GitHub（本脚本不负责 push）
 *   2) 设置环境变量：
 *      RENDER_API_KEY  - Render 控制台 Account Settings → API Keys 生成的 key
 *      LLM_API_KEY     - ModelScope API Key（真实 AI 模型用）
 *   可选：
 *      REPO            - GitHub 仓库地址（默认 https://github.com/gitjack0380/Ripple-Watch）
 *      BRANCH          - 分支（默认 master）
 *      SERVICE_NAME    - 服务名（默认 ripple-watch）
 *
 * 运行：node scripts/deploy-render.js
 */
'use strict';

const API = 'https://api.render.com/v1';

const RENDER_API_KEY = process.env.RENDER_API_KEY;
const LLM_API_KEY = process.env.LLM_API_KEY;
const REPO = process.env.REPO || 'https://github.com/gitjack0380/Ripple-Watch';
const BRANCH = process.env.BRANCH || 'master';
const SERVICE_NAME = process.env.SERVICE_NAME || 'ripple-watch';

if (!RENDER_API_KEY) { console.error('❌ 缺少环境变量 RENDER_API_KEY'); process.exit(1); }
if (!LLM_API_KEY) { console.error('❌ 缺少环境变量 LLM_API_KEY'); process.exit(1); }

function req(method, path, body) {
  const url = API + path;
  const opts = {
    method,
    headers: {
      'Authorization': 'Bearer ' + RENDER_API_KEY,
      'accept': 'application/json',
      'content-type': 'application/json'
    }
  };
  if (body) opts.body = JSON.stringify(body);
  return fetch(url, opts).then(async (r) => {
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }
    if (!r.ok) {
      const msg = (json && (json.message || (json.errors && JSON.stringify(json.errors)))) || text;
      throw new Error(`[${r.status}] ${method} ${path} -> ${msg}`);
    }
    return json;
  });
}

async function getWorkspaceId() {
  const res = await req('GET', '/workspaces');
  const list = res.data || res || [];
  if (!list.length) throw new Error('未找到任何 workspace，请确认 RENDER_API_KEY 有效');
  console.log('✓ workspace:', list[0].name || list[0].id, '(' + list[0].id + ')');
  return list[0].id;
}

async function createService(ownerId) {
  const body = {
    type: 'web_service',
    name: SERVICE_NAME,
    ownerId,
    repo: REPO,
    branch: BRANCH,
    autoDeploy: 'yes',
    envVars: [
      { key: 'NODE_ENV', value: 'production' },
      { key: 'PORT', value: '10000' },
      { key: 'DATA_DIR', value: '/var/data' },
      { key: 'LLM_API_KEY', value: LLM_API_KEY }
    ],
    serviceDetails: {
      buildCommand: 'npm install',
      startCommand: 'npm start',
      plan: 'starter',
      region: 'singapore',
      healthCheckPath: '/',
      disk: { name: 'ripple-data', mountPath: '/var/data', sizeGB: 1 }
    }
  };
  console.log('→ 创建 web_service:', SERVICE_NAME, '@', REPO, '#' + BRANCH);
  const res = await req('POST', '/services', body);
  const svc = res.service || res;
  console.log('✓ 已创建服务 id=' + svc.id + ' slug=' + svc.slug);
  return svc;
}

async function waitForLive(serviceId, slug) {
  const baseUrl = 'https://' + slug + '.onrender.com';
  console.log('→ 等待首次部署完成（最多 ~12 分钟）...');
  const deadline = Date.now() + 12 * 60 * 1000;
  let last = '';
  while (Date.now() < deadline) {
    try {
      const d = await req('GET', `/services/${serviceId}/deploys?limit=1`);
      const deploys = d.data || d || [];
      const st = deploys[0] ? deploys[0].status : 'pending';
      if (st !== last) { console.log('   部署状态:', st); last = st; }
      if (st === 'live' || st === 'deployed') {
        console.log('✓ 部署完成');
        return baseUrl;
      }
      if (st === 'build_failed' || st === 'deploy_failed' || st === 'canceled') {
        throw new Error('部署失败，请用 dashboard 查看日志: ' + (deploys[0] && deploys[0].dashboardUrl));
      }
    } catch (e) {
      if (/部署失败/.test(e.message)) throw e;
    }
    await new Promise(r => setTimeout(r, 15000));
  }
  console.log('⚠ 超时未确认 live，但服务可能仍在构建。请访问 dashboard 查看。');
  return baseUrl;
}

(async () => {
  try {
    const ownerId = await getWorkspaceId();
    const svc = await createService(ownerId);
    const url = await waitForLive(svc.id, svc.slug);
    console.log('\n========================================');
    console.log('🚀 正式上线地址：');
    console.log('   ' + url);
    console.log('   后台：' + url + '/admin  （admin / Admin@888）');
    console.log('========================================');
  } catch (e) {
    console.error('\n❌ 部署中断:', e.message);
    process.exit(1);
  }
})();
