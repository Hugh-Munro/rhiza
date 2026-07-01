// ── Zone config ───────────────────────────────────────────────────────────
const ZONE_COLS = {
  'Woods':             { fill: '#4a7c59', stroke: '#2a6b30' },
  'Field':             { fill: '#c8b865', stroke: '#8a7a20' },
  'Orchard':           { fill: '#c17f4a', stroke: '#9a6035' },
  'Gravel':            { fill: '#b0a898', stroke: '#7a7060' },
  'Side Garden':       { fill: '#c47aab', stroke: '#8a3060' },
  'Lower Back Garden': { fill: '#7aab8a', stroke: '#3a6b4a' },
  'Front Garden':      { fill: '#d4c46a', stroke: '#8a7a20' },
  'Upper Back Garden': { fill: '#5a8a6a', stroke: '#2a5a3a' },
  'Back Field':        { fill: '#c8b46a', stroke: '#7a6a20' },
  'House':             { fill: '#c4956a', stroke: '#7a5030' },
};

const ZONE_POSITIONS = {
  'Woods':             Math.PI * 1.1,
  'Field':             Math.PI * 0.0,
  'Orchard':           Math.PI * 0.65,
  'Gravel':            Math.PI * 1.55,
  'Side Garden':       Math.PI * 1.82,
  'Lower Back Garden': Math.PI * 0.88,
  'Front Garden':      Math.PI * 1.32,
  'Upper Back Garden': Math.PI * 0.22,
  'Back Field':        Math.PI * 1.78,
  'House':             Math.PI * 1.68,
};

const ZONE_ADJACENCY = [
  ['Woods',             'Orchard'],
  ['Woods',             'Gravel'],
  ['Woods',             'Front Garden'],
  ['Orchard',           'Field'],
  ['Orchard',           'Upper Back Garden'],
  ['Orchard',           'Lower Back Garden'],
  ['Field',             'Upper Back Garden'],
  ['Field',             'Back Field'],
  ['Gravel',            'Side Garden'],
  ['Gravel',            'Front Garden'],
  ['Gravel',            'House'],
  ['Side Garden',       'Lower Back Garden'],
  ['Side Garden',       'Front Garden'],
  ['Side Garden',       'House'],
  ['Lower Back Garden', 'Upper Back Garden'],
];

// ── State ─────────────────────────────────────────────────────────────────
let netNodes     = [];
let netEdges     = [];
let netSelected  = null;
let netFilter    = 'all';
let netAnimId    = null;
let netReady     = false;

