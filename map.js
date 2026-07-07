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
// World-space projection tuning (lat/lng → local planar units)
const PROJECTION_SPAN  = 800;  // total span the garden's longer axis maps to
const PROJECTION_INSET = 60;   // inset from that span, so zones don't touch the raw edge
const CONTENT_MARGIN   = 90;   // world units of decorative background bled around the garden
const BG_TEXTURE_RES   = 1.5;  // px per world unit for the cached background texture
const MAX_ZOOM             = 8;
const ZOOM_STEP             = 1.06;
const CLICK_DRAG_THRESHOLD  = 4; // px of movement that turns a tap/click into a drag
// ── Map module ────────────────────────────────────────────────────────────
const GardenMap = (() => {
  let canvas, ctx;
  let dpr = 1, cssWidth = 0, cssHeight = 0;
  let zonesData   = {};
  let plantsData  = [];
  let dataLoaded  = false;
  let projectedZones = {};
  let gardenBounds   = null; // immutable garden bounding box + CONTENT_MARGIN, in world units
  let contentBounds  = null; // gardenBounds padded to the CURRENT canvas aspect ratio
  let bakedAspect    = null; // canvas aspect the background texture was last baked at
  let bgCanvas        = null;
  let minZoom = 0.1, zoom = 1, panX = 0, panY = 0;
  let firstFit = true;
  let selectedZone = null;
  let hoveredZone  = null;
  let isPanning = false;
  let dragged   = false;
  let pointerStart = { x: 0, y: 0 };
  let panOrigin    = { x: 0, y: 0 };
  let pinch = null;
  let resizeObserver = null;
  // ── Data loading ──────────────────────────────────────────────────────
  async function loadZoneData() {
    try {
      const res = await fetch('data/zones.json');
      zonesData = await res.json();
    } catch (e) {
      console.warn('Could not load zones.json', e);
      zonesData = {};
    }
  }
  // ── Lat/lng → world-unit projection ─────────────────────────────────────
  function projectZones() {
    const allCoords = Object.values(zonesData)
      .filter(z => z.coordinates?.length)
      .flatMap(z => z.coordinates);
    if (!allCoords.length) { projectedZones = {}; gardenBounds = null; return; }
    const lats = allCoords.map(c => c[0]);
    const lngs = allCoords.map(c => c[1]);
    const minLat = Math.min(...lats), maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
    const midLat  = (minLat + maxLat) / 2;
    const cosLat  = Math.cos(midLat * Math.PI / 180);
    const lngSpan = (maxLng - minLng) * cosLat;
    const latSpan = maxLat - minLat;
    const scale = Math.min(
      (PROJECTION_SPAN - PROJECTION_INSET * 2) / lngSpan,
      (PROJECTION_SPAN - PROJECTION_INSET * 2) / latSpan
    );
    const project = ([lat, lng]) => [
       (lng - minLng) * cosLat * scale - (lngSpan * scale) / 2,
      -((lat - minLat) * scale - (latSpan * scale) / 2),
    ];
    projectedZones = {};
    for (const [slug, zone] of Object.entries(zonesData)) {
      if (zone.coordinates?.length >= 3) {
        projectedZones[slug] = zone.coordinates.map(project);
      }
    }
    const pts = Object.values(projectedZones).flat();
    const gMinX = Math.min(...pts.map(p => p[0]));
    const gMaxX = Math.max(...pts.map(p => p[0]));
    const gMinY = Math.min(...pts.map(p => p[1]));
    const gMaxY = Math.max(...pts.map(p => p[1]));
    // Immutable garden box. Never mutated after this point; the aspect-padded
    // contentBounds is derived from it fresh, per canvas size, in updateContentBounds().
    gardenBounds = {
      minX: gMinX - CONTENT_MARGIN,
      maxX: gMaxX + CONTENT_MARGIN,
      minY: gMinY - CONTENT_MARGIN,
      maxY: gMaxY + CONTENT_MARGIN,
    };
  }
  // ── Derive padded bounds + (re)build texture for the current canvas ──────
  // contentBounds and the grass texture are always rebuilt to match the live
  // canvas aspect, so a fitted view can never fall past the edge of the texture.
  function updateContentBounds() {
    if (!gardenBounds || !cssWidth || !cssHeight) return;
    let width  = gardenBounds.maxX - gardenBounds.minX;
    let height = gardenBounds.maxY - gardenBounds.minY;
    let minX = gardenBounds.minX, maxX = gardenBounds.maxX;
    let minY = gardenBounds.minY, maxY = gardenBounds.maxY;
    const canvasAspect  = cssWidth / cssHeight;
    const contentAspect = width / height;
    // Pad out whichever axis is "too narrow" for the canvas shape, so a
    // fitted view (which matches the canvas's aspect ratio) never has to
    // show anything past the edge of this region.
    if (contentAspect < canvasAspect) {
      const targetWidth = height * canvasAspect;
      const extra = (targetWidth - width) / 2;
      minX -= extra; maxX += extra; width = targetWidth;
    } else {
      const targetHeight = width / canvasAspect;
      const extra = (targetHeight - height) / 2;
      minY -= extra; maxY += extra; height = targetHeight;
    }
    contentBounds = { minX, maxX, minY, maxY };
    // Only re-paint the (expensive) texture when the aspect actually changed.
    if (bakedAspect === null || Math.abs(bakedAspect - canvasAspect) > 0.001) {
      buildBackgroundCache(width, height);
      bakedAspect = canvasAspect;
    }
  }
  // ── Background texture (generated, cached, rebuilt only on aspect change) ─
  function paintGrassTexture(bctx, left, top, width, height) {
    let seed = 17;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    const baseGrad = bctx.createLinearGradient(left, top, left + width, top + height);
    baseGrad.addColorStop(0,   '#cce89a');
    baseGrad.addColorStop(0.3, '#d4e8a8');
    baseGrad.addColorStop(0.6, '#c8e090');
    baseGrad.addColorStop(1,   '#d8eca4');
    bctx.fillStyle = baseGrad;
    bctx.fillRect(left, top, width, height);
    // Large dark green watercolour patches
    for (let p = 0; p < 60; p++) {
      const px    = left + rand() * width;
      const py    = top  + rand() * height;
      const pr    = 40 + rand() * 120;
      const alpha = 0.06 + rand() * 0.13;
      bctx.save();
      bctx.translate(px, py);
      bctx.rotate(rand() * Math.PI * 2);
      bctx.scale(1 + rand() * 1.2, 0.3 + rand() * 0.9);
      const grad = bctx.createRadialGradient(0, 0, 0, 0, 0, pr);
      const g = Math.floor(60 + rand() * 40);
      grad.addColorStop(0,   `rgba(20,${g},10,${alpha})`);
      grad.addColorStop(0.5, `rgba(40,${g + 20},15,${alpha * 0.6})`);
      grad.addColorStop(1,   `rgba(20,${g},10,0)`);
      bctx.fillStyle = grad;
      bctx.beginPath();
      bctx.arc(0, 0, pr, 0, Math.PI * 2);
      bctx.fill();
      bctx.restore();
    }
    // Medium patches — lighter variation
    for (let p = 0; p < 40; p++) {
      const px    = left + rand() * width;
      const py    = top  + rand() * height;
      const pr    = 20 + rand() * 60;
      const alpha = 0.04 + rand() * 0.09;
      bctx.save();
      bctx.translate(px, py);
      bctx.rotate(rand() * Math.PI * 2);
      bctx.scale(0.8 + rand() * 0.8, 0.4 + rand() * 0.7);
      const grad = bctx.createRadialGradient(0, 0, 0, 0, 0, pr);
      grad.addColorStop(0, `rgba(180,220,100,${alpha})`);
      grad.addColorStop(1, `rgba(180,220,100,0)`);
      bctx.fillStyle = grad;
      bctx.beginPath();
      bctx.arc(0, 0, pr, 0, Math.PI * 2);
      bctx.fill();
      bctx.restore();
    }
    // Fine grass blade strokes
    for (let i = 0; i < 2000; i++) {
      const x     = left + rand() * width;
      const y     = top  + rand() * height;
      const len   = 3 + rand() * 10;
      const lean  = (rand() - 0.5) * 6;
      const dark  = rand() > 0.5;
      const alpha = 0.08 + rand() * 0.18;
      bctx.strokeStyle = dark
        ? `rgba(30,65,10,${alpha})`
        : `rgba(160,210,70,${alpha * 0.8})`;
      bctx.lineWidth = 0.4 + rand() * 0.7;
      bctx.lineCap   = 'round';
      bctx.beginPath();
      bctx.moveTo(x, y);
      bctx.quadraticCurveTo(x + lean * 0.5, y - len * 0.5, x + lean, y - len);
      bctx.stroke();
    }
    // Dense stipple dots
    for (let i = 0; i < 1500; i++) {
      const x     = left + rand() * width;
      const y     = top  + rand() * height;
      const light = rand() > 0.45;
      bctx.fillStyle = light
        ? `rgba(210,240,140,${rand() * 0.2})`
        : `rgba(30,60,10,${rand() * 0.12})`;
      bctx.beginPath();
      bctx.arc(x, y, 0.3 + rand() * 1.8, 0, Math.PI * 2);
      bctx.fill();
    }
  }
  // Bake the texture to exactly the current contentBounds. Does not mutate
  // contentBounds (that is updateContentBounds's job).
  function buildBackgroundCache(width, height) {
    if (!contentBounds) return;
    bgCanvas = document.createElement('canvas');
    bgCanvas.width  = Math.max(1, Math.ceil(width  * BG_TEXTURE_RES));
    bgCanvas.height = Math.max(1, Math.ceil(height * BG_TEXTURE_RES));
    const bctx = bgCanvas.getContext('2d');
    bctx.scale(BG_TEXTURE_RES, BG_TEXTURE_RES);
    bctx.translate(-contentBounds.minX, -contentBounds.minY);
    paintGrassTexture(bctx, contentBounds.minX, contentBounds.minY, width, height);
  }
  // ── Canvas sizing (single source of truth for draw + hit-testing) ───────
  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect(); // forces a synchronous reflow
    dpr = window.devicePixelRatio || 1;
    cssWidth  = rect.width;
    cssHeight = rect.height;
    const bw = Math.max(1, Math.round(cssWidth * dpr));
    const bh = Math.max(1, Math.round(cssHeight * dpr));
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width  = bw;
      canvas.height = bh;
    }
  }
  // ── Fit-to-view + per-axis clamp ─────────────────────────────────────────
  function clampAxis(pan, axisMin, axisMax, viewportSize) {
    const contentSize = (axisMax - axisMin) * zoom;
    // Epsilon guards the equal case: at minZoom the content matches the
    // viewport within a rounding hair, and must centre rather than pin to an
    // edge (edge-pinning is what locked the garden low and blocked drag).
    if (contentSize <= viewportSize + 0.5) {
      return (viewportSize - contentSize) / 2 - axisMin * zoom;
    }
    const minPan = viewportSize - axisMax * zoom;
    const maxPan = -axisMin * zoom;
    return Math.min(maxPan, Math.max(minPan, pan));
  }
  function clampPan() {
    if (!contentBounds) return;
    panX = clampAxis(panX, contentBounds.minX, contentBounds.maxX, cssWidth);
    panY = clampAxis(panY, contentBounds.minY, contentBounds.maxY, cssHeight);
  }
  function fitZoomToCanvas() {
    if (!contentBounds || !cssWidth || !cssHeight) return;
    const contentW = contentBounds.maxX - contentBounds.minX;
    const contentH = contentBounds.maxY - contentBounds.minY;
    minZoom = Math.min(cssWidth / contentW, cssHeight / contentH);
    if (firstFit) {
      zoom  = minZoom;
      panX  = cssWidth  / 2 - (contentBounds.minX + contentW  / 2) * zoom;
      panY  = cssHeight / 2 - (contentBounds.minY + contentH / 2) * zoom;
      firstFit = false;
    } else {
      zoom = Math.max(zoom, minZoom);
    }
    clampPan();
  }
  // ── Transform helpers ─────────────────────────────────────────────────
  function applyTransform() {
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, panX * dpr, panY * dpr);
  }
  function screenToWorld(sx, sy) {
    return [(sx - panX) / zoom, (sy - panY) / zoom];
  }
  // ── Drawing ───────────────────────────────────────────────────────────
  function drawZone(slug, pts, isHovered, isSelected) {
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
  function drawLabel(slug, pts, isSelected) {
    const name = MAP_ZONE_NAMES[slug] ?? slug;
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const xs = pts.map(p => p[0]);
    const ys = pts.map(p => p[1]);
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
    ctx.save();
    ctx.globalAlpha = isSelected ? 0.95 : 0.82;
    ctx.fillStyle   = 'rgba(255,252,246,0.92)';
    ctx.beginPath();
    ctx.roundRect(cx - pillW / 2, cy - pillH / 2, pillW, pillH, pillH / 2);
    ctx.fill();
    ctx.restore();
    const colours = MAP_ZONE_COLOURS[slug] ?? { stroke: '#444' };
    ctx.save();
    ctx.fillStyle    = colours.stroke;
    ctx.font         = `500 ${fontSize}px DM Sans, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, cx, cy);
    ctx.restore();
  }
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    applyTransform();
    if (bgCanvas && contentBounds) {
      ctx.drawImage(
        bgCanvas,
        contentBounds.minX, contentBounds.minY,
        contentBounds.maxX - contentBounds.minX,
        contentBounds.maxY - contentBounds.minY
      );
    }
    for (const [slug, pts] of Object.entries(projectedZones)) {
      drawZone(slug, pts, hoveredZone === slug, selectedZone === slug);
    }
    for (const [slug, pts] of Object.entries(projectedZones)) {
      drawLabel(slug, pts, selectedZone === slug);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
  // ── Hit testing ───────────────────────────────────────────────────────
  function pointInPolygon(px, py, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const xi = pts[i][0], yi = pts[i][1];
      const xj = pts[j][0], yj = pts[j][1];
      const intersect = ((yi > py) !== (yj > py)) &&
        (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
      if (intersect) inside = !inside;
    }
    return inside;
  }
  function zoneAtPoint(sx, sy) {
    const [wx, wy] = screenToWorld(sx, sy);
    for (const [slug, pts] of Object.entries(projectedZones)) {
      if (pointInPolygon(wx, wy, pts)) return slug;
    }
    return null;
  }
  // ── Selection / panel ─────────────────────────────────────────────────
  function calcAreaM2(coords) {
    if (!coords || coords.length < 3) return null;
    const R      = 6371000;
    const n      = coords.length;
    const midLat = coords.reduce((s, c) => s + c[0], 0) / n;
    const cosLat = Math.cos(midLat * Math.PI / 180);
    let a = 0;
    for (let i = 0; i < n; i++) {
      const [lat1, lng1] = coords[i];
      const [lat2, lng2] = coords[(i + 1) % n];
      const x1 = lng1 * Math.PI / 180 * cosLat * R;
      const y1 = lat1 * Math.PI / 180 * R;
      const x2 = lng2 * Math.PI / 180 * cosLat * R;
      const y2 = lat2 * Math.PI / 180 * R;
      a += (x1 * y2 - x2 * y1);
    }
    return Math.round(Math.abs(a / 2));
  }
  function showZonePanel(zoneSlug) {
  const zone        = zonesData[zoneSlug];
  const displayName = MAP_ZONE_NAMES[zoneSlug] ?? zone?.name ?? zoneSlug;
  if (!zone) return;
  document.getElementById('map-panel-empty').classList.add('hidden');
  document.getElementById('map-panel-content').classList.remove('hidden');
  const area = calcAreaM2(zone.coordinates);
  document.getElementById('map-panel-name').innerHTML =
    `${displayName}<span style="font-family:'DM Sans',sans-serif;font-size:0.75rem;font-weight:400;color:#b0a090;margin-left:8px">${area ? area + ' m²' : ''}</span>`;
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
    : zonePlants.map(p => {
        const dotColour = PLANT_TYPE_COLOURS[p.type] ?? '#c17f4a';
        return `
          <div class="map-plant-row">
            <div class="map-plant-dot" style="background:${dotColour}"></div>
            <span class="map-plant-name">${p.plant}</span>
            <span class="map-plant-cycle">${p.life_cycle ?? ''}</span>
          </div>`;
      }).join('');
}
  function selectZone(slug) {
    selectedZone = slug || null;
    if (slug) {
      showZonePanel(slug);
    } else {
      showGardenPanel();
    }
    draw();
  }
  // ── Mouse input ───────────────────────────────────────────────────────
  function onMouseDown(e) {
    if (e.button !== 0) return;
    isPanning = true;
    dragged   = false;
    pointerStart = { x: e.clientX, y: e.clientY };
    panOrigin    = { x: panX, y: panY };
    canvas.style.cursor = 'grabbing';
  }
  function onMouseUp() {
    isPanning = false;
    canvas.style.cursor = hoveredZone ? 'pointer' : 'default';
  }
  function onMouseMove(e) {
    if (isPanning) {
      const dx = e.clientX - pointerStart.x;
      const dy = e.clientY - pointerStart.y;
      if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) dragged = true;
      panX = panOrigin.x + dx;
      panY = panOrigin.y + dy;
      clampPan();
      draw();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const slug = zoneAtPoint(e.clientX - rect.left, e.clientY - rect.top);
    if (slug !== hoveredZone) {
      hoveredZone = slug;
      canvas.style.cursor = slug ? 'pointer' : 'default';
      draw();
    }
  }
  function onMouseLeave() {
    hoveredZone = null;
    isPanning   = false;
    canvas.style.cursor = 'default';
    draw();
  }
  function onClick(e) {
    if (dragged) return; // tail end of a drag, not a real click
    const rect = canvas.getBoundingClientRect();
    const slug = zoneAtPoint(e.clientX - rect.left, e.clientY - rect.top);
    selectZone(slug);
  }
  function onWheel(e) {
    e.preventDefault();
    if (!contentBounds) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor  = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const newZoom = Math.min(MAX_ZOOM, Math.max(minZoom, zoom * factor));
    panX = mx - (mx - panX) * (newZoom / zoom);
    panY = my - (my - panY) * (newZoom / zoom);
    zoom = newZoom;
    clampPan();
    draw();
  }
  // ── Touch input (pan + pinch-zoom + tap) ──────────────────────────────
  function pinchState(touches) {
    const [a, b] = touches;
    return {
      dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
      zoom, panX, panY,
      midX: (a.clientX + b.clientX) / 2,
      midY: (a.clientY + b.clientY) / 2,
    };
  }
  function onTouchStart(e) {
    e.preventDefault();
    if (e.touches.length === 1) {
      isPanning = true;
      dragged   = false;
      const t = e.touches[0];
      pointerStart = { x: t.clientX, y: t.clientY };
      panOrigin    = { x: panX, y: panY };
    } else if (e.touches.length === 2) {
      isPanning = false;
      pinch = pinchState(e.touches);
    }
  }
  function onTouchMove(e) {
    e.preventDefault();
    if (e.touches.length === 2 && pinch) {
      const rect  = canvas.getBoundingClientRect();
      const state = pinchState(e.touches);
      const factor  = state.dist / pinch.dist;
      const newZoom = Math.min(MAX_ZOOM, Math.max(minZoom, pinch.zoom * factor));
      const mx = state.midX - rect.left;
      const my = state.midY - rect.top;
      panX = mx - (mx - pinch.panX) * (newZoom / pinch.zoom);
      panY = my - (my - pinch.panY) * (newZoom / pinch.zoom);
      zoom = newZoom;
      clampPan();
      draw();
    } else if (e.touches.length === 1 && isPanning) {
      const t  = e.touches[0];
      const dx = t.clientX - pointerStart.x;
      const dy = t.clientY - pointerStart.y;
      if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) dragged = true;
      panX = panOrigin.x + dx;
      panY = panOrigin.y + dy;
      clampPan();
      draw();
    }
  }
  function onTouchEnd(e) {
    e.preventDefault();
    if (e.touches.length === 0) {
      if (isPanning && !dragged) {
        const rect = canvas.getBoundingClientRect();
        const t = e.changedTouches[0];
        selectZone(zoneAtPoint(t.clientX - rect.left, t.clientY - rect.top));
      }
      isPanning = false;
      pinch = null;
    } else if (e.touches.length === 1) {
      // Lifted one finger out of a pinch — resume as a pan, not a tap.
      pinch = null;
      isPanning = true;
      dragged = true;
      const t = e.touches[0];
      pointerStart = { x: t.clientX, y: t.clientY };
      panOrigin    = { x: panX, y: panY };
    }
  }

  function showGardenPanel() {
    document.getElementById('map-panel-empty').classList.add('hidden');
    document.getElementById('map-panel-content').classList.remove('hidden');
    const totalArea = Object.values(zonesData).reduce((sum, z) => {
      const a = calcAreaM2(z.coordinates);
      return sum + (a || 0);
    }, 0);
    document.getElementById('map-panel-name').innerHTML =
      `Garden<span style="font-family:'DM Sans',sans-serif;font-size:0.75rem;font-weight:400;color:#b0a090;margin-left:8px">${totalArea} m²</span>`;
    const zoneCount  = Object.keys(zonesData).length;
    const plantCount = plantsData.length;
    document.getElementById('map-panel-props').innerHTML = [
      { label: 'Zones',  value: zoneCount },
      { label: 'Plants', value: plantCount },
    ].map(p => `
      <div class="map-prop-row">
        <span class="map-prop-label">${p.label}</span>
        <span class="map-prop-val">${p.value}</span>
      </div>`).join('');
    const sortedPlants = [...plantsData].sort((a, b) =>
      (a.plant || '').localeCompare(b.plant || '')
    );
    document.getElementById('map-plant-list').innerHTML = !sortedPlants.length
      ? `<div class="map-plant-empty">No plants recorded</div>`
      : sortedPlants.map(p => {
          const dotColour = PLANT_TYPE_COLOURS[p.type] ?? '#c17f4a';
          return `
            <div class="map-plant-row">
              <div class="map-plant-dot" style="background:${dotColour}"></div>
              <span class="map-plant-name">${p.plant}</span>
              <span class="map-plant-cycle">${p.life_cycle ?? ''}</span>
            </div>`;
        }).join('');
  }

  // ── Layout / lifecycle ────────────────────────────────────────────────
  // Single guarded entry point. Measures, rebuilds bounds+texture, fits, draws.
  // Bails on any invalid size or missing data so a zero-size frame is a no-op
  // instead of a wipe.
  function layout() {
    resizeCanvas();
    if (!cssWidth || !cssHeight || !gardenBounds) return;
    plantsData = cache['plants'] ?? [];
    updateContentBounds();
    fitZoomToCanvas();
    draw();
    if (selectedZone === null) showGardenPanel();
  }
  // ResizeObserver handler. Uses the size the observer measured and ignores
  // zero-size frames (which is every frame while the tab is display:none).
  function onResize(entries) {
    const box = entries[0]?.contentRect;
    if (!box || box.width < 1 || box.height < 1) return;
    layout();
  }
function init() {
  canvas = document.getElementById('garden-canvas');
  ctx    = canvas.getContext('2d');
  firstFit = true; // every activation re-centres to a clean fit
  if (!resizeObserver) {
    resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(canvas.parentElement);
    canvas.addEventListener('click',      onClick);
    canvas.addEventListener('mousemove',  onMouseMove);
    canvas.addEventListener('mouseleave', onMouseLeave);
    canvas.addEventListener('wheel',      onWheel, { passive: false });
    canvas.addEventListener('mousedown',  onMouseDown);
    window.addEventListener('mouseup',    onMouseUp);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove',  onTouchMove,  { passive: false });
    canvas.addEventListener('touchend',   onTouchEnd,   { passive: false });
  }
  if (!dataLoaded) {
    dataLoaded = true;
    loadZoneData().then(() => {
      projectZones();
      // Explicit first fit, deferred one frame so the canvas is measured after
      // the browser has laid it out. The observer only covers later resizes.
      requestAnimationFrame(layout);
    });
  } else {
    // Re-entry: the tab was just un-hidden. Defer one frame so the container
    // has its real size, then fit. firstFit is already true above, so this is
    // a clean centred re-fit rather than a stale, edge-clamped pan.
    requestAnimationFrame(layout);
  }
}
  return { init };
})();
function initMap() {
  GardenMap.init();
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