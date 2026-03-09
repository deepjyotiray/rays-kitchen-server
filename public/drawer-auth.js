/* drawer-auth.js — shared across all pages */
(function () {

  /* ── Inject OTP modal HTML once ── */
  function ensureOTPModal() {
    if (document.getElementById('otp-modal')) return;
    const div = document.createElement('div');
    div.innerHTML = `
<div id="otp-modal" class="otp-modal-overlay">
  <div class="otp-modal-content">
    <div class="otp-header">Verify Mobile Number</div>
    <div id="otp-mobile-step">
      <input type="tel" id="otp-mobile" class="otp-input" placeholder="Enter 10-digit mobile" maxlength="10" inputmode="numeric">
      <div id="otp-message" class="otp-message"></div>
      <div class="otp-actions">
        <button type="button" id="otp-send-btn" class="otp-btn otp-btn-primary">Send OTP</button>
        <button type="button" class="otp-btn otp-btn-secondary" onclick="closeOTPModal()">Cancel</button>
      </div>
    </div>
    <div id="otp-verify-step" style="display:none">
      <input type="text" id="otp-code" class="otp-input" placeholder="Enter 6-digit OTP" maxlength="6" inputmode="numeric">
      <div class="otp-actions">
        <button type="button" id="otp-verify-btn" class="otp-btn otp-btn-primary">Verify</button>
        <button type="button" class="otp-btn otp-btn-secondary" onclick="resetOTPSteps()">Change Number</button>
      </div>
    </div>
  </div>
</div>`;
    document.body.appendChild(div.firstElementChild);
    document.getElementById('otp-modal').addEventListener('click', e => { if (e.target.id === 'otp-modal') closeOTPModal(); });
    document.getElementById('otp-send-btn').addEventListener('click', sendOTPDrawer);
    document.getElementById('otp-verify-btn').addEventListener('click', verifyOTPDrawer);
  }

  /* Don't override if menu.js already defined it */
  if (!window.showOTPModal) window.showOTPModal = function () {
    ensureOTPModal();
    resetOTPSteps();
    document.getElementById('otp-modal').classList.add('show');
  };

  window.closeOTPModal = function () {
    const m = document.getElementById('otp-modal');
    if (m) m.classList.remove('show');
  };

  window.resetOTPSteps = function () {
    document.getElementById('otp-mobile-step').style.display = 'block';
    document.getElementById('otp-verify-step').style.display = 'none';
    document.getElementById('otp-mobile').value = '';
    document.getElementById('otp-code').value = '';
    setOTPMsg('', '');
  };

  function setOTPMsg(msg, type) {
    const el = document.getElementById('otp-message');
    el.textContent = msg;
    el.style.background = type === 'error' ? '#fee' : type === 'success' ? '#efe' : '';
    el.style.color = type === 'error' ? '#c00' : type === 'success' ? '#060' : '';
  }

  async function sendOTPDrawer() {
    const mobile = document.getElementById('otp-mobile').value.trim();
    if (!/^[0-9]{10}$/.test(mobile)) { setOTPMsg('Enter valid 10-digit mobile', 'error'); return; }
    try {
      const res = await fetch('/api/auth/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile }) });
      const data = await res.json();
      if (data.success) {
        document.getElementById('otp-mobile-step').style.display = 'none';
        document.getElementById('otp-verify-step').style.display = 'block';
      } else { setOTPMsg(data.error || 'Failed to send OTP', 'error'); }
    } catch { setOTPMsg('Network error', 'error'); }
  }

  async function verifyOTPDrawer() {
    const mobile = document.getElementById('otp-mobile').value.trim();
    const otp = document.getElementById('otp-code').value.trim();
    if (!/^[0-9]{6}$/.test(otp)) { setOTPMsg('Enter valid 6-digit OTP', 'error'); return; }
    try {
      const res = await fetch('/api/auth/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mobile, otp }) });
      const data = await res.json();
      if (data.success) { closeOTPModal(); syncDrawerUser(); if (typeof showToast === 'function') showToast('Logged in successfully!'); if (typeof window._chatbotSendPending === 'function') window._chatbotSendPending(); }
      else { setOTPMsg(data.error || 'Invalid OTP', 'error'); }
    } catch { setOTPMsg('Network error', 'error'); }
  }

  /* ── Sync drawer user section ── */
  window.syncDrawerUser = function () {
    fetch('/api/auth/session').then(r => r.json()).then(data => {
      if (!data.authenticated) return showLoggedOut();
      fetch('/users/' + data.mobile).then(r => r.json()).then(u => {
        u.user ? showLoggedIn(u.user) : showLoggedOut();
      }).catch(showLoggedOut);
    }).catch(showLoggedOut);
  };

  function showLoggedIn(user) {
    const nameEl = document.getElementById('drawer-user-name');
    const phoneEl = document.getElementById('drawer-user-phone');
    const info = document.getElementById('drawer-user-info');
    const authBtns = document.getElementById('drawer-auth-btns');
    const ordersLi = document.getElementById('drawer-my-orders-li');
    const logoutLi = document.getElementById('drawer-logout-li');
    if (nameEl) nameEl.textContent = user.name;
    if (phoneEl) phoneEl.textContent = user.mobile;
    if (info) info.style.display = 'block';
    if (authBtns) authBtns.style.display = 'none';
    if (ordersLi) ordersLi.style.display = 'block';
    if (logoutLi) logoutLi.style.display = 'block';
  }

  function showLoggedOut() {
    const info = document.getElementById('drawer-user-info');
    const authBtns = document.getElementById('drawer-auth-btns');
    const ordersLi = document.getElementById('drawer-my-orders-li');
    const logoutLi = document.getElementById('drawer-logout-li');
    if (info) info.style.display = 'none';
    if (authBtns) authBtns.style.display = 'flex';
    if (ordersLi) ordersLi.style.display = 'none';
    if (logoutLi) logoutLi.style.display = 'none';
  }

  /* Run on load */
  document.addEventListener('DOMContentLoaded', syncDrawerUser);

  /* Minimal toast for pages without menu.js */
  if (!window.showToast) {
    window.showToast = function(msg) {
      let t = document.getElementById('toast');
      if (!t) {
        t = document.createElement('div');
        t.id = 'toast';
        t.className = 'toast';
        t.setAttribute('role', 'status');
        document.body.appendChild(t);
      }
      t.textContent = msg;
      t.classList.add('show');
      setTimeout(() => t.classList.remove('show'), 2000);
    };
  }

})();
