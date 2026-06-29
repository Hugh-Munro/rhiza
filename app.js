// ── Icon (fallback) ───────────────────────────────────────────────────────
const PLANT_ICON = `<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path d="M24 42 C24 42 24 22 24 16 C24 9 17 5 10 7 C17 9 22 16 24 22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"/>
  <path d="M24 30 C24 30 24 22 29 17 C34 12 41 12 41 12 C41 12 36 19 29 23 C26.5 24.5 24 30 24 30" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" fill="none"/>
</svg>`;

// ── Zone colours ──────────────────────────────────────────────────────────
const ZONE_COLOURS = {
  'Woods': { bg: '#d1ead4', color: '#2a6b30' },
  'Field': { bg: '#fde8c0', color: '#8a5200' },
};

function zonePill(zone) {
  if (!zone) return '';
  const style = ZONE_COLOURS[zone]
    ? `background:${ZONE_COLOURS[zone].bg};color:${ZONE_COLOURS[zone].color};`
    : 'background:#e0e0e0;color:#444;';
  return `<span class="zone-pill" style="${style}">${zone}</span>`;
}

// ── Config ───────────────────────────────────────────────────────────────
const TABS = {
  plants: {
    label:      'Plants',
    file:       'data/plants.csv',
    nameCol:    'plant',
    filterCols: {
      zone:       'Zone',
      life_cycle: 'Life Cycle',
    },
  },
};

// ── State ────────────────────────────────────────────────────────────────
let cache         = {};
let photoCache    = {};
let activeTab     = 'plants';
let sortMode      = 'az';
let query         = '';
let viewMode      = 'grid';
let activeFilters = {};
let filterBarOpen = false;
let sortCol       = 0;
let sortDir       = 'asc';

// ── CSV parser ───────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map(line => {
    const vals = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (ch === ',' && !inQ) { vals.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    vals.push(cur.trim());
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] ?? '');
    return obj;
  }).filter(r => r[headers[0]]);
}

// ── Fetch + cache ────────────────────────────────────────────────────────
async function loadTab(tab) {
  if (cache[tab]) return;
  try {
    const [csvRes, imgRes] = await Promise.all([
      fetch(TABS[tab].file),
      fetch('data/plant-images.json'),
    ]);
    if (!csvRes.ok) throw new Error(csvRes.status);
    cache[tab] = parseCSV(await csvRes.text());
    photoCache = imgRes.ok ? await imgRes.json() : {};
  } catch (e) {
    cache[tab] = [];
    console.warn(`Could not load ${TABS[tab].file}:`, e);
  }
}

// ── Filter counts ─────────────────────────────────────────────────────────
function getCounts(col) {
  const data = cache[activeTab] ?? [];
  const counts = {};
  for (const row of data) {
    const v = (row[col] || '').trim();
    if (v) counts[v] = (counts[v] || 0) + 1;
  }
  return counts;
}

// ── Filter + sort ─────────────────────────────────────────────────────────
function getRows() {
  const cfg  = TABS[activeTab];
  const data = cache[activeTab] ?? [];
  const q    = query.toLowerCase();
  let rows = q
    ? data.filter(r => (r[cfg.nameCol] || '').toLowerCase().includes(q))
    : [...data];
  for (const [col, val] of Object.entries(activeFilters)) {
    if (val) rows = rows.filter(r => (r[col] || '').trim() === val);
  }
  return rows.sort((a, b) => {
    const av = (a[cfg.nameCol] || '').toLowerCase();
    const bv = (b[cfg.nameCol] || '').toLowerCase();
    return sortMode === 'az' ? av.localeCompare(bv) : bv.localeCompare(av);
  });
}

// ── Render filter bar ─────────────────────────────────────────────────────
function renderFilterBar() {
  const cfg       = TABS[activeTab];
  const filterBar = document.getElementById('filter-bar');
  const toggle    = document.getElementById('filter-toggle');
  const label     = document.getElementById('filter-toggle-label');
  const activeCount = Object.values(activeFilters).filter(Boolean).length;
  toggle.classList.toggle('active', activeCount > 0 || filterBarOpen);
  label.textContent = activeCount > 0 ? `Filter · ${activeCount}` : 'Filter';
  if (!filterBarOpen) {
    filterBar.style.display = 'none';
    filterBar.innerHTML = '';
    filterBar.classList.remove('open');
    return;
  }
  filterBar.style.display = 'flex';
  filterBar.classList.add('open');
  const sortSection = `
    <div class="filter-section">
      <div class="filter-section-label">Sort</div>
      <div class="filter-pills">
        <span class="filter-pill ${sortMode === 'az' ? 'active' : ''}" data-sort="az">A → Z</span>
        <span class="filter-pill ${sortMode === 'za' ? 'active' : ''}" data-sort="za">Z → A</span>
      </div>
    </div>`;
  const filterSections = Object.entries(cfg.filterCols).map(([col, colLabel]) => {
    const counts   = getCounts(col);
    const values   = Object.keys(counts).sort();
    const selected = activeFilters[col] || null;
    const total    = (cache[activeTab] ?? []).length;
    return `
      <div class="filter-section">
        <div class="filter-section-label">${colLabel}</div>
        <div class="filter-pills">
          <span class="filter-pill ${!selected ? 'active' : ''}" data-col="${col}" data-val="">
            All <span class="filter-pill-count">${total}</span>
          </span>
          ${values.map(v => `
            <span class="filter-pill ${selected === v ? 'active' : ''}" data-col="${col}" data-val="${v}">
              ${v} <span class="filter-pill-count">${counts[v]}</span>
            </span>`).join('')}
        </div>
      </div>`;
  }).join('');
  filterBar.innerHTML = sortSection + filterSections;
  filterBar.querySelectorAll('[data-sort]').forEach(pill => {
    pill.addEventListener('click', () => { sortMode = pill.dataset.sort; render(); });
  });
  filterBar.querySelectorAll('[data-col]').forEach(pill => {
    pill.addEventListener('click', () => {
      activeFilters[pill.dataset.col] = pill.dataset.val || null;
      render();
    });
  });
}

