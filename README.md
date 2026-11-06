# Dika Morphe Patches — GreatDay 8

Patch eksperimental untuk **`com.greatday.app`**, berdasarkan APK yang diberikan pemilik proyek. Fitur: jadwal percobaan absensi offline menggunakan alur bawaan GreatDay, pilihan hari dengan waktu WITA tetap, pencatatan hasil lokal, serta pengingat Android.

**Otomatisasi penuh saat aplikasi ditutup atau layar terkunci belum didukung.** Penjadwal JavaScript bekerja ketika WebView aktif. Jika kamera, lokasi, survei atau konfirmasi diperlukan, pengguna tetap harus menyelesaikannya. Notifikasi bukan bukti absensi tersimpan.

## Status

- Versi 0.2.0 memperbaiki tombol simpan yang terkunci saat online, menghubungkan layanan inti otomatis, dan mengganti panel dengan UI terisolasi dari style global GreatDay.
- Kode patch Morphe, pengujian penjadwal, dan uji browser dengan layanan simulasi tersedia.
- Nomor versi APK yang terbaca: `1.79.1`; pemilik menjelaskan nomor tersebut diubah dari `1.64`. Kompatibilitas ditentukan dengan fingerprint isi aset, bukan nomor versi saja.
- Belum diuji pada perangkat, akun perusahaan, kamera, atau server GreatDay.
- Workflow **Verify and build experimental Morphe bundle** membangun `.mpp`. Gunakan artifact hanya jika job `bundle` berhasil; keberhasilan unit test saja tidak berarti bundle tersedia atau layak digunakan untuk absensi nyata.
- Belum ada rilis publik atau URL sumber Morphe Manager. Import `.mpp` lokal dari artifact build setelah ditinjau.

## Cara kerja

1. Login dan buka GreatDay seperti biasa. Penjadwal terhubung dari layanan inti, termasuk ketika online; tidak perlu membuka menu offline terlebih dahulu. Jam dan hari juga dapat disimpan sebelum layanan tersebut siap.
2. Buka **Jadwal**. Pilih jam masuk/pulang dan hari kerja, lalu simpan. Zona waktu tetap **Asia/Makassar (WITA)** dan tidak ditampilkan sebagai pilihan. Otomatisasi **mati secara default** dan hanya bisa diaktifkan untuk akun yang terhubung.
3. Aktifkan dan simpan. Izin notifikasi Android diminta melalui plugin bawaan jika tersedia.
4. Pada menit jadwal, ketika aplikasi aktif, penjadwal memanggil **metode Absensi Offline asli**. Semua pemeriksaan bawaan tetap berjalan. Ambil foto atau selesaikan konfirmasi bila diminta.
5. Hanya preview baru milik percobaan tersebut yang dapat disimpan otomatis, setelah tombol simpan bawaan diizinkan. Saat online, hanya tombol masuk/pulang hari ini yang sesuai jadwal dapat dipilih; tombol kemarin/besok tidak dipilih. Status **Tersimpan offline** diberikan hanya setelah metode penyimpanan asli mengembalikan daftar berisi ID catatan itu.
6. Sinkronisasi menggunakan fitur GreatDay biasa. Patch tidak mengklaim bahwa server sudah menerima catatan, dan tidak mengubah sinkronisasi menjadi otomatis.

Label masuk/pulang adalah nama jadwal. Klasifikasi kehadiran di server tetap mengikuti GreatDay. Pengingat disiapkan untuk **14 hari**, diperbarui ketika aplikasi dibuka dan controller terhubung. Layanan inti menghubungkan kembali akun setelah restart. Jadwal tersimpan tanpa internet; alur offline yang sama digunakan baik koneksi aktif maupun tidak aktif.

## Batasan yang disengaja

- Tidak mengubah waktu/tanggal, koordinat, hasil pemeriksaan, kebijakan perusahaan, atau foto.
- Tidak mengambil foto diam-diam, melewati autentikasi, menyembunyikan perangkat, atau mematikan pelacakan.
- Hanya aktif jika akun saat ini memiliki `companySetting.offlineMode === true`.
- Jendela mulai adalah menit jadwal; tidak ada pengisian mundur untuk jadwal yang terlewat. Percobaan yang sudah mulai memiliki batas 90 detik untuk penyimpanan otomatis. Setelah itu periksa secara manual.
- Satu percobaan otomatis per akun, tanggal lokal, dan slot masuk/pulang. Mengubah waktu dalam hari yang sama tidak meresetnya. Jaminan ini tidak mencakup absensi manual, penghapusan data aplikasi, atau dua perangkat berbeda.
- Status percobaan disimpan sebelum efek samping. Jika aplikasi terputus, hasil yang belum diketahui tidak dicoba ulang otomatis. Periksa daftar offline sebelum mencoba manual.
- Ponsel mati, force-stop, pembatasan baterai, Doze, dan WebView yang ditangguhkan dapat menghalangi eksekusi. Pengingat pun dapat tertunda oleh Android.
- APK yang ditandatangani ulang mungkin ditolak aplikasi/server. Patch ini tidak menonaktifkan pemeriksaan integritas. Jangan mengganti instalasi utama sebelum data offline tersinkron dan pengujian selesai.

## Uji lokal

Prasyarat Node.js 22 dan Python 3:

```sh
node --test tests/*.test.cjs
python scripts/check_target.py /path/to/GreatDay.apk
```

Pemeriksaan APK hanya membaca fingerprint, menghitung kecocokan hook dan mengecek sintaks hasil injeksi. APK tidak dibangun ulang, dikirim ke GitHub, atau dipasang oleh skrip tersebut.

## Build `.mpp`

Workflow GitHub Actions menggunakan Java 21, Gradle 9.8.2, plugin `app.morphe.patches` 2.1.0, dan Morphe Patcher 2.2.0 sesuai template upstream yang diperiksa. Buka tab **Actions** → workflow → hasil run → **Artifacts**. Hasil Android berisi `classes.dex` dan aset penjadwal.

Build lokal menggunakan Gradle 9.8.2 yang sudah terpasang:

```sh
gradle :patches:buildAndroid --no-daemon
```

GitHub Packages membutuhkan autentikasi untuk dependensi upstream. Workflow mencoba token bawaan. Jika log menunjukkan 401/403 untuk registry Morphe, konfigurasi secret `MORPHE_PACKAGES_TOKEN` yang memiliki `read:packages` untuk akun yang dapat mengakses paket tersebut. Jangan menaruh token di kode atau mengirimkannya ke issue. Kredensial lokal dapat disediakan melalui variabel `GITHUB_ACTOR` dan `GITHUB_TOKEN` atau properti Gradle `gpr.user` dan `gpr.key` di konfigurasi pribadi.

Bundle build eksperimental belum diberi mekanisme distribusi remote atau signing key stabil. Jangan menganggap artifact pengujian sebagai rilis terpercaya untuk penggunaan rutin.

## Dokumen

- [Audit kompatibilitas](docs/COMPATIBILITY.md)
- [Checklist pengujian perangkat](docs/DEVICE_TESTS.md)

## Lisensi

GPL-3.0-only. Konfigurasi build diadaptasi dari [Morphe patches template](https://github.com/MorpheApp/morphe-patches-template). Implementasi scheduler dibuat khusus untuk repositori ini; patch spoof lokasi dan bypass dari Navhi tidak disertakan. APK GreatDay dan data akun/perusahaan tidak didistribusikan. Proyek ini tidak berafiliasi dengan GreatDay.
