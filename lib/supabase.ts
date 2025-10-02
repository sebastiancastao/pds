// PDS Time Tracking System - Supabase Client Configuration
// Secure database connection with Row Level Security (RLS)

import { createClient } from '@supabase/supabase-js';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';

// Environment variables validation
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    'Missing Supabase environment variables. Please check your .env.local file.'
  );
}

/**
 * Client-side Supabase client for browser usage
 * Uses anon key with Row Level Security (RLS) policies
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'pds-auth-token',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
  },
  global: {
    headers: {
      'x-application-name': 'PDS Time Tracking',
    },
  },
});

/**
 * Next.js App Router compatible Supabase client
 * Use this in Client Components
 */
export const createSupabaseClient = () => {
  return createClientComponentClient();
};

/**
 * Server-side Supabase client with service role key
 * ⚠️ ONLY use in API routes or server components
 * ⚠️ Bypasses Row Level Security - use with extreme caution
 */
export const createServerClient = () => {
  if (!supabaseServiceKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for server operations');
  }

  return createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
};

/**
 * Database Types
 * Run: npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/database.types.ts
 */
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          email: string;
          role: 'worker' | 'manager' | 'finance' | 'exec';
          division: 'vendor' | 'trailers' | 'both';
          created_at: string;
          updated_at: string;
          last_login: string | null;
          is_active: boolean;
        };
        Insert: Omit<Database['public']['Tables']['users']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['users']['Row']>;
      };
      profiles: {
        Row: {
          id: string;
          user_id: string;
          first_name: string; // Encrypted
          last_name: string; // Encrypted
          phone: string | null; // Encrypted
          address: string | null; // Encrypted
          city: string | null;
          state: string;
          zip_code: string | null;
          pin_hash: string | null;
          qr_code_data: string | null;
          onboarding_status: 'pending' | 'in_progress' | 'completed';
          onboarding_completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database['public']['Tables']['profiles']['Row'], 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Database['public']['Tables']['profiles']['Row']>;
      };
      audit_logs: {
        Row: {
          id: string;
          user_id: string | null;
          action: string;
          resource_type: string;
          resource_id: string | null;
          ip_address: string | null;
          user_agent: string | null;
          metadata: Json;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['audit_logs']['Row'], 'id' | 'created_at'>;
        Update: never; // Audit logs are immutable
      };
      documents: {
        Row: {
          id: string;
          user_id: string;
          document_type: 'i9' | 'w4' | 'w9' | 'direct_deposit' | 'handbook' | 'other';
          file_path: string; // Encrypted S3 path
          file_name: string;
          file_size: number;
          uploaded_at: string;
          retention_until: string | null;
          is_deleted: boolean;
          deleted_at: string | null;
        };
        Insert: Omit<Database['public']['Tables']['documents']['Row'], 'id' | 'uploaded_at'>;
        Update: Partial<Database['public']['Tables']['documents']['Row']>;
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      [_ in never]: never;
    };
    Enums: {
      user_role: 'worker' | 'manager' | 'finance' | 'exec';
      division: 'vendor' | 'trailers' | 'both';
      document_type: 'i9' | 'w4' | 'w9' | 'direct_deposit' | 'handbook' | 'other';
      onboarding_status: 'pending' | 'in_progress' | 'completed';
    };
  };
}


