import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix default marker icon paths for bundled leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: '/leaflet/marker-icon.png',
  iconRetinaUrl: '/leaflet/marker-icon-2x.png',
  shadowUrl: '/leaflet/marker-shadow.png',
});

interface LayerConfig {
  type: 'kml' | 'gpx';
  src: string;
  color?: string;
}

interface MarkerConfig {
  lat: number;
  lng: number;
  label?: string;
  anchor?: string;
}

interface ElevationConfig {
  src: string;
}

interface LeafletConfig {
  fitbounds?: boolean;
  zoomcontrol?: boolean;
  height?: number;
  layers?: LayerConfig[];
  markers?: MarkerConfig[];
  elevation?: ElevationConfig | null;
}

interface ElevationPoint {
  dist: number; // cumulative distance in km
  alt: number;  // altitude in metres
  lat: number;
  lng: number;
}

let chartIdCounter = 0;

function haversineDist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCoordinates(xmlText: string, type: 'kml' | 'gpx'): L.LatLng[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const coords: L.LatLng[] = [];

  if (type === 'kml') {
    doc.querySelectorAll('coordinates').forEach(el => {
      (el.textContent || '').trim().split(/\s+/).forEach(tuple => {
        const parts = tuple.split(',');
        if (parts.length >= 2) {
          const lng = parseFloat(parts[0]);
          const lat = parseFloat(parts[1]);
          if (!isNaN(lat) && !isNaN(lng)) coords.push(L.latLng(lat, lng));
        }
      });
    });
  } else {
    doc.querySelectorAll('trkpt').forEach(pt => {
      const lat = parseFloat(pt.getAttribute('lat') || '');
      const lon = parseFloat(pt.getAttribute('lon') || '');
      if (!isNaN(lat) && !isNaN(lon)) coords.push(L.latLng(lat, lon));
    });
  }

  return coords;
}

function parseElevationProfile(xmlText: string, type: 'kml' | 'gpx'): ElevationPoint[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const raw: Array<{ lat: number; lng: number; alt: number }> = [];

  if (type === 'kml') {
    doc.querySelectorAll('coordinates').forEach(el => {
      (el.textContent || '').trim().split(/\s+/).forEach(tuple => {
        const [lngS, latS, altS] = tuple.split(',');
        const lng = parseFloat(lngS), lat = parseFloat(latS), alt = parseFloat(altS);
        if (!isNaN(lat) && !isNaN(lng) && !isNaN(alt)) raw.push({ lat, lng, alt });
      });
    });
  } else {
    doc.querySelectorAll('trkpt').forEach(pt => {
      const lat = parseFloat(pt.getAttribute('lat') || '');
      const lng = parseFloat(pt.getAttribute('lon') || '');
      const alt = parseFloat(pt.querySelector('ele')?.textContent || '');
      if (!isNaN(lat) && !isNaN(lng) && !isNaN(alt)) raw.push({ lat, lng, alt });
    });
  }

  if (raw.length < 2) return [];

  const profile: ElevationPoint[] = [{ dist: 0, alt: raw[0].alt, lat: raw[0].lat, lng: raw[0].lng }];
  let cumDist = 0;
  for (let i = 1; i < raw.length; i++) {
    cumDist += haversineDist(raw[i - 1].lat, raw[i - 1].lng, raw[i].lat, raw[i].lng);
    profile.push({ dist: cumDist, alt: raw[i].alt, lat: raw[i].lat, lng: raw[i].lng });
  }

  // Downsample to max 400 points to keep SVG lightweight
  const MAX = 400;
  if (profile.length <= MAX) return profile;
  const step = Math.ceil(profile.length / MAX);
  const out: ElevationPoint[] = [];
  for (let i = 0; i < profile.length; i += step) out.push(profile[i]);
  if (out[out.length - 1] !== profile[profile.length - 1]) out.push(profile[profile.length - 1]);
  return out;
}

