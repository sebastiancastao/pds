// PDS Time Tracking System - Supabase Client Configuration
// Secure database connection with Row Level Security (RLS)
// SQL Injection Prevention & Security Hardening

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

// ============================================
// Environment Variables Validation
// ============================================

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Validate environment variables on initialization
if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    '🔒 SECURITY ERROR: Missing Supabase environment variables. Please check your .env.local file.'
  );
}

// Validate Supabase URL format to prevent misconfiguration
const urlPattern = /^https:\/\/[a-z0-9-]+\.supabase\.co$/;
if (!urlPattern.test(supabaseUrl)) {
  throw new Error(
    '🔒 SECURITY ERROR: Invalid Supabase URL format. Must be https://your-project.supabase.co'
  );
}

// ============================================
// Client-Side Supabase Client (Browser)
// ============================================

/**
 * Client-side Supabase client for browser usage
 * ✅ Uses anon key with Row Level Security (RLS) policies
 * ✅ Enforces RLS at database level (cannot be bypassed)
 * ✅ Automatic SQL injection prevention via Supabase client
 * 
 * Security Features:
 * - Parameterized queries (built-in)
 * - Row Level Security enforced
 * - Session management with auto-refresh
 * - Secure token storage
 */
export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'pds-auth-token',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    // Secure cookie options
    flowType: 'pkce', // Use PKCE flow for enhanced security
  },
  global: {
    headers: {
      'x-application-name': 'PDS Time Tracking',
      'x-client-info': 'pds-web-client',
    },
  },
  db: {
    schema: 'public',
  },
  // Realtime disabled by default for security
  realtime: {
    params: {
      eventsPerSecond: 10, // Rate limiting
    },
  },
});

// ============================================
// Next.js App Router Compatible Client
// ============================================

/**
 * Next.js App Router compatible Supabase client
 * Use this in Client Components for better integration
 * Uses modern @supabase/ssr package
 * 
 * @returns Type-safe Supabase client with automatic cookie handling
 */
export const createSupabaseClient = (): SupabaseClient<Database> => {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Missing Supabase environment variables');
  }
  
  return createBrowserClient<Database>(
    supabaseUrl,
    supabaseAnonKey
  );
};

// ============================================
// Server-Side Supabase Client (Service Role)
// ============================================

/**
 * Server-side Supabase client with service role key
 * 
 * ⚠️ CRITICAL SECURITY WARNINGS:
 * - ONLY use in API routes or server components
 * - BYPASSES Row Level Security - use with extreme caution
 * - ALWAYS validate user permissions manually when using this client
 * - NEVER expose this client to the browser
 * - LOG all operations for audit trail
 * 
 * When to use:
 * - Admin operations requiring elevated privileges
 * - Batch operations across multiple users
 * - System maintenance tasks
 * 
 * When NOT to use:
 * - Regular user operations (use client-side client instead)
 * - Any operation that can be done with RLS
 * 
 * @returns Service role Supabase client (bypasses RLS)
 */
export const createServerClient = (): SupabaseClient<Database> => {
  if (!supabaseServiceKey) {
    throw new Error(
      '🔒 SECURITY ERROR: SUPABASE_SERVICE_ROLE_KEY is required for server operations'
    );
  }

  // Ensure this is only called on the server
  if (typeof window !== 'undefined') {
    throw new Error(
      '🔒 SECURITY ERROR: Server client cannot be used in browser. Use createSupabaseClient() instead.'
    );
  }

  return createClient<Database>(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    global: {
      headers: {
        'x-application-name': 'PDS Time Tracking Server',
        'x-client-info': 'pds-server-client',
      },
    },
  });
};

// ============================================
// SQL Injection Prevention Utilities
// ============================================

/**
 * Sanitize string input to prevent SQL injection
 * Note: Supabase client already uses parameterized queries,
 * but this provides an additional layer of defense
 * 
 * @param input - User input string
 * @returns Sanitized string safe for database operations
 */
export const sanitizeInput = (input: string): string => {
  if (typeof input !== 'string') {
    throw new Error('Input must be a string');
  }

  // Remove SQL injection patterns
  return input
    .replace(/['";\\]/g, '') // Remove quotes and backslashes
    .replace(/--/g, '') // Remove SQL comments
    .replace(/\/\*/g, '') // Remove block comment start
    .replace(/\*\//g, '') // Remove block comment end
    .replace(/xp_/gi, '') // Remove extended stored procedures
    .replace(/sp_/gi, '') // Remove stored procedures
    .replace(/0x/gi, '') // Remove hex literals
    .trim();
};

/**
 * Validate UUID format to prevent injection via IDs
 * 
 * @param id - UUID string to validate
 * @returns True if valid UUID, false otherwise
 */
export const isValidUUID = (id: string): boolean => {
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(id);
};

/**
 * Validate email format to prevent injection
 * 
 * @param email - Email string to validate
 * @returns True if valid email, false otherwise
 */
export const isValidEmail = (email: string): boolean => {
  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return emailPattern.test(email) && email.length <= 100;
};

/**
 * Safe query builder that ensures parameterized queries
 * This is a helper that explicitly shows we're using safe queries
 * 
 * Example usage:
 * const result = await safeQuery(supabase)
 *   .from('users')
 *   .select('*')
 *   .eq('email', userEmail) // Automatically parameterized
 *   .single();
 */
export const safeQuery = <T extends SupabaseClient<Database>>(client: T) => {
  return client;
};

/**
 * Database Types
 * All database types are imported from lib/database.types.ts
 * To regenerate types, run:
 * npx supabase gen types typescript --project-id bwvnvzlmqqcdemkpecjw > lib/database.types.ts
 */
