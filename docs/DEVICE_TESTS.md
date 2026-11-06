# Uji perangkat — belum dijalankan

Gunakan lingkungan uji yang diizinkan. Pastikan catatan offline penting telah tersinkron sebelum mengganti instalasi. Jangan menguji dua instalasi yang mengirim absensi nyata bersamaan.

- [ ] Job CI `verify` dan `bundle` berhasil; artifact `.mpp` berisi DEX dan kedua JavaScript.
- [ ] Morphe menerima bundle dan patch berhasil pada APK sumber yang fingerprint-nya cocok.
- [ ] APK hasil patch dapat dipasang dan dibuka tanpa menonaktifkan pemeriksaan integritas.
- [ ] Login dan alur manual asli tetap bekerja sebelum jadwal diaktifkan.
- [ ] Membuka menu offline menghubungkan penjadwal; akun tanpa izin offline tidak dapat memulai otomatisasi.
- [ ] Atur jadwal beberapa menit ke depan, aplikasi aktif. Pastikan hanya satu alur offline dimulai.
- [ ] Foto, GPS, survei dan konfirmasi perusahaan tetap berjalan. Pembatalan kamera tidak menyimpan catatan.
- [ ] Setelah tombol asli mengizinkan simpan, catatan muncul di daftar offline. Cocokkan waktu dan lokasi sebenarnya.
- [ ] Status patch tetap “berjalan” sampai penyimpanan benar-benar mengembalikan catatan yang sesuai.
- [ ] Gagalkan penyimpanan, mulai ulang aplikasi, dan periksa bahwa percobaan yang hasilnya belum diketahui tidak diulang.
- [ ] Kunci layar/tutup aplikasi sebelum jadwal. Catat bahwa pengingat saja dapat muncul; tidak ada klaim otomatis tersimpan.
- [ ] Buka aplikasi lebih dari satu menit setelah jadwal. Pastikan tidak ada catatan dibuat mundur.
- [ ] Beralih akun, ubah zona waktu, nonaktifkan jadwal, dan periksa isolasi akun serta pembatalan pengingat milik patch.
- [ ] Sinkronkan memakai GreatDay biasa. Verifikasi hasil di server/HC; status tersimpan lokal tidak cukup.

Catat versi Android, WebView, Morphe Manager, waktu pengujian, hasil dan error yang telah dihapus data pribadinya. Jangan mengunggah token, foto, koordinat, atau data karyawan ke issue publik.
