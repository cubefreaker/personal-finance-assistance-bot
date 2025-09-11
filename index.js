import express from "express";
import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { getTransactionPrompt, getReceiptImagePrompt, getWelcomeMessage, getSetupGeminiInstruction, getSetupGoogleSheetInstruction } from "./prompt.js";
import { saveApiKey, getApiKey, hasApiKey, deleteApiKey, saveSheetId, getSheetId, hasSheetId, isUserSetupComplete } from "./apiKeyService.js";
import { saveToSheet, saveMultipleToSheet, validateGoogleSheetId, getSummaryData } from "./sheetService.js";
import { 
  validateUserSetup, 
  getUserCredentials, 
  formatAmountToCurrency, 
  parseGeminiResponse, 
  processAndSaveTransactions,
  processSingleTransaction,
  processTransactionDate,
  processTransactionAmount,
  createSheetTransaction,
  createFormattedTransaction,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES
} from "./utils.js";
dotenv.config();

const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;

const bot = new Telegraf(BOT_TOKEN);


// ===== API KEY VALIDATION =====
async function validateGeminiApiKey(apiKey) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: "Hello"
                },
              ],
            },
          ],
        })
      }
    );
    return res.ok;
  } catch (error) {
    console.error("API key validation error:", error);
    return false;
  }
}

// ===== GEMINI CATEGORIZATION =====
async function categorizeTransaction(message, apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: getTransactionPrompt(message)
              },
            ],
          },
        ],
      }),
    }
  ).then((r) => r.json());

  return parseGeminiResponse(res);
}

