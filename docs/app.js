// ================= GeoGuardian =================
// Veri stratejisi: önce kendi backend'imiz denenir (8 sn zaman aşımı);
// backend uykudaysa/erişilemezse USGS'ten doğrudan çekilir.
// Veriler bucket (all/1.0/2.5/4.5) bazında çekilir, tam şiddet eşiği
// istemcide uygulanır — kaydırıcı çoğu zaman ağa çıkmadan anında çalışır.

const API_URL = "https://geoguardian-backend.onrender.com";
const BACKEND_TIMEOUT_MS = 8000;
const AUTO_REFRESH_MS = 120000; // 2 dakikada bir sessiz yenileme
const LISTE_LIMITI = 100;

// ====== Durum ======
let quakes = [];
const state = {
  window: "day",
  minmag: 0,
  view: "2d",
  sirala: "zaman",
  markers: [],
  source: "-",
  lastUpdate: null,
  backendOk: false,
  cekilen: null, // verinin çekildiği {window, bucket}
  cizim2d: null  // 2D haritanın çizildiği "window|minmag"
};

// URL'den durum geri yükle (paylaşılabilir bağlantılar)
(function () {
  const p = new URLSearchParams(location.search);
  if (["hour", "day", "week", "month"].includes(p.get("window"))) state.window = p.get("window");
  const m = parseFloat(p.get("minmag"));
  if (!isNaN(m)) state.minmag = Math.min(6, Math.max(0, m));
  if (p.get("view") === "3d") state.view = "3d";
})();

function urlGuncelle() {
  const p = new URLSearchParams();
  if (state.window !== "day") p.set("window", state.window);
  if (state.minmag > 0) p.set("minmag", String(state.minmag));
  if (state.view === "3d") p.set("view", "3d");
  const s = p.toString();
  history.replaceState(null, "", s ? `?${s}` : location.pathname);
}

// ====== Elemanlar ======
const btn2d = document.getElementById('btn2d');
const btn3d = document.getElementById('btn3d');
const globeEl = document.getElementById('globe');
const mapEl = document.getElementById('map');
const refreshBtn = document.getElementById('refreshBtn');
const turkiyeBtn = document.getElementById('turkiyeBtn');
const windowSelect = document.getElementById('windowSelect');
const magRange = document.getElementById('magRange');
const magVal = document.getElementById('magVal');
const siralaSelect = document.getElementById('siralaSelect');
const listeEl = document.getElementById('depremListesi');
const listeNotuEl = document.getElementById('listeNotu');
const loadingEl = document.getElementById('loading');
const statusEl = document.getElementById('status');
const errorEl = document.getElementById('errorBar');
const istToplam = document.getElementById('istToplam');
const istEnBuyuk = document.getElementById('istEnBuyuk');
const istEnBuyukYer = document.getElementById('istEnBuyukYer');
const istSonSaat = document.getElementById('istSonSaat');
const istBuyukler = document.getElementById('istBuyukler');

// Kontrolleri URL'den gelen duruma eşitle
windowSelect.value = state.window;
magRange.value = String(state.minmag);
magVal.textContent = state.minmag.toFixed(1);

// ========== 2D HARİTA ==========
const map = L.map('map', {
  center: [39, 35],
  zoom: 4,
  minZoom: 2,
  maxZoom: 8,
  worldCopyJump: true,
  zoomControl: true
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://carto.com/">CARTO</a> | Veri: <a href="https://earthquake.usgs.gov/">USGS</a>',
  subdomains: 'abcd',
  maxZoom: 19
}).addTo(map);

function haritayiBoyutla() {
  map.invalidateSize(true);
}

// ====== Yardımcılar ======
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

const colorForMag = m => (m >= 5 ? '#ff5f4d' : m >= 4 ? '#ff9f43' : m >= 3 ? '#ffd166' : '#3ddc84');

