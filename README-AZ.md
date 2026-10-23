# TicketFlow — Admin paneli / QR bilet sistemi (v3)

Bu paket istifadəçinin göndərdiyi hazır admin HTML-i, `tf-admin-cloud.js` və `tf-core.js` əsasında hazırlanıb. Firebase layihəsinin adı `gunelsstory-6d3a9` olaraq saxlanıb. Orijinal `assets/ticket.jpg` bileti şablon kimi istifadə olunur. **İstifadəçi paneli hələ bu paketə daxil deyil.**

## Paketdəki fayllar

```
ticketflow-admin/
├── index.html                   Admin paneli: sifariş, tədbir, bilet, QR yoxlama, mobil hamburger
├── tf-core.js                   İstifadəçinin göndərdiyi Firebase 10.14.1 modulu
├── tf-admin-cloud.js            Admin Auth, tədbirlər, təsdiq, qəbz, maliyyə
├── tf-ticket-bridge.js          Bilet sənədləri, köhnə biletlər, təhlükəsiz giriş qeydiyyatı
├── tf-ticket-admin.js           QR skaner, nömrə ilə axtarış, şablon, bilet önizləmə
├── tf-ticket-renderer.js        Canvas ilə QR-li bilet şəklinin yaradılması
├── assets/ticket.jpg           İstifadəçinin öz bilet şablonu
├── firestore-rules-fragment.txt Yeni kolleksiyalar üçün qayda fraqmenti (tam Rules DEYİL)
├── test_integration.mjs        Lokal Firestore mock testləri
└── README-AZ.md                 Bu təlimat
```

## İşləmə ardıcıllığı

1. İstifadəçi sifariş yaradıb ödəniş qəbzi göndərir (`tfOrders`, `tfReceipts`).
2. Admin bank hesabındakı köçürməni şəxsən yoxlayıb «Təsdiqlə» basır.
3. `runTransaction` bütün bilet qeydlərini `tickets/{ticketNumber}` daxilində yaradır, tədbirin satılmış sayını artırır və sifarişi təsdiqləyir. Qəbz yoxdursa, 30 dəqiqəlik rezervasiya bitibsə, yer dolubsa və ya sifariş artıq təsdiqlənibsə əməliyyat rədd olunur.
4. Hər biletin `qrToken` dəyəri təsadüfidir; QR məzmunu `TF1|BİLET_NÖMRƏSİ|TOKEN` formatındadır.
5. «Biletlər» bölməsində admin əvvəl təqdim etdiyi şablon üzərində tədbirin adı, tarix, saat, məkan, alıcı, qiymət, bilet və sifariş nömrəsi, varsa sıra/yer və QR-ni görür, PNG yükləyir.
6. «QR yoxlama» bölməsində kamera ilə QR skan olunur və ya bilet nömrəsi daxil edilir. Yoxlamadan sonra admin ayrıca «Girişi təsdiqlə» basır. Firestore tranzaksiyası `tickets/{id}.used=true` və `tfCheckins/{id}` qeydini atomik yazır; eyni bilet ikinci dəfə keçmir.
7. «Biletləri sinxronlaşdır» köhnə təsdiqlənmiş sifarişlər üçün çatışmayan bilet sənədlərini yaradır və əvvəlki giriş qeydlərini qoruyur.

**Şəklin saxlanma üsulu:** Bu versiya hazır PNG faylını Firebase Storage-da saxlamır. Şablon `assets/ticket.jpg` və ya `ticketTemplates/global` sənədində saxlanılır, bilet məlumatları `tickets` kolleksiyasında saxlanılır, yekun görünüş eyni Canvas modulu ilə istənilən vaxt yaradılır. İstifadəçi tərəfinə həmin renderer qoşulanda bilet «Biletlərim»də eyni görünəcək. Storage tələb olunarsa əlavə mərhələdə server əsaslı generasiya qurmaq olar.

## Quraşdırma (köhnə admin repo-sunu ehtiyatlamaq şərti ilə)

