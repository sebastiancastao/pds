// PDS Time Tracking System - Audit Logging
// Immutable audit trail for compliance

import { createServerClient } from './supabase';

export enum AuditAction {
  // Authentication
  USER_LOGIN = 'user_login',
  USER_LOGOUT = 'user_logout',
  USER_LOGIN_FAILED = 'user_login_failed',
  USER_2FA_ENABLED = 'user_2fa_enabled',
  USER_2FA_DISABLED = 'user_2fa_disabled',
  
  // User Management
  USER_CREATED = 'user_created',
  USER_UPDATED = 'user_updated',
  USER_DELETED = 'user_deleted',
  USER_ROLE_CHANGED = 'user_role_changed',
  
  // Document Access
  DOCUMENT_UPLOADED = 'document_uploaded',
  DOCUMENT_VIEWED = 'document_viewed',
  DOCUMENT_DOWNLOADED = 'document_downloaded',
  DOCUMENT_DELETED = 'document_deleted',
  
  // Time Tracking
  CLOCK_IN = 'clock_in',
  CLOCK_OUT = 'clock_out',
  TIMESHEET_APPROVED = 'timesheet_approved',
  TIMESHEET_REJECTED = 'timesheet_rejected',
  
  // Events
  EVENT_CREATED = 'event_created',
  EVENT_UPDATED = 'event_updated',
  EVENT_DELETED = 'event_deleted',
  EVENT_STAFF_ASSIGNED = 'event_staff_assigned',
  
  // Payroll
  PAYOUT_APPROVED = 'payout_approved',
  PAYOUT_REJECTED = 'payout_rejected',
  PAYROLL_EXPORTED = 'payroll_exported',
  
  // Security
  SECURITY_ALERT = 'security_alert',
  EXCESSIVE_LOGIN_ATTEMPTS = 'excessive_login_attempts',
  SUSPICIOUS_ACTIVITY = 'suspicious_activity',
  ACCESS_DENIED = 'access_denied',
}

export enum ResourceType {
  USER = 'user',
  PROFILE = 'profile',
  DOCUMENT = 'document',
  TIMESHEET = 'timesheet',
  EVENT = 'event',
  PAYOUT = 'payout',
  SECURITY = 'security',
}

interface AuditLogEntry {
  userId?: string | null;
  action: AuditAction;
  resourceType: ResourceType;
  resourceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, any>;
}

/**
 * Create an immutable audit log entry
 * @param entry - Audit log data
 */
export const logAudit = async (entry: AuditLogEntry): Promise<void> => {
  try {
    const supabase = createServerClient();
    
    const { error } = await supabase.from('audit_logs').insert({
      user_id: entry.userId,
      action: entry.action,
      resource_type: entry.resourceType,
      resource_id: entry.resourceId,
      ip_address: entry.ipAddress,
      user_agent: entry.userAgent,
      metadata: entry.metadata || {},
    });
    
    if (error) {
      console.error('Audit log error:', error);
      // Don't throw - logging shouldn't break the main flow
      // But log to monitoring service
    }
  } catch (error) {
    console.error('Audit log exception:', error);
  }
};

/**
 * Log user authentication attempt
 */
export const logAuthAttempt = async (
  userId: string | null,
  success: boolean,
  ipAddress: string,
  userAgent: string,
  metadata?: Record<string, any>
): Promise<void> => {
  await logAudit({
    userId,
    action: success ? AuditAction.USER_LOGIN : AuditAction.USER_LOGIN_FAILED,
    resourceType: ResourceType.USER,
    resourceId: userId,
    ipAddress,
    userAgent,
    metadata: {
      ...metadata,
      success,
      timestamp: new Date().toISOString(),
    },
  });
};

/**
 * Log document access
 */
export const logDocumentAccess = async (
  userId: string,
  documentId: string,
  action: AuditAction.DOCUMENT_VIEWED | AuditAction.DOCUMENT_DOWNLOADED,
  ipAddress: string,
  userAgent: string
): Promise<void> => {
  await logAudit({
    userId,
    action,
    resourceType: ResourceType.DOCUMENT,
    resourceId: documentId,
    ipAddress,
    userAgent,
    metadata: {
      sensitivityLevel: 'high',
      complianceRequired: true,
    },
  });
};

/**
 * Log security alert
 */
export const logSecurityAlert = async (
  userId: string | null,
  alertType: string,
  severity: 'low' | 'medium' | 'high' | 'critical',
  ipAddress: string,
  metadata?: Record<string, any>
): Promise<void> => {
  await logAudit({
    userId,
    action: AuditAction.SECURITY_ALERT,
    resourceType: ResourceType.SECURITY,
    ipAddress,
    metadata: {
      alertType,
      severity,
      requiresReview: severity === 'high' || severity === 'critical',
      ...metadata,
    },
  });
  
  // If critical, send real-time alert
  if (severity === 'critical' && process.env.ENABLE_SECURITY_ALERTS === 'true') {
    // TODO: Implement email/SMS alert to security team
    console.error('CRITICAL SECURITY ALERT:', { userId, alertType, metadata });
  }
};

/**
 * Get audit logs for a user (admin only)
 * @param userId - User ID to query
 * @param limit - Number of records to return
 */
export const getUserAuditLogs = async (userId: string, limit: number = 100) => {
  const supabase = createServerClient();
  
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) {
    throw new Error(`Failed to fetch audit logs: ${error.message}`);
  }
  
  return data;
};

/**
 * Get audit logs for a resource (admin only)
 * @param resourceType - Resource type
 * @param resourceId - Resource ID
 * @param limit - Number of records to return
 */
export const getResourceAuditLogs = async (
  resourceType: ResourceType,
  resourceId: string,
  limit: number = 100
) => {
  const supabase = createServerClient();
  
  const { data, error } = await supabase
    .from('audit_logs')
    .select('*')
    .eq('resource_type', resourceType)
    .eq('resource_id', resourceId)
    .order('created_at', { ascending: false })
    .limit(limit);
  
  if (error) {
    throw new Error(`Failed to fetch audit logs: ${error.message}`);
  }
  
  return data;
};

/**
 * Detect anomalous activity patterns
 * @param userId - User ID to check
 * @returns True if suspicious activity detected
 */
export const detectAnomalousActivity = async (userId: string): Promise<boolean> => {
  const supabase = createServerClient();
  
  // Check for excessive login attempts in last hour
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  
  const { data: loginAttempts, error } = await supabase
    .from('audit_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('action', AuditAction.USER_LOGIN_FAILED)
    .gte('created_at', oneHourAgo);
  
  if (error) {
    console.error('Anomaly detection error:', error);
    return false;
  }
  
  const maxAttempts = parseInt(process.env.PIN_MAX_ATTEMPTS || '3');
  
  if (loginAttempts && loginAttempts.length >= maxAttempts) {
    await logSecurityAlert(
      userId,
      'excessive_login_attempts',
      'high',
      '',
      {
        attemptCount: loginAttempts.length,
        timeWindow: '1 hour',
      }
    );
    return true;
  }
  
  return false;
};