// ── Render grid ───────────────────────────────────────────────────────────
function renderGrid(rows) {
  const cfg  = TABS[activeTab];
  const grid = document.getElementById('grid-view');
  if (!rows.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1">No plants found</div>`;
    return;
  }
  grid.innerHTML = rows.map(r => {
    const name    = r[cfg.nameCol] || '';
    const zone    = r['zone'] || '';
    const life    = r['life_cycle'] || '';
    const imgUrl  = photoCache[name];
    const cardImg = imgUrl
      ? `<img src="${imgUrl}" alt="${name}" />`
      : PLANT_ICON;
    return `
      <div class="card">
        <div class="card-inner">
          <div class="card-front">
            <div class="card-img">
              ${cardImg}
              ${zonePill(zone)}
            </div>
            <div class="card-body">
              <div class="card-title">${name}</div>
            </div>
          </div>
          <div class="card-back">
            <div class="card-back-title">${name}</div>
            <div class="card-back-divider"></div>
            ${zone ? `<div class="card-back-label">Zone</div><div class="card-back-value">${zone}</div>` : ''}
            ${life ? `<div class="card-back-label">Life Cycle</div><span class="card-back-pill">${life}</span>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
  grid.querySelectorAll('.card').forEach(card => {
    card.querySelector('.card-front').addEventListener('click', () => card.classList.add('flipped'));
    card.querySelector('.card-back').addEventListener('click',  () => card.classList.remove('flipped'));
  });
}

// ── Render table ──────────────────────────────────────────────────────────
function renderTable(rows) {
  const cfg  = TABS[activeTab];
  const head = document.getElementById('table-head');
  const body = document.getElementById('table-body');
  head.innerHTML = `<tr>
    <th data-col="0" class="${sortCol === 0 ? 'sort-' + sortDir : ''}">Plant<span class="sort-arrow"></span></th>
    <th>Zone</th>
    <th>Life Cycle</th>
  </tr>`;
  head.querySelectorAll('th[data-col]').forEach(th => {
    th.addEventListener('click', () => {
      const ci = parseInt(th.dataset.col);
      if (sortCol === ci) sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      else { sortCol = ci; sortDir = 'asc'; }
      render();
    });
  });
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="3" class="empty">No plants found</td></tr>`;
  } else {
    body.innerHTML = rows.map(r => {
      const name = r[cfg.nameCol] || '';
      const zone = r['zone'] || '—';
      const life = r['life_cycle'] || '—';
      return `<tr>
        <td>${name}</td>
        <td class="muted">${zone}</td>
        <td><span class="table-pill">${life}</span></td>
      </tr>`;
    }).join('');
  }
}

// ── Master render ─────────────────────────────────────────────────────────
function render() {
  const rows   = getRows();
  const data   = cache[activeTab] ?? [];
  const gridEl = document.getElementById('grid-view');
  const listEl = document.getElementById('list-view');
  renderFilterBar();
  if (viewMode === 'grid') {
    gridEl.classList.remove('hidden');
    listEl.classList.add('hidden');
    renderGrid(rows);
  } else {
    listEl.classList.remove('hidden');
    gridEl.classList.add('hidden');
    renderTable(rows);
  }
  document.getElementById('count-label').textContent =
    rows.length === data.length
      ? `${data.length} plants`
      : `${rows.length} of ${data.length} plants`;
}

// ── Filter toggle ─────────────────────────────────────────────────────────
document.getElementById('filter-toggle').addEventListener('click', () => {
  filterBarOpen = !filterBarOpen;
  render();
});

// ── View toggle ───────────────────────────────────────────────────────────
document.getElementById('btn-grid').addEventListener('click', () => {
  viewMode = 'grid';
  document.getElementById('btn-grid').classList.add('active');
  document.getElementById('btn-list').classList.remove('active');
  render();
});
document.getElementById('btn-list').addEventListener('click', () => {
  viewMode = 'list';
  document.getElementById('btn-list').classList.add('active');
  document.getElementById('btn-grid').classList.remove('active');
  render();
});

// ── Search ────────────────────────────────────────────────────────────────
document.getElementById('search').addEventListener('input', e => {
  query = e.target.value;
  render();
});

// ── Init ──────────────────────────────────────────────────────────────────
(async () => {
  await loadTab('plants');
  document.getElementById('stat-plants').textContent = cache['plants'].length;
  render();
})();