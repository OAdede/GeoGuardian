// ================= GeoGuardian =================
// Veri stratejisi: önce kendi backend'imiz denenir (8 sn zaman aşımı);
// backend uykudaysa/erişilemezse USGS'ten doğrudan çekilir.
// Böylece site her koşulda anında veri gösterir.

const API_URL = "https://geoguardian-backend.onrender.com";
const BACKEND_TIMEOUT_MS = 8000;
const AUTO_REFRESH_MS = 120000; // 2 dakikada bir sessiz yenileme

// ========== 2D MAP ==========
const map = L.map('map', {
  center: [39, 35],
  zoom: 4,
  minZoom: 2,
  maxZoom: 8,
  worldCopyJump: true
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://carto.com/">CARTO</a> | Veri: <a href="https://earthquake.usgs.gov/">USGS</a>',
  subdomains: 'abcd',
  maxZoom: 19
}).addTo(map);

function fixMapSize() {
  map.invalidateSize(true);
}

function prepareMap() {
  fixMapSize();
  setTimeout(() => map.invalidateSize(), 400);
}

// ====== State ======
let quakes = [];
const state = {
  window: "day", minmag: 0, markers: [],
  source: "-", lastUpdate: null, backendOk: false,
  sonCekim: null, // verinin hangi parametrelerle çekildiği
  cizim2d: null   // 2D haritanın hangi parametrelerle çizildiği
};

// ====== Elements ======
const btn2d = document.getElementById('btn2d');
const btn3d = document.getElementById('btn3d');
const globeEl = document.getElementById('globe');
const mapEl = document.getElementById('map');
const refreshBtn = document.getElementById('refreshBtn');
const windowSelect = document.getElementById('windowSelect');
const magRange = document.getElementById('magRange');
const magVal = document.getElementById('magVal');
const loadingEl = document.getElementById('loading');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('errorBar');

magRange.oninput = () => {
  state.minmag = Number(magRange.value);
  magVal.textContent = state.minmag.toFixed(1);
};
windowSelect.onchange = () => state.window = windowSelect.value;

// ====== Helpers ======
const colorForMag = m => (m >= 5 ? '#e74c3c' : m >= 4 ? '#e67e22' : m >= 3 ? '#f1c40f' : '#2ecc71');

const clearMarkers = () => {
  state.markers.forEach(m => map.removeLayer(m));
  state.markers = [];
};

// Dış kaynaklardan (USGS/OpenWeather) gelen metinleri HTML'e gömmeden önce kaçır
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function zamanMetni(ts) {
  const fark = Date.now() - ts;
  const dk = Math.round(fark / 60000);
  const gorece =
    dk < 1 ? "az önce" :
    dk < 60 ? `${dk} dk önce` :
    dk < 1440 ? `${Math.round(dk / 60)} sa önce` :
    `${Math.round(dk / 1440)} gün önce`;
  const saat = new Date(ts).toLocaleString('tr-TR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
  });
  return `${saat} (${gorece})`;
}

function durumuGuncelle(gosterilen) {
  const saat = state.lastUpdate
    ? state.lastUpdate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : "-";
  statusEl.textContent = `${gosterilen} deprem · Kaynak: ${state.source} · Güncelleme: ${saat}`;
}

function hataGoster(goster) {
  errorEl.style.display = goster ? "block" : "none";
}

