// ── Zone adjacency ────────────────────────────────────────────────────────
const NET_ZONE_ADJACENCY = [
  ['Woods', 'Orchard'],
  ['Woods', 'Gravel'],
  ['Woods', 'Front Garden'],
  ['Orchard', 'Field'],
  ['Orchard', 'Upper Back Garden'],
  ['Orchard', 'Lower Back Garden'],
  ['Field', 'Upper Back Garden'],
  ['Field', 'Back Field'],
  ['Gravel', 'Side Garden'],
  ['Gravel', 'Front Garden'],
  ['Gravel', 'House'],
  ['Side Garden', 'Lower Back Garden'],
  ['Side Garden', 'Front Garden'],
  ['Side Garden', 'House'],
  ['Lower Back Garden', 'Upper Back Garden'],
];

const NET_ZONE_COLOURS = {
  'Woods':             { bg: '#d1ead4', border: '#2a6b30', text: '#1a4a20' },
  'Field':             { bg: '#f5f0c0', border: '#8a7a20', text: '#5a5010' },
  'Orchard':           { bg: '#fde8c0', border: '#9a6035', text: '#6a3010' },
  'Gravel':            { bg: '#e8e4de', border: '#7a7060', text: '#4a4030' },
  'Side Garden':       { bg: '#f0d6e8', border: '#8a3060', text: '#5a1040' },
  'Lower Back Garden': { bg: '#d4ead8', border: '#3a6b4a', text: '#1a4a2a' },
  'Front Garden':      { bg: '#f5f0c8', border: '#8a7a20', text: '#5a5010' },
  'Upper Back Garden': { bg: '#c8dece', border: '#2a5a3a', text: '#0a3a1a' },
  'Back Field':        { bg: '#f0e8c0', border: '#7a6a20', text: '#4a4010' },
  'House':             { bg: '#f0e0d0', border: '#7a5030', text: '#4a2010' },
};

// ── State ─────────────────────────────────────────────────────────────────
let netCy          = null;
let netInitialised = false;
let netSelectedNode = null;
let netActiveZone  = 'all';

// ── Init ──────────────────────────────────────────────────────────────────
function initNetwork() {
  if (netInitialised) return;
  netInitialised = true;

  const plants = cache['plants'] ?? [];
  buildNetworkGraph(plants);
  buildNetSidebar(plants);
  buildNetLegend();

  document.getElementById('net-card-close').addEventListener('click', hideNetCard);
  document.getElementById('net-reset-btn').addEventListener('click', resetNetwork);
}

