import { hasApiKey, hasSheetId, getApiKey, getSheetId } from "./apiKeyService.js";
import { saveToSheet, saveMultipleToSheet } from "./sheetService.js";

// ===== USER VALIDATION HELPERS =====

/**
 * Check if user has both API key and sheet ID
 * @param {number} userId - The user ID
 * @returns {Object} - Validation result with status and message
 */
export async function validateUserSetup(userId) {
  const userHasApiKey = await hasApiKey(userId);
  const userHasSheetId = await hasSheetId(userId);
  
  if (!userHasApiKey && !userHasSheetId) {
    return {
      isValid: false,
      type: 'both_missing',
      message: `🔑 Anda belum menyimpan API key Gemini dan Google Sheet ID Anda.\n\nSilakan kirim:\n1. API key Gemini: /setkey YOUR_GEMINI_API_KEY\n2. Google Sheet ID: /setsheet YOUR_GOOGLE_SHEET_ID`
    };
  } else if (!userHasApiKey) {
    return {
      isValid: false,
      type: 'api_key_missing',
      message: `🔑 Anda sudah memiliki Google Sheet ID, tetapi masih perlu menyimpan API key Gemini Anda.\n\nSilakan kirim API key Gemini Anda dengan format:\n/setkey YOUR_GEMINI_API_KEY`
    };
  } else if (!userHasSheetId) {
    return {
      isValid: false,
      type: 'sheet_id_missing',
      message: `📊 Anda sudah memiliki API key Gemini, tetapi masih perlu menyimpan Google Sheet ID Anda.\n\nSilakan kirim Google Sheet ID Anda dengan format:\n/setsheet YOUR_GOOGLE_SHEET_ID`
    };
  }
  
  return { isValid: true };
}

/**
 * Get user's API key and sheet ID if available
 * @param {number} userId - The user ID
 * @returns {Object} - User credentials or error message
 */
export async function getUserCredentials(userId) {
  const userApiKey = await getApiKey(userId);
  const userSheetId = await getSheetId(userId);
  
  if (!userApiKey) {
    return {
      success: false,
      message: '❌ Gagal mengambil API key Anda. Silakan coba lagi atau set ulang API key Anda.'
    };
  }
  
  if (!userSheetId) {
    return {
      success: false,
      message: '❌ Gagal mengambil Google Sheet ID Anda. Silakan coba lagi atau set ulang Sheet ID Anda.'
    };
  }
  
  return {
    success: true,
    apiKey: userApiKey,
    sheetId: userSheetId
  };
}

// ===== DATE AND FORMATTING HELPERS =====

/**
 * Format date to Indonesian locale
 * @param {string} date - Date string
 * @returns {string} - Formatted date
 */
export function formatDateToIndonesian(date) {
  return new Date(date).toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/**
 * Format amount to Indonesian Rupiah currency
 * @param {number} amount - Amount to format
 * @returns {string} - Formatted currency
 */
export function formatAmountToCurrency(amount) {
  return amount.toLocaleString("id-ID", {
    style: "currency",
    currency: "IDR",
  });
}

/**
 * Process transaction date from various formats
 * @param {Object} transaction - Transaction object
 * @returns {string} - Formatted date string (YYYY-MM-DD)
 */
export function processTransactionDate(transaction) {
  let date = new Date().toISOString().split("T")[0]; // YYYY-MM-DD format
  
  if (transaction.date) {
    // Ensure date is in YYYY-MM-DD format
    date = standardizeDateFormat(transaction.date);
  } else if (transaction.dateDiff) {
    date = new Date(new Date().setDate(new Date().getDate() + transaction.dateDiff))
      .toISOString().split("T")[0]; // YYYY-MM-DD format
  }
  
  return date;
}

/**
 * Standardize date format to YYYY-MM-DD
 * @param {string} dateString - Date string in various formats
 * @returns {string} - Standardized date string (YYYY-MM-DD)
 */
export function standardizeDateFormat(dateString) {
  if (!dateString) return new Date().toISOString().split("T")[0];
  
  // Check if already in YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    return dateString;
  }
  
  // Check if in DD-MM-YYYY format
  if (/^\d{2}-\d{2}-\d{4}$/.test(dateString)) {
    const [day, month, year] = dateString.split("-");
    return `${year}-${month}-${day}`;
  }
  
  // Check if in DD/MM/YYYY format
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dateString)) {
    const [day, month, year] = dateString.split("/");
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  
  // Try to parse as a regular date and convert
  try {
    const parsedDate = new Date(dateString);
    if (!isNaN(parsedDate.getTime())) {
      return parsedDate.toISOString().split("T")[0];
    }
  } catch (error) {
    console.warn(`Could not parse date: ${dateString}, using current date`);
  }
  
  // Fallback to current date
  return new Date().toISOString().split("T")[0];
}

