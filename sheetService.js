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
 * Test if a formula works correctly by writing it to a test cell and checking for errors
 * @param {Object} sheets - Google Sheets API instance
 * @param {string} sheetId - The Google Sheet ID
 * @param {string} sheetName - The sheet name
 * @param {string} testFormula - The formula to test
 * @returns {boolean} - True if formula works without errors, false otherwise
 */
async function testFormula(sheets, sheetId, sheetName, testFormula) {
  try {
    // Write the test formula to a temporary cell (Z1)
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${sheetName}!Z1`,
      valueInputOption: 'USER_ENTERED',
      requestBody: {
        values: [[testFormula]]
      }
    });
    
    // Wait a moment for the formula to calculate
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Read the cell value to check for errors
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!Z1`
    });
    
    const cellValue = response.data.values?.[0]?.[0];
    
    // Check if the cell contains an error (starts with #)
    const hasError = cellValue && cellValue.toString().startsWith('#');
    
    // Clean up the test cell
    await sheets.spreadsheets.values.clear({
      spreadsheetId: sheetId,
      range: `${sheetName}!Z1`
    });
    
    return !hasError;
  } catch (error) {
    console.warn('Error testing formula:', error.message);
    return false;
  }
}

/**
 * Detect the correct formula separator by testing actual formulas
 * @param {Object} sheets - Google Sheets API instance
 * @param {string} sheetId - The Google Sheet ID
 * @param {string} sheetName - The sheet name
 * @returns {string} - The appropriate separator (',' or ';')
 */
async function detectFormulaSeparator(sheets, sheetId, sheetName) {
  // Test formulas with both separators
  const testFormulas = {
    comma: '=SUMIF(D6:D,"debit",C6:C)',
    semicolon: '=SUMIF(D6:D;"debit";C6:C)'
  };
  
  // Try comma separator first (most common)
  const commaWorks = await testFormula(sheets, sheetId, sheetName, testFormulas.comma);
  if (commaWorks) {
    console.log('✅ Comma separator works for this sheet');
    return ',';
  }
  
  // Try semicolon separator
  const semicolonWorks = await testFormula(sheets, sheetId, sheetName, testFormulas.semicolon);
  if (semicolonWorks) {
    console.log('✅ Semicolon separator works for this sheet');
    return ';';
  }
  
  // If both fail, default to comma and log warning
  console.warn('⚠️ Both separators failed, defaulting to comma');
  return ',';
}

/**
 * Verify that the written formulas are working correctly and fix them if needed
 * @param {Object} sheets - Google Sheets API instance
 * @param {string} sheetId - The Google Sheet ID
 * @param {string} sheetName - The sheet name
 * @param {string} currentSeparator - The separator that was used
 */
async function verifyFormulasWork(sheets, sheetId, sheetName, currentSeparator) {
  try {
    // Wait a moment for formulas to calculate
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Read the formula cells to check for errors
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${sheetName}!B1:B3`
    });
    
    const values = response.data.values || [];
    let needsFix = false;
    
    // Check if any formula cells contain errors
    for (let i = 0; i < values.length; i++) {
      const cellValue = values[i]?.[0];
      if (cellValue && cellValue.toString().startsWith('#')) {
        console.warn(`⚠️ Formula error detected in cell B${i + 1}: ${cellValue}`);
        needsFix = true;
      }
    }
    
    // If formulas have errors, try the other separator
    if (needsFix) {
      console.log('🔄 Attempting to fix formulas with alternative separator...');
      const alternativeSeparator = currentSeparator === ',' ? ';' : ',';
      
      const fixedUpdates = [
        {
          range: `${sheetName}!B1:B2`,
          values: [
            [`=SUMIF(D6:D${alternativeSeparator}"debit"${alternativeSeparator}C6:C)`], // Pemasukan
            [`=ABS(SUMIF(D6:D${alternativeSeparator}"credit"${alternativeSeparator}C6:C))`] // Pengeluaran
          ]
        }
      ];
      
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: fixedUpdates
        }
      });
      
      console.log(`✅ Formulas fixed using ${alternativeSeparator} separator`);
    } else {
      console.log('✅ All formulas are working correctly');
    }
  } catch (error) {
    console.warn('Error verifying formulas:', error.message);
  }
}

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
  
  // Detect the appropriate formula separator by testing actual formulas
  const separator = await detectFormulaSeparator(sheets, sheetId, sheetName);
  
  // Prepare all data to write with formulas using the detected separator
  const updates = [
    {
      range: `${sheetName}!A1:F3`,
      values: [
        ["Pemasukan", `=SUMIF(D6:D${separator}"debit"${separator}C6:C)`, "", "", "", ""], // Formula to sum all debit amounts
        ["Pengeluaran", `=ABS(SUMIF(D6:D${separator}"credit"${separator}C6:C))`, "", "", "", ""], // Formula to sum all credit amounts (absolute value)
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
  
  // Verify that the formulas are working correctly
  await verifyFormulasWork(sheets, sheetId, sheetName, separator);
  
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
