# Audit kompatibilitas

Target adalah APK yang disediakan pemilik proyek, package `com.greatday.app`, manifest versionName `1.79.1`, versionCode `22725`. SHA-256 APK sumber:

`7cfd49f18faff80c235a7e359b8c47cc86d0f08c502890b090f1431dfa6bea71`

Pemilik menyatakan nomor versi pernah diubah dari 1.64; versi kode aslinya belum diverifikasi secara independen. Karena itu target versi tetap eksperimental dan lima aset harus cocok byte demi byte dengan `targets.properties`. APK atau salinan kode proprietary tidak dimasukkan ke repositori.

Bundle Navhi v1.0.4 yang diperiksa mempunyai hash:

`c79fab1791a670767b184b5cddc34db6a771b999e1f79987396872afdcd098ec`

Bundle tersebut menargetkan `com.dataon.sunfishgo` 7.54.0, path `assets/www` dan kelas native lama yang tidak ditemukan dalam APK ini. Mengganti nama paketnya tidak memindahkan implementasi ke GreatDay 8.

## Implementasi patch baru

Patch ini menggunakan `resourcePatch` Morphe. Tidak ada modifikasi DEX aplikasi, manifest, izin, pemeriksaan keamanan, atau layanan sinkronisasi.

- Aset shared berukuran besar hanya diberi fingerprint untuk memverifikasi implementasi service yang dipakai. Aset tersebut tidak dimodifikasi.
- Dua chunk yang memuat aksi offline mendapat hook registrasi controller, ticket untuk membedakan panggilan otomatis dari manual, dan observasi ID hasil sebelum navigasi preview. Pemanggilan metode asli dan kebijakan asli dipertahankan.
- Tiga chunk preview mendapat hook registrasi instance. Runtime mengamati hasil Promise metode penyimpanan asli tanpa mengubah argumen, hasil, atau error.
- `index.html` memuat dua file JavaScript baru sebelum aplikasi dimulai.
- Semua fingerprint dan anchor diperiksa sebelum penulisan aset. APK yang berubah ditolak; tidak ada target wildcard.

Kecocokan fingerprint dan sintaks injeksi telah diperiksa pada APK sumber. Hal itu belum membuktikan hook dipanggil di perangkat, rendering UI bekerja, atau absensi diterima server. Lihat checklist uji perangkat sebelum menggunakan build.

## Sumber teknis

- [Template Morphe](https://github.com/MorpheApp/morphe-patches-template)
- [Implementasi plugin Gradle Morphe](https://github.com/MorpheApp/morphe-patches-gradle-plugin)
- [Repo Navhi yang dibandingkan](https://github.com/ravhirizaldi/navhi-morphe-patches)

Konfigurasi upstream diperiksa pada 6 November 2026. Build tetap harus diverifikasi melalui CI.
