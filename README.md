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
