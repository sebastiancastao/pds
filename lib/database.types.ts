// Auto-generated Database Types
// Run: npx supabase gen types typescript --project-id YOUR_PROJECT_ID > lib/database.types.ts

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
          is_active: boolean;
          created_at: string;
          updated_at: string;
          last_login: string | null;
          failed_login_attempts: number;
          account_locked_until: string | null;
          // Temporary Password Management
          is_temporary_password: boolean;
          must_change_password: boolean;
          password_expires_at: string | null;
          last_password_change: string | null;
        };
        Insert: {
          id?: string;
          email: string;
          role: 'worker' | 'manager' | 'finance' | 'exec';
          division: 'vendor' | 'trailers' | 'both';
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
          last_login?: string | null;
          failed_login_attempts?: number;
          account_locked_until?: string | null;
          is_temporary_password?: boolean;
          must_change_password?: boolean;
          password_expires_at?: string | null;
          last_password_change?: string | null;
        };
        Update: Partial<Database['public']['Tables']['users']['Row']>;
      };
      profiles: {
        Row: {
          id: string;
          user_id: string;
          // Encrypted PII fields
          first_name: string; // ENCRYPTED
          last_name: string; // ENCRYPTED
          phone: string | null; // ENCRYPTED
          address: string | null; // ENCRYPTED
          city: string | null;
          state: string;
          zip_code: string | null;
          // Authentication (new MFA fields)
          password_hash: string;
          mfa_secret: string | null;
          mfa_enabled: boolean;
          backup_codes: string[] | null; // Array of hashed backup codes
          // Onboarding
          onboarding_status: 'pending' | 'in_progress' | 'completed';
          onboarding_completed_at: string | null;
          // Metadata
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          user_id: string;
          first_name: string;
          last_name: string;
          phone?: string | null;
          address?: string | null;
          city?: string | null;
          state: string;
          zip_code?: string | null;
          password_hash: string;
          mfa_secret?: string | null;
          mfa_enabled?: boolean;
          backup_codes?: string[] | null;
          onboarding_status?: 'pending' | 'in_progress' | 'completed';
          onboarding_completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
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
          success: boolean;
          error_message: string | null;
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
          mime_type: string;
          uploaded_at: string;
          retention_until: string | null;
          is_deleted: boolean;
          deleted_at: string | null;
          deleted_by: string | null;
        };
        Insert: Omit<Database['public']['Tables']['documents']['Row'], 'id' | 'uploaded_at'>;
        Update: Partial<Database['public']['Tables']['documents']['Row']>;
      };
      sessions: {
        Row: {
          id: string;
          user_id: string;
          token_hash: string;
          ip_address: string;
          user_agent: string;
          expires_at: string;
          created_at: string;
          last_activity: string;
        };
        Insert: Omit<Database['public']['Tables']['sessions']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['sessions']['Row']>;
      };
      password_resets: {
        Row: {
          id: string;
          user_id: string;
          token_hash: string;
          expires_at: string;
          used_at: string | null;
          created_at: string;
        };
        Insert: Omit<Database['public']['Tables']['password_resets']['Row'], 'id' | 'created_at'>;
        Update: Partial<Database['public']['Tables']['password_resets']['Row']>;
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

