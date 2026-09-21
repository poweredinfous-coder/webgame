# Papan skor family gathering

Layar skor untuk proyektor dan halaman admin untuk mengubah skor. Berjalan di satu laptop, tanpa internet, tanpa `npm install`.

## Menjalankan

Butuh Node.js 20 atau lebih baru.

```bash
ADMIN_PIN=angkaanda npm start
```

Tanpa `ADMIN_PIN`, PIN-nya `1234`. Terminal menampilkan alamat yang bisa dibuka:

- Layar proyektor: `http://localhost:3000/`. Tekan F atau klik dua kali untuk layar penuh.
- Admin: `http://localhost:3000/admin`

Perangkat lain di wifi yang sama bisa membuka alamat IP laptop yang tertulis di terminal. Kalau wifi venue memblokir antarperangkat, nyalakan hotspot dari laptop.

## Cara kerja skor

Skor sebuah kelompok di satu game = poin juara + poin manual.

- Poin juara diambil dari tab Nilai juara (juara 1, juara 2, dan seterusnya). Kelompok tanpa juara tidak dapat poin juara.
- Poin manual bebas diketik dan boleh minus, untuk bonus atau penalti.
- Total kelompok = jumlah skor di semua game. Skor sama berbagi peringkat.

Layar proyektor baru berubah setelah tombol Simpan ditekan, jadi beberapa baris bisa diisi dulu lalu diumumkan sekaligus.

## Data

Semua tersimpan di `data/state.json` (cadangan satu langkah sebelumnya di `data/state.json.bak`). Hapus folder `data/` untuk mulai dari data awal.

Variabel opsional: `PORT` (bawaan 3000), `HOST` (bawaan 0.0.0.0, pakai 127.0.0.1 untuk menutup akses dari perangkat lain), `DATA_FILE`.

## Arah desain

Lihat `DESIGN.md`.
