const API_URL = "https://geoguardian-backend.onrender.com";

// ========== 2D MAP ==========
const map = L.map('map', {
  center: [39, 35],
  zoom: 4,
  minZoom: 2,
  maxZoom: 8,
  worldCopyJump: true
});

// 🌍 Açık renkli klasik harita
L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 19
}).addTo(map);






function fixMapSize() {
  map.invalidateSize(true);
}

function prepareMap() {
  fixMapSize();
  setTimeout(() => {
    map.invalidateSize();
    map.setView([39, 35], 4);
  }, 400);
}

// ====== State ======
let quakes = [];
const state = { window: "day", minmag: 0, markers: [] };

// ====== Elements ======
const btn2d = document.getElementById('btn2d');
const btn3d = document.getElementById('btn3d');
const globeEl = document.getElementById('globe');
const refreshBtn = document.getElementById('refreshBtn');
const windowSelect = document.getElementById('windowSelect');
const magRange = document.getElementById('magRange');
const magVal = document.getElementById('magVal');
const loadingEl = document.getElementById('loading');

magRange.oninput = () => {
  state.minmag = Number(magRange.value);
  magVal.textContent = state.minmag.toFixed(1);
};
windowSelect.onchange = () => state.window = windowSelect.value;

// ====== Helpers ======
const colorForMag = m => (m >= 5 ? 'red' : m >= 4 ? 'orange' : m >= 3 ? 'yellow' : 'lime');

const clearMarkers = () => {
  state.markers.forEach(m => map.removeLayer(m));
  state.markers = [];
};

async function fetchQuakes() {
  const res = await fetch(`${API_URL}/earthquakes?window=${state.window}&minmag=${state.minmag}`);
  quakes = await res.json();
}

// ======= LOAD 2D =======
async function loadEarthquakes2D() {
  loadingEl.style.display = "flex";
  await fetchQuakes();
  clearMarkers();
  if (!quakes || quakes.length === 0) {
    loadingEl.style.display = "none";
    return;
  }

  quakes
    .filter(eq => eq.mag >= state.minmag)
    .forEach(eq => {
      const marker = L.circleMarker([eq.lat, eq.lon], {
        radius: Math.max(2, eq.mag * 2),
        color: colorForMag(eq.mag),
        fillColor: colorForMag(eq.mag),
        fillOpacity: 0.55
      })
      .bindPopup(`<b>${eq.title}</b><br>Büyüklük: ${eq.mag} Mw<br>Derinlik: ${eq.depth} km`)
      .addTo(map);
      state.markers.push(marker);
    });

  loadingEl.style.display = "none";
  prepareMap();
}

// ========== 3D GLOBE ==========
let world;

async function initGlobe(forceReload = false) {
  loadingEl.style.display = "flex";

  if (!quakes.length || forceReload)
    await fetchQuakes();

  const points = quakes
    .filter(eq => eq.mag >= state.minmag)
    .map(eq => ({
      lat: eq.lat,
      lng: eq.lon,
      mag: eq.mag
    }));

  if (!world || forceReload) {
    globeEl.innerHTML = "";
    world = Globe()(globeEl)
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .pointsData(points)
      .pointColor(p => colorForMag(p.mag))
      .pointRadius(p => Math.max(0.12, p.mag * 0.13))
      .pointAltitude(p => Math.min(0.05, (p.mag - 1) * 0.009))
      .showAtmosphere(true)
      .atmosphereColor('#88aaff')
      .backgroundColor('rgba(0,0,0,0)');

    const controls = world.controls();
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.6;
    controls.minDistance = window.innerWidth < 768 ? 180 : 115;
    controls.maxDistance = 500;
  }

  world.pointsData(points);
  fixGlobe();

  loadingEl.style.display = "none";
}

function fixGlobe() {
  if (!world) return;
  requestAnimationFrame(() => {
    const w = globeEl.clientWidth;
    const h = globeEl.clientHeight;
    if (w > 0 && h > 0) {
      world.width(w);
      world.height(h);
    }
  });
}

// ========= UI =========
btn2d.onclick = () => {
  btn2d.classList.add('active');
  btn3d.classList.remove('active');
  globeEl.style.display = "none";
  document.getElementById('map').style.display = "block";
  prepareMap();
};

btn3d.onclick = async () => {
  btn3d.classList.add('active');
  btn2d.classList.remove('active');
  document.getElementById('map').style.display = "none";
  globeEl.style.display = "block";
  await initGlobe();
  fixGlobe();
};

refreshBtn.onclick = async () => {
  if (globeEl.style.display === "block") {
    await initGlobe(true);
  } else {
    await loadEarthquakes2D();
  }
};

// ========= Responsive =========
window.addEventListener('resize', () => {
  fixGlobe();
  fixMapSize();
});

loadEarthquakes2D();
