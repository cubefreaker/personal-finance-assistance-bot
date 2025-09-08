import express from "express";
import { Telegraf, Markup } from "telegraf";
import fetch from "node-fetch";
import dotenv from "dotenv";
import { getTransactionPrompt, getWelcomeMessage, getSetupGeminiInstruction, getSetupGoogleSheetInstruction } from "./prompt.js";
import { saveApiKey, getApiKey, hasApiKey, deleteApiKey, saveSheetId, getSheetId, hasSheetId, isUserSetupComplete } from "./apiKeyService.js";
import { saveToSheet, validateGoogleSheetId } from "./sheetService.js";
dotenv.config();

const app = express();

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBHOOK_URL = process.env.WEBHOOK_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SHEET_ID = process.env.SHEET_ID;

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

  let parsed = { description: "", amount: 0, date: "", dbcr: "credit", category: "Uncategorized", message: "" };
  try {
    const text = res?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

    // Sanitize response to handle markdown code blocks
    let sanitizedText = text.trim();

    // Remove markdown code blocks if present
    if (sanitizedText.startsWith('```json') && sanitizedText.endsWith('```')) {
      sanitizedText = sanitizedText.slice(7, -3).trim(); // Remove ```json and ```
    } else if (sanitizedText.startsWith('```') && sanitizedText.endsWith('```')) {
      sanitizedText = sanitizedText.slice(3, -3).trim(); // Remove ``` and ```
    }

    parsed = JSON.parse(sanitizedText);
  } catch (e) {
    console.error("Gemini parse error:", e);
    console.error("Raw response text:", res?.candidates?.[0]?.content?.parts?.[0]?.text);
  }
  return parsed;
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

  if (transactionData.type === "message") {
    await ctx.reply(transactionData.message);
    return;
  }

  let date = new Date().toISOString().split("T")[0].split("-").reverse().join("-");
  if (transactionData.date) {
    date = transactionData.date;
  } else if (transactionData.dateDiff) {
    date = new Date(new Date().setDate(new Date().getDate() + transactionData.dateDiff)).toISOString().split("T")[0].split("-").reverse().join("-");
  }
  
  await saveToSheet({
    date,
    text: transactionData.description,
    amount: transactionData.amount,
    dbcr: transactionData.dbcr,
    category: transactionData.category,
  }, userSheetId);

  let formattedDate = new Date(date).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  let formattedAmount = transactionData.amount.toLocaleString("id-ID", {
    style: "currency",
    currency: "IDR",
  });

  await ctx.reply(
    `✅ Transaksi berhasil disimpan!\n\n📅 Date: ${formattedDate}\n📝 Description: ${transactionData.description}\n💰 Amount: ${formattedAmount}\n🏷️ Category: ${transactionData.category}\n🔄 Tipe: ${transactionData.dbcr.toLowerCase() === "debit" ? "Debit" : transactionData.dbcr.toLowerCase() === "credit" ? "Kredit" : transactionData.dbcr}`
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