/**
 * Process transaction amount based on debit/credit type
 * @param {Object} transaction - Transaction object
 * @returns {number} - Processed amount
 */
export function processTransactionAmount(transaction) {
  return transaction.dbcr.toLowerCase() === "credit" ? -transaction.amount : transaction.amount;
}

// ===== GEMINI RESPONSE PARSING =====

/**
 * Parse and sanitize Gemini API response
 * @param {Object} response - Raw Gemini API response
 * @returns {Object|Array} - Parsed transaction data
 */
export function parseGeminiResponse(response) {
  let parsed = [{ description: "", amount: 0, date: "", dbcr: "credit", category: "Uncategorized", message: "" }];
  
  try {
    const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

    // Sanitize response to handle markdown code blocks
    let sanitizedText = text.trim();

    // Remove markdown code blocks if present
    if (sanitizedText.startsWith('```json') && sanitizedText.endsWith('```')) {
      sanitizedText = sanitizedText.slice(7, -3).trim(); // Remove ```json and ```
    } else if (sanitizedText.startsWith('```') && sanitizedText.endsWith('```')) {
      sanitizedText = sanitizedText.slice(3, -3).trim(); // Remove ``` and ```
    }

    const parsedResponse = JSON.parse(sanitizedText);
    
    // Handle both array and single object responses
    if (Array.isArray(parsedResponse)) {
      parsed = parsedResponse;
    } else {
      // Single object (message type or single transaction), return as-is for consistency
      parsed = parsedResponse;
    }
  } catch (e) {
    console.error("Gemini parse error:", e);
    console.error("Raw response text:", response?.candidates?.[0]?.content?.parts?.[0]?.text);
  }
  
  return parsed;
}

// ===== TRANSACTION PROCESSING HELPERS =====

/**
 * Create formatted transaction object for display
 * @param {Object} transaction - Raw transaction data
 * @param {string} date - Processed date
 * @param {number} amount - Processed amount
 * @returns {Object} - Formatted transaction for display
 */
export function createFormattedTransaction(transaction, date, amount) {
  return {
    date: formatDateToIndonesian(date),
    description: transaction.description,
    amount: formatAmountToCurrency(amount),
    category: transaction.category,
    dbcr: transaction.dbcr.toLowerCase() === "debit" ? "Debit" : 
          transaction.dbcr.toLowerCase() === "credit" ? "Kredit" : transaction.dbcr
  };
}

/**
 * Create transaction object for saving to sheet
 * @param {Object} transaction - Raw transaction data
 * @param {string} date - Processed date
 * @param {number} amount - Processed amount
 * @param {Object} userInfo - User information from Telegram context
 * @param {string} source - Source of transaction (e.g., "Receipt", "Text")
 * @returns {Object} - Transaction object ready for sheet saving
 */
export function createSheetTransaction(transaction, date, amount, userInfo, source = "") {
  const sourceTag = source ? ` [${source}]` : "";
  return {
    date,
    text: transaction.description,
    amount,
    dbcr: transaction.dbcr,
    category: transaction.category,
    createdBy: `${userInfo.id} (${userInfo?.first_name || ""} ${userInfo?.last_name || ""})${userInfo?.username ? ` @${userInfo?.username}` : ""}${sourceTag}`,
  };
}

