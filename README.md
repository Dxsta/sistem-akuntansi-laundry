# Bagaskara Laundry — Sistem Informasi Akuntansi

## Struktur
- `frontend/HTML/index.html` — halaman aplikasi
- `frontend/CSS/style.css` — tampilan responsif
- `frontend/JS/config.js` — konfigurasi Supabase
- `frontend/JS/app.js` — logika aplikasi
- `backend/database.sql` — satu-satunya sumber SQL untuk skema, relasi, indeks, RLS, fungsi transaksi, dan view PostgreSQL
- `supabase/functions/manage-cashier/index.ts` — fungsi backend untuk pemilik membuat atau mengganti kata sandi akun kasir bersama

## Cara menjalankan
1. Buat project di Supabase.
2. Buat pengguna Auth pemilik `desta@laundry.com` di Supabase Dashboard > Authentication > Users, tandai email terkonfirmasi, dan tetapkan kata sandi secara privat di dashboard. Alamat ini dipakai sebagai username login; bila bukan kotak surat yang dikuasai, jangan mengandalkan email tersebut untuk pemulihan akun.
3. Buka SQL Editor dan jalankan seluruh isi `backend/database.sql` untuk menyiapkan skema. Pada project yang sudah berisi data, buat backup terlebih dahulu; skrip mempertahankan baris operasional, tetapi mengganti policy RLS agar hanya pengguna terautentikasi dengan role yang terdaftar bisa mengaksesnya. Jalankan bootstrap role berikutnya segera setelah skrip.
4. Jalankan sekali di SQL Editor untuk memberi role pemilik (jangan pernah memasukkan kata sandi pada query):
   ```sql
   insert into public.app_user_roles (user_id, role)
   select id, 'owner' from auth.users where lower(email) = 'desta@laundry.com'
   on conflict (user_id) do nothing;
   ```
   Pastikan akun tersebut memiliki role `owner` di `public.app_user_roles`. Jangan membagikan kata sandi pemilik.
5. Buka Project Settings / API (atau Connect), salin Project URL serta publishable key (atau anon key), dan isi `frontend/JS/config.js`. Jangan pernah menaruh `service_role` key di browser.
6. Pasang Supabase CLI, login, lalu deploy fungsi kasir dari root project. Alternatifnya, buat/deploy `manage-cashier` menggunakan Edge Functions > Open Editor di Dashboard dari `supabase/functions/manage-cashier/index.ts`.
   ```powershell
   supabase login
   supabase link --project-ref baamonowlouscdtwfqrk
   supabase functions deploy manage-cashier
   ```
   Fungsi menggunakan `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` dari environment Supabase; rahasia service-role tidak pernah dikirim ke browser. Matikan opsi **Verify JWT with legacy secret** untuk fungsi ini; fungsi memvalidasi access token lewat `auth.getUser`.
7. Matikan pendaftaran publik (Authentication > Settings > User Signups) setelah akun pemilik tersedia. Pemilik masuk dengan username `Desta Bagaskara`, buka **Pengaturan > Akun Pegawai**, lalu buat kata sandi kuat (minimal 12 karakter) untuk akun bersama `Karyawan` (`karyawan@laundry.com`).
8. Jalankan `frontend/HTML/index.html` lewat server lokal (misalnya Live Server di VS Code) agar file dan library berjalan lebih konsisten.
9. Di menu Operasional > Pesanan Laundry, cari pelanggan berdasarkan nama atau pilih "Daftarkan pelanggan baru" di bagian atas daftar. Tambahkan satu atau beberapa layanan kiloan dan/atau satuan ke pesanan, lalu simpan dengan pembayaran Tunai atau QRIS. Tanggal pesanan dan pembayaran tercatat otomatis memakai tanggal WIB ketika tombol simpan ditekan; tanggal pesanan tidak perlu diisi manual.

