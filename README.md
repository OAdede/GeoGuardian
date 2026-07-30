# 🌍 GeoGuardian — Canlı Deprem Takip Sistemi

Dünya genelindeki depremleri gerçek zamanlı izleyen web uygulaması: **2D harita** (Leaflet)
ve **3D küre** (globe.gl) görünümü, zaman aralığı ve büyüklük filtreleri, otomatik yenileme.

**Canlı Demo:** **https://oadede.github.io/GeoGuardian/**

## Özellikler

- 🗺️ 2D harita ve 🌐 3D döner küre arasında tek tıkla geçiş
- ⏱️ Zaman filtresi: son 1 saat / 24 saat / 7 gün / 30 gün
- 📏 Minimum büyüklük (Mw) filtresi
- 🎨 Büyüklüğe göre renk kodu (yeşil → kırmızı) ve boyutlanan işaretçiler
- 🕐 Her depremin saati ve "x dk önce" görece zamanı
- 🌡️ Deprem noktasındaki güncel hava durumu (opsiyonel, popup içinde)
- 🔄 2 dakikada bir sessiz otomatik yenileme, durum çubuğunda son güncelleme saati
- 📱 Mobil uyumlu arayüz

## Mimari

```
Tarayıcı (GitHub Pages, docs/)
   │
   ├─► GeoGuardian API (FastAPI, Render) ──► USGS GeoJSON Feed
   │        └─► OpenWeatherMap (opsiyonel hava durumu)
   │
   └─► USGS GeoJSON Feed (backend uyanana kadar otomatik yedek)
```

Backend, Render'ın ücretsiz planında çalıştığı için boşta kalınca uykuya geçer ve ilk
istekte ~1 dakika gecikebilir. Ön yüz bu durumu kendisi çözer: backend 8 saniyede yanıt
vermezse veriyi **doğrudan USGS'ten** çeker — site her koşulda anında açılır.

## Yerelde Çalıştırma

### Ön yüz

Statik dosyalardır; `docs/index.html`'i tarayıcıda açmak yeterli.

### Backend (opsiyonel)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload
```

| Uç Nokta | Açıklama |
|---|---|
| `GET /earthquakes?window=day&minmag=2.5` | Deprem listesi (window: hour/day/week/month) |
| `GET /weather?lat=39&lon=35` | Koordinattaki hava durumu (`WEATHER_KEY` gerekli) |

Hava durumu için `backend/.env` dosyasına [OpenWeatherMap](https://openweathermap.org/api)
anahtarı ekleyin:

```
WEATHER_KEY=xxxxxxxxxxxx
```

> Not: Ön yüz varsayılan olarak Render'daki canlı backend'e bağlıdır. Sitenin
> **yerel** backend'inizi kullanması için `docs/app.js` başındaki `API_URL`
> değerini geçici olarak `http://127.0.0.1:8000` yapın.

## Veri Kaynağı

Deprem verileri [USGS Earthquake Hazards Program](https://earthquake.usgs.gov/)
GeoJSON beslemelerinden alınır ve yaklaşık dakikada bir güncellenir.

## Lisans

[MIT](LICENSE)