// ===== IMAGE PROCESSING =====
async function downloadImageFromTelegram(fileId, apiKey) {
  try {
    // Get file info from Telegram
    const fileInfoResponse = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
    const fileInfo = await fileInfoResponse.json();
    
    if (!fileInfo.ok) {
      throw new Error('Failed to get file info from Telegram');
    }
    
    // Download the image
    const imageResponse = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${fileInfo.result.file_path}`);
    const imageBuffer = await imageResponse.buffer();
    
    return {
      data: imageBuffer.toString('base64'),
      mimeType: 'image/jpeg' // Telegram typically serves images as JPEG
    };
  } catch (error) {
    console.error("Error downloading image:", error);
    throw error;
  }
}

async function analyzeReceiptImage(imageData, apiKey) {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                {
                  text: getReceiptImagePrompt()
                },
                {
                  inline_data: {
                    mime_type: imageData.mimeType,
                    data: imageData.data
                  }
                }
              ],
            },
          ],
        }),
      }
    ).then((r) => r.json());

    let parsed = parseGeminiResponse(res);
    
    // If parsing failed, return error message for receipt processing
    if (Array.isArray(parsed) && parsed.length === 1 && !parsed[0].description) {
      return {
        type: "message",
        message: "Maaf, saya tidak dapat memproses gambar receipt ini. Silakan coba lagi dengan gambar yang lebih jelas."
      };
    }
    
    return parsed;
  } catch (error) {
    console.error("Error analyzing receipt image:", error);
    return {
      type: "message",
      message: "Maaf, terjadi kesalahan saat memproses gambar. Silakan coba lagi."
    };
  }
}

// ===== TELEGRAM FLOW =====

// Handle /start command
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  const userHasApiKey = await hasApiKey(userId);
  const userHasSheetId = await hasSheetId(userId);
  
  await ctx.reply(getWelcomeMessage(process.env), { parse_mode: "MarkdownV2" });

  if (!userHasApiKey && !userHasSheetId) {
    await ctx.reply(`🔑 Untuk menggunakan bot ini, Anda perlu menyimpan API key Gemini dan Google Sheet ID Anda terlebih dahulu.\n\nSilakan kirim:\n1. API key Gemini: /setkey YOUR_GEMINI_API_KEY\n2. Google Sheet ID: /setsheet YOUR_GOOGLE_SHEET_ID`);
  } else if (!userHasApiKey) {
    await ctx.reply(`🔑 Anda sudah memiliki Google Sheet ID, tetapi masih perlu menyimpan API key Gemini Anda.\n\nSilakan kirim API key Gemini Anda dengan format:\n/setkey YOUR_GEMINI_API_KEY`);
  } else if (!userHasSheetId) {
    await ctx.reply(`📊 Anda sudah memiliki API key Gemini, tetapi masih perlu menyimpan Google Sheet ID Anda.\n\nSilakan kirim Google Sheet ID Anda dengan format:\n/setsheet YOUR_GOOGLE_SHEET_ID`);
  }

  // add inline button for info_setup_gemini and info_setup_gsheet
  await ctx.reply('Silakan klik tombol dibawah ini untuk informasi lebih lanjut:', {
    reply_markup: {
      inline_keyboard: [[{ text: 'Info Setup API Key Gemini', callback_data: 'info_setup_gemini' }, { text: 'Info Setup Google Sheet', callback_data: 'info_setup_gsheet' }]]
    }
  });
});

// Handle /setkey command
bot.command('setkey', async (ctx) => {
  const userId = ctx.from.id;
  const apiKey = ctx.message.text.replace('/setkey', '').trim();
  
  if (!apiKey) {
    await ctx.reply('❌ Silakan berikan API key Gemini Anda.\nContoh: /setkey YOUR_GEMINI_API_KEY');
    return;
  }
  
  // Validate API key
  const isValid = await validateGeminiApiKey(apiKey);
  if (!isValid) {
    await ctx.reply('❌ API key tidak valid. Silakan periksa kembali API key Gemini Anda.');
    return;
  }
  
  // Save API key
  const saved = await saveApiKey(userId, apiKey);
  if (saved) {
    const userHasSheetId = await hasSheetId(userId);
    if (userHasSheetId) {
      await ctx.reply('✅ API key berhasil disimpan! Sekarang Anda dapat menggunakan bot ini.');
    } else {
      await ctx.reply('✅ API key berhasil disimpan! Sekarang Anda perlu menyimpan Google Sheet ID Anda.\n\nSilakan kirim Google Sheet ID Anda dengan format:\n/setsheet YOUR_GOOGLE_SHEET_ID');
    }
  } else {
    await ctx.reply('❌ Gagal menyimpan API key. Silakan coba lagi.');
  }
});

// Handle /setsheet command
bot.command('setsheet', async (ctx) => {
  const userId = ctx.from.id;
  const sheetId = ctx.message.text.replace('/setsheet', '').trim();
  
  if (!sheetId) {
    await ctx.reply('❌ Silakan berikan Google Sheet ID Anda.\nContoh: /setsheet YOUR_GOOGLE_SHEET_ID');
    return;
  }
  
  // Validate Sheet ID
  const isValid = await validateGoogleSheetId(sheetId);
  if (!isValid) {
    await ctx.reply('❌ Google Sheet ID tidak valid atau tidak dapat diakses. Silakan periksa kembali Sheet ID Anda dan pastikan bot memiliki akses ke sheet tersebut.');
    return;
  }
  
  // Save Sheet ID
  const saved = await saveSheetId(userId, sheetId);
  if (saved) {
    const userHasApiKey = await hasApiKey(userId);
    if (userHasApiKey) {
      await ctx.reply('✅ Google Sheet ID berhasil disimpan! Sekarang Anda dapat menggunakan bot ini.');
    } else {
      await ctx.reply('✅ Google Sheet ID berhasil disimpan! Sekarang Anda perlu menyimpan API key Gemini Anda.\n\nSilakan kirim API key Gemini Anda dengan format:\n/setkey YOUR_GEMINI_API_KEY');
    }
  } else {
    await ctx.reply('❌ Gagal menyimpan Google Sheet ID. Silakan coba lagi.');
  }
});

// Handle /removekey command
bot.command('removekey', async (ctx) => {
  const userId = ctx.from.id;
  const deleted = await deleteApiKey(userId);
  
  if (deleted) {
    await ctx.reply('✅ API key berhasil dihapus. Anda perlu menyimpan API key baru untuk menggunakan bot ini.');
  } else {
    await ctx.reply('❌ Gagal menghapus API key. Silakan coba lagi.');
  }
});

// Handle /info command
bot.command('info', async (ctx) => {
  await ctx.reply(getWelcomeMessage(process.env), { parse_mode: "MarkdownV2" });
});

// Handle /info_setup_gemini command
bot.command('info_setup_gemini', async (ctx) => {
  await ctx.reply(getSetupGeminiInstruction(), { parse_mode: "MarkdownV2" });
});

// Handle /info_setup_gsheet command
bot.command('info_setup_gsheet', async (ctx) => {
  await ctx.reply(getSetupGoogleSheetInstruction(), { parse_mode: "MarkdownV2" });
});

// Handle /info_setup_gemini command
bot.action('info_setup_gemini', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(getSetupGeminiInstruction(), { parse_mode: "MarkdownV2" });
});

// Handle /info_setup_gsheet command
bot.action('info_setup_gsheet', async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(getSetupGoogleSheetInstruction(), { parse_mode: "MarkdownV2" });
});

// Handle /saldo command
bot.command('saldo', async (ctx) => {
  const userId = ctx.from.id;
  
  // Validate user setup
  const validation = await validateUserSetup(userId);
  if (!validation.isValid) {
    await ctx.reply(validation.message);
    return;
  }
  
  try {
    // Get user credentials
    const credentials = await getUserCredentials(userId);
    if (!credentials.success) {
      await ctx.reply(credentials.message);
      return;
    }
    
    // Get summary data from sheet
    const summaryData = await getSummaryData(credentials.sheetId);
    
    // Format currency values
    const formattedPemasukan = formatAmountToCurrency(summaryData.pemasukan);
    const formattedPengeluaran = formatAmountToCurrency(summaryData.pengeluaran);
    const formattedSaldo = formatAmountToCurrency(summaryData.saldo);
    
    // Create summary message
    const summaryMessage = `📊 *Ringkasan Keuangan Anda*\n\n💰 *Pemasukan:* ${formattedPemasukan}\n💸 *Pengeluaran:* ${formattedPengeluaran}\n🏦 *Saldo:* ${formattedSaldo}`;
    
    await ctx.reply(summaryMessage, { parse_mode: "Markdown" });
    
  } catch (error) {
    console.error('Error getting summary data:', error);
    await ctx.reply('❌ Gagal mengambil data ringkasan dari Google Sheet. Silakan coba lagi atau periksa konfigurasi Sheet Anda.');
  }
});

// Handle photo messages (receipt images)
bot.on(message("photo"), async (ctx) => {
  const userId = ctx.from.id;
  
  // Check if user has both API key and sheet ID
  const userHasApiKey = await hasApiKey(userId);
  const userHasSheetId = await hasSheetId(userId);
  
  if (!userHasApiKey && !userHasSheetId) {
    await ctx.reply(`🔑 Anda belum menyimpan API key Gemini dan Google Sheet ID Anda.\n\nSilakan kirim:\n1. API key Gemini: /setkey YOUR_GEMINI_API_KEY\n2. Google Sheet ID: /setsheet YOUR_GOOGLE_SHEET_ID`);
    return;
  } else if (!userHasApiKey) {
    await ctx.reply(`🔑 Anda sudah memiliki Google Sheet ID, tetapi masih perlu menyimpan API key Gemini Anda.\n\nSilakan kirim API key Gemini Anda dengan format:\n/setkey YOUR_GEMINI_API_KEY`);
    return;
  } else if (!userHasSheetId) {
    await ctx.reply(`📊 Anda sudah memiliki API key Gemini, tetapi masih perlu menyimpan Google Sheet ID Anda.\n\nSilakan kirim Google Sheet ID Anda dengan format:\n/setsheet YOUR_GOOGLE_SHEET_ID`);
    return;
  }
  
  // Get user's API key and sheet ID
  const userApiKey = await getApiKey(userId);
  const userSheetId = await getSheetId(userId);
  
  if (!userApiKey) {
    await ctx.reply('❌ Gagal mengambil API key Anda. Silakan coba lagi atau set ulang API key Anda.');
    return;
  }
  
  if (!userSheetId) {
    await ctx.reply('❌ Gagal mengambil Google Sheet ID Anda. Silakan coba lagi atau set ulang Sheet ID Anda.');
    return;
  }
  
  try {
    // Send processing message
    await ctx.reply('📸 Sedang memproses gambar receipt Anda...');
    
    // Get the largest photo size (best quality)
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    
    // Download and analyze the image
    const imageData = await downloadImageFromTelegram(photo.file_id, userApiKey);
    const transactionData = await analyzeReceiptImage(imageData, userApiKey);
    
    // Handle message response (single object)
    if (transactionData.type === "message") {
      await ctx.reply(transactionData.message);
      return;
    }

    // Handle empty array (unclear input) - treat as message
    if (Array.isArray(transactionData) && transactionData.length === 0) {
      await ctx.reply("Maaf, saya tidak dapat membaca informasi transaksi dari gambar ini. Pastikan gambar receipt jelas dan berisi informasi transaksi.");
      return;
    }

    // Handle transaction responses (array)
    if (Array.isArray(transactionData)) {
      let transactionsToSave = [];
      let formattedTransactions = [];
      
      // Check if array contains message objects
      for (const item of transactionData) {
        if (item.type === "message") {
          await ctx.reply(item.message);
          return;
        }
      }
      
      // Prepare transactions for batch saving
      for (const transaction of transactionData) {
        if (transaction.type === "transaction") {
          const date = processTransactionDate(transaction);
          const amount = processTransactionAmount(transaction);
          
          let descriptionUpper = transaction.description.toUpperCase();
          if(descriptionUpper.includes("[RCPTXXXX]")) {
            // generate random 4 character string
            let randomString = Math.random().toString(36).substring(2, 6).toUpperCase();
            transaction.description = descriptionUpper.replace("[RCPTXXXX]", `[${randomString}]`);
          }

          // Add to batch save array
          transactionsToSave.push(createSheetTransaction(transaction, date, amount, ctx.from, "Receipt"));
          
          // Format for response
          formattedTransactions.push(createFormattedTransaction(transaction, date, amount));
        }
      }
      
      // Save all transactions in one batch
      if (transactionsToSave.length > 0) {
        try {
          await saveMultipleToSheet(transactionsToSave, userSheetId);
          
          let replyMessage = `✅ ${transactionsToSave.length} transaksi dari receipt berhasil disimpan!\n\n`;
          formattedTransactions.forEach((transaction, index) => {
            replyMessage += `📋 Transaksi ${index + 1}:\n`;
            replyMessage += `📅 Date: ${transaction.date}\n`;
            replyMessage += `📝 Description: ${transaction.description}\n`;
            replyMessage += `💰 Amount: ${transaction.amount}\n`;
            replyMessage += `🏷️ Category: ${transaction.category}\n`;
            replyMessage += `🔄 Tipe: ${transaction.dbcr}\n\n`;
          });
          
          await ctx.reply(replyMessage.trim());
        } catch (error) {
          console.error("Error saving transactions from receipt:", error);
          await ctx.reply("❌ Gagal menyimpan transaksi dari receipt. Silakan coba lagi.");
        }
      } else {
        await ctx.reply("❌ Tidak ada transaksi valid yang dapat disimpan dari receipt ini.");
      }
      return;
    }

    // Fallback for single transaction object (backward compatibility)
    const date = processTransactionDate(transactionData);
    const amount = processTransactionAmount(transactionData);
    await saveToSheet(createSheetTransaction(transactionData, date, amount, ctx.from, "Receipt"), userSheetId);

    const formattedTransaction = createFormattedTransaction(transactionData, date, amount);
    await ctx.reply(
      `✅ Transaksi dari receipt berhasil disimpan!\n\n📅 Date: ${formattedTransaction.date}\n📝 Description: ${formattedTransaction.description}\n💰 Amount: ${formattedTransaction.amount}\n🏷️ Category: ${formattedTransaction.category}\n🔄 Tipe: ${formattedTransaction.dbcr}`
    );
    
  } catch (error) {
    console.error("Error processing receipt image:", error);
    await ctx.reply("❌ Gagal memproses gambar receipt. Silakan coba lagi dengan gambar yang lebih jelas.");
  }
});

// Handle document messages (uncompressed images)
bot.on(message("document"), async (ctx) => {
  const userId = ctx.from.id;
  const document = ctx.message.document;
  
  // Check if the document is an image
  if (!document.mime_type || !document.mime_type.startsWith('image/')) {
    return; // Not an image, ignore
  }
  
  // Check if user has both API key and sheet ID
  const userHasApiKey = await hasApiKey(userId);
  const userHasSheetId = await hasSheetId(userId);
  
  if (!userHasApiKey && !userHasSheetId) {
    await ctx.reply(`🔑 Anda belum menyimpan API key Gemini dan Google Sheet ID Anda.\n\nSilakan kirim:\n1. API key Gemini: /setkey YOUR_GEMINI_API_KEY\n2. Google Sheet ID: /setsheet YOUR_GOOGLE_SHEET_ID`);
    return;
  } else if (!userHasApiKey) {
    await ctx.reply(`🔑 Anda sudah memiliki Google Sheet ID, tetapi masih perlu menyimpan API key Gemini Anda.\n\nSilakan kirim API key Gemini Anda dengan format:\n/setkey YOUR_GEMINI_API_KEY`);
    return;
  } else if (!userHasSheetId) {
    await ctx.reply(`📊 Anda sudah memiliki API key Gemini, tetapi masih perlu menyimpan Google Sheet ID Anda.\n\nSilakan kirim Google Sheet ID Anda dengan format:\n/setsheet YOUR_GOOGLE_SHEET_ID`);
    return;
  }
  
  // Get user's API key and sheet ID
  const userApiKey = await getApiKey(userId);
  const userSheetId = await getSheetId(userId);
  
  if (!userApiKey) {
    await ctx.reply('❌ Gagal mengambil API key Anda. Silakan coba lagi atau set ulang API key Anda.');
    return;
  }
  
  if (!userSheetId) {
    await ctx.reply('❌ Gagal mengambil Google Sheet ID Anda. Silakan coba lagi atau set ulang Sheet ID Anda.');
    return;
  }
  
  try {
    // Send processing message
    await ctx.reply('📸 Sedang memproses gambar receipt Anda...');
    
    // Download and analyze the image document
    const imageData = await downloadImageFromTelegram(document.file_id, userApiKey);
    // Update mime type based on the actual document
    imageData.mimeType = document.mime_type;
    
    const transactionData = await analyzeReceiptImage(imageData, userApiKey);
    
    // Handle message response (single object)
    if (transactionData.type === "message") {
      await ctx.reply(transactionData.message);
      return;
    }

    // Handle empty array (unclear input) - treat as message
    if (Array.isArray(transactionData) && transactionData.length === 0) {
      await ctx.reply("Maaf, saya tidak dapat membaca informasi transaksi dari gambar ini. Pastikan gambar receipt jelas dan berisi informasi transaksi.");
      return;
    }

    // Handle transaction responses (array)
    if (Array.isArray(transactionData)) {
      let transactionsToSave = [];
      let formattedTransactions = [];
      
      // Check if array contains message objects
      for (const item of transactionData) {
        if (item.type === "message") {
          await ctx.reply(item.message);
          return;
        }
      }
      
      // Prepare transactions for batch saving
      for (const transaction of transactionData) {
        if (transaction.type === "transaction") {
          const date = processTransactionDate(transaction);
          const amount = processTransactionAmount(transaction);
          
          // Add to batch save array
          transactionsToSave.push(createSheetTransaction(transaction, date, amount, ctx.from, "Receipt"));
          
          // Format for response
          formattedTransactions.push(createFormattedTransaction(transaction, date, amount));
        }
      }
      
      // Save all transactions in one batch
      if (transactionsToSave.length > 0) {
        try {
          await saveMultipleToSheet(transactionsToSave, userSheetId);
          
          let replyMessage = `✅ ${transactionsToSave.length} transaksi dari receipt berhasil disimpan!\n\n`;
          formattedTransactions.forEach((transaction, index) => {
            replyMessage += `📋 Transaksi ${index + 1}:\n`;
            replyMessage += `📅 Date: ${transaction.date}\n`;
            replyMessage += `📝 Description: ${transaction.description}\n`;
            replyMessage += `💰 Amount: ${transaction.amount}\n`;
            replyMessage += `🏷️ Category: ${transaction.category}\n`;
            replyMessage += `🔄 Tipe: ${transaction.dbcr}\n\n`;
          });
          
          await ctx.reply(replyMessage.trim());
        } catch (error) {
          console.error("Error saving transactions from receipt:", error);
          await ctx.reply("❌ Gagal menyimpan transaksi dari receipt. Silakan coba lagi.");
        }
      } else {
        await ctx.reply("❌ Tidak ada transaksi valid yang dapat disimpan dari receipt ini.");
      }
      return;
    }

    // Fallback for single transaction object (backward compatibility)
    const date = processTransactionDate(transactionData);
    const amount = processTransactionAmount(transactionData);
    await saveToSheet(createSheetTransaction(transactionData, date, amount, ctx.from, "Receipt"), userSheetId);

    const formattedTransaction = createFormattedTransaction(transactionData, date, amount);
    await ctx.reply(
      `✅ Transaksi dari receipt berhasil disimpan!\n\n📅 Date: ${formattedTransaction.date}\n📝 Description: ${formattedTransaction.description}\n💰 Amount: ${formattedTransaction.amount}\n🏷️ Category: ${formattedTransaction.category}\n🔄 Tipe: ${formattedTransaction.dbcr}`
    );
    
  } catch (error) {
    console.error("Error processing receipt image:", error);
    await ctx.reply("❌ Gagal memproses gambar receipt. Silakan coba lagi dengan gambar yang lebih jelas.");
  }
});

bot.on("message", async (ctx, next) => {
  // Only handle text messages
  if (!ctx.message || !("text" in ctx.message)) {
    return next();
  }
  
  const message = ctx.message.text;
  const userId = ctx.from.id;
  
  // Handle setkey command (without slash)
  if (message.toLowerCase().startsWith('setkey ')) {
    const apiKey = message.replace(/^setkey\s+/i, '').trim();
    
    if (!apiKey) {
      await ctx.reply('❌ Silakan berikan API key Gemini Anda.\nContoh: setkey YOUR_GEMINI_API_KEY');
      return;
    }
    
    // Validate API key
    const isValid = await validateGeminiApiKey(apiKey);
    if (!isValid) {
      await ctx.reply('❌ API key tidak valid. Silakan periksa kembali API key Gemini Anda.');
      return;
    }
    
    // Save API key
    const saved = await saveApiKey(userId, apiKey);
    if (saved) {
      const userHasSheetId = await hasSheetId(userId);
      if (userHasSheetId) {
        await ctx.reply('✅ API key berhasil disimpan! Sekarang Anda dapat menggunakan bot ini.\n\n' + getWelcomeMessage(process.env), { parse_mode: "MarkdownV2" });
      } else {
        await ctx.reply('✅ API key berhasil disimpan! Sekarang Anda perlu menyimpan Google Sheet ID Anda.\n\nSilakan kirim Google Sheet ID Anda dengan format:\n/setsheet YOUR_GOOGLE_SHEET_ID');
      }
    } else {
      await ctx.reply('❌ Gagal menyimpan API key. Silakan coba lagi.');
    }
    return;
  }
  
  // Handle setsheet command (without slash)
  if (message.toLowerCase().startsWith('setsheet ')) {
    const sheetId = message.replace(/^setsheet\s+/i, '').trim();
    
    if (!sheetId) {
      await ctx.reply('❌ Silakan berikan Google Sheet ID Anda.\nContoh: setsheet YOUR_GOOGLE_SHEET_ID');
      return;
    }
    
    // Validate Sheet ID
    const isValid = await validateGoogleSheetId(sheetId);
    if (!isValid) {
      await ctx.reply('❌ Google Sheet ID tidak valid atau tidak dapat diakses. Silakan periksa kembali Sheet ID Anda dan pastikan bot memiliki akses ke sheet tersebut.');
      return;
    }
    
    // Save Sheet ID
    const saved = await saveSheetId(userId, sheetId);
    if (saved) {
      const userHasApiKey = await hasApiKey(userId);
      if (userHasApiKey) {
        await ctx.reply('✅ Google Sheet ID berhasil disimpan! Sekarang Anda dapat menggunakan bot ini.\n\n' + getWelcomeMessage(process.env), { parse_mode: "MarkdownV2" });
      } else {
        await ctx.reply('✅ Google Sheet ID berhasil disimpan! Sekarang Anda perlu menyimpan API key Gemini Anda.\n\nSilakan kirim API key Gemini Anda dengan format:\n/setkey YOUR_GEMINI_API_KEY');
      }
    } else {
      await ctx.reply('❌ Gagal menyimpan Google Sheet ID. Silakan coba lagi.');
    }
    return;
  }
  
  // Check if user has both API key and sheet ID before processing transaction
  const userHasApiKey = await hasApiKey(userId);
  const userHasSheetId = await hasSheetId(userId);
  
  if (!userHasApiKey && !userHasSheetId) {
    await ctx.reply(`🔑 Anda belum menyimpan API key Gemini dan Google Sheet ID Anda.\n\nSilakan kirim:\n1. API key Gemini: /setkey YOUR_GEMINI_API_KEY\n2. Google Sheet ID: /setsheet YOUR_GOOGLE_SHEET_ID\nsetsheet YOUR_GOOGLE_SHEET_ID`);
    return;
  } else if (!userHasApiKey) {
    await ctx.reply(`🔑 Anda sudah memiliki Google Sheet ID, tetapi masih perlu menyimpan API key Gemini Anda.\n\nSilakan kirim API key Gemini Anda dengan format:\n/setkey YOUR_GEMINI_API_KEY`);
    return;
  } else if (!userHasSheetId) {
    await ctx.reply(`📊 Anda sudah memiliki API key Gemini, tetapi masih perlu menyimpan Google Sheet ID Anda.\n\nSilakan kirim Google Sheet ID Anda dengan format:\n/setsheet YOUR_GOOGLE_SHEET_ID`);
    return;
  }
  
  // Get user's API key and sheet ID
  const userApiKey = await getApiKey(userId);
  const userSheetId = await getSheetId(userId);
  
  if (!userApiKey) {
    await ctx.reply('❌ Gagal mengambil API key Anda. Silakan coba lagi atau set ulang API key Anda.');
    return;
  }
  
  if (!userSheetId) {
    await ctx.reply('❌ Gagal mengambil Google Sheet ID Anda. Silakan coba lagi atau set ulang Sheet ID Anda.');
    return;
  }
  
  const transactionData = await categorizeTransaction(message, userApiKey);

  // Handle message response (single object)
  if (transactionData.type === "message") {
    await ctx.reply(transactionData.message);
    return;
  }

  // Handle empty array (unclear input) - treat as message
  if (Array.isArray(transactionData) && transactionData.length === 0) {
    await ctx.reply("Silahkan berikan informasi transaksi Anda dengan benar. Contoh: 'Nasi goreng 100000' atau 'Nasi goreng 100000, makanan' atau 'Nasi goreng 100000, makanan, 20 januari 2025'");
    return;
  }

  // Handle transaction responses (array)
  if (Array.isArray(transactionData)) {
    let transactionsToSave = [];
    let formattedTransactions = [];
    
    // Check if array contains message objects
    for (const item of transactionData) {
      if (item.type === "message") {
        await ctx.reply(item.message);
        return;
      }
    }
    
    // Prepare transactions for batch saving
    for (const transaction of transactionData) {
      if (transaction.type === "transaction") {
        const date = processTransactionDate(transaction);
        const amount = processTransactionAmount(transaction);
        
        // Add to batch save array
        transactionsToSave.push(createSheetTransaction(transaction, date, amount, ctx.from, ""));
        
        // Format for response
        formattedTransactions.push(createFormattedTransaction(transaction, date, amount));
      }
    }
    
    // Save all transactions in one batch
    if (transactionsToSave.length > 0) {
      try {
        await saveMultipleToSheet(transactionsToSave, userSheetId);
        
        let replyMessage = `✅ ${transactionsToSave.length} transaksi berhasil disimpan!\n\n`;
        formattedTransactions.forEach((transaction, index) => {
          replyMessage += `📋 Transaksi ${index + 1}:\n`;
          replyMessage += `📅 Date: ${transaction.date}\n`;
          replyMessage += `📝 Description: ${transaction.description}\n`;
          replyMessage += `💰 Amount: ${transaction.amount}\n`;
          replyMessage += `🏷️ Category: ${transaction.category}\n`;
          replyMessage += `🔄 Tipe: ${transaction.dbcr}\n\n`;
        });
        
        await ctx.reply(replyMessage.trim());
      } catch (error) {
        console.error("Error saving transactions:", error);
        await ctx.reply("❌ Gagal menyimpan transaksi. Silakan coba lagi.");
      }
    } else {
      await ctx.reply("❌ Tidak ada transaksi valid yang dapat disimpan.");
    }
    return;
  }

  // Fallback for single transaction object (backward compatibility)
  const date = processTransactionDate(transactionData);
  const amount = processTransactionAmount(transactionData);
  await saveToSheet(createSheetTransaction(transactionData, date, amount, ctx.from, ""), userSheetId);

  const formattedTransaction = createFormattedTransaction(transactionData, date, amount);
  await ctx.reply(
    `✅ Transaksi berhasil disimpan!\n\n📅 Date: ${formattedTransaction.date}\n📝 Description: ${formattedTransaction.description}\n💰 Amount: ${formattedTransaction.amount}\n🏷️ Category: ${formattedTransaction.category}\n🔄 Tipe: ${formattedTransaction.dbcr}`
  );
});

// ===== WEBHOOK SETUP =====
app.use(bot.webhookCallback("/webhook"));
app.get("/", (req, res) => res.send("Bot is running"));

const port = process.env.PORT || 8080;
app.listen(port, async () => {
  console.log(`Server running on port ${port}`);
  await bot.telegram.setWebhook(`${WEBHOOK_URL}/webhook`);
});
