// ── Config ──────────────────────────────────────────────────────────────────
const PAGE_SIZE = 40;
const DDV = "16.4.1"; // Data Dragon version for images
const IMG_BASE = `https://ddragon.leagueoflegends.com/cdn/img/champion/loading/`;

// ── State ────────────────────────────────────────────────────────────────────
let filtered = [];
let page = 0;
let activeTier = "all";
let activeChampion = "all";
let activeSkinLine = "all";
let activeYear = "all";
let sortBy = "newest";
let searchQuery = "";

// ── Store state ──────────────────────────────────────────────────────────────
const MOCK_RP_KEY   = 'lolskins_rp';
const OWNED_KEY     = 'lolskins_owned';
const STARTING_RP   = 15000;

function getMockRP()  { return parseInt(localStorage.getItem(MOCK_RP_KEY) ?? STARTING_RP, 10); }
function setMockRP(v) {
  localStorage.setItem(MOCK_RP_KEY, String(v));
  const el = document.getElementById('headerRP');
  if (el) el.textContent = v.toLocaleString();
}
function getOwned()   { try { return new Set(JSON.parse(localStorage.getItem(OWNED_KEY) || '[]')); } catch { return new Set(); } }
function addOwned(id) { const o = getOwned(); o.add(String(id)); localStorage.setItem(OWNED_KEY, JSON.stringify([...o])); }

// ── DOM refs ─────────────────────────────────────────────────────────────────
const purchaseOverlay = document.getElementById("purchaseOverlay");
const purchaseBody    = document.getElementById("purchaseBody");
const grid         = document.getElementById("skinsGrid");
const loadMoreWrap = document.getElementById("loadMore");
const loadMoreBtn  = document.getElementById("loadMoreBtn");
const noResults    = document.getElementById("noResults");
const resultsCount = document.getElementById("resultsCount");
const totalSkinsEl = document.getElementById("totalSkins");
const totalChampEl = document.getElementById("totalChampions");
const searchInput  = document.getElementById("searchInput");
const clearSearch  = document.getElementById("clearSearch");
const overlay      = document.getElementById("modalOverlay");
const modalBody    = document.getElementById("modalBody");
const modalClose   = document.getElementById("modalClose");