function renderElevationChart(mapContainer: HTMLElement, profile: ElevationPoint[], map: L.Map): void {
  if (profile.length < 2) return;

  const totalDist = profile[profile.length - 1].dist;
  const alts = profile.map(p => p.alt);
  const minAlt = Math.min(...alts);
  const maxAlt = Math.max(...alts);

  let gain = 0, loss = 0;
  for (let i = 1; i < profile.length; i++) {
    const diff = profile[i].alt - profile[i - 1].alt;
    if (diff > 0) gain += diff;
    else loss -= diff;
  }

  // SVG layout constants
  const W = 800, H = 160;
  const PL = 50, PR = 12, PT = 12, PB = 28;
  const cW = W - PL - PR, cH = H - PT - PB;

  const xS = (d: number) => PL + (d / totalDist) * cW;
  const altRange = maxAlt - minAlt || 1;
  const yS = (a: number) => PT + cH - ((a - minAlt) / altRange) * cH;

  const gradId = `elev-g-${++chartIdCounter}`;
  const NS = 'http://www.w3.org/2000/svg';

  const linePoints = profile.map(p => `${xS(p.dist).toFixed(1)},${yS(p.alt).toFixed(1)}`).join(' ');
  const areaPoints = [
    `${PL},${PT + cH}`,
    ...profile.map(p => `${xS(p.dist).toFixed(1)},${yS(p.alt).toFixed(1)}`),
    `${xS(totalDist).toFixed(1)},${PT + cH}`,
  ].join(' ');

  // Y-axis: 4 evenly spaced ticks
  const yTicks: number[] = [];
  for (let i = 0; i <= 4; i++) yTicks.push(minAlt + (altRange * i) / 4);

  // X-axis: pick a nice km interval targeting ~6 labels
  const niceIntervals = [1, 2, 5, 10, 20, 25, 50, 100];
  const rawInterval = totalDist / 6;
  const xInterval = niceIntervals.find(v => v >= rawInterval) ?? 100;
  const xTicks: number[] = [];
  for (let v = 0; v <= totalDist + xInterval * 0.01; v += xInterval) {
    if (v <= totalDist) xTicks.push(v);
  }

  // --- DOM construction ---
  const wrapper = document.createElement('div');
  wrapper.className = 'elevation-chart';

  // Stats bar
  const stats = document.createElement('div');
  stats.className = 'elevation-stats';
  stats.innerHTML =
    `<span><b>${totalDist.toFixed(1)}&thinsp;km</b> 総距離</span>` +
    `<span><b>↑&thinsp;${Math.round(gain)}&thinsp;m</b> 獲得標高</span>` +
    `<span><b>↓&thinsp;${Math.round(loss)}&thinsp;m</b> 損失標高</span>` +
    `<span><b>${Math.round(minAlt)}–${Math.round(maxAlt)}&thinsp;m</b> 標高範囲</span>`;
  wrapper.appendChild(stats);

  // SVG
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'elevation-svg');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', '標高グラフ');

  // Gradient definition
  const defs = document.createElementNS(NS, 'defs');
  const grad = document.createElementNS(NS, 'linearGradient');
  grad.id = gradId;
  grad.setAttribute('x1', '0'); grad.setAttribute('y1', '0');
  grad.setAttribute('x2', '0'); grad.setAttribute('y2', '1');
  (['0%', '0.45'] as const).forEach(([off, op]) => {
    const s = document.createElementNS(NS, 'stop');
    s.setAttribute('offset', off);
    s.setAttribute('stop-color', '#3b82f6');
    s.setAttribute('stop-opacity', op);
    grad.appendChild(s);
  });
  (['100%', '0.05'] as const).forEach(([off, op]) => {
    const s = document.createElementNS(NS, 'stop');
    s.setAttribute('offset', off);
    s.setAttribute('stop-color', '#3b82f6');
    s.setAttribute('stop-opacity', op);
    grad.appendChild(s);
  });
  defs.appendChild(grad);
  svg.appendChild(defs);

  // Area fill
  const area = document.createElementNS(NS, 'polygon');
  area.setAttribute('points', areaPoints);
  area.setAttribute('fill', `url(#${gradId})`);
  svg.appendChild(area);

  // Y-axis grid + labels
  yTicks.forEach(val => {
    const y = yS(val);
    const grid = document.createElementNS(NS, 'line');
    grid.setAttribute('x1', String(PL)); grid.setAttribute('y1', y.toFixed(1));
    grid.setAttribute('x2', String(PL + cW)); grid.setAttribute('y2', y.toFixed(1));
    grid.setAttribute('stroke', '#e5e7eb'); grid.setAttribute('stroke-width', '1');
    svg.appendChild(grid);

    const lbl = document.createElementNS(NS, 'text');
    lbl.setAttribute('x', String(PL - 4)); lbl.setAttribute('y', (y + 4).toFixed(1));
    lbl.setAttribute('text-anchor', 'end'); lbl.setAttribute('font-size', '11');
    lbl.setAttribute('fill', '#9ca3af');
    lbl.textContent = `${Math.round(val)}m`;
    svg.appendChild(lbl);
  });

  // X-axis labels
  xTicks.forEach(dist => {
    const x = xS(dist);
    const anchor = dist === 0 ? 'start' : dist >= totalDist * 0.95 ? 'end' : 'middle';
    const lbl = document.createElementNS(NS, 'text');
    lbl.setAttribute('x', x.toFixed(1)); lbl.setAttribute('y', String(H - 4));
    lbl.setAttribute('text-anchor', anchor); lbl.setAttribute('font-size', '11');
    lbl.setAttribute('fill', '#9ca3af');
    lbl.textContent = `${dist}km`;
    svg.appendChild(lbl);
  });

  // Elevation line (rendered above fill)
  const line = document.createElementNS(NS, 'polyline');
  line.setAttribute('points', linePoints);
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', '#2563eb');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(line);

  // Hover: vertical crosshair
  const vLine = document.createElementNS(NS, 'line');
  vLine.setAttribute('stroke', '#374151'); vLine.setAttribute('stroke-width', '1');
  vLine.setAttribute('stroke-dasharray', '3,2'); vLine.setAttribute('visibility', 'hidden');
  svg.appendChild(vLine);

  // Hover: dot on line
  const dot = document.createElementNS(NS, 'circle');
  dot.setAttribute('r', '4'); dot.setAttribute('fill', '#2563eb');
  dot.setAttribute('stroke', '#fff'); dot.setAttribute('stroke-width', '1.5');
  dot.setAttribute('visibility', 'hidden');
  svg.appendChild(dot);

  // Hover: tooltip text
  const tip = document.createElementNS(NS, 'text');
  tip.setAttribute('font-size', '12'); tip.setAttribute('fill', '#111827');
  tip.setAttribute('font-weight', 'bold'); tip.setAttribute('visibility', 'hidden');
  svg.appendChild(tip);

  // Map position marker: circleMarker that tracks the hovered elevation point
  const posMarker = L.circleMarker([profile[0].lat, profile[0].lng], {
    radius: 9,
    fillColor: '#ef4444',
    fillOpacity: 0,
    color: '#ffffff',
    weight: 2.5,
    opacity: 0,
    interactive: false,
    bubblingMouseEvents: false,
  }).addTo(map);

  // Transparent hit rectangle for pointer events
  const hit = document.createElementNS(NS, 'rect');
  hit.setAttribute('x', String(PL)); hit.setAttribute('y', String(PT));
  hit.setAttribute('width', String(cW)); hit.setAttribute('height', String(cH));
  hit.setAttribute('fill', 'transparent');
  hit.style.cursor = 'crosshair';

  const showAt = (clientX: number) => {
    const rect = svg.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, ((clientX - rect.left) / rect.width * W - PL) / cW));
    const targetDist = ratio * totalDist;
    let nearest = profile[0];
    let minD = Infinity;
    for (const p of profile) {
      const d = Math.abs(p.dist - targetDist);
      if (d < minD) { minD = d; nearest = p; }
    }
    const cx = xS(nearest.dist), cy = yS(nearest.alt);
    vLine.setAttribute('x1', cx.toFixed(1)); vLine.setAttribute('y1', String(PT));
    vLine.setAttribute('x2', cx.toFixed(1)); vLine.setAttribute('y2', String(PT + cH));
    vLine.setAttribute('visibility', 'visible');
    dot.setAttribute('cx', cx.toFixed(1)); dot.setAttribute('cy', cy.toFixed(1));
    dot.setAttribute('visibility', 'visible');
    const tipX = cx > W / 2 ? cx - 8 : cx + 8;
    tip.setAttribute('x', tipX.toFixed(1));
    tip.setAttribute('y', (Math.max(PT + 14, cy - 8)).toFixed(1));
    tip.setAttribute('text-anchor', cx > W / 2 ? 'end' : 'start');
    tip.textContent = `${nearest.dist.toFixed(1)} km  /  ${Math.round(nearest.alt)} m`;
    tip.setAttribute('visibility', 'visible');
    // Sync map marker
    posMarker.setLatLng([nearest.lat, nearest.lng]);
    posMarker.setStyle({ fillOpacity: 0.9, opacity: 1 });
  };

  const hideAll = () => {
    vLine.setAttribute('visibility', 'hidden');
    dot.setAttribute('visibility', 'hidden');
    tip.setAttribute('visibility', 'hidden');
    posMarker.setStyle({ fillOpacity: 0, opacity: 0 });
  };

  hit.addEventListener('mousemove', e => showAt(e.clientX));
  hit.addEventListener('mouseleave', hideAll);
  hit.addEventListener('touchmove', e => { e.preventDefault(); showAt(e.touches[0].clientX); }, { passive: false });
  hit.addEventListener('touchend', hideAll);

  svg.appendChild(hit);
  wrapper.appendChild(svg);

  mapContainer.insertAdjacentElement('afterend', wrapper);
}