function zamanMetni(ts) {
  const dk = Math.round((Date.now() - ts) / 60000);
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

const goreceZaman = ts => {
  const dk = Math.round((Date.now() - ts) / 60000);
  return dk < 1 ? "az önce" :
         dk < 60 ? `${dk} dk` :
         dk < 1440 ? `${Math.round(dk / 60)} sa` :
         `${Math.round(dk / 1440)} g`;
};

function usgsBucket(minmag) {
  return minmag >= 4.5 ? "4.5" : minmag >= 2.5 ? "2.5" : minmag >= 1.0 ? "1.0" : "all";
}

const cizimAnahtari = () => `${state.window}|${state.minmag}`;

function veriGuncelMi() {
  // state.cekilen yalnızca başarılı fetch'te yazılır; boş sonuç da geçerli veridir.
  return !!(state.cekilen &&
    state.cekilen.window === state.window &&
    state.cekilen.bucket === usgsBucket(state.minmag));
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

function durumuGuncelle(gosterilen) {
  const saat = state.lastUpdate
    ? state.lastUpdate.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
    : "-";
  statusEl.textContent = `${gosterilen} deprem · ${state.source} · ${saat}`;
}

function hataGoster(goster) {
  errorEl.style.display = goster ? "flex" : "none";
}

// ====== Veri çekme (backend → USGS yedeği, yarış korumalı) ======
function usgsNormallestir(f) {
  return (f || []).map(q => ({
    title: q.properties.place || "Bilinmeyen konum",
    mag: q.properties.mag || 0,
    lat: q.geometry.coordinates[1],
    lon: q.geometry.coordinates[0],
    depth: q.geometry.coordinates[2] || 0,
    time: q.properties.time,
    url: q.properties.url || null,
    source: "USGS"
  }));
}

async function backendden(cekim) {
  const res = await fetchWithTimeout(
    `${API_URL}/earthquakes?window=${cekim.window}&minmag=${cekim.bucket === "all" ? 0 : cekim.bucket}`,
    BACKEND_TIMEOUT_MS
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error(data && data.error ? data.error : "Beklenmeyen yanıt");
  return data;
}

async function usgsten(cekim) {
  const url = `https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/${cekim.bucket}_${cekim.window}.geojson`;
  const res = await fetchWithTimeout(url, 15000);
  if (!res.ok) throw new Error(`USGS HTTP ${res.status}`);
  const data = await res.json();
  return usgsNormallestir(data.features);
}

// Yarış koruması: yalnızca en son başlatılan isteğin sonucu uygulanır.
let istekNo = 0;

async function fetchQuakes() {
  const no = ++istekNo;
  const cekim = { window: state.window, bucket: usgsBucket(state.minmag) };
  let veri, kaynak, backendOk;

  try {
    veri = await backendden(cekim);
    kaynak = "GeoGuardian API";
    backendOk = true;
  } catch (hata) {
    console.warn("Backend erişilemedi, USGS'e geçiliyor:", hata.message);
    backendOk = false;
    try {
      veri = await usgsten(cekim);
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
  state.cekilen = cekim;
  state.cizim2d = null; // yeni veri geldi: 2D çizimi artık geçersiz
  return true;
}

// Gerekirse veri çeker; arayüz geri bildirimini yönetir.
// Dönüş: true = veri hazır, render edilebilir; false = bayat/başarısız.
async function veriHazirla(zorla = false, sessiz = false) {
  if (!zorla && veriGuncelMi()) return true;

  if (!sessiz) loadingEl.style.display = "flex";
  hataGoster(false);
  try {
    const taze = await fetchQuakes();
    if (!taze) return false; // en güncel çağrı arayüzü yönetiyor
  } catch (hata) {
    console.error("Veri alınamadı:", hata);
    loadingEl.style.display = "none";
    statusEl.textContent = "Veri alınamadı";
    hataGoster(true);
    return false;
  }
  loadingEl.style.display = "none";
  return true;
}

// ====== Hava durumu (opsiyonel; backend destekliyorsa popup'a eklenir) ======
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

// ====== Render katmanı ======
const filtrelenmis = () => quakes.filter(eq => eq.mag >= state.minmag);

function popupHtml(eq) {
  let html =
    `<b>${esc(eq.title)}</b><br>` +
    `Büyüklük: <b>${Number(eq.mag).toFixed(1)}</b> Mw · Derinlik: ${Math.round(eq.depth)} km<br>` +
    `🕐 ${zamanMetni(eq.time)}`;
  if (eq.url) html += `<br><a href="${esc(eq.url)}" target="_blank" rel="noopener">USGS detayı ↗</a>`;
  return html;
}

function render2d(veriler) {
  state.markers.forEach(m => map.removeLayer(m));
  state.markers = [];

  veriler.forEach(eq => {
    const temelHtml = popupHtml(eq);
    const marker = L.circleMarker([eq.lat, eq.lon], {
      radius: Math.max(3, eq.mag * 2),
      color: colorForMag(eq.mag),
      fillColor: colorForMag(eq.mag),
      fillOpacity: 0.5,
      weight: 1.5
    })
    .bindPopup(temelHtml)
    .addTo(map);

    marker.on('popupopen', e => havaDurumuEkle(e.popup, eq, temelHtml));
    eq._marker = marker;
    state.markers.push(marker);
  });

  state.cizim2d = cizimAnahtari();
}

// ========== 3D KÜRE ==========
let world;

function globeKur() {
  globeEl.innerHTML = "";
  world = Globe()(globeEl)
    .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
    .bumpImageUrl('https://unpkg.com/three-globe/example/img/earth-topology.png')
    .pointColor(p => colorForMag(p.mag))
    .pointRadius(p => Math.max(0.12, p.mag * 0.13))
    .pointAltitude(p => Math.min(0.05, (p.mag - 1) * 0.009))
    .pointLabel(p => `${esc(p.title)}<br>M${Number(p.mag).toFixed(1)} · ${zamanMetni(p.time)}`)
    .ringLat(d => d.lat)
    .ringLng(d => d.lng)
    .ringMaxRadius(d => d.mag * 1.1)
    .ringPropagationSpeed(1.4)
    .ringRepeatPeriod(1600)
    .ringColor(() => t => `rgba(255, 95, 77, ${Math.max(0, 1 - t)})`)
    .showAtmosphere(true)
    .atmosphereColor('#88aaff')
    .backgroundColor('rgba(0,0,0,0)');

  const controls = world.controls();
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.6;
  controls.minDistance = window.innerWidth < 768 ? 180 : 115;
  controls.maxDistance = 500;
}

function render3d(veriler) {
  if (!world) globeKur();
  const points = veriler.map(eq => ({
    lat: eq.lat, lng: eq.lon, mag: eq.mag, title: eq.title, time: eq.time
  }));
  world.pointsData(points);
  // M≥5 depremlerde yayılan sismik halka animasyonu
  world.ringsData(points.filter(p => p.mag >= 5));
  globeBoyutla();
}

function globeBoyutla() {
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

// ====== İstatistikler ======
function renderIstatistik(veriler) {
  istToplam.textContent = String(veriler.length);

  const enBuyuk = veriler.reduce((a, b) => (b.mag > (a ? a.mag : -1) ? b : a), null);
  istEnBuyuk.textContent = enBuyuk ? `M${Number(enBuyuk.mag).toFixed(1)}` : "—";
  istEnBuyukYer.textContent = enBuyuk
    ? (enBuyuk.title.length > 34 ? enBuyuk.title.slice(0, 33) + "…" : enBuyuk.title)
    : "veri yok";

  const birSaat = Date.now() - 3600000;
  istSonSaat.textContent = String(veriler.filter(q => q.time >= birSaat).length);
  istBuyukler.textContent = String(veriler.filter(q => q.mag >= 4.5).length);
}

// ====== Liste ======
function renderListe(veriler) {
  const sirali = [...veriler].sort(
    state.sirala === "buyukluk" ? (a, b) => b.mag - a.mag : (a, b) => b.time - a.time
  );
  const gosterilen = sirali.slice(0, LISTE_LIMITI);

  const parca = document.createDocumentFragment();
  gosterilen.forEach(eq => {
    const li = document.createElement("li");
    const dugme = document.createElement("button");
    dugme.type = "button";
    dugme.className = "deprem-satiri";
    dugme.setAttribute("aria-label",
      `${eq.title}, büyüklük ${Number(eq.mag).toFixed(1)}, ${goreceZaman(eq.time)} önce. Haritada göster.`);

    const rozet = document.createElement("span");
    rozet.className = "mag-rozet";
    rozet.style.background = colorForMag(eq.mag);
    rozet.textContent = Number(eq.mag).toFixed(1);

    const bilgi = document.createElement("span");
    bilgi.className = "deprem-bilgi";
    const yer = document.createElement("span");
    yer.className = "deprem-yer";
    yer.textContent = eq.title;
    const meta = document.createElement("span");
    meta.className = "deprem-meta";
    meta.textContent = `${goreceZaman(eq.time)} · ${Math.round(eq.depth)} km`;
    bilgi.append(yer, meta);

    dugme.append(rozet, bilgi);
    dugme.addEventListener("click", () => depremeOdaklan(eq));
    li.appendChild(dugme);
    parca.appendChild(li);
  });

  listeEl.replaceChildren(parca);
  listeNotuEl.textContent = sirali.length > LISTE_LIMITI
    ? `İlk ${LISTE_LIMITI} gösteriliyor (toplam ${sirali.length})`
    : "";
}

function depremeOdaklan(eq) {
  if (state.view === "2d") {
    map.flyTo([eq.lat, eq.lon], 6, { duration: 1.1 });
    if (eq._marker) {
      map.once("moveend", () => eq._marker.openPopup());
    }
  } else if (world) {
    world.controls().autoRotate = false;
    world.pointOfView({ lat: eq.lat, lng: eq.lon, altitude: 0.9 }, 1000);
  }
}

// ====== Toplu render ======
function renderAktif() {
  const veriler = filtrelenmis();
  if (state.view === "2d") render2d(veriler);
  else render3d(veriler);
  renderIstatistik(veriler);
  renderListe(veriler);
  durumuGuncelle(veriler.length);
}

async function yenile(sessiz = false, zorla = true) {
  if (await veriHazirla(zorla, sessiz)) renderAktif();
}

// ====== Görünüm geçişi ======
// Kabuk (düğmeler + panel görünürlüğü) veri durumundan bağımsız eşitlenir;
// böylece ilk fetch başarısız olsa bile arayüz seçili görünümü yansıtır.
function kabukGuncelle() {
  const ikiD = state.view === "2d";
  btn2d.classList.toggle('active', ikiD);
  btn3d.classList.toggle('active', !ikiD);
  btn2d.setAttribute('aria-pressed', String(ikiD));
  btn3d.setAttribute('aria-pressed', String(!ikiD));
  mapEl.style.display = ikiD ? "block" : "none";
  globeEl.style.display = ikiD ? "none" : "block";
}

function gorunumSec(view) {
  state.view = view;
  kabukGuncelle();
  urlGuncelle();

  if (view === "2d") {
    haritayiBoyutla();
    // 3D'deyken parametre/veri değiştiyse haritayı tazele
    if (state.cizim2d !== cizimAnahtari() || !veriGuncelMi()) {
      yenile(false, !veriGuncelMi());
    }
  } else {
    yenile(false, !veriGuncelMi()); // veri güncelse yalnızca render eder
  }
}

btn2d.onclick = () => gorunumSec("2d");
btn3d.onclick = () => gorunumSec("3d");

// ====== Kontroller ======
windowSelect.onchange = () => {
  state.window = windowSelect.value;
  urlGuncelle();
  yenile();
};

let kaydiriciZamani = null;
magRange.oninput = () => {
  state.minmag = Number(magRange.value);
  magVal.textContent = state.minmag.toFixed(1);
  clearTimeout(kaydiriciZamani);
  kaydiriciZamani = setTimeout(() => {
    urlGuncelle();
    if (veriGuncelMi()) renderAktif(); // aynı bucket: ağa çıkmadan anında uygula
    else yenile();
  }, 350);
};

siralaSelect.onchange = () => {
  state.sirala = siralaSelect.value;
  renderListe(filtrelenmis());
};

refreshBtn.onclick = () => yenile();
document.getElementById('retryBtn').onclick = () => yenile();

turkiyeBtn.onclick = () => {
  if (state.view === "2d") {
    map.flyToBounds([[35.6, 25.5], [42.4, 44.9]], { duration: 1.2 });
  } else if (world) {
    world.controls().autoRotate = false;
    world.pointOfView({ lat: 39, lng: 35, altitude: 1.1 }, 1000);
  }
};

// ====== Otomatik yenileme (sekme görünürken, sessizce) ======
setInterval(() => {
  if (!document.hidden) yenile(true);
}, AUTO_REFRESH_MS);

// ====== Duyarlılık ======
window.addEventListener('resize', () => {
  globeBoyutla();
  haritayiBoyutla();
});

// ====== Başlangıç ======
(async function () {
  kabukGuncelle(); // URL'deki görünüm, veri gelmese bile kabuğa yansır
  const tamam = await veriHazirla(true);
  if (tamam) renderAktif();
})();