// ── Build graph ───────────────────────────────────────────────────────────
function buildNetworkGraph(plants, zoneFilter = 'all') {
  if (netCy) { netCy.destroy(); netCy = null; }

  const zones = [...new Set(plants.map(p => p.zone).filter(Boolean))];
  const filteredZones = zoneFilter === 'all' ? zones : [zoneFilter];
  const filteredPlants = plants.filter(p => filteredZones.includes(p.zone));

  // Deduplicate plants
  const plantMap = {};
  filteredPlants.forEach(p => {
    const key = p.plant;
    if (!plantMap[key]) plantMap[key] = { zones: [], life_cycle: p.life_cycle, type: p.type };
    plantMap[key].zones.push(p.zone);
  });

  // Degree map for sizing zone nodes
  const zoneDeg = {};
  filteredZones.forEach(z => zoneDeg[z] = 0);
  Object.values(plantMap).forEach(p => p.zones.forEach(z => zoneDeg[z]++));
  const maxDeg = Math.max(...Object.values(zoneDeg), 1);

  const elements = [];

  // Zone nodes
  filteredZones.forEach(z => {
    const c = NET_ZONE_COLOURS[z] ?? { bg: '#e0e0e0', border: '#888', text: '#333' };
    const size = 44 + (zoneDeg[z] / maxDeg) * 36;
    elements.push({
      data: { id: 'z-' + z, label: z, type: 'zone', zone: z, size, bg: c.bg, border: c.border, textCol: c.text }
    });
  });

  // Zone adjacency edges
  NET_ZONE_ADJACENCY.forEach(([a, b]) => {
    if (filteredZones.includes(a) && filteredZones.includes(b)) {
      elements.push({
        data: { id: `zadj-${a}-${b}`, source: 'z-' + a, target: 'z-' + b, edgeType: 'adjacency' }
      });
    }
  });

  // Plant nodes + membership edges
  Object.entries(plantMap).forEach(([name, data]) => {
    const col = PLANT_TYPE_COLOURS[data.type] ?? '#c17f4a';
    elements.push({
      data: { id: 'p-' + name, label: name, type: 'plant', plantType: data.type, life_cycle: data.life_cycle, zones: data.zones.join(', '), size: 18, bg: col + '33', border: col, textCol: col }
    });
    data.zones.filter(z => filteredZones.includes(z)).forEach(z => {
      elements.push({
        data: { id: `mem-${z}-${name}`, source: 'z-' + z, target: 'p-' + name, edgeType: 'membership' }
      });
    });
  });

  netCy = window.cytoscape({
    container: document.getElementById('net-cy'),
    elements,
    style: [
      {
        selector: 'node',
        style: {
            'width':               'data(size)',
            'height':              'data(size)',
            'background-color':    'data(bg)',
            'border-color':        'data(border)',
            'border-width':        1.5,
            'label':               'data(label)',
            'color':               '#3d2b1f',
            'font-size':           10,
            'font-family':         'DM Sans, sans-serif',
            'font-weight':         500,
            'text-valign':         'bottom',
            'text-halign':         'center',
            'text-margin-y':       5,
            'text-wrap':           'wrap',
            'text-max-width':      '80px',
            'transition-property': 'opacity, border-width, border-color',
            'transition-duration': '200ms',
        },
        },
        {
        selector: 'node[type = "zone"]',
        style: {
            'font-size':    11,
            'font-weight':   600,
            'border-width':  2,
            'text-valign':   'center',
            'text-halign':   'center',
            'text-margin-y': 0,
            'color':         'data(textCol)',
            'text-max-width': 'data(size)',
        },
      },
      {
        selector: 'node.selected-node',
        style: {
          'border-width':      3,
          'outline-color':     'data(border)',
          'outline-width':     7,
          'outline-opacity':   0.28,
        },
      },
      {
        selector: 'node.neighbour-node',
        style: { 'border-width': 2.5 },
      },
      {
        selector: 'edge',
        style: {
          'width':              0.8,
          'line-color':         '#d0c8b8',
          'opacity':            0.6,
          'curve-style':        'bezier',
          'transition-property': 'opacity, width, line-color',
          'transition-duration': '200ms',
        },
      },
      {
        selector: 'edge[edgeType = "adjacency"]',
        style: {
          'width':       2,
          'line-color':  '#3d2b1f',
          'line-style':  'dashed',
          'line-dash-pattern': [5, 4],
          'opacity':     0.5,
        },
      },
      {
        selector: 'edge.dimmed',
        style: { opacity: 0.05 },
      },
      {
        selector: 'edge.selected-edge',
        style: { opacity: 1, width: 2, 'line-color': '#3d2b1f' },
      },
    ],
    layout: {
      name:             'cose',
      animate:          true,
      animationDuration: 800,
      nodeRepulsion:    () => 55000,
      idealEdgeLength:  () => 120,
      edgeElasticity:   () => 80,
      gravity:          0.25,
      numIter:          1200,
      padding:          40,
      randomize:        false,
    },
    userZoomingEnabled: true,
    userPanningEnabled: true,
    minZoom: 0.2,
    maxZoom: 4,
  });

  setupNetEvents();
}

// ── Events ────────────────────────────────────────────────────────────────
function setupNetEvents() {
  netCy.on('tap', 'node', e => {
    const node = e.target;
    netSelectedNode = node;
    netCy.elements().removeClass('selected-node selected-edge neighbour-node dimmed');
    node.addClass('selected-node');
    node.connectedEdges().addClass('selected-edge');
    node.neighborhood('node').addClass('neighbour-node');
    netCy.elements().not(node).not(node.connectedEdges()).not(node.neighborhood('node')).not(node.connectedEdges()).addClass('dimmed');
    showNetCard(node);
    updateNetSel(node);
  });

  netCy.on('tap', e => {
    if (e.target === netCy) {
      netCy.elements().removeClass('selected-node selected-edge neighbour-node dimmed');
      hideNetCard();
      clearNetSel();
      netSelectedNode = null;
    }
  });

  netCy.on('pan zoom resize', () => {
    if (netSelectedNode) positionNetCard(netSelectedNode);
  });

  netCy.on('mouseover', 'node', () => { document.body.style.cursor = 'pointer'; });
  netCy.on('mouseout',  'node', () => { document.body.style.cursor = 'default'; });
}