/**
 * Format multiple transactions for display message
 * @param {Array} formattedTransactions - Array of formatted transactions
 * @param {string} successMessage - Success message prefix
 * @returns {string} - Complete formatted message
 */
export function formatTransactionsMessage(formattedTransactions, successMessage) {
  let replyMessage = successMessage + "\n\n";
  
  formattedTransactions.forEach((transaction, index) => {
    replyMessage += `📋 Transaksi ${index + 1}:\n`;
    replyMessage += `📅 Date: ${transaction.date}\n`;
    replyMessage += `📝 Description: ${transaction.description}\n`;
    replyMessage += `💰 Amount: ${transaction.amount}\n`;
    replyMessage += `🏷️ Category: ${transaction.category}\n`;
    replyMessage += `🔄 Tipe: ${transaction.dbcr}\n\n`;
  });
  
  return replyMessage.trim();
}

/**
 * Format single transaction for display message
 * @param {Object} formattedTransaction - Formatted transaction
 * @param {string} successMessage - Success message prefix
 * @returns {string} - Complete formatted message
 */
export function formatSingleTransactionMessage(formattedTransaction, successMessage) {
  return `${successMessage}\n\n📅 Date: ${formattedTransaction.date}\n📝 Description: ${formattedTransaction.description}\n💰 Amount: ${formattedTransaction.amount}\n🏷️ Category: ${formattedTransaction.category}\n🔄 Tipe: ${formattedTransaction.dbcr}`;
}

// ===== ERROR HANDLING HELPERS =====

/**
 * Standard error messages for common scenarios
 */
export const ERROR_MESSAGES = {
  INVALID_RECEIPT: "Maaf, saya tidak dapat membaca informasi transaksi dari gambar ini. Pastikan gambar receipt jelas dan berisi informasi transaksi.",
  INVALID_TRANSACTION_INPUT: "Silahkan berikan informasi transaksi Anda dengan benar. Contoh: 'Nasi goreng 100000' atau 'Nasi goreng 100000, makanan' atau 'Nasi goreng 100000, makanan, 20 januari 2025'",
  SAVE_FAILED: "❌ Gagal menyimpan transaksi. Silakan coba lagi.",
  SAVE_RECEIPT_FAILED: "❌ Gagal menyimpan transaksi dari receipt. Silakan coba lagi.",
  PROCESS_RECEIPT_FAILED: "❌ Gagal memproses gambar receipt. Silakan coba lagi dengan gambar yang lebih jelas.",
  NO_VALID_TRANSACTIONS: "❌ Tidak ada transaksi valid yang dapat disimpan.",
  NO_VALID_RECEIPT_TRANSACTIONS: "❌ Tidak ada transaksi valid yang dapat disimpan dari receipt ini."
};

/**
 * Standard success messages
 */
export const SUCCESS_MESSAGES = {
  TRANSACTION_SAVED: "✅ Transaksi berhasil disimpan!",
  TRANSACTIONS_SAVED: (count) => `✅ ${count} transaksi berhasil disimpan!`,
  RECEIPT_TRANSACTION_SAVED: "✅ Transaksi dari receipt berhasil disimpan!",
  RECEIPT_TRANSACTIONS_SAVED: (count) => `✅ ${count} transaksi dari receipt berhasil disimpan!`,
  PROCESSING_RECEIPT: "📸 Sedang memproses gambar receipt Anda..."
};

// ===== TRANSACTION BATCH PROCESSING =====

/**
 * Process and save multiple transactions from Gemini response
 * @param {Array} transactionData - Array of transaction data from Gemini
 * @param {Object} userInfo - User info from Telegram context
 * @param {string} sheetId - Google Sheet ID
 * @param {string} source - Source of transactions (e.g., "Receipt", "Text")
 * @returns {Object} - Processing result with success status and message
 */
