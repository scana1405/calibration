# VNG hedef kalibrasyon aracı

Projektörün duvara yansıttığı görüntüde göz hedeflerini istenen açılara doğru yerleştirmek için kalibrasyon yapar ve sonucu bir profil (JSON) olarak saklar. Göz-duvar mesafesi ve hedef açıları girdidir; kod içinde sabit değildir (varsayılanlar 100 cm, 25° yatay, 20° dikey).

## Kurulum

```bash
npm install
npm run dev      # geliştirme sunucusu
npm test         # geometri ve profil testleri
npm run build    # üretim derlemesi (dist/)
```

## Projektörü yerleştirme

1. Projektörü ikinci ekran olarak bağla ve kendi yerel çözünürlüğüne ayarla (ayna değil, genişletilmiş ekran).
2. Projektörü duvara mümkün olduğunca dik kur. Yazılım yamukluğu yalnızca uyarır, düzeltmez.
3. Uygulamayı Chrome'da aç, pencereyi projektör ekranına taşı ve `F` ile tam ekran yap. Tarayıcı zoom'u %100 olsun.

## Kalibrasyon adımları

1. **Ölçek (`1`)**: Duvardaki beyaz çerçevenin dış kenarlarını mezurayla ölç; genişlik ve yüksekliği cm olarak gir. İstersen iki köşegeni de gir: yamukluk ve hatalı ölçüm uyarıları için kullanılır. Göz-duvar mesafesini gir.
2. **Merkez (`2`)**: Artıyı hastanın göz hizasına ve tam karşısına taşı: fareyle sürükle ya da ok tuşlarını kullan (Shift ile 10 piksel).
3. **Doğrulama (`3`)**: İstenen yatay ve dikey açıları gir. Dört hedefin artıya uzaklığını mezurayla ölç; etiketteki değerle (ör. `+25° · 46.6 cm`) karşılaştır.
4. **Kaydet**: Profil tarayıcıda saklanır ve sayfa açılınca yüklenir. `JSON dışa aktar` ile `vng-kalibrasyon-YYYY-MM-DD.json` dosyası indirilir; `JSON içe aktar` ile geri yüklenir.

Çözünürlük, zoom ya da ekran ölçeklemesi ölçümden sonra değişirse panel uyarır: çerçeveyi yeniden ölç.

## Klavye kısayolları

| Tuş | İşlev |
| --- | --- |
| `1`, `2`, `3` | Ölçek, merkez, doğrulama modu |
| `4` | Gaze testi hazırlık ekranı |
| `F` | Tam ekranı aç ya da kapat |
| `P` | Ayar panelini gizle ya da göster |
| Ok tuşları | Merkezi 1 piksel taşı (merkez ve doğrulama modunda) |
| `Shift` + ok tuşları | Merkezi 10 piksel taşı |
| `R` | Merkezi ekran ortasına sıfırla |
| `H` | Doğrulama modunda hedef etiketlerini gizle ya da göster |

Bir metin kutusu odaktayken kısayollar çalışmaz.

## Hesap

Çerçeve, ekranın %60 × %80'i boyutunda ve ortadadır. Ölçek `s = çerçeve_px / ölçülen_cm` (yatay ve dikey ayrı). Hedef konumu, merkez `(cx, cy)` ve mesafe `D` için:

```
x = cx + D · tan(θ_yatay) · s_x
y = cy − D · tan(θ_dikey) · s_y
```

Tüm pikseller fiziksel cihaz pikselidir (`devicePixelRatio` hesaba katılır). Hedef noktasının çapı 0.3° görüş açısına denk gelir, en az 6 pikseldir.

## Profil biçimi

`localStorage` anahtarı `vng-calibration-profile-v1`. Gaze testi bu dosyayı okuyacağı için alan adları değiştirilmemeli:

```json
{
  "version": 1,
  "createdAt": "2026-10-07T19:30:00.000Z",
  "canvasPx": { "width": 1920, "height": 1080 },
  "devicePixelRatio": 1,
  "framePx": { "width": 1152, "height": 864 },
  "measuredCm": { "width": 108.0, "height": 81.0, "diagonal1": null, "diagonal2": null },
  "eyeDistanceCm": 100,
  "pxPerCm": { "x": 10.6667, "y": 10.6667 },
  "centerPx": { "x": 960, "y": 540 },
  "anglesDeg": { "horizontal": 25, "vertical": 20 }
}
```

## Gaze testi

Kalibrasyondan sonra hedef noktayı sırayla merkeze, sağa, sola, yukarıya ve aşağıya yerleştirir ve her fazın gerçek zamanını kaydeder. Kamera ya da göz takibi yoktur, uygulama yalnızca uyaranı gösterir.

### Akış

