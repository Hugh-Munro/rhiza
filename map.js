// ── Zone colours ──────────────────────────────────────────────────────────
const MAP_ZONE_COLOURS = {
  woods:   { color: '#2a6b30', fillColor: '#4a7c59' },
  field:   { color: '#8a7a20', fillColor: '#c8b865' },
  orchard: { color: '#9a6035', fillColor: '#c17f4a' },
  gravel:  { color: '#7a7060', fillColor: '#b0a898' },
};

// ── State ─────────────────────────────────────────────────────────────────
let map            = null;
let zonesData      = {};
let plantsData     = [];
let drawnLayers    = {};   // { zoneId: L.polygon }
let drawingPoints  = [];
let drawingMarkers = [];
let previewLine    = null;
let drawMode       = false;
let mapInitialised = false;

// ── Init map ──────────────────────────────────────────────────────────────
async function initMap() {
  if (mapInitialised) return;
  mapInitialised = true;

  // Load zones.json
  try {
    const res = await fetch('data/zones.json');
    zonesData = await res.json();
  } catch (e) {
    console.warn('Could not load zones.json', e);
    zonesData = {};
  }

  // Grab plants from app.js cache
  plantsData = cache['plants'] ?? [];

  // Create Leaflet map centred on Callaghane, Waterford
  map = L.map('leaflet-map', { zoomControl: true }).setView([52.2069, -7.0453], 17);

  // Esri satellite tiles — free, no API key
  L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    {
      attribution: 'Tiles © Esri',
      maxZoom: 20,
    }
  ).addTo(map);

  // Draw any existing zone polygons from zones.json
  for (const [zoneId, zone] of Object.entries(zonesData)) {
    if (zone.coordinates && zone.coordinates.length >= 3) {
      drawZonePolygon(zoneId, zone.coordinates);
    }
  }

  // Map click — add point when in draw mode
  map.on('click', onMapClick);
}

// ── Draw a saved polygon ──────────────────────────────────────────────────
function drawZonePolygon(zoneId, coords) {
  if (drawnLayers[zoneId]) {
    drawnLayers[zoneId].remove();
  }
  const colours = MAP_ZONE_COLOURS[zoneId] ?? { color: '#666', fillColor: '#999' };
  const polygon = L.polygon(coords, {
    color:       colours.color,
    fillColor:   colours.fillColor,
    fillOpacity: 0.45,
    weight:      2,
  }).addTo(map);

  polygon.on('click', (e) => {
    L.DomEvent.stopPropagation(e);
    if (!drawMode) showZonePanel(zoneId);
  });

  drawnLayers[zoneId] = polygon;
}

// ── Map click handler ─────────────────────────────────────────────────────
function onMapClick(e) {
  if (!drawMode) return;

  const { lat, lng } = e.latlng;
  drawingPoints.push([lat, lng]);

  // Place a small marker for each point
  const marker = L.circleMarker([lat, lng], {
    radius: 5, color: '#c17f4a', fillColor: '#c17f4a', fillOpacity: 1, weight: 2,
  }).addTo(map);
  drawingMarkers.push(marker);

  // Update hint
  if (drawingPoints.length === 1) {
    document.getElementById('map-hint').textContent = 'Keep clicking to add points — click the first point to close the shape';
  }

  // Check if clicking near first point to close polygon (after 3+ points)
  if (drawingPoints.length >= 3) {
    const first = map.latLngToContainerPoint(drawingPoints[0]);
    const current = map.latLngToContainerPoint([lat, lng]);
    const dist = Math.sqrt(Math.pow(first.x - current.x, 2) + Math.pow(first.y - current.y, 2));
    if (dist < 14) {
      closePolygon();
      return;
    }
  }

  // Draw preview polyline
  if (previewLine) previewLine.remove();
  if (drawingPoints.length >= 2) {
    previewLine = L.polyline(drawingPoints, { color: '#c17f4a', weight: 1.5, dashArray: '5,5' }).addTo(map);
  }
}