1. Mövcud **admin kodunun və Firebase Security Rules-un ehtiyat nüsxəsini** çıxarın.
2. ZIP-i açın, `ticketflow-admin/` içindəki əsas 6 faylı və `assets/` qovluğunu **eyni strukturla** admin repo-sunun kökünə yerləşdirin. `index.html` layihədə adminin ana giriş faylı olmalıdır.
3. Firebase Authentication-da admin e-poçtu ilə giriş istifadə olunur; `tfAdmins/{adminUID}` sənədində `active: true` olmalıdır.
4. **Ən vacib:** `firestore-rules-fragment.txt` mətnini mövcud Rules V2 `match /databases/{database}/documents` bölməsindəki qaydalarla düzgün BİRLƏŞDİRİN; köhnə qaydaları kor-koranə əvəz etməyin. Firestore `allow` qaydaları birləşərək OR işləyir. Geniş `allow write: if true` və ya istənilən giriş etmiş istifadəçiyə `tfOrders` statusunu/`tfEvents.sold` dəyərini dəyişməyə icazə verən qaydalar varsa təhlükəsizlik pozular. Tam Rules mətnini görmədən canlı yayıma çıxarmaq olmaz.
5. Faylları HTTPS olan domenə/hostinqə yerləşdirin; `file://` şəklində açmayın. `firebasejs`, `qrcodejs`, `html5-qrcode` kitabxanaları internetdən gəlir. Kamera brauzerdə HTTPS və istifadəçi icazəsi tələb edir.
6. Sınaq: admin giriş → yeni/əvvəlki sifarişin qəbzi → təsdiq → biletin önizləməsi və QR → skan → girişin qeyd edilməsi → təkrar skanın rədd edilməsi. Bir neçə biletli sifarişi, qəbzsiz sifarişi, müddəti bitmiş sifarişi və bilet limitini də yoxlayın.

## İstifadəçi tərəfi üçün tələb olunan məlumat

Yeni bilet sənədində `buyerUid` sifarişin `userId`, `uid`, `buyerUid`, `customerUid` və ya `ownerUid` sahəsindən götürülür. İstifadəçinin «Biletlərim» bölməsində bilet görünməsi üçün **sifariş yaradan istifadəçinin Firebase Auth UID-si** həmin sahələrdən birində olmalıdır və müvafiq Firestore read qaydası qurulmalıdır. `buyerUid` null olan köhnə sifarişlər üçün ayrıca təhlükəsiz uyğunlaşdırma lazım olacaq. İstifadəçi panelinin kodu alınanda bunu birlikdə yoxlamaq lazımdır.

## Təhlükəsizlik və məhdudiyyətlər

- Firebase API konfiqurasiyasında olan `apiKey` client SDK üçün normal identifikatordur; **o, yazma icazəsi demək deyil**. Təhlükəsizlik Firestore Rules və Auth icazələrindən asılıdır. Məxfi service account açarını və ya admin parolunu front-end faylına qoymayın.
- QR-nin şəklini başqasına göndərmək olar. Buna görə yalnız **ilk admin təsdiqləməsi** keçərlidir. Fiziki şəxsiyyət yoxlaması zəruridirsə, onu ayrıca təşkil edin.
- Paketdəki lokal/mock testlər, HTML önizləmə, mobil hamburger və sintaksis yoxlaması aparılıb. **Canlı Firebase qaydaları, real ödəniş, dəqiq domen, real kamera və istifadəçi kabineti test edilməyib.**
- `firestore-rules-fragment.txt` tam, yerləşdirməyə hazır təhlükəsizlik qaydası deyil. Mövcud Rules-un tam mətninə əsasən yekunlaşdırılmalıdır.

## Növbəti mərhələ

İstifadəçi HTML/JS kodunu və tətbiq olunan Firestore Rules-un tam mətnini göndərin: «Biletlərim» səhifəsini `buyerUid` ilə filtr edilmiş real Firestore abunəliyinə, dinamik bilet görünüşünə, PNG yükləməyə və adminin QR yoxlama axınına bağlamaq lazımdır.
