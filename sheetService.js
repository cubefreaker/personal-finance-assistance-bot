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
// ===== SHARED HELPER FUNCTIONS =====

/**
 * Get sheet information and setup the sheet structure
 * @param {string} sheetId - The Google Sheet ID
 * @returns {Object} - Sheet information including sheets instance, name, and sheet ID
 */
async function getSheetInfo(sheetId) {
  const { sheets } = await initializeAuth();
  
  // Get the actual sheet information to get the first sheet name
  const spreadsheetInfo = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
  });
  
  // Get the first sheet (index 0) regardless of its name
  const firstSheet = spreadsheetInfo.data.sheets.find(sheet => sheet.properties.index === 0);
  if (!firstSheet) {
    throw new Error("No sheets found in the spreadsheet");
  }
  
  return {
    sheets,
    sheetName: firstSheet.properties.title,
    actualSheetId: firstSheet.properties.sheetId,
    existingMerges: firstSheet?.merges || []
  };
}

/**
 * Check if a range is already merged
 * @param {Array} existingMerges - Array of existing merge ranges
 * @param {number} startRow - Start row index
 * @param {number} endRow - End row index
 * @param {number} startCol - Start column index
 * @param {number} endCol - End column index
 * @returns {boolean} - Whether the range is already merged
 */
function isRangeMerged(existingMerges, startRow, endRow, startCol, endCol) {
  return existingMerges.some(merge => {
    const mergeRange = merge;
    return mergeRange.startRowIndex === startRow &&
           mergeRange.endRowIndex === endRow &&
           mergeRange.startColumnIndex === startCol &&
           mergeRange.endColumnIndex === endCol;
  });
}

/**
 * Setup sheet structure with summary formulas and headers
 * @param {Object} sheetInfo - Sheet information from getSheetInfo
 * @param {string} sheetId - The Google Sheet ID
 */
async function setupSheetStructure(sheetInfo, sheetId) {
  const { sheets, sheetName, actualSheetId, existingMerges } = sheetInfo;
  
  // Prepare all data to write with formulas
  const updates = [
    {
      range: `${sheetName}!A1:F3`,
      values: [
        ["Pemasukan", "=SUMIF(D6:D,\"debit\",C6:C)", "", "", "", ""], // Formula to sum all debit amounts
        ["Pengeluaran", "=ABS(SUMIF(D6:D,\"credit\",C6:C))", "", "", "", ""], // Formula to sum all credit amounts (absolute value)
        ["Saldo", "=B1-B2", "", "", "", ""] // Formula to calculate balance (Pemasukan - Pengeluaran)
      ]
    },
    {
      range: `${sheetName}!A5:F5`,
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
  
  // Prepare merge requests only for ranges that aren't already merged
  const mergeRequests = [];
  
  // Check and add merge request for row 1 (B1:F1)
  if (!isRangeMerged(existingMerges, 0, 1, 1, 6)) {
    mergeRequests.push({
      mergeCells: {
        range: {
          sheetId: actualSheetId,
          startRowIndex: 0, // Row 1 (0-indexed)
          endRowIndex: 1,
          startColumnIndex: 1, // Column B (0-indexed)
          endColumnIndex: 6 // Column F (0-indexed, exclusive)
        },
        mergeType: "MERGE_ALL"
      }
    });
  }
  
  // Check and add merge request for row 2 (B2:F2)
  if (!isRangeMerged(existingMerges, 1, 2, 1, 6)) {
    mergeRequests.push({
      mergeCells: {
        range: {
          sheetId: actualSheetId,
          startRowIndex: 1, // Row 2 (0-indexed)
          endRowIndex: 2,
          startColumnIndex: 1, // Column B (0-indexed)
          endColumnIndex: 6 // Column F (0-indexed, exclusive)
        },
        mergeType: "MERGE_ALL"
      }
    });
  }
  
  // Check and add merge request for row 3 (B3:F3)
  if (!isRangeMerged(existingMerges, 2, 3, 1, 6)) {
    mergeRequests.push({
      mergeCells: {
        range: {
          sheetId: actualSheetId,
          startRowIndex: 2, // Row 3 (0-indexed)
          endRowIndex: 3,
          startColumnIndex: 1, // Column B (0-indexed)
          endColumnIndex: 6 // Column F (0-indexed, exclusive)
        },
        mergeType: "MERGE_ALL"
      }
    });
  }
  
  // Only execute merge requests if there are any to process
  if (mergeRequests.length > 0) {
    try {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          requests: mergeRequests
        }
      });
      console.log(`Successfully merged ${mergeRequests.length} cell ranges`);
    } catch (error) {
      console.error('Error merging cells:', error.message);
      // Continue execution even if merging fails
    }
  } else {
    console.log('All summary rows are already merged');
  }
}

export async function saveMultipleToSheet(transactions, sheetId) {
  const sheetInfo = await getSheetInfo(sheetId);
  const { sheets, sheetName } = sheetInfo;
  
  // Prepare new transaction data
  const newTransactionRows = transactions.map(({ date, text, amount, dbcr, category, createdBy }) => 
    [date, text, amount, dbcr, category, createdBy]
  );
  
  // Setup sheet structure
  await setupSheetStructure(sheetInfo, sheetId);
  
  // Append all new transactions in one batch operation
  if (newTransactionRows.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${sheetName}!A6:F6`,
      valueInputOption: "USER_ENTERED",
      requestBody: { 
        values: newTransactionRows
      },
    });
  }
}

export async function saveToSheet({ date, text, amount, dbcr, category, createdBy }, sheetId) {
  const sheetInfo = await getSheetInfo(sheetId);
  const { sheets, sheetName } = sheetInfo;
  
  // Setup sheet structure
  await setupSheetStructure(sheetInfo, sheetId);
  
  // Append the new transaction starting from row 6
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${sheetName}!A6:F6`,
    valueInputOption: "USER_ENTERED",
    requestBody: { 
      values: [[date, text, amount, dbcr, category, createdBy]]
    },
  });
}

// ===== GET SUMMARY DATA =====
export async function getSummaryData(sheetId) {
  try {
    const sheetInfo = await getSheetInfo(sheetId);
    const { sheets, sheetName } = sheetInfo;
    
    // Read summary data from rows 1-3
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!A1:B3`, // Read only columns A and B for the summary
    });
    
    const values = response.data.values || [];
    
    // Default values
    let pemasukan = 0;
    let pengeluaran = 0;
    let saldo = 0;
    
    // Parse the summary data
    if (values.length >= 3) {
      pemasukan = parseFloat(values[0]?.[1]) || 0; // Row 1, Column B (Pemasukan)
      pengeluaran = parseFloat(values[1]?.[1]) || 0; // Row 2, Column B (Pengeluaran)
      saldo = parseFloat(values[2]?.[1]) || 0; // Row 3, Column B (Saldo)
    }
    
    return {
      pemasukan,
      pengeluaran,
      saldo
    };
  } catch (error) {
    console.error("Error getting summary data:", error);
    throw new Error("Failed to retrieve summary data from sheet");
  }
}

// ===== GOOGLE SHEET VALIDATION =====
export async function validateGoogleSheetId(sheetId) {
  try {
    await getSheetInfo(sheetId);
    return true;
  } catch (error) {
    console.error("Sheet ID validation error:", error);
    return false;
  }
}