// ── Close and save polygon ────────────────────────────────────────────────
function closePolygon() {
  const zoneId = document.getElementById('map-zone-select').value;

  // Clean up drawing state
  drawingMarkers.forEach(m => m.remove());
  drawingMarkers = [];
  if (previewLine) { previewLine.remove(); previewLine = null; }

  // Save coords to zonesData and draw
  const coords = [...drawingPoints];
  drawingPoints = [];

  if (!zonesData[zoneId]) zonesData[zoneId] = { name: zoneId };
  zonesData[zoneId].coordinates = coords;
  drawZonePolygon(zoneId, coords);

  document.getElementById('map-hint').textContent = `${zonesData[zoneId].name ?? zoneId} saved — click Export to download zones.json`;
}

// ── Show zone panel ───────────────────────────────────────────────────────
function showZonePanel(zoneId) {
  const zone = zonesData[zoneId];
  if (!zone) return;

  document.getElementById('map-panel-empty').classList.add('hidden');
  document.getElementById('map-panel-content').classList.remove('hidden');
  document.getElementById('map-panel-name').textContent = zone.name ?? zoneId;

  // Properties
  const props = [
    { label: 'Light', value: zone.light ?? '—' },
    { label: 'Soil',  value: zone.soil  ?? '—' },
  ];
  document.getElementById('map-panel-props').innerHTML = props.map(p => `
    <div class="map-prop-row">
      <span class="map-prop-label">${p.label}</span>
      <span class="map-prop-val">${p.value}</span>
    </div>`).join('');

  // Plants in this zone
  const zonePlants = plantsData.filter(r => (r.zone || '').toLowerCase() === (zone.name || zoneId).toLowerCase());
  const listEl = document.getElementById('map-plant-list');
  if (!zonePlants.length) {
    listEl.innerHTML = `<div class="map-plant-empty">No plants recorded</div>`;
  } else {
    listEl.innerHTML = zonePlants.map(p => `
      <div class="map-plant-row">
        <div class="map-plant-dot"></div>
        <span class="map-plant-name">${p.plant}</span>
        <span class="map-plant-cycle">${p.life_cycle ?? ''}</span>
      </div>`).join('');
  }

  // Highlight active polygon
  Object.entries(drawnLayers).forEach(([id, layer]) => {
    layer.setStyle({ weight: id === zoneId ? 3 : 2 });
  });
}

// ── Export zones.json ─────────────────────────────────────────────────────
function exportZones() {
  const blob = new Blob([JSON.stringify(zonesData, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'zones.json';
  a.click();
  URL.revokeObjectURL(url);
}

// ── Clear a zone polygon ──────────────────────────────────────────────────
function clearZone() {
  const zoneId = document.getElementById('map-zone-select').value;
  if (drawnLayers[zoneId]) {
    drawnLayers[zoneId].remove();
    delete drawnLayers[zoneId];
  }
  if (zonesData[zoneId]) {
    delete zonesData[zoneId].coordinates;
  }
  document.getElementById('map-panel-empty').classList.remove('hidden');
  document.getElementById('map-panel-content').classList.add('hidden');
  document.getElementById('map-hint').textContent = 'Zone cleared — draw a new boundary';
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

// ── Draw mode toggle ──────────────────────────────────────────────────────
document.getElementById('btn-draw-mode').addEventListener('click', () => {
  drawMode = !drawMode;
  document.getElementById('btn-draw-mode').classList.toggle('active', drawMode);
  document.getElementById('map-hint').textContent = drawMode
    ? 'Click the map to start drawing a zone boundary'
    : 'Select a zone and click Draw zone to begin';
  if (!drawMode) {
    drawingPoints = [];
    drawingMarkers.forEach(m => m.remove());
    drawingMarkers = [];
    if (previewLine) { previewLine.remove(); previewLine = null; }
  }
  if (map) map.getContainer().style.cursor = drawMode ? 'crosshair' : '';
});

document.getElementById('btn-export').addEventListener('click', exportZones);
document.getElementById('btn-clear-zone').addEventListener('click', clearZone);