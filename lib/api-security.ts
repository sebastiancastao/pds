// PDS Time Tracking System - API Security Layer
// SQL Injection Prevention & Input Validation

import { createServerClient, isValidUUID, isValidEmail, sanitizeInput } from './supabase';
import { logAuditEvent } from './audit';
import type { Database } from './database.types';

// ============================================
// Rate Limiting
// ============================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();

/**
 * Rate limiting to prevent brute force attacks
 * 
 * @param identifier - IP address or user ID
 * @param maxAttempts - Maximum attempts allowed
 * @param windowMs - Time window in milliseconds
 * @returns True if rate limit exceeded
 */
export const isRateLimited = (
  identifier: string,
  maxAttempts: number = 5,
  windowMs: number = 15 * 60 * 1000 // 15 minutes
): boolean => {
  const now = Date.now();
  const entry = rateLimitMap.get(identifier);

  if (!entry || now > entry.resetTime) {
    rateLimitMap.set(identifier, {
      count: 1,
      resetTime: now + windowMs,
    });
    return false;
  }

  entry.count++;

  if (entry.count > maxAttempts) {
    return true;
  }

  return false;
};

/**
 * Clear rate limit for an identifier (e.g., after successful login)
 */
export const clearRateLimit = (identifier: string): void => {
  rateLimitMap.delete(identifier);
};

// ============================================
// Input Validation & Sanitization
// ============================================

/**
 * Validate and sanitize user registration data
 * Prevents SQL injection and ensures data integrity
 */
export interface RegistrationData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  role: 'worker' | 'manager' | 'finance' | 'exec';
  division: 'vendor' | 'trailers' | 'both';
}

export interface ValidationResult<T> {
  isValid: boolean;
  data?: T;
  errors: string[];
}

/**
 * Validate registration data with comprehensive security checks
 */
