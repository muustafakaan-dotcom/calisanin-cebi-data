# Çalışanın Cebi · veri

Uygulamanın indirdiği tek dosya: `docs/data.json` (GitHub Pages:
`https://muustafakaan-dotcom.github.io/calisanin-cebi-data/data.json`). Herkes için
aynıdır; uygulama kullanıcıya ait hiçbir veri göndermez.

## Otomatik güncellenenler (`scripts/update.mjs`, hafta içi her gün)

| Alan | Kaynak |
|---|---|
| `rates.usd/eur` | TCMB günlük kurlar (`kurlar/today.xml`), döviz satış |
| `history.items[].usd/eur` | TCMB arşivi, her ayın 15'i (tatilse önceki iş günü) |
| `history.items[].cpi`, `inflation.month/annual` | TÜİK TÜFE, TCMB "Tüketici Fiyatları" tablosundaki aylık değişimlerle zincirlenir; yıllık değişimle çapraz kontrol edilir |
| `inflation.rentRate/rentMonth` | 12 aylık ortalama TÜFE değişimi (TBK md. 344), endeksten hesaplanır. Aynı ay için elle doğrulanmış oran (`rentVerified: true`) korunur |
| `history.items[].ounce`, `rates.goldOunceUsd` | Dünya Bankası "Pink Sheet" aylık ons altın ortalaması (CC BY 4.0) |

Bir kaynak okunamazsa veya değer şüpheliyse o kısım atlanır, eski değer kalır.

## Elle güncellenenler (resmi kaynaktan doğrulamadan yazma)

- `holidays`, `coverage`: Resmî tatiller ve arifeler; dini bayramlar Diyanet takviminden.
- `schoolBreaks`: MEB çalışma takvimi.
- `law`: Her Ocak (ve Temmuz kıdem tavanı): gelir vergisi tarifesi (GVGT), asgari ücret, SGK oranları/tavanı, damga vergisi, kıdem tazminatı tavanı. `law.year` ve `law.checked` güncellenmezse uygulama "mevzuat güncel değil" uyarısı gösterir.
- `inflation.groups`: Harcama gruplarına göre yıllık TÜFE (kişisel enflasyon).

Elle değişiklikten sonra `version` alanını o anın tarih-saatine (TR) çek; uygulama daha eski sürümü kabul etmez.

## Hatırlatmalar

`scripts/checks.mjs` her çalışmada elle güncellenecekleri kontrol eder ve zamanı gelen her iş için
`elle-guncelleme` etiketli bir GitHub issue açar (GitHub depo sahibine e-posta gönderir):
Ocak mevzuatı, 1 Temmuz kıdem tavanı, Temmuz ara zam kontrolü, önümüzdeki iki yılın bayram
tarihleri, Haziran'dan itibaren yeni MEB takvimi, 4 aydan eski harcama grubu verisi.
İş bitince issue'yu kapat.
