# DESIGN.md

Arah desain papan skor family gathering. Disusun agen dari jawaban pemilik: suasana "meriah tapi rapi", tanpa logo perusahaan. Arah yang disusun agen cenderung lebih umum daripada arah dari pemilik, jadi file ini boleh diganti kapan saja dengan arah sendiri (warna brand, contoh tampilan, logo).

Design Read: papan skor lomba santai untuk proyektor di aula yang diredupkan (penonton karyawan dan keluarga, melihat dari jauh), plus panel admin untuk satu panitia di laptop. Gayanya kertas krem di atas tinta gelap, dan warna kelompok jadi satu-satunya warna.

Dial layar proyektor: ENERGY 2 / RHYTHM 2 / MOTION 2
Dial admin: ENERGY 1 / RHYTHM 1 / MOTION 1

## Identitas

- Motif: batang skor. Tiap kelompok satu batang tebal berwarna kelompoknya, angka skor besar di kanan. Tanpa kartu, glow, gradien, atau kaca buram.
- Satu aksen: krem terang, kebalikan dari latar. Dipakai hanya untuk juara 1, chip "Game berjalan", dan tombol utama di admin.
- Warna kelompok adalah data yang dipilih admin, bukan dekorasi. Di luar itu semuanya netral hangat.

## Warna

| Token | Nilai | Dipakai untuk |
|---|---|---|
| `--bg` | `#14120f` | latar layar dan admin |
| `--surface` | `#1d1a16` | panel, baris juara 1 |
| `--track` | `#26221c` | jalur batang, kolom isian |
| `--text` | `#f4efe6` | teks utama, aksen |
| `--muted` | `#b0a99c` | teks pendukung |
| `--line-strong` | `#857d70` | batas kontrol isian |
| `--danger` | `#ff9b90` | pesan galat |

Semua pasangan teks lolos 4,5:1, batas kontrol dan warna kelompok lolos 3:1 (dicek dengan `contrast-check.py`). Admin memperingatkan kalau warna kelompok di bawah 3:1 terhadap latar layar.

## Huruf

- Satu keluarga untuk semua teks: `Avenir Next`, cadangan `Segoe UI`, `system-ui`. Angka, nama kelompok, dan judul memakai bobot 700, keterangan memakai 400 sampai 600.
- Alasan: huruf lebar normal dengan lubang terbuka membuat angka seperti 6, 8, dan 0 mudah dibedakan dari jauh. Font ini sudah ada di macOS jadi jalan tanpa internet dan tanpa file font, dan cadangannya (Segoe UI) punya karakter yang mirip di Windows.
- Sebelumnya memakai keluarga condensed bobot 800. Diganti karena terlalu rapat, huruf dan angkanya saling menempel dan kurang jelas dibaca dari jauh. Kalau ingin font lain, ubah `--body` di `public/css/display.css` dan `public/css/admin.css`, lalu cek lagi lebar kolom nama dan skor di layar.

## Gerak

- Angka menghitung naik saat skor berubah, batang memanjang, baris berpindah halus saat peringkat berubah.
- Saat peringkat dibuka dari mode sembunyi: baris muncul dari juara terakhir ke juara 1, supaya ada jeda menegangkan.
- Tidak ada animasi yang berulang terus. Hormati `prefers-reduced-motion`.
- Admin: hanya transisi hover dan fokus.

## Alasan tiap keputusan

- Latar gelap: proyektor butuh ruangan redup, dan latar gelap tidak menyilaukan penonton. Admin ikut gelap karena dipakai di ruangan yang sama.
- Nama kelompok di luar batang, bukan di dalamnya: nama selalu terbaca walau skor 0 dan warna batang terang atau gelap.
- Pemimpin (peringkat 1 dengan skor di atas 0) diberi panel latar dan angka krem: satu titik fokus per layar. Saat semua masih 0 tidak ada yang disorot.
- Radius: 14px untuk panel, 8px untuk kontrol, batang 0.35em. Tidak ada bentuk pil.
- Tidak ada ikon dekoratif. Kontrol memakai teks.