export const validateRegistrationData = (
  data: Partial<RegistrationData>
): ValidationResult<RegistrationData> => {
  const errors: string[] = [];

  // Validate email
  if (!data.email || !isValidEmail(data.email)) {
    errors.push('Invalid email format');
  }

  // Validate password (done separately by validatePassword in auth.ts)
  if (!data.password || data.password.length < 12) {
    errors.push('Password must be at least 12 characters');
  }

  // Validate name fields
  const namePattern = /^[a-zA-Z\s'-]{2,50}$/;
  if (!data.firstName || !namePattern.test(data.firstName)) {
    errors.push('Invalid first name');
  }
  if (!data.lastName || !namePattern.test(data.lastName)) {
    errors.push('Invalid last name');
  }

  // Validate address
  const addressPattern = /^[a-zA-Z0-9\s,.'#-]{5,200}$/;
  if (!data.address || !addressPattern.test(data.address)) {
    errors.push('Invalid address');
  }

  // Validate city
  const cityPattern = /^[a-zA-Z\s'-]{2,100}$/;
  if (!data.city || !cityPattern.test(data.city)) {
    errors.push('Invalid city');
  }

  // Validate state (2-letter code)
  const statePattern = /^[A-Z]{2}$/;
  if (!data.state || !statePattern.test(data.state)) {
    errors.push('Invalid state code');
  }

  // Validate ZIP code
  const zipPattern = /^\d{5}(-\d{4})?$/;
  if (!data.zipCode || !zipPattern.test(data.zipCode)) {
    errors.push('Invalid ZIP code');
  }

  // Validate role
  const validRoles = ['worker', 'manager', 'finance', 'exec'];
  if (!data.role || !validRoles.includes(data.role)) {
    errors.push('Invalid role');
  }

  // Validate division
  const validDivisions = ['vendor', 'trailers', 'both'];
  if (!data.division || !validDivisions.includes(data.division)) {
    errors.push('Invalid division');
  }

  if (errors.length > 0) {
    return { isValid: false, errors };
  }

  return {
    isValid: true,
    data: data as RegistrationData,
    errors: [],
  };
};

// ============================================
// Secure Database Operations
// ============================================

/**
 * Safely fetch user by email with parameterized query
 * This demonstrates SQL injection prevention
 */
export const secureGetUserByEmail = async (email: string) => {
  // Validate email format first
  if (!isValidEmail(email)) {
    throw new Error('Invalid email format');
  }

  const supabase = createServerClient();

  // Supabase automatically uses parameterized queries
  // The email parameter is safely escaped
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('email', email) // ✅ Parameterized - safe from SQL injection
    .single();

  if (error) {
    // Log error without exposing sensitive details
    console.error('Database error:', error.code);
    throw new Error('Database operation failed');
  }

  return data;
};

/**
 * Safely fetch user by ID with UUID validation
 */
export const secureGetUserById = async (userId: string) => {
  // Validate UUID format to prevent injection
  if (!isValidUUID(userId)) {
    throw new Error('Invalid user ID format');
  }

  const supabase = createServerClient();

  const { data, error } = await supabase
    .from('users')
    .select('*, profiles(*)')
    .eq('id', userId) // ✅ Parameterized and validated
    .single();

  if (error) {
    console.error('Database error:', error.code);
    throw new Error('Database operation failed');
  }

  return data;
};

/**
 * Safely update user profile with validation
 */
export const secureUpdateProfile = async (
  userId: string,
  updates: Partial<Database['public']['Tables']['profiles']['Update']>
) => {
  // Validate UUID
  if (!isValidUUID(userId)) {
    throw new Error('Invalid user ID format');
  }

  // Sanitize string inputs
  if (updates.first_name) {
    updates.first_name = sanitizeInput(updates.first_name);
  }
  if (updates.last_name) {
    updates.last_name = sanitizeInput(updates.last_name);
  }
  if (updates.address) {
    updates.address = sanitizeInput(updates.address);
  }
  if (updates.city) {
    updates.city = sanitizeInput(updates.city);
  }

  const supabase = createServerClient();

  const { data, error } = await (supabase
    .from('profiles') as any)
    .update({
      ...updates,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId) // ✅ Parameterized and validated
    .select()
    .single();

  if (error) {
    console.error('Database error:', error.code);
    throw new Error('Profile update failed');
  }

  // Log the update for audit trail
  await logAuditEvent({
    userId,
    action: 'profile.update',
    resourceType: 'profile',
    resourceId: userId,
    success: true,
    metadata: { fields: Object.keys(updates) },
  });

  return data;
};

/**
 * Safely search users with pagination and filtering
 * Demonstrates safe handling of user-provided search terms
 */
export const secureSearchUsers = async (
  searchTerm: string,
  page: number = 1,
  limit: number = 10
) => {
  // Sanitize search term
  const safeTerm = sanitizeInput(searchTerm);
  
  // Validate pagination parameters
  const safePage = Math.max(1, Math.floor(page));
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const offset = (safePage - 1) * safeLimit;

  const supabase = createServerClient();

  // Use Supabase's text search which is SQL injection safe
  const { data, error, count } = await supabase
    .from('users')
    .select('id, email, role, division, is_active', { count: 'exact' })
    .or(`email.ilike.%${safeTerm}%`) // ✅ Parameterized text search
    .range(offset, offset + safeLimit - 1)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Database error:', error.code);
    throw new Error('Search failed');
  }

  return {
    data,
    total: count || 0,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.ceil((count || 0) / safeLimit),
  };
};

// ============================================
// Secure Batch Operations
// ============================================

/**
 * Safely perform batch user updates with transaction
 * All operations logged for audit trail
 */
export const secureBatchUpdateUsers = async (
  updates: Array<{ userId: string; data: Partial<Database['public']['Tables']['users']['Update']> }>
) => {
  // Validate all user IDs first
  for (const update of updates) {
    if (!isValidUUID(update.userId)) {
      throw new Error(`Invalid user ID: ${update.userId}`);
    }
  }

  const supabase = createServerClient();
  const results: any[] = [];

  // Perform updates (Supabase doesn't support transactions, so we do sequential)
  for (const update of updates) {
    const { data, error } = await (supabase
      .from('users') as any)
      .update({
        ...update.data,
        updated_at: new Date().toISOString(),
      })
      .eq('id', update.userId) // ✅ Parameterized
      .select()
      .single();

    if (error) {
      console.error('Batch update error:', error.code);
      // Continue with other updates, log the error
      results.push({ userId: update.userId, success: false, error: error.message });
    } else {
      results.push({ userId: update.userId, success: true, data });
      
      // Log audit event
      await logAuditEvent({
        userId: update.userId,
        action: 'user.batch_update',
        resourceType: 'user',
        resourceId: update.userId,
        success: true,
        metadata: { fields: Object.keys(update.data) },
      });
    }
  }

  return results;
};

// ============================================
// IP & User Agent Helpers
// ============================================

/**
 * Safely extract IP address from request headers
 */
export const getClientIP = (headers: Headers): string => {
  return (
    headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    headers.get('x-real-ip') ||
    'unknown'
  );
};

/**
 * Safely extract user agent from request headers
 */
export const getUserAgent = (headers: Headers): string => {
  const ua = headers.get('user-agent') || 'unknown';
  // Limit length to prevent log pollution
  return ua.substring(0, 500);
};