export async function initLeafletMaps(): Promise<void> {
  const containers = document.querySelectorAll<HTMLElement>('.leaflet-map-container');

  // Cache fetched XML by URL to avoid re-fetching when elevation.src == layer.src
  const fetchCache = new Map<string, string>();
  const fetchCached = async (url: string): Promise<string | null> => {
    if (fetchCache.has(url)) return fetchCache.get(url)!;
    try {
      const r = await fetch(url);
      if (!r.ok) { console.warn(`Failed to fetch ${url}: ${r.status}`); return null; }
      const text = await r.text();
      fetchCache.set(url, text);
      return text;
    } catch (err) {
      console.warn(`Error fetching ${url}:`, err);
      return null;
    }
  };

  for (const container of containers) {
    const configStr = container.getAttribute('data-leaflet-config');
    if (!configStr) continue;

    let config: LeafletConfig;
    try {
      config = JSON.parse(configStr);
    } catch {
      console.error('Failed to parse leaflet config:', configStr);
      continue;
    }

    const height = config.height ?? 450;
    container.style.height = `${height}px`;

    const map = L.map(container, {
      zoomControl: config.zoomcontrol ?? true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 18,
    }).addTo(map);

    const allLatLngs: L.LatLng[] = [];

    // Add layers (KML/GPX)
    const layers = config.layers ?? [];
    for (const layer of layers) {
      const text = await fetchCached(layer.src);
      if (!text) continue;
      const coords = parseCoordinates(text, layer.type);
      if (coords.length > 0) {
        const polyline = L.polyline(coords, {
          color: layer.color ?? 'blue',
          weight: 3,
          opacity: 0.8,
        }).addTo(map);
        allLatLngs.push(...coords);
        if (!config.fitbounds && layers.length === 1) {
          map.fitBounds(polyline.getBounds(), { padding: [20, 20], animate: false });
        }
      }
    }

    // Add markers
    const markers = config.markers ?? [];
    for (const markerConfig of markers) {
      const latLng = L.latLng(markerConfig.lat, markerConfig.lng);
      const marker = L.marker(latLng).addTo(map);
      if (markerConfig.label) {
        const popupContent = markerConfig.anchor
          ? `<a href="${markerConfig.anchor}" style="color:#0066cc;">${markerConfig.label}</a>`
          : markerConfig.label;
        marker.bindPopup(popupContent);
      }
      allLatLngs.push(latLng);
    }

    // Fit bounds
    if (config.fitbounds && allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [20, 20], animate: false });
    } else if (allLatLngs.length === 0) {
      map.setView([36.0, 136.0], 6);
    } else if (!config.fitbounds && layers.length === 0 && allLatLngs.length > 0) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [20, 20], animate: false });
    }

    setTimeout(() => map.invalidateSize({ pan: false }), 0);

    // Elevation chart
    if (config.elevation?.src) {
      const src = config.elevation.src;
      const type = src.endsWith('.gpx') ? 'gpx' : 'kml';
      const xml = await fetchCached(src);
      if (xml) {
        const profile = parseElevationProfile(xml, type);
        renderElevationChart(container, profile, map);
      }
    }
  }
}
