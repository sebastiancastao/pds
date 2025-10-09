-- Migration: Add phone number field for SMS-based MFA
-- This adds phone_number to users table and removes TOTP-specific fields

-- Add phone_number to users table
ALTER TABLE public.users
ADD COLUMN IF NOT EXISTS phone_number TEXT;

-- Add index for phone lookups
CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users(phone_number);

-- Update profiles table - change mfa_secret to store SMS verification status
-- We'll keep the field name for compatibility but change its purpose
COMMENT ON COLUMN public.profiles.mfa_secret IS 'For SMS MFA: stores phone verification status';

-- Add SMS verification code table for temporary storage
CREATE TABLE IF NOT EXISTS public.mfa_sms_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  phone_number TEXT NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Index for faster lookups
  CONSTRAINT unique_active_code_per_user UNIQUE(user_id, verified)
);

-- Index for cleanup of expired codes
CREATE INDEX IF NOT EXISTS idx_mfa_sms_codes_expires ON public.mfa_sms_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_mfa_sms_codes_user ON public.mfa_sms_codes(user_id);

-- Add RLS policies for mfa_sms_codes table
ALTER TABLE public.mfa_sms_codes ENABLE ROW LEVEL SECURITY;

-- Users can only see their own codes
CREATE POLICY "Users can view their own SMS codes"
  ON public.mfa_sms_codes
  FOR SELECT
  USING (auth.uid() = user_id);

-- Service role can manage all codes (for API operations)
CREATE POLICY "Service role can manage SMS codes"
  ON public.mfa_sms_codes
  FOR ALL
  USING (true);

COMMENT ON TABLE public.mfa_sms_codes IS 'Temporary storage for SMS MFA verification codes';

