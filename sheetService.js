import { google } from "googleapis";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

// ===== GOOGLE SHEETS =====
let auth;
let sheets;

async function initializeAuth() {
  if (!auth) {
    try {
      // Get credentials from Secret Manager
      const client = new SecretManagerServiceClient();
      const secretPath = process.env.SECRET_PATH || "projects/hamzah-dev/secrets/PersonalFinanceBotSecret/versions/latest";
      const [version] = await client.accessSecretVersion({
        name: secretPath,
      });
      const credentials = JSON.parse(version.payload.data.toString());
      
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    } catch (error) {
      console.error("Failed to get credentials from Secret Manager:", error);
      throw new Error("Unable to initialize Google Sheets authentication. Please ensure the secret is properly configured in Google Secret Manager.");
    }
    sheets = google.sheets({ version: "v4", auth });
  }
  return { auth, sheets };
}
export async function saveToSheet({ date, text, amount, dbcr, category, createdBy }, sheetId) {
  const { sheets } = await initializeAuth();
  
  // First, get existing transactions to calculate totals
  let existingData = [];
  try {
    const existingResponse = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: "Transactions!A6:F", // Read from row 6 onwards to the end
    });
    existingData = existingResponse.data.values || [];
  } catch (error) {
    console.log("No existing data found or error reading data:", error.message);
  }

  // Add the new transaction to existing data for calculation
  const allTransactions = [...existingData, [date, text, amount, dbcr, category, createdBy]];
  
  // Calculate totals
  let totalDebit = 0;
  let totalCredit = 0;
  
  allTransactions.forEach(row => {
    if (row && row.length >= 4) {
      const transactionAmount = parseFloat(row[2]) || 0;
      const transactionType = (row[3] || '').toLowerCase();
      
      if (transactionType === 'debit') {
        totalDebit += Math.abs(transactionAmount);
      } else if (transactionType === 'credit') {
        totalCredit += Math.abs(transactionAmount);
      }
    }
  });
  
  const totalBalance = totalDebit - totalCredit;
  
  // Prepare all data to write
  const updates = [
    {
      range: "Transactions!A1:B3",
      values: [
        ["Pemasukan", totalDebit],
        ["Pengeluaran", totalCredit],
        ["Saldo", totalBalance]
      ]
    },
    {
      range: "Transactions!A5:F5",
      values: [
        ["Date", "Description", "Amount", "Type", "Category", "Created By"]
      ]
    }
  ];
  
  // Use batchUpdate to write summary and headers
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "USER_ENTERED",
      data: updates
    }
  });
  
  // Merge cells for summary rows
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [
        {
          mergeCells: {
            range: {
              sheetId: 0, // Assuming first sheet (Transactions)
              startRowIndex: 0, // Row 1 (0-indexed)
              endRowIndex: 1,
              startColumnIndex: 1, // Column B (0-indexed)
              endColumnIndex: 5 // Column E (0-indexed, exclusive)
            },
            mergeType: "MERGE_ALL"
          }
        },
        {
          mergeCells: {
            range: {
              sheetId: 0, // Assuming first sheet (Transactions)
              startRowIndex: 1, // Row 2 (0-indexed)
              endRowIndex: 2,
              startColumnIndex: 1, // Column B (0-indexed)
              endColumnIndex: 5 // Column E (0-indexed, exclusive)
            },
            mergeType: "MERGE_ALL"
          }
        },
        {
          mergeCells: {
            range: {
              sheetId: 0, // Assuming first sheet (Transactions)
              startRowIndex: 2, // Row 3 (0-indexed)
              endRowIndex: 3,
              startColumnIndex: 1, // Column B (0-indexed)
              endColumnIndex: 5 // Column E (0-indexed, exclusive)
            },
            mergeType: "MERGE_ALL"
          }
        }
      ]
    }
  });
  
  // Append the new transaction starting from row 6
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Transactions!A6:F6",
    valueInputOption: "USER_ENTERED",
    requestBody: { 
      values: [[date, text, amount, dbcr, category, createdBy]]
    },
  });
}

// ===== GOOGLE SHEET VALIDATION =====
export async function validateGoogleSheetId(sheetId) {
  try {
    const { sheets } = await initializeAuth();
    await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
    });
    return true;
  } catch (error) {
    console.error("Sheet ID validation error:", error);
    return false;
  }
}
