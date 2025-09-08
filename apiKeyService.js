import { Firestore } from '@google-cloud/firestore';
import { SecretManagerServiceClient } from '@google-cloud/secret-manager';
import crypto from 'crypto';

let firestore;

async function initializeFirestore() {
  if (!firestore) {
    try {
      // Try to get credentials from Secret Manager first
      const client = new SecretManagerServiceClient();
      const secretPath = process.env.SECRET_PATH || "projects/hamzah-dev/secrets/PersonalFinanceBotSecret/versions/latest";
      const [version] = await client.accessSecretVersion({
        name: secretPath,
      });
      const credentials = JSON.parse(version.payload.data.toString());
      
      firestore = new Firestore({
        projectId: 'hamzah-dev',
        credentials
      });
    } catch (error) {
      console.log("Error initializing Firestore:", error);
      // Fallback to keyFile for local development
      firestore = new Firestore({
        projectId: 'hamzah-dev',
        keyFilename: 'creds.json'
      });
    }
  }
  return firestore;
}

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
  try {
    // Validate encrypted text format
    if (!encryptedText || typeof encryptedText !== 'string') {
      throw new Error('Invalid encrypted text: not a string or empty');
    }
    
    const textParts = encryptedText.split(':');
    if (textParts.length < 2) {
      throw new Error('Invalid encrypted text format: missing IV or data');
    }
    
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedData = textParts.join(':');
    
    // Validate IV length (should be 16 bytes for AES-256-CBC)
    if (iv.length !== 16) {
      throw new Error('Invalid IV length: expected 16 bytes');
    }
    
    // Validate encrypted data is not empty
    if (!encryptedData) {
      throw new Error('Invalid encrypted data: empty');
    }
    
    const key = crypto.scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    console.error('Decryption error details:', {
      error: error.message,
      encryptedTextLength: encryptedText ? encryptedText.length : 0,
      encryptionKeyLength: ENCRYPTION_KEY ? ENCRYPTION_KEY.length : 0,
      encryptionKeyPrefix: ENCRYPTION_KEY ? ENCRYPTION_KEY.substring(0, 8) + '...' : 'undefined'
    });
    throw new Error(`Decryption failed: ${error.message}. This usually means the ENCRYPTION_KEY environment variable has changed or the encrypted data is corrupted.`);
  }
}

export async function saveApiKey(userId, apiKey) {
  try {
    const db = await initializeFirestore();
    const encryptedApiKey = encrypt(apiKey);
    await db.collection('user_api_keys').doc(userId.toString()).set({
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
    const db = await initializeFirestore();
    await db.collection('user_api_keys').doc(userId.toString()).set({
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
    const db = await initializeFirestore();
    const doc = await db.collection('user_api_keys').doc(userId.toString()).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data();
    
    if (!data.apiKey) {
      console.error('No API key found in document for user:', userId);
      return null;
    }
    
    return decrypt(data.apiKey);
  } catch (error) {
    console.error('Error retrieving API key for user:', userId, error);
    
    // If it's a decryption error, log additional context
    if (error.message.includes('Decryption failed')) {
      console.error('Decryption failed for user:', userId, {
        hasEncryptionKey: !!ENCRYPTION_KEY,
        encryptionKeyLength: ENCRYPTION_KEY ? ENCRYPTION_KEY.length : 0,
        environment: process.env.NODE_ENV || 'development'
      });
    }
    
    return null;
  }
}

export async function getSheetId(userId) {
  try {
    const db = await initializeFirestore();
    const doc = await db.collection('user_api_keys').doc(userId.toString()).get();
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
    const db = await initializeFirestore();
    const doc = await db.collection('user_api_keys').doc(userId.toString()).get();
    return doc.exists && doc.data().apiKey;
  } catch (error) {
    console.error('Error checking API key existence:', error);
    return false;
  }
}

export async function hasSheetId(userId) {
  try {
    const db = await initializeFirestore();
    const doc = await db.collection('user_api_keys').doc(userId.toString()).get();
    return doc.exists && doc.data().sheetId;
  } catch (error) {
    console.error('Error checking sheet ID existence:', error);
    return false;
  }
}

export async function isUserSetupComplete(userId) {
  try {
    const db = await initializeFirestore();
    const doc = await db.collection('user_api_keys').doc(userId.toString()).get();
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
    const db = await initializeFirestore();
    await db.collection('user_api_keys').doc(userId.toString()).delete();
    return true;
  } catch (error) {
    console.error('Error deleting API key:', error);
    return false;
  }
}

/**
 * Debug function to check encryption/decryption status
 * This helps diagnose issues with the ENCRYPTION_KEY
 */
export async function debugEncryptionStatus(userId) {
  try {
    const db = await initializeFirestore();
    const doc = await db.collection('user_api_keys').doc(userId.toString()).get();
    
    if (!doc.exists) {
      return { status: 'no_document', message: 'User document does not exist' };
    }
    
    const data = doc.data();
    if (!data.apiKey) {
      return { status: 'no_api_key', message: 'No API key found in document' };
    }
    
    // Try to decrypt
    try {
      const decrypted = decrypt(data.apiKey);
      return { 
        status: 'success', 
        message: 'Decryption successful',
        encryptedLength: data.apiKey.length,
        decryptedLength: decrypted.length
      };
    } catch (decryptError) {
      return {
        status: 'decrypt_failed',
        message: decryptError.message,
        encryptedLength: data.apiKey.length,
        encryptionKeyLength: ENCRYPTION_KEY ? ENCRYPTION_KEY.length : 0,
        hasEncryptionKey: !!ENCRYPTION_KEY
      };
    }
  } catch (error) {
    return { status: 'error', message: error.message };
  }
}
