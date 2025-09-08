import { Firestore } from '@google-cloud/firestore';
import crypto from 'crypto';

const firestore = new Firestore({
  projectId: 'hamzah-dev',
  keyFilename: 'creds.json'
});

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'your-32-character-secret-key-here!'; // In production, use a proper secret
const ALGORITHM = 'aes-256-cbc';

function encrypt(text) {
  const iv = crypto.randomBytes(16);
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(encryptedText) {
  const textParts = encryptedText.split(':');
  const iv = Buffer.from(textParts.shift(), 'hex');
  const encryptedData = textParts.join(':');
  const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export async function saveApiKey(userId, apiKey) {
  try {
    const encryptedApiKey = encrypt(apiKey);
    await firestore.collection('user_api_keys').doc(userId.toString()).set({
      apiKey: encryptedApiKey,
      createdAt: new Date(),
      updatedAt: new Date()
    }, { merge: true });
    return true;
  } catch (error) {
    console.error('Error saving API key:', error);
    return false;
  }
}

export async function saveSheetId(userId, sheetId) {
  try {
    await firestore.collection('user_api_keys').doc(userId.toString()).set({
      sheetId: sheetId,
      updatedAt: new Date()
    }, { merge: true });
    return true;
  } catch (error) {
    console.error('Error saving sheet ID:', error);
    return false;
  }
}

export async function getApiKey(userId) {
  try {
    const doc = await firestore.collection('user_api_keys').doc(userId.toString()).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data();
    return decrypt(data.apiKey);
  } catch (error) {
    console.error('Error retrieving API key:', error);
    return null;
  }
}

export async function getSheetId(userId) {
  try {
    const doc = await firestore.collection('user_api_keys').doc(userId.toString()).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data();
    return data.sheetId || null;
  } catch (error) {
    console.error('Error retrieving sheet ID:', error);
    return null;
  }
}

export async function hasApiKey(userId) {
  try {
    const doc = await firestore.collection('user_api_keys').doc(userId.toString()).get();
    return doc.exists && doc.data().apiKey;
  } catch (error) {
    console.error('Error checking API key existence:', error);
    return false;
  }
}

export async function hasSheetId(userId) {
  try {
    const doc = await firestore.collection('user_api_keys').doc(userId.toString()).get();
    return doc.exists && doc.data().sheetId;
  } catch (error) {
    console.error('Error checking sheet ID existence:', error);
    return false;
  }
}

export async function isUserSetupComplete(userId) {
  try {
    const doc = await firestore.collection('user_api_keys').doc(userId.toString()).get();
    if (!doc.exists) return false;
    const data = doc.data();
    return !!(data.apiKey && data.sheetId);
  } catch (error) {
    console.error('Error checking user setup:', error);
    return false;
  }
}

export async function deleteApiKey(userId) {
  try {
    await firestore.collection('user_api_keys').doc(userId.toString()).delete();
    return true;
  } catch (error) {
    console.error('Error deleting API key:', error);
    return false;
  }
}
