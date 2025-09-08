export const getTransactionPrompt = (message) => {
  return `You are an financial expert, you will be given a transaction log and you will determine the description, amount, date, debit or credit, and category of the transaction. give the response in json format. if there is message, you will say it in indonesian language.
Output JSON with fields: {"type": string (transaction or message), "description": string, "dbcr": string (debit or credit), "amount": number, "date": string (YYYY-MM-DD) or null, "dateDiff": string (today, yesterday, last week or null) or null, "category": string (Camel Case), "message": string}.
Example:
transaction log: "coffee latte 20000"
{
"type": "transaction",
"description": "coffee latte",
"dbcr": "credit",
"amount": 20000,
"date": null,
"dateDiff": null,
"category": "Food & Beverage",
"message": ""
}
Note for category:
- if category is mentioned in the transaction log, use it.
- if category is not mentioned in the transaction log, use the category that is most likely to be the correct one.
Example:
transaction log: "coffee latte 20000, minuman"
{
"type": "transaction",
"description": "coffee latte",
"dbcr": "credit",
"amount": 20000,
"date": null,
"dateDiff": null,
"category": "Minuman",
"message": ""
}
Note for dbcr:
- if transaction is likely to be a credit, set dbcr to "credit".
- if transaction is likely to be a debit, set dbcr to "debit".
- if transaction is not clear, set dbcr to "credit".
Example:
transaction log: "coffee latte 20000"
{
"type": "transaction",
"description": "coffee latte",
"dbcr": "credit",
"amount": 20000,
"date": null,
"dateDiff": null,
"category": "Food & Beverage",
"message": ""
}
transaction log: "gaji 10000000"
{
"type": "transaction",
"description": "gaji",
"dbcr": "debit",
"amount": 10000000,
"date": null,
"dateDiff": null,
"category": "Income",
"message": ""
}
Note for date:
- if date is mentioned in the transaction log, use it.
- if date is not mentioned in the transaction log, use null.
- if date is mentioned in the transaction log with format like "today", "yesterday", "last week". set dateDiff property to numeric value of the dateDiff (eg. +7, -1, -7) and date property to null.
Example:
transaction log: "coffee latte 20000, 20 januari 2025"
{
"type": "transaction",
"description": "coffee latte",
"dbcr": "credit",
"amount": 20000,
"date": "2025-01-20",
"dateDiff": null,
"category": "Food & Beverage",
"message": ""
}
transaction log: "coffee latte 20000, yesterday"
{
"type": "transaction",
"description": "coffee latte",
"amount": 20000,
"date": null,
"dbcr": "credit",
"dateDiff": -1,
"category": "Food & Beverage",
"message": ""
}
Note for message:
- if transaction log is not clear, for example amount is not mentioned or it is a greeting message, reply with proper and related message. set type property to "message".
- if transaction log is not related to finance transaction at all, reply with "Maaf, saya tidak bisa membantu dengan yang ini." and set type property to "message".
Example:
transaction log: "coffee latte"
{
"type": "message",
"message": "Silahkan berikan informasi transaksi Anda dengan benar. Contoh: 'Nasi goreng 100000' atau 'Nasi goreng 100000, makanan' atau 'Nasi goreng 100000, makanan, 20 januari 2025'"
}
transaction log: "halo"
{
"type": "message",
"message": "Halo, bagaimana saya bisa membantu Anda hari ini?"
}

Transaction log: ${message}
`;
};

export const getWelcomeMessage = (env) => {
  return `🎉 *Selamat datang di Personal Finance Assistant Bot\\!* 🎉

Saya adalah bot yang akan membantu Anda mengelola keuangan pribadi dengan mudah\\. Berikut cara menggunakan saya:

📝 *Cara Menggunakan:*
• Kirim pesan transaksi Anda dalam format: "deskripsi jumlah"
• Contoh: "kopi latte 25000" atau "makan siang 50000"
• Saya akan otomatis mengkategorikan dan menyimpan transaksi Anda

💡 *Contoh Pesan:*
• "Nasi goreng 15000"
• "Bensin 50000, transportasi"
• "Belanja bulanan 200000, 15 januari 2025"

🔧 *Fitur:*
• Otomatis kategorisasi transaksi menggunakan Gemini AI
• Penyimpanan ke Google Sheets pribadi Anda
• Format tanggal Indonesia
• Menggunakan API key Gemini dan Google Sheet ID Anda sendiri

💻 *Daftar Command:*
• /info \\- Informasi umum mengenai bot ini
• /info\\_setup\\_gemini \\- Informasi setup api key gemini anda
• /info\\_setup\\_gsheet \\- Informasi setup google sheet anda
• /setkey YOUR\\_API\\_KEY \\- Simpan API key Gemini Anda
• /setsheet YOUR\\_SHEET\\_ID \\- Simpan Google Sheet ID Anda
• /saldo \\- Lihat ringkasan keuangan \\(pemasukan, pengeluaran, saldo\\)
• /removekey \\- Hapus API key yang tersimpan

Silakan kirim transaksi pertama Anda untuk memulai\\! 💰`;
};

