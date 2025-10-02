// PDS Time Tracking System - Authentication Utilities
// PIN, QR Code, and 2FA authentication helpers

import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { hash, verify } from './encryption';

/**
 * Generate a 6-digit PIN for worker authentication
 * @returns 6-digit PIN string
 */
export const generatePIN = (): string => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * Hash PIN for secure storage
 * @param pin - 6-digit PIN
 * @returns Hashed PIN with salt
 */
export const hashPIN = (pin: string): { hash: string; salt: string } => {
  if (!/^\d{6}$/.test(pin)) {
    throw new Error('PIN must be exactly 6 digits');
  }
  
  return hash(pin);
};

/**
 * Verify PIN against stored hash
 * @param pin - PIN to verify
 * @param hashedPIN - Stored hash
 * @param salt - Stored salt
 * @returns True if PIN is valid
 */
export const verifyPIN = (pin: string, hashedPIN: string, salt: string): boolean => {
  if (!/^\d{6}$/.test(pin)) {
    return false;
  }
  
  return verify(pin, hashedPIN, salt);
};

/**
 * Generate QR code data for worker authentication
 * @param userId - User ID
 * @returns QR code data string
 */
export const generateQRCodeData = (userId: string): string => {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 15);
  
  return `PDS-${userId}-${timestamp}-${random}`;
};

/**
 * Generate QR code image as data URL
 * @param data - QR code data
 * @returns Promise resolving to data URL
 */
export const generateQRCodeImage = async (data: string): Promise<string> => {
  try {
    const dataUrl = await QRCode.toDataURL(data, {
      errorCorrectionLevel: 'H',
      type: 'image/png',
      width: 300,
      margin: 2,
    });
    
    return dataUrl;
  } catch (error) {
    console.error('QR code generation error:', error);
    throw new Error('Failed to generate QR code');
  }
};

/**
 * Generate 2FA secret for admin users
 * @param userEmail - User's email
 * @returns TOTP secret
 */
export const generate2FASecret = (userEmail: string): {
  secret: string;
  otpauthUrl: string;
} => {
  const secret = speakeasy.generateSecret({
    name: `PDS Time Tracking (${userEmail})`,
    issuer: process.env.TOTP_ISSUER || 'PDS Time Tracking',
    length: 32,
  });
  
  return {
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url || '',
  };
};

/**
 * Generate QR code for 2FA setup
 * @param otpauthUrl - TOTP URL
 * @returns Promise resolving to QR code data URL
 */
export const generate2FAQRCode = async (otpauthUrl: string): Promise<string> => {
  return generateQRCodeImage(otpauthUrl);
};

/**
 * Verify 2FA token
 * @param token - 6-digit TOTP token
 * @param secret - User's 2FA secret
 * @returns True if token is valid
 */
export const verify2FAToken = (token: string, secret: string): boolean => {
  if (!/^\d{6}$/.test(token)) {
    return false;
  }
  
  return speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: token,
    window: parseInt(process.env.TOTP_WINDOW || '1'),
  });
};

/**
 * Role-based permission checker
 */
export enum Permission {
  // Worker permissions
  CLOCK_IN_OUT = 'clock_in_out',
  VIEW_OWN_EVENTS = 'view_own_events',
  VIEW_OWN_PAY = 'view_own_pay',
  UPDATE_AVAILABILITY = 'update_availability',
  
  // Manager permissions
  CREATE_EVENTS = 'create_events',
  ASSIGN_STAFF = 'assign_staff',
  APPROVE_TIMESHEETS = 'approve_timesheets',
  VIEW_VENUE_CALENDAR = 'view_venue_calendar',
  
  // Finance permissions
  APPROVE_PAYOUTS = 'approve_payouts',
  VIEW_PAYROLL = 'view_payroll',
  EXPORT_ADP = 'export_adp',
  
  // Exec permissions
  VIEW_GLOBAL_CALENDAR = 'view_global_calendar',
  VIEW_ALL_REPORTS = 'view_all_reports',
  MANAGE_USERS = 'manage_users',
  
  // Admin permissions
  VIEW_AUDIT_LOGS = 'view_audit_logs',
  MANAGE_SECURITY = 'manage_security',
}

export type UserRole = 'worker' | 'manager' | 'finance' | 'exec';

const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  worker: [
    Permission.CLOCK_IN_OUT,
    Permission.VIEW_OWN_EVENTS,
    Permission.VIEW_OWN_PAY,
    Permission.UPDATE_AVAILABILITY,
  ],
  manager: [
    Permission.CLOCK_IN_OUT,
    Permission.VIEW_OWN_EVENTS,
    Permission.VIEW_OWN_PAY,
    Permission.UPDATE_AVAILABILITY,
    Permission.CREATE_EVENTS,
    Permission.ASSIGN_STAFF,
    Permission.APPROVE_TIMESHEETS,
    Permission.VIEW_VENUE_CALENDAR,
  ],
  finance: [
    Permission.APPROVE_PAYOUTS,
    Permission.VIEW_PAYROLL,
    Permission.EXPORT_ADP,
    Permission.VIEW_ALL_REPORTS,
  ],
  exec: [
    Permission.VIEW_GLOBAL_CALENDAR,
    Permission.VIEW_ALL_REPORTS,
    Permission.MANAGE_USERS,
    Permission.VIEW_AUDIT_LOGS,
    Permission.MANAGE_SECURITY,
  ],
};

/**
 * Check if user has permission
 * @param role - User's role
 * @param permission - Permission to check
 * @returns True if user has permission
 */
export const hasPermission = (role: UserRole, permission: Permission): boolean => {
  return ROLE_PERMISSIONS[role]?.includes(permission) || false;
};

/**
 * Check if user has any of the specified permissions
 * @param role - User's role
 * @param permissions - Permissions to check
 * @returns True if user has at least one permission
 */
export const hasAnyPermission = (role: UserRole, permissions: Permission[]): boolean => {
  return permissions.some((permission) => hasPermission(role, permission));
};

/**
 * Check if user has all specified permissions
 * @param role - User's role
 * @param permissions - Permissions to check
 * @returns True if user has all permissions
 */
export const hasAllPermissions = (role: UserRole, permissions: Permission[]): boolean => {
  return permissions.every((permission) => hasPermission(role, permission));
};