// ── Card ──────────────────────────────────────────────────────────────────
function showNetCard(node) {
  const d    = node.data();
  const card = document.getElementById('net-card');
  document.getElementById('net-card-name').textContent = d.label;
  document.getElementById('net-card-type').textContent = d.type === 'zone' ? 'Zone' : d.plantType ?? 'Plant';

  if (d.type === 'zone') {
    const zonePlants = (cache['plants'] ?? []).filter(p => p.zone === d.zone);
    document.getElementById('net-card-rows').innerHTML = `
      <div class="net-card-row"><span class="net-card-key">Plants</span><span class="net-card-val">${zonePlants.length}</span></div>
      <div class="net-card-row"><span class="net-card-key">Connections</span><span class="net-card-val">${node.connectedEdges().length}</span></div>
    `;
  } else {
    document.getElementById('net-card-rows').innerHTML = `
      <div class="net-card-row"><span class="net-card-key">Zone</span><span class="net-card-val">${d.zones}</span></div>
      <div class="net-card-row"><span class="net-card-key">Life cycle</span><span class="net-card-val">${d.life_cycle}</span></div>
      <div class="net-card-row"><span class="net-card-key">Type</span><span class="net-card-val">${d.plantType ?? '—'}</span></div>
    `;
  }

  card.style.display = 'block';
  positionNetCard(node);
}

function positionNetCard(node) {
  const card = document.getElementById('net-card');
  if (card.style.display === 'none') return;
  const wrap = document.getElementById('net-cy');
  const pos  = node.renderedPosition();
  const wR   = wrap.getBoundingClientRect();
  const cW   = card.offsetWidth  || 230;
  const cH   = card.offsetHeight || 130;
  const m    = 16;
  let left = pos.x + m;
  let top  = pos.y + m;
  if (left + cW + m > wR.width)  left = pos.x - cW - m;
  if (top  + cH + m > wR.height) top  = pos.y - cH - m;
  card.style.left = Math.max(m, left) + 'px';
  card.style.top  = Math.max(m, top)  + 'px';
}

function hideNetCard() {
  document.getElementById('net-card').style.display = 'none';
}

// ── Sel box ───────────────────────────────────────────────────────────────
function updateNetSel(node) {
  const d = node.data();
  document.getElementById('net-sel-box').style.display = 'block';
  document.getElementById('net-sel-name').textContent  = d.label;
  document.getElementById('net-sel-meta').textContent  = d.type === 'zone'
    ? `Zone · ${node.connectedEdges().length} connections`
    : `${d.plantType ?? 'Plant'} · Degree: ${node.connectedEdges().length}`;
}

function clearNetSel() {
  document.getElementById('net-sel-box').style.display = 'none';
}

// ── Sidebar ───────────────────────────────────────────────────────────────
function buildNetSidebar(plants) {
  const zones = ['all', ...Object.keys(NET_ZONE_COLOURS)];
  const container = document.getElementById('net-zone-filters');
  container.innerHTML = '';

  zones.forEach(z => {
    const btn = document.createElement('div');
    btn.className = 'net-filter-row' + (z === 'all' ? ' active' : '');
    btn.dataset.zone = z;
    const col = z === 'all' ? '#3d2b1f' : (NET_ZONE_COLOURS[z]?.border ?? '#888');
    btn.innerHTML = `<div class="net-dot" style="background:${col}"></div>${z === 'all' ? 'All zones' : z}`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('.net-filter-row[data-zone]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      netActiveZone = z;
      netSelectedNode = null;
      hideNetCard();
      clearNetSel();
      buildNetworkGraph(plants, z === 'all' ? 'all' : z);
    });
    container.appendChild(btn);
  });
}

function buildNetLegend() {
  const container = document.getElementById('net-legend');
  container.innerHTML = '';

  const adjacencyItem = document.createElement('div');
  adjacencyItem.className = 'net-legend-item';
  adjacencyItem.innerHTML = `<div class="net-legend-line net-legend-adjacency"></div>Zone adjacency`;
  container.appendChild(adjacencyItem);

  const memberItem = document.createElement('div');
  memberItem.className = 'net-legend-item';
  memberItem.innerHTML = `<div class="net-legend-line net-legend-membership"></div>Plant membership`;
  container.appendChild(memberItem);

  Object.entries(PLANT_TYPE_COLOURS).forEach(([type, col]) => {
    const item = document.createElement('div');
    item.className = 'net-legend-item';
    item.innerHTML = `<div class="net-dot" style="background:${col};border:1.5px solid ${col}"></div>${type}`;
    container.appendChild(item);
  });
}

// ── Reset ─────────────────────────────────────────────────────────────────
function resetNetwork() {
  if (!netCy) return;
  netCy.elements().removeClass('selected-node selected-edge neighbour-node dimmed');
  netSelectedNode = null;
  hideNetCard();
  clearNetSel();
  netCy.animate({ fit: { padding: 40 }, duration: 400, easing: 'ease-in-out' });
}