// PDS Time Keeping System - Authentication Utilities
// Email/Password + MFA authentication for all users

import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

/**
 * Password strength levels
 */
export type PasswordStrength = 'weak' | 'medium' | 'strong' | 'very-strong';

/**
 * Password validation result
 */
export interface PasswordValidation {
  isValid: boolean;
  strength: PasswordStrength;
  errors: string[];
}

/**
 * Validate password strength and requirements
 * @param password - Password to validate
 * @returns Validation result with strength and errors
 */
export const validatePassword = (password: string): PasswordValidation => {
  const errors: string[] = [];
  let strengthScore = 0;

  // Length checks
  if (password.length < 12) {
    errors.push('Password must be at least 12 characters long');
  } else {
    strengthScore++;
    if (password.length >= 16) strengthScore++;
    if (password.length >= 20) strengthScore++;
  }

  // Character type checks
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  } else {
    strengthScore++;
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  } else {
    strengthScore++;
  }

  if (!/\d/.test(password)) {
    errors.push('Password must contain at least one number');
  } else {
    strengthScore++;
  }

  if (!/[@$!%*?&#^()_+\-=\[\]{};':"\\|,.<>\/]/.test(password)) {
    errors.push('Password must contain at least one special character (@$!%*?&#^()_+-=[]{};\':"|,.<>/)');
  } else {
    strengthScore++;
  }

  // Determine strength
  let strength: PasswordStrength = 'weak';
  if (strengthScore >= 7) strength = 'very-strong';
  else if (strengthScore >= 5) strength = 'strong';
  else if (strengthScore >= 4) strength = 'medium';

  return {
    isValid: errors.length === 0,
    strength,
    errors,
  };
};

/**
 * Hash password using bcrypt
 * @param password - Plain text password
 * @returns Hashed password
 */
export const hashPassword = async (password: string): Promise<string> => {
  const saltRounds = 12; // Increased from default 10 for better security
  return bcrypt.hash(password, saltRounds);
};

/**
 * Verify password against hash
 * @param password - Plain text password
 * @param hash - Stored hash
 * @returns True if password matches
 */
export const verifyPassword = async (password: string, hash: string): Promise<boolean> => {
  return bcrypt.compare(password, hash);
};

/**
 * Generate MFA secret for user
 * @param userEmail - User's email
 * @returns MFA secret and QR code URL
 */
export const generateMFASecret = (userEmail: string): {
  secret: string;
  otpauthUrl: string;
} => {
  const secret = speakeasy.generateSecret({
    name: `PDS Time Keeping (${userEmail})`,
    issuer: process.env.TOTP_ISSUER || 'PDS Time Keeping ',
    length: 32,
  });
  
  return {
    secret: secret.base32,
    otpauthUrl: secret.otpauth_url || '',
  };
};

/**
 * Generate QR code for MFA setup
 * @param otpauthUrl - TOTP URL
 * @returns Promise resolving to QR code data URL
 */
export const generateMFAQRCode = async (otpauthUrl: string): Promise<string> => {
  try {
    const dataUrl = await QRCode.toDataURL(otpauthUrl, {
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
 * Verify MFA token
 * @param token - 6-digit TOTP token
 * @param secret - User's MFA secret
 * @returns True if token is valid
 */
export const verifyMFAToken = (token: string, secret: string): boolean => {
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
 * Generate backup codes for MFA
 * @returns Array of 10 backup codes (format: A1B2C3D4)
 */
export const generateBackupCodes = (): string[] => {
  const codes: string[] = [];
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  
  for (let i = 0; i < 10; i++) {
    let code = '';
    for (let j = 0; j < 8; j++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    codes.push(code);
  }
  
  return codes;
};

/**
 * Hash backup codes for secure storage
 * @param codes - Array of backup codes
 * @returns Array of hashed codes
 */
export const hashBackupCodes = async (codes: string[]): Promise<string[]> => {
  return Promise.all(codes.map(code => bcrypt.hash(code, 10)));
};

/**
 * Verify backup code against stored hashes
 * @param code - Backup code to verify
 * @param hashedCodes - Array of hashed backup codes
 * @returns Index of matching code, or -1 if not found
 */
export const verifyBackupCode = async (
  code: string,
  hashedCodes: string[]
): Promise<number> => {
  for (let i = 0; i < hashedCodes.length; i++) {
    const isMatch = await bcrypt.compare(code, hashedCodes[i]);
    if (isMatch) {
      return i;
    }
  }
  return -1;
};

/**
 * Generate password reset token
 * @returns Secure random token
 */
export const generatePasswordResetToken = (): string => {
  return crypto.randomBytes(32).toString('hex');
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

/**
 * Generate a 6-digit email verification code
 * @returns 6-digit numeric code as string
 */
export const generateEmailMFACode = (): string => {
  return crypto.randomInt(100000, 999999).toString();
};

/**
 * Hash email MFA code for storage
 * @param code - 6-digit verification code
 * @returns Promise resolving to hashed code
 */
export const hashEmailMFACode = async (code: string): Promise<string> => {
  return bcrypt.hash(code, 10);
};

/**
 * Verify email MFA code against stored hash
 * @param code - 6-digit verification code
 * @param hashedCode - Stored hash
 * @returns Promise resolving to true if code matches
 */
export const verifyEmailMFACode = async (code: string, hashedCode: string): Promise<boolean> => {
  return bcrypt.compare(code, hashedCode);
};


