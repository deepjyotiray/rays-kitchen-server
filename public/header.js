/* ===== SHARED HEADER COMPONENT =====
   Injects app-bar + all sub-header bars into the page.
   Call initHeader(activeTab) after DOM is ready, or it auto-runs on DOMContentLoaded.
*/
(function() {
  function inject(activeTab) {
    activeTab = activeTab || (location.hash.replace('#','') || 'menu');

    const appBar = document.createElement('header');
    appBar.className = 'app-bar';
    appBar.innerHTML = `
      <a href="/#menu" class="app-bar-brand" style="margin-left:-4px">
        <img src="/favicon.png" alt="" class="app-bar-logo" width="48" height="48">
      </a>
      <div class="ab-order-type" id="ab-order-type-wrap">
        <button class="ab-order-type-btn" onclick="toggleOrderTypeMenu()" aria-haspopup="true">
          <span id="ab-order-type-label">Healthy Meals Delivery</span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><path d="M2 4l4 4 4-4"/></svg>
        </button>
        <div class="ab-order-type-menu" id="ab-order-type-menu" style="display:none">
          <button onclick="selectOrderType('Healthy Meals Delivery')" class="selected">Healthy Meals Delivery</button>
          <button onclick="selectOrderType('Healthy Meals Take Away')">Healthy Meals Take Away</button>
          <button onclick="selectOrderType('Bulk Orders')">Bulk Orders</button>
        </div>
      </div>
      <div class="ab-location-wrap" id="ab-location-wrap">
        <button class="ab-location-btn" id="ab-location-btn" onclick="toggleLocationMenu()">
          <span class="ab-location-icon">📍</span>
          <span class="ab-location-text">
            <span class="ab-location-name" id="ab-location-name">Healthy Meal Spot, Mumbai</span>
            <span class="ab-location-sub" id="ab-location-sub"></span>
          </span>
          <svg class="ab-chevron" width="14" height="14" viewBox="0 0 12 12" fill="currentColor"><path d="M2 4l4 4 4-4"/></svg>
        </button>
      </div>
      <button class="ab-time-btn" onclick="openDeliveryTimeModal()">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        <span id="ab-time-label">Now</span>
      </button>
      <div class="app-bar-actions">
        <span id="app-bar-greeting" class="top-nav-link" style="font-size:16px;font-weight:800;color:var(--accent);letter-spacing:0.3px">Hi there !</span>
        <a href="/#menu"       class="top-nav-link app-bar-nav-link" data-tab="menu"      onclick="return navTab('menu')">🍽️ Menu</a>
        <a href="/#nutrition"  class="top-nav-link app-bar-nav-link" data-tab="nutrition" onclick="return navTab('nutrition')">🌿 Nutrition</a>
        <a href="/#consult"    class="top-nav-link app-bar-nav-link" data-tab="consult"   onclick="return navTab('consult')">🩺 Consult</a>
        <a href="/#about"      class="top-nav-link app-bar-nav-link" data-tab="about"     onclick="return navTab('about')">About</a>
        <a href="/#myhealth"   class="top-nav-link app-bar-nav-link" data-tab="myhealth"  id="desktop-myhealth-btn" onclick="return navTab('myhealth')">❤️ My Health</a>
      </div>`;

    const subHeaders = document.createElement('div');
    subHeaders.id = 'sub-headers';
    subHeaders.innerHTML = `
      <div id="consult-header-bar" style="display:none">
        <div class="menu-header-top">
          <h1 class="menu-header-title">🩺 Consult a Nutritionist</h1>
        </div>
        <div class="menu-header-filters">
          <div class="nutrition-search-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--muted);flex-shrink:0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input id="consult-header-search" type="search" placeholder="Search nutritionists, specialties..." autocomplete="off" oninput="filterConsultCards(this.value)">
            <button onclick="filterConsultCards('')" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:0;font-size:13px;line-height:1" aria-label="Clear">✕</button>
          </div>
        </div>
      </div>

      <div id="myhealth-header-bar" style="display:none">
        <div class="menu-header-top">
          <h1 class="menu-header-title" id="mhb-title">❤️ My Health</h1>
        </div>
      </div>

      <div id="nutrition-header-bar" style="display:none">
        <div class="menu-header-top">
          <h1 class="menu-header-title">🌿 Nutrition Hub</h1>
          <span id="nutrition-header-tagline" style="margin-left:10px;font-size:12px;font-weight:600;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis"></span>
        </div>
        <div class="menu-header-filters">
          <div class="nutrition-search-pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="color:var(--muted);flex-shrink:0"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            <input id="nutrition-header-search" type="search" placeholder="Search articles..." autocomplete="off" oninput="onNutritionSearchInput(this.value)">
            <button onclick="onNutritionSearchInput('')" style="background:none;border:none;color:var(--muted);cursor:pointer;padding:0;font-size:13px;line-height:1" aria-label="Clear">✕</button>
          </div>
        </div>
      </div>

      <div id="menu-header-bar" style="display:none">
        <div class="menu-header-top">
          <h1 class="menu-header-title">Our Menu</h1>
        </div>
        <div class="menu-header-filters">
          <div class="food-toggle-item" id="ft-veg" onclick="toggleFoodFilter('veg',this)">
            <div class="food-toggle">
              <div class="food-toggle__toggle-strip"></div>
              <div class="food-toggle__toggle-thumb">
                <img src="https://assets.mcdelivery.co.in/icons/veg-filter.svg" alt="ic-veg-filter" loading="lazy" style="object-fit:contain;width:16px;height:16px">
              </div>
            </div>
          </div>
          <div class="food-toggle-item" id="ft-nonveg" onclick="toggleFoodFilter('nonveg',this)">
            <div class="food-toggle">
              <div class="food-toggle__toggle-strip"></div>
              <div class="food-toggle__toggle-thumb">
                <img src="https://assets.mcdelivery.co.in/icons/nonveg-filter.svg" alt="ic-nonveg-filter" loading="lazy" style="object-fit:contain;width:16px;height:16px">
              </div>
            </div>
          </div>
          <div class="food-toggle-item" id="ft-egg" onclick="toggleFoodFilter('egg',this)">
            <div class="food-toggle">
              <div class="food-toggle__toggle-strip"></div>
              <div class="food-toggle__toggle-thumb">
                <img src="https://assets.mcdelivery.co.in/icons/egg-filter.svg" alt="ic-egg-filter" loading="lazy" style="object-fit:contain;width:16px;height:16px">
              </div>
            </div>
          </div>
          <button class="top-sellers-tab" id="ft-topsellers" onclick="toggleTopSellers(this)" aria-pressed="false">Top Sellers</button>
          <div id="menu-search-wrapper" class="menu-search-wrapper">
            <button id="menu-header-search-btn" class="menu-header-search-btn" onclick="openMenuSearch()" aria-label="Search">
              <img src="https://assets.mcdelivery.co.in/icons/search-medium.svg" alt="search" loading="lazy" style="object-fit:contain;width:24px;height:24px">
            </button>
            <div id="menu-search-pill" class="menu-search-pill">
              <div class="autocomplete-wrapper">
                <input id="menu-search-inline" type="text" placeholder="Search here" enterkeyhint="search" maxlength="75" oninput="onMenuSearchInput(this.value)">
                <div class="ghost-text"><span class="suggestion" role="button" tabindex="0"></span></div>
              </div>
              <button class="menu-search-clear" onclick="clearMenuSearch()" aria-label="Clear search">✕</button>
            </div>
          </div>
        </div>
      </div>`;

    // Insert at top of body
    document.body.insertBefore(subHeaders, document.body.firstChild);
    document.body.insertBefore(appBar, document.body.firstChild);

    // Set active nav link
    setHeaderActiveTab(activeTab);
  }

  window.setHeaderActiveTab = function(tab) {
    document.querySelectorAll('.app-bar-nav-link').forEach(a => {
      a.classList.toggle('active', a.dataset.tab === tab);
    });
  };

  // navTab for pages that are NOT index.html (satellite pages redirect, but just in case)
  window.navTab = function(tab) {
    if (typeof switchTab === 'function') {
      switchTab(tab);
      return false; // prevent href navigation
    }
    location.href = '/#' + tab;
    return false;
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => inject());
  } else {
    inject();
  }
})();
