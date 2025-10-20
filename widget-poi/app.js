(function () {
  // =========================
  //  Configuración
  // =========================
  const CATEGORIES = [
    { id: 'school', label: 'Escuelas/Colegios', tags: [{ k: 'amenity', v: 'school' }] },
    { id: 'university', label: 'Universidades', tags: [{ k: 'amenity', v: 'university' }] },
    { id: 'park', label: 'Parques', tags: [{ k: 'leisure', v: 'park' }] },
    { id: 'mall', label: 'Centros comerciales', tags: [{ k: 'shop', v: 'mall' }] },
    { id: 'hospital', label: 'Hospitales', tags: [{ k: 'amenity', v: 'hospital' }] },
    { id: 'clinic', label: 'Clínicas', tags: [{ k: 'amenity', v: 'clinic' }] },
    { id: 'pharmacy', label: 'Farmacias', tags: [{ k: 'amenity', v: 'pharmacy' }] },
    { id: 'supermarket', label: 'Super/Tiendas', tags: [{ k: 'shop', v: 'supermarket' }, { k: 'shop', v: 'convenience' }] },
    { id: 'bus_stop', label: 'Paradas de bus', tags: [{ k: 'highway', v: 'bus_stop' }] },
  ];

  const COLORS = {
    school: '#facc15',
    university: '#1d4ed8',
    park: '#4ade80',
    mall: '#f472b6',
    hospital: '#f87171',
    clinic: '#fb923c',
    pharmacy: '#a78bfa',
    supermarket: '#34d399',
    bus_stop: '#2563eb'
  };

  // =========================
  //  Estado inicial
  // =========================
  const center = { lat: -0.13226, lng: -78.47046 };  
  const homeLabel = "Torres Santa Catalina";
  const FIXED_RADIUS = 500; // radio fijo en metros
  let activeCats = CATEGORIES.map(c => c.id);

  // =========================
  //  Utilidades
  // =========================
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function featureToLatLng(feat) {
    if (feat.type === 'node') return [feat.lat, feat.lon];
    if ((feat.type === 'way' || feat.type === 'relation') && feat.center)
      return [feat.center.lat, feat.center.lon];
    return null;
  }

  function getName(tags) {
    if (!tags) return 'Sin nombre';
    return tags.name || tags['name:es'] || tags.brand || 'Sin nombre';
  }

  function guessCategory(tags) {
    for (const c of CATEGORIES) {
      for (const t of c.tags) {
        if (tags && tags[t.k] === t.v) return c.id;
      }
    }
    return 'otro';
  }

  function categoryLabel(id) {
    const c = CATEGORIES.find(x => x.id === id);
    return c ? c.label : 'Otro';
  }

  function iconFor(catId) {
    const color = COLORS[catId] || '#f59e0b';
    const svg = encodeURIComponent(`
      <svg xmlns='http://www.w3.org/2000/svg' width='30' height='42' viewBox='0 0 30 42'>
        <path d='M15 0C6.7 0 0 6.7 0 15c0 10.5 15 27 15 27s15-16.5 15-27C30 6.7 23.3 0 15 0z' fill='${color}'/>
        <circle cx='15' cy='15' r='6' fill='#D99940'/>
      </svg>
    `);
    return L.icon({
      iconUrl: `data:image/svg+xml,${svg}`,
      iconSize: [24, 34],
      iconAnchor: [12, 34],
      popupAnchor: [0, -28]
    });
  }

  function buildOverpassQuery(lat, lng, radius, activeCatIds) {
    const parts = [];
    activeCatIds.forEach(id => {
      const cat = CATEGORIES.find(c => c.id === id);
      if (!cat) return;
      cat.tags.forEach(tag => {
        const filter = `[${tag.k}="${tag.v}"]`;
        parts.push(`node${filter}(around:${radius},${lat},${lng});`);
        parts.push(`way${filter}(around:${radius},${lat},${lng});`);
        parts.push(`relation${filter}(around:${radius},${lat},${lng});`);
      });
    });
    return `[out:json][timeout:25];(${parts.join('\n')});out center;`;
  }

  // =========================
  //  Referencias de UI
  // =========================
  const listDiv = document.getElementById("list");
  const catCheckboxes = document.querySelectorAll('.categories input[type="checkbox"]');
  const toggleArea = document.getElementById("toggleArea");

  // =========================
  //  Mapa
  // =========================
  const mapHost = document.getElementById("map");
  const mapDiv = document.createElement("div");
  mapDiv.style.position = "absolute";
  mapDiv.style.inset = "0";
  mapHost.appendChild(mapDiv);

  const map = L.map(mapDiv).setView([center.lat, center.lng], 15);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  const homeMarker = L.marker([center.lat, center.lng], {
    draggable: false,
    icon: L.icon({
      iconUrl: `data:image/svg+xml,${encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 24 24" fill="#facc15" stroke="#000" stroke-width="1.5">
          <path d="M3 9.5L12 3l9 6.5V21a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1V9.5z"/>
        </svg>`)}`,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -28]
    })
  }).addTo(map)
    .bindPopup(homeLabel)
    .openPopup();

  const resultsLayer = L.layerGroup().addTo(map);
  let searchCircle = null;

  // =========================
  //  Render de lista
  // =========================
  function renderList(items) {
    if (!items.length) {
      listDiv.innerHTML = `<div class="item"><em>0 resultados.</em></div>`;
      return;
    }
    listDiv.innerHTML = '';
    items.forEach(it => {
      const row = document.createElement('div');
      row.className = 'item';
      const left = document.createElement('div');
      const right = document.createElement('div');
      right.className = 'actions';
      left.innerHTML = `<h3>${it.name}</h3><div class="meta">${categoryLabel(it.catId)} · ${(it.dist / 1000).toFixed(2)} km</div>`;
      right.innerHTML = `<a href="https://maps.google.com/?q=${it.lat},${it.lng}" target="_blank">Maps</a>`;
      row.appendChild(left);
      row.appendChild(right);
      listDiv.appendChild(row);
    });
  }

  // =========================
  //  Búsqueda Overpass
  // =========================
  async function search() {
    const ll = L.latLng(center.lat, center.lng);
    const r = FIXED_RADIUS;
    resultsLayer.clearLayers();

    if (searchCircle) map.removeLayer(searchCircle);
    searchCircle = L.circle(ll, {
      radius: r,
      color: "#16a34a",
      weight: 2,
      fillColor: "#22c55e",
      fillOpacity: 0.10
    }).addTo(map);

    map.fitBounds(searchCircle.getBounds(), { padding: [20, 20] });


    try {
      const query = buildOverpassQuery(ll.lat, ll.lng, r, activeCats);
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ data: query })
      });
      const json = await res.json();
      const elements = json.elements || [];

      for (const el of elements) {
        const pos = featureToLatLng(el);
        if (!pos) continue;
        const [y, x] = pos;
        const name = getName(el.tags || {});
        const catId = guessCategory(el.tags || {});
        if (!activeCats.includes(catId)) continue;
        const dist = haversine(ll.lat, ll.lng, y, x);

        L.marker([y, x], { icon: iconFor(catId) })
          .bindPopup(`<b>${name}</b><br>${categoryLabel(catId)}<br>${dist.toFixed(0)} m`)
          .addTo(resultsLayer);
      }
    } catch (err) {
      console.error("Error Overpass:", err);
    }
  }


  // =========================
  //  Eventos
  // =========================
  catCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      activeCats = Array.from(catCheckboxes)
        .filter(x => x.checked)
        .map(x => x.value);
      search(); // búsqueda automática
    });
  });

  // Ejecutar búsqueda inicial
  search();
})();