## Catatan penting
- SQL menggunakan generated column untuk menghitung total dari jumlah × harga satuan. Demi kompatibilitas, jumlah dan harga per unit masih disimpan pada kolom lama `berat_kg` dan `harga_per_kg`; kolom `satuan` membedakan layanan kiloan (`kg`) dan layanan satuan (`item`). Definisi skema terkini tersedia di `backend/database.sql`.
- Daftar harga awal pada formulir Operasional: kiloan reguler (2 hari) Rp4.000/kg (cuci kering), Rp2.000/kg (setrika), Rp5.000/kg (cuci + setrika); kiloan express (24 jam) Rp6.000/kg, Rp3.000/kg, dan Rp7.500/kg sesuai jenis cucian. Tarif express memakai asumsi awal 50% di atas reguler; harga pada formulir dapat disesuaikan per pesanan. Layanan satuan Rp10.000–Rp25.000/item sesuai jenis layanan.
- Satu penerimaan dapat memuat beberapa layanan kiloan dan satuan. Dukungan kolom transaksi, validasi jumlah satuan, dan fungsi RPC transaksional disertakan di `backend/database.sql`.
- Setiap penerimaan laundry dibayar lunas saat transaksi dibuat. Aplikasi mencatat pembayaran penuh untuk total seluruh layanan dengan metode Tunai atau QRIS secara atomik; tidak ada pencatatan saldo terutang.
- Akses data memakai Supabase Auth dan role pada `app_user_roles`. Pemilik dapat mengakses laporan akuntansi serta pengaturan akun kasir; pegawai kasir hanya melihat menu operasional di aplikasi. RLS menolak akses anon dan membatasi perubahan data, sedangkan fungsi pembuatan akun kasir hanya melayani role pemilik. Simpan kata sandi kasir dengan aman dan bagikan melalui saluran tepercaya. Karena akunnya bersama, log tidak dapat membedakan tindakan pegawai per orang.
- Dashboard dan laporan memakai satu angka pendapatan yang dihitung dari pembayaran diterima, bukan menjumlahkan penjualan jasa dan kas sebagai dua pendapatan terpisah. Grafik dan laporan dapat difilter per hari (rincian per jam), per bulan (rincian per tanggal), dan per tahun (rincian per bulan); tanggal, bulan, atau tahun dapat dipilih. Kartu ringkasan dashboard tetap menunjukkan pendapatan hari ini dan bulan berjalan. Tanggal pembayaran dicatat terpisah dari tanggal pesanan menggunakan tanggal lokal saat transaksi disimpan. Pengakuan pendapatan akuntansi tetap perlu mempertimbangkan saat jasa diberikan dan kebijakan usaha. Menjalankan SQL akan menghapus kolom status pengerjaan lama dari database.
- Header dashboard menampilkan tanggal dan jam berjalan menurut zona waktu WIB (`Asia/Jakarta`, UTC+7) di kanan atas dan memperbaruinya otomatis setiap detik, beserta alamat toko Jl. Karangrejo VI, Srondol Wetan, Banyumanik, Semarang. Tautan lokasi membuka pencarian alamat di Google Maps.
- Dashboard memakai foto ilustrasi laundry (bukan foto lokasi toko): `frontend/Assets/laundry-shop.jpg`, karya Fitrah 9131 dari Wikimedia Commons, berlisensi CC BY-SA 3.0. Atribusi dan tautan lisensi juga ditampilkan di dashboard.
- Operasional menyediakan antrean pengerjaan yang dipisahkan per tanggal pesanan, dengan nomor antrean yang dimulai kembali setiap hari. Centang selesai berlaku untuk seluruh layanan dalam satu transaksi dan tersimpan pada kolom `selesai`; jalankan ulang seluruh SQL setelah pembaruan ini untuk menambahkan kolom tersebut.
- Menu Operasional > Laundry Siap Ambil menampilkan semua transaksi yang seluruh layanannya telah selesai. Tandai pengambilan dengan ceklis; status diterapkan ke semua layanan dalam transaksi. Jika pesanan dikembalikan ke antrean, status pengambilan akan direset.
- Skema instalasi baru dan skema fitur terkini dikelola hanya melalui `backend/database.sql`; file dump dan migrasi terpisah telah dihapus agar tidak ada sumber SQL ganda. Project Supabase aktif sudah memiliki kolom `diambil`, dan status pengambilan pesanan selesai telah disinkronkan sebelumnya. Jangan menjalankan pembaruan massal status pengambilan lagi.
- Di navigasi Operasional, Pesanan Laundry, Antrean Pengerjaan, Laundry Siap Ambil, Daftar Pelanggan, Daftar Pesanan, dan Riwayat Pembayaran tersedia sebagai halaman terpisah agar lebih praktis diakses.
- Laporan keuangan merinci penerimaan Tunai dan QRIS untuk periode pilihan, dengan rincian per jam, tanggal, atau bulan sesuai tingkat periode.
- Menu Akuntansi menyediakan Jurnal Umum, Buku Besar per akun, Neraca Saldo, dan Laporan Laba Rugi. Setiap pembayaran otomatis membentuk jurnal debit Kas Tunai atau Bank QRIS dan kredit Pendapatan Jasa Laundry. Periode laporan akuntansi dapat dipilih per hari, bulan, atau tahun. Laporan ini diturunkan dari data pembayaran yang sudah tersimpan dan tidak membuat tabel jurnal terpisah; karena itu, jurnal baru mengikuti data pembayaran yang tersedia saat halaman dimuat.
- Laporan akuntansi saat ini hanya mencakup penerimaan pembayaran dan pendapatan jasa. Beban, modal, aset, pajak, dan transaksi nonkas belum dicatat, sehingga angka laba bersih adalah pendapatan dikurangi beban yang tercatat (saat ini nol), bukan laba usaha lengkap. Kebijakan ini mengakui pendapatan pada tanggal pembayaran sesuai permintaan; sesuaikan bila kebijakan akuntansi usaha mengharuskan pengakuan saat jasa selesai.
- `backend/database.sql` adalah skrip skema, bukan cadangan data. Menjalankannya tidak menggantikan backup database. Project Supabase aktif berisi data operasional; buat dan simpan backup terpisah melalui Supabase sebelum perubahan berisiko atau pemulihan data.