// ── Init ──────────────────────────────────────────────────────────────────
function initNetwork() {
  if (netReady) return;
  netReady = true;

  const canvas = document.getElementById('net-canvas');
  const ctx    = canvas.getContext('2d');

  function resize() {
    canvas.width  = canvas.parentElement.clientWidth;
    canvas.height = canvas.parentElement.clientHeight;
  }

  function getNode(id) {
    return netNodes.find(n => n.id === id);
  }

  // ── Build graph ───────────────────────────────────────────────────────
  function buildGraph() {
    netNodes = [];
    netEdges = [];

    const W  = canvas.width;
    const H  = canvas.height;
    const cx = W / 2;
    const cy = H / 2;

    const allZones     = Object.keys(ZONE_COLS);
    const visibleZones = netFilter === 'all' ? allZones : [netFilter];
    const visiblePlants = (cache['plants'] ?? []).filter(p =>
      netFilter === 'all' || (p.zone || '').trim() === netFilter
    );

    // Zone nodes
    visibleZones.forEach(z => {
      const angle = ZONE_POSITIONS[z] ?? 0;
      const r     = Math.min(cx, cy) * 0.28;
      netNodes.push({
        id: 'z-' + z, label: z, type: 'zone', zone: z,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        vx: 0, vy: 0, r: 22, fixed: true, life_cycle: '',
      });
    });

    // Zone adjacency edges
    ZONE_ADJACENCY.forEach(([a, b]) => {
      if (visibleZones.includes(a) && visibleZones.includes(b)) {
        netEdges.push({ from: 'z-' + a, to: 'z-' + b, type: 'adjacency' });
      }
    });

    // Deduplicate plants (same plant in multiple zones)
    const plantMap = {};
    visiblePlants.forEach(p => {
      const key = (p.plant || '').trim();
      if (!key) return;
      if (!plantMap[key]) plantMap[key] = { zones: [], life_cycle: p.life_cycle };
      plantMap[key].zones.push((p.zone || '').trim());
    });

    // Plant nodes + membership edges
    Object.entries(plantMap).forEach(([name, data], i) => {
      const total  = Object.keys(plantMap).length;
      const angle  = (i / total) * Math.PI * 2;
      const spread = Math.min(cx, cy) * (0.52 + Math.random() * 0.3);
      netNodes.push({
        id: 'p-' + name, label: name, type: 'plant',
        zone: data.zones.join(', '), life_cycle: data.life_cycle,
        zones: data.zones,
        x: cx + Math.cos(angle) * spread + (Math.random() - 0.5) * 35,
        y: cy + Math.sin(angle) * spread + (Math.random() - 0.5) * 35,
        vx: 0, vy: 0, r: 8, fixed: false,
      });
      data.zones.filter(z => visibleZones.includes(z)).forEach(z => {
        netEdges.push({ from: 'z-' + z, to: 'p-' + name, type: 'membership' });
      });
    });
  }

  // ── Force simulation ──────────────────────────────────────────────────
  function simulate() {
    const cx = canvas.width  / 2;
    const cy = canvas.height / 2;

    netNodes.forEach(n => {
      if (n.fixed) return;
      let fx = 0, fy = 0;

      // Repulsion
      netNodes.forEach(m => {
        if (m.id === n.id) return;
        const dx = n.x - m.x, dy = n.y - m.y;
        const d  = Math.sqrt(dx * dx + dy * dy) || 1;
        fx += dx / d * (2000 / (d * d));
        fy += dy / d * (2000 / (d * d));
      });

      // Attraction along edges
      netEdges.forEach(e => {
        const other = e.from === n.id ? getNode(e.to) : e.to === n.id ? getNode(e.from) : null;
        if (!other) return;
        const dx     = other.x - n.x, dy = other.y - n.y;
        const d      = Math.sqrt(dx * dx + dy * dy) || 1;
        const target = 105;
        fx += (dx / d) * (d - target) * 0.045;
        fy += (dy / d) * (d - target) * 0.045;
      });

      // Gravity toward centre
      fx += (cx - n.x) * 0.012;
      fy += (cy - n.y) * 0.012;

      n.vx = (n.vx + fx) * 0.80;
      n.vy = (n.vy + fy) * 0.80;
      n.x  += n.vx;
      n.y  += n.vy;
    });
  }

  // ── Connected node IDs for highlight ─────────────────────────────────
  function connectedIds(n) {
    if (!n) return null;
    const ids = new Set([n.id]);
    netEdges.forEach(e => {
      if (e.from === n.id) ids.add(e.to);
      if (e.to   === n.id) ids.add(e.from);
    });
    return ids;
  }

  // ── Draw ──────────────────────────────────────────────────────────────
  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const connected = netSelected ? connectedIds(netSelected) : null;

    // Edges
    netEdges.forEach(e => {
      const a = getNode(e.from), b = getNode(e.to);
      if (!a || !b) return;
      const isLit = !connected || (connected.has(e.from) && connected.has(e.to));
      ctx.globalAlpha = isLit ? 1 : 0.08;

      if (e.type === 'adjacency') {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = '#3d2b1f';
        ctx.lineWidth   = 2.5;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      } else {
        ctx.strokeStyle = 'rgba(193,127,74,0.45)';
        ctx.lineWidth   = 0.9;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    });

    // Nodes
    netNodes.forEach(n => {
      const isLit    = !connected || connected.has(n.id);
      const isActive = netSelected && netSelected.id === n.id;
      ctx.globalAlpha = isLit ? 1 : 0.15;

      if (n.type === 'zone') {
        const col = ZONE_COLS[n.zone] ?? { fill: '#888', stroke: '#555' };
        ctx.beginPath();
        ctx.arc(n.x, n.y, isActive ? n.r * 1.15 : n.r, 0, Math.PI * 2);
        ctx.fillStyle   = col.fill;
        ctx.fill();
        ctx.strokeStyle = col.stroke;
        ctx.lineWidth   = 2;
        ctx.stroke();
        ctx.fillStyle      = '#fff';
        ctx.font           = '500 10px DM Sans, sans-serif';
        ctx.textAlign      = 'center';
        ctx.textBaseline   = 'middle';
        ctx.fillText(n.label, n.x, n.y);
      } else {
        const fill   = n.life_cycle === 'Annual' ? '#7aab6e' : '#c17f4a';
        const stroke = n.life_cycle === 'Annual' ? '#4a7a3e' : '#9a6035';
        ctx.beginPath();
        ctx.arc(n.x, n.y, isActive ? n.r * 1.4 : n.r, 0, Math.PI * 2);
        ctx.fillStyle   = fill;
        ctx.fill();
        ctx.strokeStyle = stroke;
        ctx.lineWidth   = 1.5;
        ctx.stroke();
        if (isLit) {
          ctx.fillStyle    = '#3d2b1f';
          ctx.font         = '11px DM Sans, sans-serif';
          ctx.textAlign    = 'center';
          ctx.textBaseline = 'top';
          ctx.fillText(n.label, n.x, n.y + n.r + 3);
        }
      }
      ctx.globalAlpha = 1;
    });
  }

  // ── Tick ──────────────────────────────────────────────────────────────
  function tick() {
    simulate();
    draw();
    netAnimId = requestAnimationFrame(tick);
  }

  // ── Node at mouse ─────────────────────────────────────────────────────
  function nodeAt(mx, my) {
    return netNodes.find(n => {
      const dx = n.x - mx, dy = n.y - my;
      return Math.sqrt(dx * dx + dy * dy) < n.r + 6;
    });
  }

  // ── Show popup card ───────────────────────────────────────────────────
  function showCard(n, mx, my) {
    const memberEdges = netEdges.filter(e =>
      (e.from === n.id || e.to === n.id) && e.type === 'membership'
    );
    const adjEdges = netEdges.filter(e =>
      (e.from === n.id || e.to === n.id) && e.type === 'adjacency'
    );
    const totalDeg = netEdges.filter(e => e.from === n.id || e.to === n.id).length;

    document.getElementById('net-card-name').textContent  = n.label;
    document.getElementById('net-card-type').textContent  = n.type === 'zone' ? 'Zone' : 'Plant';

    const rows = n.type === 'zone'
      ? `<div class="net-card-row"><span class="net-card-key">Plants</span><span class="net-card-val">${memberEdges.length}</span></div>
         <div class="net-card-row"><span class="net-card-key">Adjacent zones</span><span class="net-card-val">${adjEdges.length}</span></div>`
      : `<div class="net-card-row"><span class="net-card-key">Zone</span><span class="net-card-val">${n.zone}</span></div>
         <div class="net-card-row"><span class="net-card-key">Life cycle</span><span class="net-card-val">${n.life_cycle}</span></div>
         <div class="net-card-row"><span class="net-card-key">Connections</span><span class="net-card-val">${totalDeg}</span></div>`;

    document.getElementById('net-card-rows').innerHTML = rows;

    const card = document.getElementById('net-card');
    card.style.display = 'block';
    const cw = canvas.parentElement.clientWidth;
    const ch = canvas.parentElement.clientHeight;
    let cx = mx + 16, cy = my - 20;
    if (cx + 240 > cw - 10) cx = mx - 250;
    if (cy + 140 > ch - 10) cy = ch - 150;
    card.style.left = cx + 'px';
    card.style.top  = cy + 'px';

    document.getElementById('net-sel-box').style.display = 'block';
    document.getElementById('net-sel-name').textContent  = n.label;
    document.getElementById('net-sel-meta').textContent  = n.type === 'zone'
      ? `Zone · ${totalDeg} connections`
      : `Plant · Degree: ${totalDeg}`;
  }

  function hideCard() {
    netSelected = null;
    document.getElementById('net-card').style.display    = 'none';
    document.getElementById('net-sel-box').style.display = 'none';
  }

  // ── Canvas events ─────────────────────────────────────────────────────
  canvas.addEventListener('click', e => {
    const rect = canvas.getBoundingClientRect();
    const mx   = e.clientX - rect.left;
    const my   = e.clientY - rect.top;
    const n    = nodeAt(mx, my);
    if (n) { netSelected = n; showCard(n, mx, my); }
    else   { hideCard(); }
  });

  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    canvas.style.cursor = nodeAt(e.clientX - rect.left, e.clientY - rect.top) ? 'pointer' : 'default';
  });

  document.getElementById('net-card-close').addEventListener('click', hideCard);

  // ── Sidebar filter ────────────────────────────────────────────────────
  document.querySelectorAll('.net-filter-row').forEach(row => {
    row.addEventListener('click', () => {
      document.querySelectorAll('.net-filter-row').forEach(r => r.classList.remove('active'));
      row.classList.add('active');
      netFilter  = row.dataset.filter;
      netSelected = null;
      hideCard();
      cancelAnimationFrame(netAnimId);
      buildGraph();
      tick();
    });
  });

  // ── Kick off ──────────────────────────────────────────────────────────
  resize();
  window.addEventListener('resize', () => {
    resize();
    cancelAnimationFrame(netAnimId);
    buildGraph();
    tick();
  });
  buildGraph();
  tick();
}