export async function processAndSaveTransactions(transactionData, userInfo, sheetId, source = "") {
  // Handle message response (single object)
  if (transactionData.type === "message") {
    return {
      success: false,
      shouldReply: true,
      message: transactionData.message
    };
  }

  // Handle empty array (unclear input) - treat as message
  if (Array.isArray(transactionData) && transactionData.length === 0) {
    return {
      success: false,
      shouldReply: true,
      message: source === "Receipt" ? ERROR_MESSAGES.INVALID_RECEIPT : ERROR_MESSAGES.INVALID_TRANSACTION_INPUT
    };
  }

  // Handle transaction responses (array)
  if (Array.isArray(transactionData)) {
    let transactionsToSave = [];
    let formattedTransactions = [];
    
    // Check if array contains message objects
    for (const item of transactionData) {
      if (item.type === "message") {
        return {
          success: false,
          shouldReply: true,
          message: item.message
        };
      }
    }
    
    // Prepare transactions for batch saving
    for (const transaction of transactionData) {
      if (transaction.type === "transaction") {
        const date = processTransactionDate(transaction);
        const amount = processTransactionAmount(transaction);
        
        // Add to batch save array
        transactionsToSave.push(createSheetTransaction(transaction, date, amount, userInfo, source));
        
        // Format for response
        formattedTransactions.push(createFormattedTransaction(transaction, date, amount));
      }
    }
    
    // Save all transactions in one batch
    if (transactionsToSave.length > 0) {
      try {
        await saveMultipleToSheet(transactionsToSave, sheetId);
        
        const successMessage = source === "Receipt" 
          ? SUCCESS_MESSAGES.RECEIPT_TRANSACTIONS_SAVED(transactionsToSave.length)
          : SUCCESS_MESSAGES.TRANSACTIONS_SAVED(transactionsToSave.length);
        
        const replyMessage = formatTransactionsMessage(formattedTransactions, successMessage);
        
        return {
          success: true,
          shouldReply: true,
          message: replyMessage
        };
      } catch (error) {
        console.error("Error saving transactions:", error);
        return {
          success: false,
          shouldReply: true,
          message: source === "Receipt" ? ERROR_MESSAGES.SAVE_RECEIPT_FAILED : ERROR_MESSAGES.SAVE_FAILED
        };
      }
    } else {
      return {
        success: false,
        shouldReply: true,
        message: source === "Receipt" ? ERROR_MESSAGES.NO_VALID_RECEIPT_TRANSACTIONS : ERROR_MESSAGES.NO_VALID_TRANSACTIONS
      };
    }
  }

  // Fallback for single transaction object (backward compatibility)
  const date = processTransactionDate(transactionData);
  const amount = processTransactionAmount(transactionData);
  
  return {
    success: true,
    shouldReply: false,
    singleTransaction: {
      sheetData: createSheetTransaction(transactionData, date, amount, userInfo, source),
      formatted: createFormattedTransaction(transactionData, date, amount)
    }
  };
}

/**
 * Process and save a single transaction
 * @param {Object} singleTransactionResult - Result from processAndSaveTransactions for single transaction
 * @param {string} sheetId - Google Sheet ID
 * @param {string} source - Source of transaction (e.g., "Receipt", "Text")
 * @returns {Object} - Processing result with success status and message
 */
export async function processSingleTransaction(singleTransactionResult, sheetId, source = "") {
  try {
    await saveToSheet(singleTransactionResult.sheetData, sheetId);
    
    const successMessage = source === "Receipt" 
      ? SUCCESS_MESSAGES.RECEIPT_TRANSACTION_SAVED
      : SUCCESS_MESSAGES.TRANSACTION_SAVED;
    
    const replyMessage = formatSingleTransactionMessage(singleTransactionResult.formatted, successMessage);
    
    return {
      success: true,
      message: replyMessage
    };
  } catch (error) {
    console.error("Error saving single transaction:", error);
    return {
      success: false,
      message: source === "Receipt" ? ERROR_MESSAGES.SAVE_RECEIPT_FAILED : ERROR_MESSAGES.SAVE_FAILED
    };
  }
}
