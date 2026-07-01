// ── Zone config ───────────────────────────────────────────────────────────
const MAP_ZONE_COLOURS = {
  'woods':             { fill: '#4a7c59', stroke: '#2a6b30' },
  'field':             { fill: '#c8b865', stroke: '#8a7a20' },
  'orchard':           { fill: '#c17f4a', stroke: '#9a6035' },
  'gravel':            { fill: '#b0a898', stroke: '#7a7060' },
  'side-garden':       { fill: '#c47aab', stroke: '#8a3060' },
  'lower-back-garden': { fill: '#7aab8a', stroke: '#3a6b4a' },
  'front-garden':      { fill: '#d4c46a', stroke: '#8a7a20' },
  'upper-back-garden': { fill: '#5a8a6a', stroke: '#2a5a3a' },
  'back-field':        { fill: '#c8b46a', stroke: '#7a6a20' },
  'house':             { fill: '#c4956a', stroke: '#7a5030' },
};

const MAP_ZONE_NAMES = {
  'woods':             'Woods',
  'field':             'Field',
  'orchard':           'Orchard',
  'gravel':            'Gravel',
  'side-garden':       'Side Garden',
  'lower-back-garden': 'Lower Back Garden',
  'front-garden':      'Front Garden',
  'upper-back-garden': 'Upper Back Garden',
  'back-field':        'Back Field',
  'house':             'House',
};

const WORLD_SIZE  = 800;
const WORLD_PAD   = 60;
const BG_PADDING  = 600;

// ── State ─────────────────────────────────────────────────────────────────
let mapCanvas      = null;
let mapCtx         = null;
let zonesData      = {};
let plantsData     = [];
let mapInitialised = false;
let selectedZone   = null;
let hoveredZone    = null;
let projectedZones = {};
let gardenBounds   = null;
let panX = 0, panY = 0, zoom = 1;
let isPanning = false;
let panStart  = { x: 0, y: 0 };
let panOrigin = { x: 0, y: 0 };

// ── Init ──────────────────────────────────────────────────────────────────
async function initMap() {
  if (mapInitialised) return;
  mapInitialised = true;

  try {
    const res = await fetch('data/zones.json');
    zonesData = await res.json();
  } catch (e) {
    console.warn('Could not load zones.json', e);
    zonesData = {};
  }

  plantsData = cache['plants'] ?? [];

  mapCanvas = document.getElementById('garden-canvas');
  mapCtx    = mapCanvas.getContext('2d');

  resizeCanvas();
  projectZones();
  drawMap();

  window.addEventListener('resize', () => {
    resizeCanvas();
    projectZones();
    drawMap();
  });

  mapCanvas.addEventListener('click',      onCanvasClick);
  mapCanvas.addEventListener('mousemove',  onCanvasMove);
  mapCanvas.addEventListener('mouseleave', onCanvasLeave);
  mapCanvas.addEventListener('wheel',      onCanvasWheel, { passive: false });
  mapCanvas.addEventListener('mousedown',  onCanvasMouseDown);
  window.addEventListener('mouseup',       onCanvasMouseUp);
}

// ── Resize ────────────────────────────────────────────────────────────────
function resizeCanvas() {
  const wrap = mapCanvas.parentElement;
  mapCanvas.width  = wrap.clientWidth;
  mapCanvas.height = wrap.clientHeight;
}

