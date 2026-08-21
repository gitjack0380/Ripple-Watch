/* 涟漪观察 · 前端交互（真实 API） */
document.addEventListener('DOMContentLoaded', function () {

  /* ---------- 弹窗 ---------- */
  function showModal(title, msg) {
    var m = document.getElementById('modal');
    if (!m) return;
    m.querySelector('h3').textContent = title;
    m.querySelector('p').textContent = msg;
    m.classList.add('show');
  }
  var mask = document.querySelector('.modal-mask');
  if (mask) mask.addEventListener('click', function (e) { if (e.target === this) this.classList.remove('show'); });

  /* ---------- 会员 月/年 切换 ---------- */
  var toggleBtns = document.querySelectorAll('.toggle button');
  var priceEls = document.querySelectorAll('[data-price]');
  toggleBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      toggleBtns.forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      var mode = b.dataset.mode;
      var unit = document.getElementById('unit');
      priceEls.forEach(function (el) {
        el.textContent = mode === 'year' ? el.dataset.year : el.dataset.month;
      });
      if (unit) unit.textContent = mode === 'year' ? '年' : '月';
    });
  });

  /* ---------- 订阅（真实下单，按支付模式分流） ---------- */
  document.querySelectorAll('[data-action="subscribe"]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var plan = btn.dataset.plan || 'month';
      fetch('/api/me').then(r => r.json()).then(function (me) {
        if (!me.user) { window.location.href = '/login?next=/membership'; return; }
        btn.disabled = true; btn.textContent = '处理中…';
        fetch('/api/subscribe', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: plan })
        }).then(r => r.json()).then(function (d) {
          if (d.mode === 'external' && d.payUrl) {
            // 跳转第三方店铺完成支付，支付成功后由回跳链接激活会员
            window.location.href = d.payUrl;
            return;
          }
          if (d.ok) {
            if (d.mode === 'wechat' && !d.test && d.codeUrl) {
              showModal('请扫码支付', '微信支付二维码地址：' + d.codeUrl + '（正式环境前端应渲染二维码图片）');
              btn.disabled = false; btn.textContent = '开通' + (plan === 'year' ? '年卡' : '月卡');
              return;
            }
            showModal('订阅成功 🎉', d.msg || '你已成为会员，全部深度解读已解锁。');
            setTimeout(function () { window.location.reload(); }, 1500);
          } else {
            btn.disabled = false; btn.textContent = '开通' + (plan === 'year' ? '年卡' : '月卡');
            showModal('未能订阅', d.msg || '请稍后再试');
          }
        }).catch(function () {
          btn.disabled = false;
          showModal('网络错误', '请求失败，请检查网络后重试');
        });
      });
    });
  });

  /* ---------- 已完成购买但未自动激活（external 模式引导） ---------- */
  var activateBtn = document.querySelector('[data-action="activate"]');
  if (activateBtn) {
    activateBtn.addEventListener('click', function () {
      fetch('/api/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
        .then(r => r.json()).then(function (d) {
          if (d.ok) { showModal('激活成功 🎉', d.msg || '会员已开通'); setTimeout(function () { location.reload(); }, 1200); }
          else showModal('激活失败', d.msg || '请确认你已在小鹅通完成购买，或联系客服');
        }).catch(function () { showModal('网络错误', '请求失败，请重试'); });
    });
  }

  /* ---------- 广告位（演示） ---------- */
  document.querySelectorAll('[data-action="ad"]').forEach(function (b) {
    b.addEventListener('click', function () {
      showModal('广告主合作', '这是广告位演示。正式版可接入 AdSense / 百度联盟 / 穿山甲，或承接品牌原生广告。');
    });
  });

  /* ---------- 登录 / 注册 表单 ---------- */
  var form = document.getElementById('auth-form');
  if (form) {
    var modeEl = document.getElementById('auth-mode');
    var submitBtn = document.getElementById('auth-submit');
    var switchLink = document.getElementById('auth-switch');
    var next = (new URLSearchParams(location.search)).get('next') || '/membership';

    function setMode(m) {
      modeEl.value = m;
      submitBtn.textContent = m === 'login' ? '登录' : '注册并登录';
      switchLink.textContent = m === 'login' ? '没有账号？去注册' : '已有账号？去登录';
    }
    if (switchLink) switchLink.addEventListener('click', function (e) {
      e.preventDefault();
      setMode(modeEl.value === 'login' ? 'register' : 'login');
    });
    setMode('login');

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var account = form.account.value.trim();
      var password = form.password.value;
      var mode = modeEl.value;
      var url = mode === 'login' ? '/api/login' : '/api/register';
      submitBtn.disabled = true; submitBtn.textContent = '处理中…';
      fetch(url, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: account, password: password })
      }).then(r => r.json()).then(function (d) {
        if (d.ok) { window.location.href = next; }
        else { submitBtn.disabled = false; submitBtn.textContent = mode === 'login' ? '登录' : '注册并登录'; showModal('操作失败', d.msg || '请重试'); }
      }).catch(function () {
        submitBtn.disabled = false; showModal('网络错误', '请求失败，请重试');
      });
    });
  }

  /* ---------- 登出 ---------- */
  var logout = document.querySelector('[data-action="logout"]');
  if (logout) logout.addEventListener('click', function () {
    fetch('/api/logout', { method: 'POST' }).then(function () { window.location.href = '/'; });
  });

  /* ---------- 搜索（演示） ---------- */
  var s = document.querySelector('.search input');
  if (s) s.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && s.value.trim()) showModal('搜索：' + s.value.trim(), '演示环境：正式版将返回相关全球大事及影响解读。');
  });

});