export const getSetupGeminiInstruction = () => {
  return `🔑 *Cara Mendapatkan Gemini API Key:*

1\\. *Kunjungi Google AI Studio:*
   • Buka https://aistudio\\.google\\.com/
   • Login dengan akun Google Anda

2\\. *Buat API Key:*
   • Klik menu "API keys" di bagian Dashboard
   • Klik tombol "Create API key"

3\\. *Salin API Key:*
   • API key akan muncul di daftar project api keys
   • Klik API key pada kolom "API key" dan salin
   • *PENTING:* Jangan bagikan API key ini kepada siapapun\\!

4\\. *Kirim ke Bot:*
   • Kirim pesan: \`/setkey YOUR\\_API\\_KEY\`
   • Ganti YOUR\\_API\\_KEY dengan API key yang Anda salin
   • Contoh: \`/setkey AhdIUASdbiASDNKjadnsKDBAKJSdn\`

5\\. *Verifikasi:*
   • Bot akan memvalidasi API key Anda
   • Jika valid, API key akan tersimpan dengan aman dan terenkripsi
   • Jika tidak valid, periksa kembali API key Anda

💡 *Tips:*
• API key gratis memiliki limit penggunaan harian
• Simpan API key di tempat yang aman
• Jangan share API key di chat publik

❓ *Masalah?*
• Pastikan API key sudah aktif di Google AI Studio
• Cek apakah ada typo saat menyalin API key
• Pastikan koneksi internet stabil`;
};

export const getSetupGoogleSheetInstruction = () => {
  return `📊 *Cara Setup Google Sheet:*

1\\. *Buat Google Sheet Baru:*
   • Buka https://sheets\\.google\\.com/
   • Klik "\\+" untuk membuat spreadsheet baru
   • Beri nama yang mudah diingat \\(contoh: "Personal Finance"\\)

2\\. *Setup Sheet Structure:*
   • Bot akan menggunakan sheet pertama \\(tidak perlu rename\\)
   • Di baris 1, tambahkan header berikut:
     \\- A1: Date
     \\- B1: Description  
     \\- C1: Amount
     \\- D1: Debit/Credit
     \\- E1: Category

3\\. *Share dengan Service Account:*
   • Klik tombol "Share" di kanan atas
   • Tambahkan email: \`${process.env.SERVICE_ACCOUNT_EMAIL || 'your-service-account@project.iam.gserviceaccount.com'}\`
   • Set permission sebagai "Editor"
   • Klik "Send"

4\\. *Dapatkan Sheet ID:*
   • Lihat URL di browser: \`https://docs\\.google\\.com/spreadsheets/d/SHEET\\_ID\\_HERE/edit\`
   • Sheet ID adalah bagian setelah \`/d/\` dan sebelum \`/edit\`
   • Contoh: \`1BxiMVs0XRA5nFdISDnKjdjandSbs74OgvE2upms\`

5\\. *Kirim Sheet ID ke Bot:*
   • Kirim pesan: \`/setsheet YOUR\\_SHEET\\_ID\`
   • Ganti YOUR\\_SHEET\\_ID dengan ID yang Anda salin
   • Contoh: \`/setsheet 1BxiMVs0XRA5nFdISDnKjdjandSbs74OgvE2upms\`

6\\. *Verifikasi:*
   • Bot akan memvalidasi Sheet ID dan akses
   • Jika berhasil, Sheet ID akan tersimpan
   • Jika gagal, periksa sharing permission

📋 *Kolom yang Tersedia:*
• *Date* \\- Tanggal transaksi \\(format: DD\\-MM\\-YYYY\\)
• *Description* \\- Deskripsi transaksi
• *Amount* \\- Jumlah transaksi \\(angka\\)
• *Debit/Credit* \\- Jenis transaksi \\(Debit/Kredit\\)
• *Category* \\- Kategori transaksi \\(otomatis\\)

💡 *Tips:*
• Sheet ID tidak boleh ada spasi di awal/akhir
• Bot akan otomatis menggunakan sheet pertama
• Backup data penting secara berkala

❓ *Masalah?*
• Cek permission sharing \\(harus Editor\\)
• Pastikan Sheet ID tidak ada typo
• Coba refresh halaman Google Sheets`;
};