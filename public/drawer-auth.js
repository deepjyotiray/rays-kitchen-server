/* drawer-auth.js — shared across all pages */
(function () {

  function ensureOTPModal() {
    if (document.getElementById('otp-modal')) return;
    const el = document.createElement('div');
    el.id = 'otp-modal';
    el.className = 'otp-modal-overlay';
    el.innerHTML = `
      <div class="otp-login-hero">
        <div class="otp-login-logo">🍱</div>
        <h1 class="otp-login-title">Healthy Meal Spot</h1>
        <p class="otp-login-sub">Fresh, home-cooked meals delivered to you</p>
      </div>
      <div class="otp-login-card">
        <div id="otp-mobile-step">
          <h2 class="otp-step-heading">Login / Sign Up</h2>
          <p class="otp-step-sub">Enter your mobile number to continue</p>
          <div id="otp-message" class="otp-message"></div>
          <div class="otp-field">
            <span class="otp-prefix">+91 –</span>
            <input type="tel" id="mob-input" placeholder="10-digit mobile" maxlength="10" inputmode="numeric" autocomplete="tel">
          </div>
          <button class="otp-submit-btn" id="otp-send-btn">Continue</button>
          <button class="otp-ghost-btn" onclick="closeOTPModal()">Cancel</button>
        </div>
        <div id="otp-verify-step" style="display:none">
          <h2 class="otp-step-heading">Verify OTP</h2>
          <p class="otp-step-sub" id="otp-verify-sub">Sent to <strong></strong> via WhatsApp</p>
          <div id="otp-verify-message" class="otp-message"></div>
          <div class="otp-boxes" id="otp-boxes">
            <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]">
            <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]">
            <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]">
            <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]">
            <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]">
            <input type="text" maxlength="1" inputmode="numeric" pattern="[0-9]">
          </div>
          <button class="otp-submit-btn" id="otp-verify-btn">Verify</button>
          <div class="otp-resend">
            Didn't receive? <button id="otp-resend-btn" disabled>Resend</button><span id="otp-resend-timer"></span>
          </div>
          <button class="otp-ghost-btn" onclick="resetOTPSteps()">← Change number</button>
        </div>
      </div>`;
    document.body.appendChild(el);

    // Wire mobile input
    document.getElementById('mob-input').addEventListener('input', () => {
      if (getMobileDigits().length === 10) sendOTPDrawer();
    });
    document.getElementById('mob-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') sendOTPDrawer();
    });

    // Wire OTP boxes auto-advance
    const boxesEl = document.getElementById('otp-boxes');
    boxesEl.addEventListener('input', e => {
      const boxes = [...boxesEl.querySelectorAll('input')];
      const i = boxes.indexOf(e.target);
      if (e.target.value && i < boxes.length - 1) boxes[i + 1].focus();
      if (getOTPCode().length === 6) verifyOTPDrawer();
    });
    boxesEl.addEventListener('keydown', e => {
      const boxes = [...boxesEl.querySelectorAll('input')];
      const i = boxes.indexOf(e.target);
      if (e.key === 'Backspace' && !e.target.value && i > 0) boxes[i - 1].focus();
    });

    document.getElementById('otp-send-btn').addEventListener('click', sendOTPDrawer);
    document.getElementById('otp-verify-btn').addEventListener('click', verifyOTPDrawer);
    document.getElementById('otp-resend-btn').addEventListener('click', resendOTPDrawer);
  }

  function getMobileDigits() {
    return (document.getElementById('mob-input')?.value || '').trim();
  }

  function getOTPCode() {
    return [...document.querySelectorAll('#otp-boxes input')].map(b => b.value).join('');
  }

  function setMsg(id, text, type) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = text;
    el.style.background = type === 'error' ? '#fff0ee' : type === 'success' ? '#ecfdf3' : '';
    el.style.color = type === 'error' ? '#c0392b' : type === 'success' ? '#166534' : '';
    el.style.display = text ? 'block' : 'none';
  }

  let _otpMobile = '';
  let _resendTick = null;

  function getDrawerDialCode() {
    const v = document.getElementById('otp-dial-code')?.value || '+91';
    return v === '+1-CA' ? '+1' : v;
  }

  function startResend(secs = 30) {
    const btn = document.getElementById('otp-resend-btn');
    const timer = document.getElementById('otp-resend-timer');
    btn.disabled = true;
    let t = secs;
    timer.textContent = ` (${t}s)`;
    clearInterval(_resendTick);
    _resendTick = setInterval(() => {
      t--;
      if (t <= 0) { clearInterval(_resendTick); btn.disabled = false; timer.textContent = ''; }
      else timer.textContent = ` (${t}s)`;
    }, 1000);
  }

  async function sendOTPDrawer() {
    const raw = getMobileDigits();
    if (!/^[0-9]{10}$/.test(raw)) { setMsg('otp-message', 'Enter a valid 10-digit mobile number', 'error'); return; }
    _otpMobile = getDrawerDialCode() + raw;
    const btn = document.getElementById('otp-send-btn');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      const res = await fetch('/api/auth/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: _otpMobile }) });
      const data = await res.json();
      if (!data.success) { setMsg('otp-message', data.error || 'Failed to send OTP', 'error'); return; }
      const dialCode = getDrawerDialCode();
      document.querySelector('#otp-verify-sub strong').textContent = dialCode + '-' + raw;
      document.getElementById('otp-mobile-step').style.display = 'none';
      document.getElementById('otp-verify-step').style.display = 'block';
      document.querySelector('#otp-boxes input').focus();
      startResend();
    } catch { setMsg('otp-message', 'Network error. Try again.', 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Continue'; }
  }

  async function resendOTPDrawer() {
    try {
      const res = await fetch('/api/auth/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: _otpMobile }) });
      const data = await res.json();
      if (data.success) startResend();
      else setMsg('otp-verify-message', data.error || 'Failed to resend', 'error');
    } catch { setMsg('otp-verify-message', 'Network error', 'error'); }
  }

  async function verifyOTPDrawer() {
    const otp = getOTPCode();
    if (otp.length !== 6) { setMsg('otp-verify-message', 'Enter the 6-digit OTP', 'error'); return; }
    const btn = document.getElementById('otp-verify-btn');
    btn.disabled = true; btn.textContent = 'Verifying…';
    try {
      const res = await fetch('/api/auth/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile: _otpMobile, otp }) });
      const data = await res.json();
      if (!data.success) { setMsg('otp-verify-message', data.error || 'Invalid OTP', 'error'); return; }
      closeOTPModal();
      const m = data.mobile.startsWith('+') ? data.mobile : '+91' + data.mobile;
      fetch('/users/' + encodeURIComponent(m)).then(r => r.json()).then(ud => {
        if (ud.user) { window.currentUser = ud.user; }
        if (typeof syncTopNav === 'function') syncTopNav();
        if (typeof initMyHealth === 'function') initMyHealth();
      });
      if (typeof showToast === 'function') showToast('Logged in successfully! 🎉');
    } catch { setMsg('otp-verify-message', 'Network error. Try again.', 'error'); }
    finally { btn.disabled = false; btn.textContent = 'Verify'; }
  }

  function _vpResize() {
    const m = document.getElementById('otp-modal');
    if (!m) return;
    m.scrollTo(0, 0);
  }

  function _attachViewportLock() {
    if (!window.visualViewport) return;
    window.visualViewport.removeEventListener('resize', _vpResize);
    window.visualViewport.addEventListener('resize', _vpResize);
  }

  if (!window.showOTPModal) window.showOTPModal = function () {
    ensureOTPModal();
    window.resetOTPSteps();
    document.getElementById('otp-modal').classList.add('show');
    document.body.style.overflow = 'hidden';
    _attachViewportLock();
    setTimeout(() => document.getElementById('mob-input')?.focus(), 100);
  };
  // Always expose as _drawerShowOTPModal so menu.js can delegate to it
  window._drawerShowOTPModal = function () {
    ensureOTPModal();
    window.resetOTPSteps();
    document.getElementById('otp-modal').classList.add('show');
    document.body.style.overflow = 'hidden';
    _attachViewportLock();
    setTimeout(() => document.getElementById('mob-input')?.focus(), 100);
  };

  window.closeOTPModal = function () {
    const m = document.getElementById('otp-modal');
    if (m) { m.classList.remove('show'); }
    document.body.style.overflow = '';
    clearInterval(_resendTick);
    if (window.visualViewport) window.visualViewport.removeEventListener('resize', _vpResize);
  };

  window.resetOTPSteps = function () {
    ensureOTPModal();
    document.getElementById('otp-mobile-step').style.display = 'block';
    document.getElementById('otp-verify-step').style.display = 'none';
    const mobInput = document.getElementById('mob-input');
    if (mobInput) mobInput.value = '';
    [...document.querySelectorAll('#otp-boxes input')].forEach(b => b.value = '');
    setMsg('otp-message', '', '');
    setMsg('otp-verify-message', '', '');
    setTimeout(() => document.getElementById('mob-input')?.focus(), 50);
  };

  /* ── Sync drawer user section ── */
  window.syncDrawerUser = function () {
    fetch('/api/auth/session').then(r => r.json()).then(data => {
      if (!data.authenticated) return;
      const m = data.mobile.startsWith('+') ? data.mobile : '+91' + data.mobile;
      fetch('/users/' + encodeURIComponent(m)).then(r => r.json()).then(u => {
        if (u.user) { window.currentUser = u.user; if (typeof syncTopNav === 'function') syncTopNav(); }
      }).catch(() => {});
    }).catch(() => {});
  };

  document.addEventListener('DOMContentLoaded', syncDrawerUser);

  if (!window.showToast) {
    window.showToast = function (msg) {
      let t = document.getElementById('toast');
      if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2500);
    };
  }

})();