// ── Analytics ────────────────────────────────────────────────────────────────
function track(event, params = {}) {
  if (typeof gtag === "function") gtag("event", event, params);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function tierColor(tier) {
  const map = { Ultimate:"--ultimate", Mythic:"--mythic", Legendary:"--legendary", Epic:"--epic", Standard:"--standard", Budget:"--budget", Rare:"--rare" };
  return map[tier] || "--text";
}

function rpLabel(skin) {
  if (skin.rp === 0) return skin.availability === "Rare" ? "Gem / Prestige / Event" : "0 RP";
  return `${(skin.rp ?? 0).toLocaleString()} RP`;
}

function imgUrl(skin) {
  return `${IMG_BASE}${skin.champion}_${skin.splashIndex || 0}.jpg`;
}

function yearOf(skin) {
  return skin.releaseDate ? skin.releaseDate.slice(0, 4) : "?";
}

// ── Populate dropdowns ───────────────────────────────────────────────────────
function populateDropdowns() {
  const champions = [...new Set(window.SKINS.map(s => s.champion))].sort();
  const skinLines = [...new Set(window.SKINS.map(s => s.skinLine))].sort();
  const years     = [...new Set(window.SKINS.map(s => yearOf(s)))].sort().reverse();

  const champSel = document.getElementById("championFilter");
  champions.forEach(c => champSel.insertAdjacentHTML("beforeend", `<option value="${c}">${c}</option>`));

  const lineSel = document.getElementById("skinLineFilter");
  skinLines.forEach(l => lineSel.insertAdjacentHTML("beforeend", `<option value="${l}">${l}</option>`));

  const yearSel = document.getElementById("yearFilter");
  years.forEach(y => yearSel.insertAdjacentHTML("beforeend", `<option value="${y}">${y}</option>`));

  const unique = new Set(window.SKINS.map(s => s.champion));
  totalSkinsEl.textContent = window.SKINS.length;
  totalChampEl.textContent = unique.size;
}

// ── Filter + Sort ────────────────────────────────────────────────────────────
function applyFilters() {
  const q = searchQuery.toLowerCase();
  filtered = window.SKINS.filter(s => {
    if (activeTier !== "all" && s.tier !== activeTier) return false;
    if (activeChampion !== "all" && s.champion !== activeChampion) return false;
    if (activeSkinLine !== "all" && s.skinLine !== activeSkinLine) return false;
    if (activeYear !== "all" && yearOf(s) !== activeYear) return false;
    if (q && !s.name.toLowerCase().includes(q) && !s.champion.toLowerCase().includes(q) && !s.skinLine.toLowerCase().includes(q)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    switch (sortBy) {
      case "newest":     return (b.releaseDate || "0000").localeCompare(a.releaseDate || "0000");
      case "oldest":     return (a.releaseDate || "0000").localeCompare(b.releaseDate || "0000");
      case "name-az":    return a.name.localeCompare(b.name);
      case "name-za":    return b.name.localeCompare(a.name);
      case "price-high": return b.rp - a.rp;
      case "price-low":  return a.rp - b.rp;
      case "champion-az":return a.champion.localeCompare(b.champion);
      default:           return 0;
    }
  });

  page = 0;
  grid.innerHTML = "";
  renderPage();
  resultsCount.textContent = `${filtered.length} skin${filtered.length !== 1 ? "s" : ""} found`;
  noResults.style.display = filtered.length === 0 ? "block" : "none";
}

// ── Render ───────────────────────────────────────────────────────────────────
function renderPage() {
  const slice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const owned = getOwned();
  slice.forEach(skin => {
    const card = document.createElement("div");
    card.className = `skin-card tier-card-${skin.tier}`;
    card.dataset.id = skin.id;
    const isOwned   = owned.has(String(skin.id));
    const isFree    = skin.rp === 0;
    const buyLabel  = isOwned ? '✓ Owned' : isFree ? 'Acquire' : `Buy · ${skin.rp.toLocaleString()} RP`;
    card.innerHTML = `
      <img class="card-image" src="${imgUrl(skin)}" alt="${skin.name}" loading="lazy"
           onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
      <div class="card-image-placeholder" style="display:none;">⚔</div>
      <div class="card-overlay">
        <div class="card-bottom">
          <div class="card-name">${skin.name}</div>
          <span class="tier-badge tier-${skin.tier}">${skin.tier}</span>
          <div class="card-footer">
            <span class="card-rp">${rpLabel(skin)}</span>
            <span class="card-avail avail-${skin.availability}">${skin.availability}</span>
          </div>
          <button class="buy-btn${isOwned ? ' owned' : ''}" data-skin-id="${skin.id}">${buyLabel}</button>
        </div>
      </div>`;
    card.querySelector('.buy-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (!isOwned) openPurchaseModal(skin);
    });
    card.addEventListener("click", () => openModal(skin));
    grid.appendChild(card);
  });

  page++;
  const hasMore = page * PAGE_SIZE < filtered.length;
  loadMoreWrap.style.display = hasMore ? "block" : "none";
}

// ── Modal ────────────────────────────────────────────────────────────────────
function openModal(skin) {
  const imgHtml = `<img class="modal-img" src="${imgUrl(skin)}" alt="${skin.name}"
    onerror="this.style.display='none'; this.nextElementSibling.style.display='flex'">
    <div class="modal-img-placeholder" style="display:none;">🎮</div>`;

  modalBody.innerHTML = `
    ${imgHtml}
    <div class="modal-info">
      <div class="modal-header">
        <div class="modal-name">${skin.name}</div>
        <div class="modal-champion">${skin.champion}</div>
      </div>
      <div class="modal-stats">
        <div class="stat-block">
          <div class="stat-label">Tier</div>
          <div class="stat-value"><span class="tier-badge tier-${skin.tier}">${skin.tier}</span></div>
        </div>
        <div class="stat-block">
          <div class="stat-label">Cost</div>
          <div class="stat-value gold">${rpLabel(skin)}</div>
        </div>
        <div class="stat-block">
          <div class="stat-label">Released</div>
          <div class="stat-value">${skin.releaseDate || "Unknown"}</div>
        </div>
        <div class="stat-block">
          <div class="stat-label">Availability</div>
          <div class="stat-value"><span class="card-avail avail-${skin.availability}">${skin.availability}</span></div>
        </div>
        <div class="stat-block" style="grid-column:1/-1">
          <div class="stat-label">Skin Line</div>
          <div class="stat-value">${skin.skinLine}</div>
        </div>
      </div>
      ${skin.lore ? `<div class="modal-lore">${skin.lore}</div>` : ""}
      ${skin.features && skin.features.length ? `
        <div class="modal-features">
          <h4>Features</h4>
          <div class="feature-list">${skin.features.map(f => `<span class="feature-tag">${f}</span>`).join("")}</div>
        </div>` : ""}
    </div>`;

  track("skin_view", { skin_name: skin.name, champion: skin.champion, tier: skin.tier, skin_line: skin.skinLine });
  overlay.classList.add("open");
  document.body.style.overflow = "hidden";
}

function closeModal() {
  overlay.classList.remove("open");
  document.body.style.overflow = "";
}

// ── Event Listeners ──────────────────────────────────────────────────────────
document.getElementById("tierFilters").addEventListener("click", e => {
  const chip = e.target.closest(".chip");
  if (!chip) return;
  document.querySelectorAll("#tierFilters .chip").forEach(c => c.classList.remove("active"));
  chip.classList.add("active");
  activeTier = chip.dataset.value;
  track("filter_tier", { tier: activeTier });
  applyFilters();
});

document.getElementById("championFilter").addEventListener("change", e => {
  activeChampion = e.target.value;
  if (activeChampion !== "all") track("filter_champion", { champion: activeChampion });
  applyFilters();
});
document.getElementById("skinLineFilter").addEventListener("change", e => {
  activeSkinLine = e.target.value;
  if (activeSkinLine !== "all") track("filter_skin_line", { skin_line: activeSkinLine });
  applyFilters();
});
document.getElementById("yearFilter").addEventListener("change", e => {
  activeYear = e.target.value;
  if (activeYear !== "all") track("filter_year", { year: activeYear });
  applyFilters();
});
document.getElementById("sortBy").addEventListener("change", e => {
  sortBy = e.target.value;
  track("sort_change", { sort_by: sortBy });
  applyFilters();
});

let searchTimer;
searchInput.addEventListener("input", e => {
  searchQuery = e.target.value;
  clearSearch.style.display = searchQuery ? "block" : "none";
  clearTimeout(searchTimer);
  if (searchQuery.length >= 2) {
    searchTimer = setTimeout(() => track("search", { search_term: searchQuery, results: filtered.length }), 800);
  }
  applyFilters();
});
clearSearch.addEventListener("click", () => {
  searchInput.value = "";
  searchQuery = "";
  clearSearch.style.display = "none";
  applyFilters();
});

document.getElementById("resetFilters").addEventListener("click", () => {
  activeTier = activeChampion = activeSkinLine = activeYear = activeAvail = "all";
  sortBy = "newest";
  searchQuery = "";
  searchInput.value = "";
  clearSearch.style.display = "none";
  document.querySelectorAll("#tierFilters .chip").forEach((c, i) => c.classList.toggle("active", i === 0));
  document.getElementById("championFilter").value = "all";
  document.getElementById("skinLineFilter").value = "all";
  document.getElementById("yearFilter").value = "all";
  document.getElementById("sortBy").value = "newest";
  track("reset_filters");
  applyFilters();
});

loadMoreBtn.addEventListener("click", () => {
  track("load_more", { page_loaded: page + 1 });
  renderPage();
});
modalClose.addEventListener("click", closeModal);
overlay.addEventListener("click", e => { if (e.target === overlay) closeModal(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeModal(); });

// ── Purchase Modal ───────────────────────────────────────────────────────────
function openPurchaseModal(skin) {
  const rp       = getMockRP();
  const isFree   = skin.rp === 0;
  const canAfford = rp >= skin.rp;

  const priceHtml = isFree
    ? `<div class="pm-price-note">This skin cannot be directly purchased</div>`
    : `<div class="pm-price-row">
         <span class="pm-rp-badge">RP</span>
         <span class="pm-rp-amount">${skin.rp.toLocaleString()}</span>
       </div>
       <div class="pm-balance${canAfford ? '' : ' low'}">
         Your balance: <strong>${rp.toLocaleString()} RP</strong>
         ${!canAfford ? '<span class="pm-insufficient">Insufficient RP</span>' : ''}
       </div>`;

  const actionsHtml = isFree
    ? `<button class="pm-btn-cancel" id="pmCancel">Close</button>`
    : `<button class="pm-btn-cancel" id="pmCancel">Cancel</button>
       <button class="pm-btn-confirm${canAfford ? '' : ' disabled'}" id="pmConfirm" ${canAfford ? '' : 'disabled'}>
         Confirm Purchase
       </button>`;

  purchaseBody.innerHTML = `
    <div class="pm-splash">
      <img src="${imgUrl(skin)}" alt="${skin.name}"
           onerror="this.style.display='none'">
      <div class="pm-splash-overlay"></div>
    </div>
    <div class="pm-info">
      <div class="pm-champion">${skin.champion}</div>
      <div class="pm-name">${skin.name}</div>
      <span class="tier-badge tier-${skin.tier}">${skin.tier}</span>
      ${priceHtml}
      <div class="pm-actions">${actionsHtml}</div>
    </div>`;

  document.getElementById('pmCancel').addEventListener('click', closePurchaseModal);
  const confirmBtn = document.getElementById('pmConfirm');
  if (confirmBtn) confirmBtn.addEventListener('click', () => completePurchase(skin));

  purchaseOverlay.classList.add('open');
  document.body.style.overflow = 'hidden';
  track('purchase_modal_open', { skin_name: skin.name, tier: skin.tier });
}

function completePurchase(skin) {
  const newRP = getMockRP() - skin.rp;
  setMockRP(newRP);
  addOwned(skin.id);

  purchaseBody.innerHTML = `
    <div class="pm-success">
      <div class="pm-success-check">✓</div>
      <div class="pm-success-title">Purchase Complete!</div>
      <div class="pm-success-skin">${skin.name}</div>
      <div class="pm-success-balance">New balance: <strong>${newRP.toLocaleString()} RP</strong></div>
    </div>`;

  // Update card button in grid
  const cardBtn = grid.querySelector(`[data-skin-id="${skin.id}"]`);
  if (cardBtn) {
    cardBtn.textContent = '✓ Owned';
    cardBtn.classList.add('owned');
  }

  track('purchase_complete', { skin_name: skin.name, tier: skin.tier, rp_spent: skin.rp });
  setTimeout(closePurchaseModal, 2200);
}

function closePurchaseModal() {
  purchaseOverlay.classList.remove('open');
  document.body.style.overflow = '';
}

document.getElementById('purchaseClose').addEventListener('click', closePurchaseModal);
purchaseOverlay.addEventListener('click', e => { if (e.target === purchaseOverlay) closePurchaseModal(); });

// ── Init ─────────────────────────────────────────────────────────────────────
document.getElementById('headerRP').textContent = getMockRP().toLocaleString();
populateDropdowns();
applyFilters();