1. **Hazırlık**: Doğrulama ekranında `Gaze testine geç` düğmesine ya da `4` tuşuna bas. Panel; açıları ve mesafeyi (ekrandaki güncel kalibrasyondan, kaydetmek şart değil), süre ayarlarını, faz listesini ve toplam süreyi gösterir. Canvas'ta yalnızca merkez hedefi görünür.
2. **Geri sayım**: `Testi başlat` ile panel ve fare imleci gizlenir, merkez hedefin üstünde geri sayım görünür.
3. **Oynatma**: Ekranda yalnızca o fazın hedefi vardır: 0.3° çaplı, sabit yanan kırmızı nokta.
4. **Bitiş**: Panel geri gelir; tamamlandı ya da iptal edildi bilgisi, toplam süre ve faz sayısı görünür. `Kaydı indir (JSON)`, `Tekrar başlat`, `Kalibrasyona dön`.

`Testi başlat` şu koşullardan biri sağlanmıyorsa pasiftir ve nedeni yazar: kalibrasyon geçerli (ölçek, mesafe, açılar), tüm hedefler ekran içinde, süre ayarları geçerli aralıkta, uygulama tam ekranda (`F`). Kalibrasyon ve test aynı tam ekran düzeninde yapılmalıdır; aksi halde merkez noktası duvarda kayar.

### Varsayılan dizi

9 faz, 140 s: Merkez 20 s → Sağ 20 s → Merkeze dönüş 10 s → Sol → dönüş → Yukarı → dönüş → Aşağı → dönüş. Açılar kalibrasyondaki yatay ve dikey açılardır. Merkeze dönüş fazları, eksantrik bakıştan sonra görülen ters yönlü (rebound) nistagmusu yakalamak içindir.

### Ayarlar

`localStorage` içinde `vng-gaze-settings-v1` anahtarıyla saklanır.

| Ayar | Varsayılan | Aralık | Açıklama |
| --- | --- | --- | --- |
| Bakış süresi (`gazeDurationSec`) | 20 | 1–120 s | Her bakış konumunun süresi |
| Merkeze dönüş (`returnDurationSec`) | 10 | 0–60 s | 0 ise dönüş fazları eklenmez |
| Hedefsiz süre (`fixationOffSec`) | 0 | 0–60 s | Her bakıştan sonra ekran siyah, aynı konumda; 0 ise eklenmez |
| Geri sayım (`countdownSec`) | 3 | 0–10 s | Test öncesi geri sayım |
| Bip sesi (`beepOnChange`) | açık | | Her faz başında 880 Hz, 80 ms |

### Test sırasındaki tuşlar

| Tuş | İşlev |
| --- | --- |
| `Boşluk` | Duraklat ya da devam et. Hedef yerinde kalır, altta "Duraklatıldı" yazar |
| `Esc` | Testi iptal et (kayıtta `completed: false`) |

Diğer kısayollar test sırasında çalışmaz. Tam ekrandan çıkılırsa ya da pencere boyutu değişirse test iptal edilir; sekme gizlenirse duraklatılır. Destekleniyorsa ekranın uykuya geçmesi engellenir (Screen Wake Lock).

### Kayıt biçimi

Kayıt yalnızca bellekte tutulur ve `vng-gaze-YYYY-MM-DD-HHmm.json` olarak indirilir. Zamanlama `requestAnimationFrame` ve `performance.now()` ile yapılır; faz geçişleri kümülatif planlanan sürelere göre olduğu için kare gecikmeleri birikmez.

```json
{
  "version": 1,
  "test": "gaze",
  "startedAt": "2026-10-07T19:55:03.120Z",
  "startedAtEpochMs": 1791402903120.4,
  "completed": true,
  "settings": { "gazeDurationSec": 20, "returnDurationSec": 10, "fixationOffSec": 0, "countdownSec": 3, "beepOnChange": true },
  "profile": { "...": "test anındaki kalibrasyon profilinin tam kopyası" },
  "phases": [
    {
      "index": 0,
      "kind": "gaze",
      "label": "center",
      "angleDeg": { "h": 0, "v": 0 },
      "targetPx": { "x": 960, "y": 540 },
      "plannedMs": 20000,
      "startMs": 0,
      "endMs": 20004.2
    }
  ],
  "pauses": [{ "startMs": 31250.0, "endMs": 36900.5 }]
}
```

- Tüm `...Ms` değerleri test başlangıcından (geri sayımın bittiği an) itibaren geçen milisaniyedir ve duraklatmaları içerir.
- `startMs`, hedefin yeni konumda ilk çizildiği karenin zamanıdır; `endMs` bir sonraki fazın `startMs` değeridir.
- `startedAtEpochMs` = `performance.timeOrigin + performance.now()`; göz takip verisiyle saat eşlemek için.
- `kind`: `gaze`, `return`, `fixationOff`. `label`: `center`, `right`, `left`, `up`, `down`, `return`; `fixationOff` fazları önceki bakışın etiketini taşır ve `targetPx` değerleri `null` olur.
- İptal edilen testte başlamamış fazlar kayıtta yer almaz.
