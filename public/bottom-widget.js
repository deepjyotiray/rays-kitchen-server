/* ── Bottom Widget ─────────────────────────────────────────────────────────
   - Active order: Menu nav icon + text glow when order exists
   - Progress widget: only visible on the menu tab
──────────────────────────────────────────────────────────────────────────── */
(function () {
  const STEPS = [
    { key: 'new',              label: 'Placed',     icon: '✓'  },
    { key: 'confirmed',        label: 'Confirmed',  icon: '🍳' },
    { key: 'out for delivery', label: 'On the Way', icon: '🛵' },
    { key: 'delivered',        label: 'Delivered',  icon: '🎉' },
  ];
  const STATUS_IDX = { 'new': 0, 'confirmed': 1, 'out for delivery': 2, 'on the way': 2, 'pending': 0, 'delivered': 3 };

  const widget = document.getElementById('bottom-widget');
  const track  = document.getElementById('bottom-widget-track');
  const dotsEl = document.getElementById('bottom-widget-dots');
  if (!widget || !track) return;

  let cartCard     = null;
  let orderCards   = {};
  let curIdx       = 0;
  let _activeOrder = null;
  let _currentTab  = 'home';

  // ── nav glow ──────────────────────────────────────────────────────────────

  function setNavGlow(show) {
    const btn = document.querySelector('.mob-nav-btn[data-tab="menu"]');
    if (!btn) return;
    if (show) btn.classList.add('bw-nav-glow');
    else btn.classList.remove('bw-nav-glow');
  }

  // ── tab change ────────────────────────────────────────────────────────────

  window.BottomWidget_onTabChange = function(tab) {
    _currentTab = tab;
    syncVisibility();
  };

  function syncVisibility() {
    const hasCards = !!(cartCard || Object.keys(orderCards).length);

    if (hasCards) {
      widget.classList.add('visible');
      document.body.classList.add('has-bottom-widget');
      requestAnimationFrame(() => goTo(Math.min(curIdx, track.children.length - 1), false));
    } else {
      widget.classList.remove('visible');
      document.body.classList.remove('has-bottom-widget');
    }

    setNavGlow(!!_activeOrder);
  }

  // ── render helpers ────────────────────────────────────────────────────────

  function stepHTML(ds, os) {
    const s = (ds || os || 'new').toLowerCase();
    const activeIdx = STATUS_IDX[s] ?? 0;
    return STEPS.map((st, i) => {
      const cls = i < activeIdx ? 'done' : i === activeIdx ? 'active' : '';
      const connector = i < STEPS.length - 1
        ? `<div class="bw-connector${i < activeIdx ? ' done' : ''}"><div class="bw-connector-fill"></div></div>`
        : '';
      return `<div class="bw-step ${cls}"><div class="bw-dot">${st.icon}</div><span class="bw-lbl">${st.label}</span>${connector}</div>`;
    }).join('');
  }

  function makeOrderCard(order) {
    const el = document.createElement('div');
    el.className = 'bw-card bw-card-order';
    el.dataset.orderId = order.id;
    el.onclick = () => {
      if (typeof showOrderDrawer === 'function') {
        showOrderDrawer(order.id, order.delivery_status, order.status);
      } else {
        try { localStorage.setItem('PENDING_ORDER_TAB', order.id); } catch(_){}
        location.href = '/#order';
      }
    };
    el.innerHTML =
      `<div class="bw-order-top">` +
        `<span class="bw-order-id">${order.id}</span>` +
        `<span class="bw-order-status">${order.delivery_status || order.status || 'New'}</span>` +
      `</div>` +
      `<div class="bw-steps">${stepHTML(order.delivery_status, order.status)}</div>`;
    return el;
  }

  function makeCartCard(count, total) {
    const el = document.createElement('div');
    el.className = 'bw-card bw-card-cart';
    el.onclick = () => { if (typeof togglePlateDrawer === 'function') togglePlateDrawer(); };
    el.innerHTML =
      `<div class="bw-cart-badge" id="bw-cart-badge">${count}</div>` +
      `<span class="bw-cart-label">🍽️ Your Plate</span>` +
      `<span class="bw-cart-total" id="bw-cart-total">₹${total}</span>` +
      `<button class="bw-cart-cta" onclick="event.stopPropagation();if(typeof orderOnWhatsApp==='function')orderOnWhatsApp()">Order →</button>`;
    return el;
  }

  // ── layout ────────────────────────────────────────────────────────────────

  function rebuild() {
    const cards = [];
    if (cartCard) cards.push(cartCard.el);
    Object.values(orderCards).forEach(el => cards.push(el));

    track.innerHTML = '';
    cards.forEach(c => track.appendChild(c));

    dotsEl.innerHTML = '';
    if (cards.length > 1) {
      cards.forEach((_, i) => {
        const d = document.createElement('div');
        d.className = 'bw-dot-ind' + (i === curIdx ? ' active' : '');
        dotsEl.appendChild(d);
      });
    }

    syncVisibility();
  }

  function goTo(idx, animate) {
    curIdx = idx;
    const cardW = widget.offsetWidth || window.innerWidth;
    track.style.transition = animate ? 'transform 0.3s cubic-bezier(.4,0,.2,1)' : 'none';
    track.style.transform = `translateX(${-idx * cardW}px)`;
    dotsEl.querySelectorAll('.bw-dot-ind').forEach((d, i) => d.classList.toggle('active', i === idx));
  }

  // ── swipe ─────────────────────────────────────────────────────────────────

  let tx0 = 0, dragging = false;
  track.addEventListener('touchstart', e => { tx0 = e.touches[0].clientX; dragging = true; }, { passive: true });
  track.addEventListener('touchend', e => {
    if (!dragging) return; dragging = false;
    const dx = e.changedTouches[0].clientX - tx0;
    const total = track.children.length;
    if (dx < -40 && curIdx < total - 1) goTo(curIdx + 1, true);
    else if (dx > 40 && curIdx > 0)     goTo(curIdx - 1, true);
  }, { passive: true });

  // ── public API ────────────────────────────────────────────────────────────

  window.BottomWidget = {
    setCart(count, total) {
      if (count > 0) {
        if (!cartCard) { cartCard = { el: makeCartCard(count, total) }; rebuild(); }
        else {
          cartCard.el.querySelector('#bw-cart-badge').textContent = count;
          cartCard.el.querySelector('#bw-cart-total').textContent = '₹' + total;
        }
      } else {
        if (cartCard) { cartCard = null; rebuild(); }
      }
    },

    setOrders(orders) {
      orderCards = {};
      orders.forEach(o => { orderCards[o.id] = makeOrderCard(o); });
      _activeOrder = orders.length ? { id: orders[0].id, delivery_status: orders[0].delivery_status, status: orders[0].status } : null;
      rebuild();
      orders.forEach(o => this._pollOrder(o.id));
    },

    updateOrderStatus(id, ds, os) {
      if (_activeOrder && _activeOrder.id === id) {
        _activeOrder.delivery_status = ds;
        _activeOrder.status = os;
      }
      const el = orderCards[id];
      if (el) {
        el.querySelector('.bw-order-status').textContent = ds || os || 'New';
        el.querySelector('.bw-steps').innerHTML = stepHTML(ds, os);
      }
      // refresh drawer if open
      const drawer = document.getElementById('order-progress-drawer');
      if (drawer && drawer.classList.contains('open') && typeof showOrderDrawer === 'function') {
        showOrderDrawer(id, ds, os);
      }
      if ((ds || '').toLowerCase() === 'delivered') {
        setTimeout(() => {
          localStorage.removeItem('ACTIVE_ORDER');
          _activeOrder = null;
          delete orderCards[id];
          setNavGlow(false);
          rebuild();
        }, 10000);
      }
    },

    _pollOrder(id) {
      const poll = async () => {
        try {
          const r = await fetch('https://api.healthymealspot.com/orders/' + encodeURIComponent(id) + '/status');
          if (!r.ok) return;
          const d = await r.json();
          this.updateOrderStatus(id, d.delivery_status, d.status);
          if ((d.delivery_status || '').toLowerCase() === 'delivered') clearInterval(t);
        } catch (_) {}
      };
      poll();
      const t = setInterval(poll, 30000);
    },
  };

  // ── init from localStorage ─────────────────────────────────────────────
  try {
    const saved = JSON.parse(localStorage.getItem('ACTIVE_ORDER') || 'null');
    if (saved && saved.orderId) {
      if (Date.now() - new Date(saved.createdAt).getTime() > 86400000) {
        localStorage.removeItem('ACTIVE_ORDER');
      } else {
        const id = saved.orderId;
        fetch('https://api.healthymealspot.com/orders/' + encodeURIComponent(id) + '/status')
          .then(r => r.ok ? r.json() : null)
          .then(d => {
            if (!d) return;
            if ((d.delivery_status || '').toLowerCase() === 'delivered') {
              localStorage.removeItem('ACTIVE_ORDER'); return;
            }
            window.BottomWidget.setOrders([{ id, delivery_status: d.delivery_status, status: d.status }]);
          })
          .catch(() => {});
      }
    }
  } catch (_) {}

})();
