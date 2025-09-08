import { google } from "googleapis";

// ===== GOOGLE SHEETS =====
const auth = new google.auth.GoogleAuth({
  keyFile: "creds.json",
  scopes: ["https://www.googleapis.com/auth/spreadsheets"],
});
const sheets = google.sheets({ version: "v4", auth });

export async function saveToSheet({ date, text, amount, dbcr, category }, sheetId) {
  const values = [[date, text, amount, dbcr, category]];
  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: "Transactions!A:D",
    valueInputOption: "USER_ENTERED",
    requestBody: { values },
  });
}

// ===== GOOGLE SHEET VALIDATION =====
export async function validateGoogleSheetId(sheetId) {
  try {
    await sheets.spreadsheets.get({
      spreadsheetId: sheetId,
    });
    return true;
  } catch (error) {
    console.error("Sheet ID validation error:", error);
    return false;
  }
}