// ── Project lat/lng → world coords ───────────────────────────────────────
function projectZones() {
  const allCoords = Object.values(zonesData)
    .filter(z => z.coordinates?.length)
    .flatMap(z => z.coordinates);

  if (!allCoords.length) return;

  const lats   = allCoords.map(c => c[0]);
  const lngs   = allCoords.map(c => c[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);

  const midLat  = (minLat + maxLat) / 2;
  const cosLat  = Math.cos(midLat * Math.PI / 180);
  const lngSpan = (maxLng - minLng) * cosLat;
  const latSpan = maxLat - minLat;

  const scale = Math.min(
    (WORLD_SIZE - WORLD_PAD * 2) / lngSpan,
    (WORLD_SIZE - WORLD_PAD * 2) / latSpan
  );

  function project([lat, lng]) {
    const x =  (lng - minLng) * cosLat * scale - (lngSpan * scale) / 2;
    const y = -((lat - minLat) * scale - (latSpan * scale) / 2);
    return [x, y];
  }

  projectedZones = {};
  for (const [slug, zone] of Object.entries(zonesData)) {
    if (zone.coordinates?.length >= 3) {
      projectedZones[slug] = zone.coordinates.map(project);
    }
  }

  const allPts = Object.values(projectedZones).flat();
  gardenBounds = {
    minX: Math.min(...allPts.map(p => p[0])),
    minY: Math.min(...allPts.map(p => p[1])),
    maxX: Math.max(...allPts.map(p => p[0])),
    maxY: Math.max(...allPts.map(p => p[1])),
  };

  // Fit garden in viewport on load
  const gardenW = gardenBounds.maxX - gardenBounds.minX;
  const gardenH = gardenBounds.maxY - gardenBounds.minY;
  zoom = Math.min(
    mapCanvas.width  * 0.75 / gardenW,
    mapCanvas.height * 0.75 / gardenH
  );

  panX = mapCanvas.width  / 2;
  panY = mapCanvas.height / 2;
}

// ── Background half-size ──────────────────────────────────────────────────
function bgHalf() {
  if (!gardenBounds) return 2000;
  return Math.max(
    gardenBounds.maxX - gardenBounds.minX,
    gardenBounds.maxY - gardenBounds.minY
  ) / 2 + BG_PADDING;
}

// ── Clamp pan ─────────────────────────────────────────────────────────────
function clampPan() {
  const W = mapCanvas.width;
  const H = mapCanvas.height;
  const h = bgHalf() * zoom;
  panX = Math.min(h, Math.max(W - h, panX));
  panY = Math.min(h, Math.max(H - h, panY));
}

// ── Transform ─────────────────────────────────────────────────────────────
function applyTransform() {
  mapCtx.setTransform(zoom, 0, 0, zoom, panX, panY);
}

function screenToWorld(sx, sy) {
  return [(sx - panX) / zoom, (sy - panY) / zoom];
}

// ── Draw background ───────────────────────────────────────────────────────
function drawBackground() {
  const ctx  = mapCtx;
  const h    = bgHalf();
  const size = h * 2;

  ctx.fillStyle = '#d4e8b0';
  ctx.fillRect(-h, -h, size, size);

  let seed = 17;
  function rand() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }

  for (let p = 0; p < 40; p++) {
    const px    = -h + rand() * size;
    const py    = -h + rand() * size;
    const pr    = 35 + rand() * 80;
    const alpha = 0.07 + rand() * 0.12;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(rand() * Math.PI * 2);
    ctx.scale(1 + rand() * 0.7, 0.5 + rand() * 0.8);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, pr);
    grad.addColorStop(0,   `rgba(40,75,15,${alpha})`);
    grad.addColorStop(0.5, `rgba(60,95,20,${alpha * 0.5})`);
    grad.addColorStop(1,   'rgba(40,75,15,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, pr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (let i = 0; i < 800; i++) {
    const x = -h + rand() * size;
    const y = -h + rand() * size;
    ctx.fillStyle = rand() > 0.5
      ? `rgba(200,230,150,${rand() * 0.16})`
      : `rgba(40,70,10,${rand() * 0.09})`;
    ctx.beginPath();
    ctx.arc(x, y, 0.5 + rand() * 1.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ── Draw zone ─────────────────────────────────────────────────────────────
function drawZone(slug, pts, isHovered, isSelected) {
  const ctx     = mapCtx;
  const colours = MAP_ZONE_COLOURS[slug] ?? { fill: '#999', stroke: '#666' };

  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();

  ctx.globalAlpha = isSelected ? 0.82 : isHovered ? 0.7 : 0.58;
  ctx.fillStyle   = colours.fill;
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.strokeStyle = colours.stroke;
  ctx.lineWidth   = (isSelected ? 2.5 : 1.5) / zoom;
  ctx.lineJoin    = 'round';
  ctx.stroke();
}

// ── Draw label ────────────────────────────────────────────────────────────
function drawLabel(slug, pts, isSelected) {
  const ctx  = mapCtx;
  const name = MAP_ZONE_NAMES[slug] ?? slug;

  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;

  const xs  = pts.map(p => p[0]);
  const ys  = pts.map(p => p[1]);
  const wPx = (Math.max(...xs) - Math.min(...xs)) * zoom;
  const hPx = (Math.max(...ys) - Math.min(...ys)) * zoom;
  if (wPx < 36 || hPx < 16) return;

  const fontSize = 11 / zoom;
  const padX     = 8  / zoom;
  const padY     = 5  / zoom;

  ctx.font = `500 ${fontSize}px DM Sans, sans-serif`;
  const textW = ctx.measureText(name).width;
  const pillW = textW + padX * 2;
  const pillH = fontSize + padY * 2;
  const pillR = pillH / 2;

  ctx.save();
  ctx.globalAlpha = isSelected ? 0.95 : 0.82;
  ctx.fillStyle   = 'rgba(255,252,246,0.92)';
  ctx.beginPath();
  ctx.roundRect(cx - pillW / 2, cy - pillH / 2, pillW, pillH, pillR);
  ctx.fill();
  ctx.restore();

  const colours = MAP_ZONE_COLOURS[slug] ?? { stroke: '#444' };
  ctx.save();
  ctx.globalAlpha  = 1;
  ctx.fillStyle    = colours.stroke;
  ctx.font         = `500 ${fontSize}px DM Sans, sans-serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, cx, cy);
  ctx.restore();
}

// ── Master draw ───────────────────────────────────────────────────────────
function drawMap() {
  const ctx = mapCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  applyTransform();
  drawBackground();
  for (const [slug, pts] of Object.entries(projectedZones)) {
    drawZone(slug, pts, hoveredZone === slug, selectedZone === slug);
  }
  for (const [slug, pts] of Object.entries(projectedZones)) {
    drawLabel(slug, pts, selectedZone === slug);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

// ── Hit test ──────────────────────────────────────────────────────────────
function zoneAtPoint(sx, sy) {
  const [wx, wy] = screenToWorld(sx, sy);
  const ctx = mapCtx;
  for (const [slug, pts] of Object.entries(projectedZones)) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (ctx.isPointInPath(wx, wy)) return slug;
  }
  return null;
}

// ── Wheel zoom ────────────────────────────────────────────────────────────
function onCanvasWheel(e) {
  e.preventDefault();
  if (!gardenBounds) return;
  const rect    = mapCanvas.getBoundingClientRect();
  const mx      = e.clientX - rect.left;
  const my      = e.clientY - rect.top;
  const factor  = e.deltaY < 0 ? 1.06 : 1 / 1.06;
  const minZoom = Math.max(mapCanvas.width, mapCanvas.height) / (bgHalf() * 2);
  const newZoom = Math.min(10, Math.max(minZoom, zoom * factor));
  panX  = mx - (mx - panX) * (newZoom / zoom);
  panY  = my - (my - panY) * (newZoom / zoom);
  zoom  = newZoom;
  clampPan();
  drawMap();
}

// ── Pan ───────────────────────────────────────────────────────────────────
function onCanvasMouseDown(e) {
  if (e.button !== 0) return;
  isPanning = true;
  panStart  = { x: e.clientX, y: e.clientY };
  panOrigin = { x: panX, y: panY };
  mapCanvas.style.cursor = 'grabbing';
}

function onCanvasMouseUp() {
  isPanning = false;
  mapCanvas.style.cursor = hoveredZone ? 'pointer' : 'default';
}

function onCanvasMove(e) {
  if (isPanning) {
    panX = panOrigin.x + (e.clientX - panStart.x);
    panY = panOrigin.y + (e.clientY - panStart.y);
    clampPan();
    drawMap();
    return;
  }
  const rect = mapCanvas.getBoundingClientRect();
  const slug = zoneAtPoint(e.clientX - rect.left, e.clientY - rect.top);
  if (slug !== hoveredZone) {
    hoveredZone = slug ?? null;
    mapCanvas.style.cursor = slug ? 'pointer' : 'default';
    drawMap();
  }
}

function onCanvasClick(e) {
  const dx = e.clientX - panStart.x;
  const dy = e.clientY - panStart.y;
  if (Math.sqrt(dx * dx + dy * dy) > 4) return;
  const rect = mapCanvas.getBoundingClientRect();
  const slug = zoneAtPoint(e.clientX - rect.left, e.clientY - rect.top);
  if (slug) {
    selectedZone = slug;
    showZonePanel(slug);
  } else {
    selectedZone = null;
    document.getElementById('map-panel-empty').classList.remove('hidden');
    document.getElementById('map-panel-content').classList.add('hidden');
  }
  drawMap();
}

function onCanvasLeave() {
  hoveredZone = null;
  isPanning   = false;
  mapCanvas.style.cursor = 'default';
  drawMap();
}

// ── Zone panel ────────────────────────────────────────────────────────────
function showZonePanel(zoneSlug) {
  const zone        = zonesData[zoneSlug];
  const displayName = MAP_ZONE_NAMES[zoneSlug] ?? zone?.name ?? zoneSlug;
  if (!zone) return;

  document.getElementById('map-panel-empty').classList.add('hidden');
  document.getElementById('map-panel-content').classList.remove('hidden');
  document.getElementById('map-panel-name').textContent = displayName;

  document.getElementById('map-panel-props').innerHTML = [
    { label: 'Light', value: zone.light ?? '—' },
    { label: 'Soil',  value: zone.soil  ?? '—' },
  ].map(p => `
    <div class="map-prop-row">
      <span class="map-prop-label">${p.label}</span>
      <span class="map-prop-val">${p.value}</span>
    </div>`).join('');

  const zonePlants = plantsData.filter(r =>
    (r.zone || '').trim().toLowerCase() === displayName.toLowerCase()
  );

  document.getElementById('map-plant-list').innerHTML = !zonePlants.length
    ? `<div class="map-plant-empty">No plants recorded</div>`
    : zonePlants.map(p => `
        <div class="map-plant-row">
          <div class="map-plant-dot"></div>
          <span class="map-plant-name">${p.plant}</span>
          <span class="map-plant-cycle">${p.life_cycle ?? ''}</span>
        </div>`).join('');
}

// ── Tab switching ─────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const t = tab.dataset.tab;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');

    document.getElementById('tab-plants').classList.add('hidden');
    document.getElementById('tab-map').classList.add('hidden');
    document.getElementById('tab-network').classList.add('hidden');
    document.getElementById('view-toggle').style.display = 'none';

    if (t === 'plants') {
      document.getElementById('tab-plants').classList.remove('hidden');
      document.getElementById('view-toggle').style.display = 'flex';
    } else if (t === 'map') {
      document.getElementById('tab-map').classList.remove('hidden');
      initMap();
    } else if (t === 'network') {
      document.getElementById('tab-network').classList.remove('hidden');
      initNetwork();
    }
  });
});