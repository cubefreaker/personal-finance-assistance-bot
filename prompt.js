export const getTransactionPrompt = (message) => {
  return `You are an financial expert, you will be given a transaction log and you will determine the description, amount, date, and category of the transaction. give the response in json format. if there is message, you will say it in indonesian language.
Output JSON with fields: {"description": string, "amount": number, "date": string (YYYY-MM-DD) or null, "dateDiff": string (today, yesterday, last week or null) or null, "category": string (Camel Case), "message": string}.
Example:
transaction log: "coffee latte 20000"
{
"type": "transaction",
"description": "coffee latte",
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
"amount": 20000,
"date": null,
"dateDiff": null,
"category": "Minuman",
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
  return `🎉 Selamat datang di Personal Finance Assistant Bot! 🎉

Saya adalah bot yang akan membantu Anda mengelola keuangan pribadi dengan mudah. Berikut cara menggunakan saya:

📝 **Cara Menggunakan:**
• Kirim pesan transaksi Anda dalam format: "deskripsi jumlah"
• Contoh: "kopi latte 25000" atau "makan siang 50000"
• Saya akan otomatis mengkategorikan dan menyimpan transaksi Anda

💡 **Contoh Pesan:**
• "Nasi goreng 15000"
• "Bensin 50000, transportasi"
• "Belanja bulanan 200000, 15 januari 2025"

🔧 **Fitur:**
• Otomatis kategorisasi transaksi menggunakan Gemini AI
• Penyimpanan ke Google Sheets pribadi Anda
• Format tanggal Indonesia
• Menggunakan API key Gemini dan Google Sheet ID Anda sendiri

🔑 **Perintah Setup:**
• /setkey YOUR_API_KEY - Simpan API key Gemini Anda
• /setsheet YOUR_SHEET_ID - Simpan Google Sheet ID Anda
• /removekey - Hapus API key yang tersimpan

📊 **Setup Google Sheet:**
1. Buat Google Sheet baru
2. Rename sheet pertama menjadi "Transactions"
3. Tambahkan header di baris 1: Date, Description, Amount, Category
4. **PENTING:** Share sheet dengan service account sebagai Editor:
   • Klik tombol "Share" di kanan atas
   • Tambahkan email: ${env.SERVICE_ACCOUNT_EMAIL}
   • Set permission sebagai "Editor"
   • Klik "Send"
5. Salin Sheet ID dari URL:
   • URL: https://docs.google.com/spreadsheets/d/SHEET_ID_HERE/edit
   • Sheet ID adalah bagian setelah /d/ dan sebelum /edit
   • Contoh: 1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms
6. Kirim Sheet ID ke bot dengan /setsheet SHEET_ID_HERE

📋 **Kolom yang Tersedia:**
• **Date** - Tanggal transaksi (format: DD-MM-YYYY)
• **Description** - Deskripsi transaksi
• **Amount** - Jumlah transaksi (angka)
• **Category** - Kategori transaksi (otomatis)

Silakan kirim transaksi pertama Anda untuk memulai! 💰`;
};
