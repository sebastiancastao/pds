// PDS Time Keeping System - Audit Logging
// Immutable audit trail for compliance (SOC2, FLSA, IRS/DOL)

import { supabase } from './supabase';

interface AuditLogEvent {
  userId?: string | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  success: boolean;
  metadata?: Record<string, any>;
  ipAddress?: string;
  userAgent?: string;
  errorMessage?: string;
}

/**
 * Log audit event to database
 * 
 * Creates immutable audit trail for:
 * - User authentication events
 * - Account creation/modification
 * - Data access
 * - System operations
 * 
 * Required for:
 * - SOC2 compliance
 * - FLSA audit trail
 * - IRS/DOL requirements
 * 
 * @param event - Audit event details
 * @returns Promise that resolves when log is saved
 */
export async function logAuditEvent(event: AuditLogEvent): Promise<void> {
  try {
    const { error } = await (supabase
      .from('audit_logs') as any)
      .insert({
        user_id: event.userId || null,
        action: event.action,
        resource_type: event.resourceType,
        resource_id: event.resourceId || null,
        ip_address: event.ipAddress || null,
        user_agent: event.userAgent || null,
        metadata: event.metadata || {},
        success: event.success,
        error_message: event.errorMessage || null,
      });

    if (error) {
      // Log to console but don't throw - audit logging should not break app flow
      console.error('Failed to log audit event:', error);
      console.error('Event details:', event);
    }
  } catch (error) {
    // Catch any unexpected errors
    console.error('Unexpected error logging audit event:', error);
    console.error('Event details:', event);
  }
}

/**
 * Log authentication events
 */
export async function logAuthEvent(
  action: 'login_attempt' | 'login_success' | 'login_failed' | 'logout' | 'password_reset',
  userId: string | null,
  success: boolean,
  metadata?: Record<string, any>,
  ipAddress?: string,
  userAgent?: string
): Promise<void> {
  await logAuditEvent({
    userId,
    action,
    resourceType: 'authentication',
    success,
    metadata,
    ipAddress,
    userAgent,
  });
}

/**
 * Log user management events
 */
export async function logUserEvent(
  action: 'user_created' | 'user_updated' | 'user_deleted' | 'user_activated' | 'user_deactivated',
  userId: string,
  performedBy: string | null,
  success: boolean,
  metadata?: Record<string, any>
): Promise<void> {
  await logAuditEvent({
    userId: performedBy,
    action,
    resourceType: 'user',
    resourceId: userId,
    success,
    metadata: {
      ...metadata,
      targetUserId: userId,
    },
  });
}

/**
 * Log data access events
 */
export async function logDataAccessEvent(
  action: string,
  userId: string,
  resourceType: string,
  resourceId: string,
  metadata?: Record<string, any>
): Promise<void> {
  await logAuditEvent({
    userId,
    action,
    resourceType,
    resourceId,
    success: true,
    metadata,
  });
}

/**
 * Log security events
 */
export async function logSecurityEvent(
  action: string,
  userId: string | null,
  success: boolean,
  metadata?: Record<string, any>,
  ipAddress?: string
): Promise<void> {
  await logAuditEvent({
    userId,
    action,
    resourceType: 'security',
    success,
    metadata,
    ipAddress,
  });
}

/**
 * Query audit logs for a specific user
 */
export async function getUserAuditLogs(
  userId: string,
  limit: number = 100
): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch audit logs:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return [];
  }
}

/**
 * Query audit logs for a specific action
 */
export async function getActionAuditLogs(
  action: string,
  limit: number = 100
): Promise<any[]> {
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('action', action)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch audit logs:', error);
      return [];
    }

    return data || [];
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return [];
  }
}

/**
 * Query failed authentication attempts
 */
export async function getFailedAuthAttempts(
  email: string,
  since: Date
): Promise<number> {
  try {
    const { count, error } = await supabase
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('action', 'login_failed')
      .gte('created_at', since.toISOString())
      .eq('metadata->>email', email);

    if (error) {
      console.error('Failed to count failed auth attempts:', error);
      return 0;
    }

    return count || 0;
  } catch (error) {
    console.error('Error counting failed auth attempts:', error);
    return 0;
  }
}
