// PDS Time Tracking System - AES-256 Encryption Utilities
// Secure PII data encryption/decryption for compliance

import CryptoJS from 'crypto-js';

/**
 * Get encryption key from environment
 * Must be 256-bit (32 characters) for AES-256
 */
const getEncryptionKey = (): string => {
  const key = process.env.ENCRYPTION_KEY;
  
  if (!key) {
    throw new Error('ENCRYPTION_KEY environment variable is required');
  }
  
  if (key.length < 32) {
    throw new Error('ENCRYPTION_KEY must be at least 32 characters for AES-256');
  }
  
  return key;
};

/**
 * Encrypt sensitive PII data using AES-256
 * @param plaintext - The data to encrypt
 * @returns Base64 encoded encrypted string
 */
export const encrypt = (plaintext: string): string => {
  if (!plaintext) {
    return '';
  }

  try {
    const key = getEncryptionKey();
    const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    
    return encrypted.toString();
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
};

/**
 * Decrypt sensitive PII data
 * @param ciphertext - Base64 encoded encrypted string
 * @returns Decrypted plaintext
 */
export const decrypt = (ciphertext: string): string => {
  if (!ciphertext) {
    return '';
  }

  try {
    const key = getEncryptionKey();
    const decrypted = CryptoJS.AES.decrypt(ciphertext, key, {
      mode: CryptoJS.mode.CBC,
      padding: CryptoJS.pad.Pkcs7,
    });
    
    const plaintext = decrypted.toString(CryptoJS.enc.Utf8);
    
    if (!plaintext) {
      throw new Error('Decryption resulted in empty string');
    }
    
    return plaintext;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
};

/**
 * Hash sensitive data (one-way, for PINs, passwords)
 * Uses PBKDF2 with SHA-256
 * @param data - The data to hash
 * @param salt - Optional salt (generated if not provided)
 * @returns Object with hash and salt
 */
export const hash = (data: string, salt?: string): { hash: string; salt: string } => {
  try {
    const useSalt = salt || CryptoJS.lib.WordArray.random(128 / 8).toString();
    const key = getEncryptionKey();
    
    const hashed = CryptoJS.PBKDF2(data, useSalt + key, {
      keySize: 256 / 32,
      iterations: 10000,
      hasher: CryptoJS.algo.SHA256,
    });
    
    return {
      hash: hashed.toString(),
      salt: useSalt,
    };
  } catch (error) {
    console.error('Hashing error:', error);
    throw new Error('Failed to hash data');
  }
};

/**
 * Verify hashed data (for PIN/password verification)
 * @param data - The plaintext data to verify
 * @param hashedData - The hash to compare against
 * @param salt - The salt used in original hash
 * @returns True if data matches hash
 */
export const verify = (data: string, hashedData: string, salt: string): boolean => {
  try {
    const { hash: newHash } = hash(data, salt);
    return newHash === hashedData;
  } catch (error) {
    console.error('Verification error:', error);
    return false;
  }
};

/**
 * Encrypt object (for JSON data)
 * @param obj - Object to encrypt
 * @returns Encrypted string
 */
export const encryptObject = (obj: Record<string, any>): string => {
  const jsonString = JSON.stringify(obj);
  return encrypt(jsonString);
};

/**
 * Decrypt object (for JSON data)
 * @param encrypted - Encrypted string
 * @returns Decrypted object
 */
export const decryptObject = <T = Record<string, any>>(encrypted: string): T => {
  const jsonString = decrypt(encrypted);
  return JSON.parse(jsonString) as T;
};

/**
 * Redact sensitive data for logging
 * Shows only first and last character
 * @param data - Data to redact
 * @returns Redacted string
 */
export const redact = (data: string): string => {
  if (!data || data.length < 3) {
    return '***';
  }
  
  const first = data.charAt(0);
  const last = data.charAt(data.length - 1);
  const middle = '*'.repeat(data.length - 2);
  
  return `${first}${middle}${last}`;
};

/**
 * Mask email for display (show first letter and domain)
 * @param email - Email to mask
 * @returns Masked email
 */
export const maskEmail = (email: string): string => {
  if (!email || !email.includes('@')) {
    return '***@***.***';
  }
  
  const [local, domain] = email.split('@');
  const maskedLocal = local.charAt(0) + '***';
  
  return `${maskedLocal}@${domain}`;
};

/**
 * Mask phone number for display
 * @param phone - Phone number to mask
 * @returns Masked phone
 */
export const maskPhone = (phone: string): string => {
  if (!phone || phone.length < 4) {
    return '***-***-****';
  }
  
  const last4 = phone.slice(-4);
  return `***-***-${last4}`;
};


