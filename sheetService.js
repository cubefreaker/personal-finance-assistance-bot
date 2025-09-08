import { google } from "googleapis";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";

// ===== GOOGLE SHEETS =====
let auth;
let sheets;

async function initializeAuth() {
  if (!auth) {
    try {
      // Try to get credentials from Secret Manager first
      const client = new SecretManagerServiceClient();
      const [version] = await client.accessSecretVersion({
        name: "projects/hamzah-dev/secrets/PersonalFinanceBotSecret/versions/latest",
      });
      const credentials = JSON.parse(version.payload.data.toString());
      
      auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    } catch (error) {
      console.log("Secret Manager not available, falling back to keyFile");
      // Fallback to keyFile for local development
      auth = new google.auth.GoogleAuth({
        keyFile: "creds.json",
        scopes: ["https://www.googleapis.com/auth/spreadsheets"],
      });
    }
    sheets = google.sheets({ version: "v4", auth });
  }
  return { auth, sheets };
}
export async function saveToSheet({ date, text, amount, dbcr, category }, sheetId) {
  const { sheets } = await initializeAuth();
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