// ====== Veri çekme (backend → USGS yedeği) ======
function usgsBucket(minmag) {
  return minmag >= 4.5 ? "4.5" : minmag >= 2.5 ? "2.5" : minmag >= 1.0 ? "1.0" : "all";
}

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function backendden() {
  const res = await fetchWithTimeout(
    `${API_URL}/earthquakes?window=${state.window}&minmag=${state.minmag}`,
    BACKEND_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(data && data.error ? data.error : "Beklenmeyen yanıt");
  return data;
}

async function usgsten() {
  const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${usgsBucket(state.minmag)}_${state.window}.geojson`;
  const res = await fetchWithTimeout(url, 15000);
  if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
  const data = await res.json();
  return (data.features || []).map(q => ({
    title: q.properties.place || "Bilinmeyen konum",
    mag: q.properties.mag || 0,
    lat: q.geometry.coordinates[1],
    lon: q.geometry.coordinates[0],
    depth: q.geometry.coordinates[2] || 0,
    time: q.properties.time,
    source: "USGS"
  }));
}

// Görünümün hangi parametrelerle çizildiğini/çekildiğini izlemek için
const anahtar = () => `${state.window}|${state.minmag}`;

// Yarış koruması: yalnızca en son başlatılan isteğin sonucu uygulanır.
let istekNo = 0;

async function fetchQuakes() {
  const no = ++istekNo;
  const parametreler = anahtar(); // istek anındaki değerler
  let veri, kaynak, backendOk;

  try {
    veri = await backendden();
    kaynak = "GeoGuardian API";
    backendOk = true;
  } catch (hata) {
    console.warn("Backend erişilemedi, USGS'e geçiliyor:", hata.message);
    backendOk = false;
    try {
      veri = await usgsten();
      kaynak = "USGS (doğrudan)";
    } catch (usgsHata) {
      if (no !== istekNo) return false; // bayat istek; hatasını da yok say
      throw usgsHata;
    }
  }

  if (no !== istekNo) return false; // bu arada daha yeni istek başladı

  quakes = veri;
  state.source = kaynak;
  state.backendOk = backendOk;
  state.lastUpdate = new Date();
  state.sonCekim = parametreler;
  return true;
}

// ====== Hava durumu (opsiyonel; backend destekliyorsa popup'a eklenir) ======
// Sonuç deprem nesnesinde önbellenir: tekrar açılışta yeniden istek atılmaz,
// içerik taban HTML üzerine kurulduğu için satır birikmesi olmaz.
async function havaDurumuEkle(popup, eq, temelHtml) {
  if (eq._hava === undefined) {
    if (!state.backendOk) return;
    try {
      const res = await fetchWithTimeout(`${API_URL}/weather?lat=${eq.lat}&lon=${eq.lon}`, 6000);
      const w = res.ok ? await res.json() : null;
      eq._hava = (w && typeof w.temp === "number")
        ? `<br>🌡️ ${Math.round(w.temp)}°C, ${esc(w.desc || "")} · Rüzgâr ${esc(w.wind ?? "-")} m/sn`
        : null;
    } catch (hata) {
      eq._hava = null; // hava durumu süs; sessizce geç
    }
  }
  if (eq._hava) popup.setContent(temelHtml + eq._hava);
}

// ======= LOAD 2D =======
async function loadEarthquakes2D(sessiz = false) {
  if (!sessiz) loadingEl.style.display = "flex";
  hataGoster(false);
  try {
    const taze = await fetchQuakes();
    if (!taze) return; // bayat istek; en güncel çağrı arayüzü yönetiyor
  } catch (hata) {
    console.error("Veri alınamadı:", hata);
    loadingEl.style.display = "none";
    statusEl.textContent = "Veri alınamadı";
    hataGoster(true);
    return;
  }

  clearMarkers();
  const gosterilecek = quakes.filter(eq => eq.mag >= state.minmag);

  gosterilecek.forEach(eq => {
    const temelHtml =
      `<b>${esc(eq.title)}</b><br>` +
      `Büyüklük: <b>${Number(eq.mag).toFixed(1)}</b> Mw · Derinlik: ${Math.round(eq.depth)} km<br>` +
      `🕐 ${zamanMetni(eq.time)}`;

    const marker = L.circleMarker([eq.lat, eq.lon], {
      radius: Math.max(2, eq.mag * 2),
      color: colorForMag(eq.mag),
      fillColor: colorForMag(eq.mag),
      fillOpacity: 0.55,
      weight: 1.5
    })
    .bindPopup(temelHtml)
    .addTo(map);

    marker.on('popupopen', e => havaDurumuEkle(e.popup, eq, temelHtml));
    state.markers.push(marker);
  });

  state.cizim2d = anahtar();
  durumuGuncelle(gosterilecek.length);
  loadingEl.style.display = "none";
  if (!sessiz) prepareMap();
}

// ========== 3D GLOBE ==========
let world;

async function initGlobe(forceReload = false, sessiz = false) {
  if (!sessiz) loadingEl.style.display = "flex";
  hataGoster(false);

  // Önbellek yalnızca aynı zaman/şiddet parametreleriyle çekildiyse geçerli.
  if (!quakes.length || forceReload || state.sonCekim !== anahtar()) {
    try {
      const taze = await fetchQuakes();
      if (!taze) return; // bayat istek; en güncel çağrı arayüzü yönetiyor
    } catch (hata) {
      console.error("Veri alınamadı:", hata);
      loadingEl.style.display = "none";
      statusEl.textContent = "Veri alınamadı";
      hataGoster(true);
      return;
    }
  }

  const points = quakes
    .filter(eq => eq.mag >= state.minmag)
    .map(eq => ({ lat: eq.lat, lng: eq.lon, mag: eq.mag, title: eq.title, time: eq.time }));

  if (!world) {
    globeEl.innerHTML = "";
    world = Globe()(globeEl)
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
      .pointColor(p => colorForMag(p.mag))
      .pointRadius(p => Math.max(0.12, p.mag * 0.13))
      .pointAltitude(p => Math.min(0.05, (p.mag - 1) * 0.009))
      .pointLabel(p => `${esc(p.title)}<br>M${Number(p.mag).toFixed(1)} · ${zamanMetni(p.time)}`)
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
  durumuGuncelle(points.length);
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
  mapEl.style.display = "block";
  // Harita veya eldeki veri güncel parametrelerle uyuşmuyorsa yeniden yükle;
  // böylece durum çubuğu ve işaretçiler her zaman tutarlı kalır.
  if (state.cizim2d !== anahtar() || state.sonCekim !== anahtar()) {
    loadEarthquakes2D();
  } else {
    prepareMap();
  }
};

btn3d.onclick = async () => {
  btn3d.classList.add('active');
  btn2d.classList.remove('active');
  mapEl.style.display = "none";
  globeEl.style.display = "block";
  await initGlobe();
  fixGlobe();
};

async function aktifGorunumuYenile(sessiz = false) {
  if (globeEl.style.display === "block") {
    await initGlobe(true, sessiz);
  } else {
    await loadEarthquakes2D(sessiz);
  }
}

refreshBtn.onclick = () => aktifGorunumuYenile();
document.getElementById('retryBtn').onclick = () => aktifGorunumuYenile();

// ========= Otomatik yenileme (sekme görünürken, sessizce) =========
setInterval(() => {
  if (!document.hidden) aktifGorunumuYenile(true);
}, AUTO_REFRESH_MS);

// ========= Responsive =========
window.addEventListener('resize', () => {
  fixGlobe();
  fixMapSize();
});

loadEarthquakes2D();
