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
