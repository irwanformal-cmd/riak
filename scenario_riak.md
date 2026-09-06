# Senario untuk Riak: Pasar Aplikasi Mobile Baru

## Deskripsi Skenario
Sebagai pemilik aplikasi mobile untuk layanan pengiriman makanan, kita akan merancang strategi peluncuran di kota besar. Skenario ini mengeksplorasi dampak dari berbagai faktor pada adoption pengguna dan retained users.

**Pertanyaan Utama:** Apa dampak dari menurunkan harga subscripsi terhadap adoption dan retained users di masa 3 bulan?

**Faktor Utama:**
1. **Strategi Harga:** Diskon 50% untuk pengguna baru selama 1 bulan, lalu pulang ke harga penuh
2. **Kampanye Marketing:** Iklan target pada sosial media vs referral program
3. **Kualitas Layanan:** Waktu delivery rata-rata 30 menit vs 45 menit
4. **Kompetitor:** Lainnya menawarkan free delivery untuk order pertama

**Parameter Konfigurasi:**
- Seed: 42 (reproducibility)
- Branches: 5 (consequences per event)
- Depth: 3 (cause→effect levels deep)
- Max Nodes: 2000 (safety cap)

## Intervensi yang Ditest

### Intervensi 1: Diskon Waktu Terbatas
**Deskripsi:** Berikan diskon 30% untuk semua order selama 2 minggu awal peluncuran.

**Dihasilkan Ketika:** Peluncuran aplikasi di pasar baru (Kota A)

**Efek yang Diperkirakan:**
- +40% pengguna baru dalam minggu pertama
- -15% retained users pada bulan ketiga (setelah diskon berhenti)
- WPO (Word of Mouth) positif meningkat 2.5x

### Intervensi 2: Program Referral
**Deskripsi:** Setiap pengguna yang mengunduh aplikasi melalui link referral mendapat $5 credit, dan pengguna referrer mendapat $5 discount untuk order pertama mereka.

**Dihasilkan Ketika:** Pasar kompetitif dengan banyak alternatif

**Efek yang Diperkirakan:**
- +65% adoption rate melalui channel referral
- +25% retained users setelah 6 bulan
- Cost per acquisition turun 40%

### Intervensi 3: Garansi Waktu Delivery
**Deskripsi:** Jakan ikut "Free delivery jika terlambat > 30 menit" untuk semua order pertama.

**Dihasilkan Ketika:** Masalah waktu delivery adalah kendala utama

**Efek yang Diperkirakan:**
- +30% konversi dari landing page
- -20% cancellations di awal session
- Customer satisfaction score naik dari 3.5 ke 4.2/5

## Cara Men-test di Riak

1. **Buka:** http://127.0.0.1:8000
2. **Pada tab "Step 1 - Describe the scenario":**
   - Copy isi "Deskripsi Skenario" ke textarea `#seed-text`
   - Atur parameter: Seed 42, Branches 5, Depth 3, Max Nodes 2000
   - Klik "Map the consequences"

3. **Pada tab "Step 2 - Add interventions":**
   - Copy setiap intervensi ke kolom yang tersedia
   - Klik "+ Add intervention" untuk menambah banyak
   - Klik "Run prediction" untuk melihat hasil

4. **Lihat hasil di tab:**
   - **Network:** Grafik pohon consequences
   - **Report:** Ringkasan statistik dampak
   - **Chat:** Diskusikan event tertentu dengan AI
   - **Math:** Turunannya matematis