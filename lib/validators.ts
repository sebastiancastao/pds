// PDS Time Keeping System - Input Validation
// Server-side validation using Zod for security

import { z } from 'zod';

// ============================================
// User Registration Validation
// ============================================
export const registerSchema = z.object({
  firstName: z.string()
    .min(1, 'First name is required')
    .max(50, 'First name must be less than 50 characters')
    .regex(/^[a-zA-Z\s'-]+$/, 'First name contains invalid characters'),
  
  lastName: z.string()
    .min(1, 'Last name is required')
    .max(50, 'Last name must be less than 50 characters')
    .regex(/^[a-zA-Z\s'-]+$/, 'Last name contains invalid characters'),
  
  email: z.string()
    .email('Invalid email address')
    .max(100, 'Email must be less than 100 characters')
    .toLowerCase()
    .trim(),
  
  address: z.string()
    .min(5, 'Address must be at least 5 characters')
    .max(200, 'Address must be less than 200 characters'),
  
  city: z.string()
    .max(100, 'City must be less than 100 characters')
    .optional(),
  
  state: z.string()
    .length(2, 'State must be 2 characters')
    .regex(/^[A-Z]{2}$/, 'Invalid state code')
    .toUpperCase(),
  
  zipCode: z.string()
    .regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code')
    .optional(),
});

export type RegisterInput = z.infer<typeof registerSchema>;

// ============================================
// Login Validation
// ============================================
export const pinLoginSchema = z.object({
  pin: z.string()
    .length(6, 'PIN must be exactly 6 digits')
    .regex(/^\d{6}$/, 'PIN must contain only digits'),
});

export const emailLoginSchema = z.object({
  email: z.string()
    .email('Invalid email address')
    .toLowerCase()
    .trim(),
  
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .max(100, 'Password must be less than 100 characters'),
});

export const qrLoginSchema = z.object({
  qrData: z.string()
    .min(10, 'Invalid QR code data')
    .regex(/^PDS-/, 'Invalid QR code format'),
});

// ============================================
// 2FA Validation
// ============================================
export const twoFactorSchema = z.object({
  token: z.string()
    .length(6, 'Token must be exactly 6 digits')
    .regex(/^\d{6}$/, 'Token must contain only digits'),
});

// ============================================
// Profile Update Validation
// ============================================
export const profileUpdateSchema = z.object({
  firstName: z.string()
    .min(1, 'First name is required')
    .max(50, 'First name must be less than 50 characters')
    .regex(/^[a-zA-Z\s'-]+$/, 'First name contains invalid characters')
    .optional(),
  
  lastName: z.string()
    .min(1, 'Last name is required')
    .max(50, 'Last name must be less than 50 characters')
    .regex(/^[a-zA-Z\s'-]+$/, 'Last name contains invalid characters')
    .optional(),
  
  phone: z.string()
    .regex(/^\+?1?\d{10,14}$/, 'Invalid phone number')
    .optional(),
  
  address: z.string()
    .min(5, 'Address must be at least 5 characters')
    .max(200, 'Address must be less than 200 characters')
    .optional(),
});

// ============================================
// Document Upload Validation
// ============================================
export const documentUploadSchema = z.object({
  documentType: z.enum(['i9', 'w4', 'w9', 'direct_deposit', 'handbook', 'other']),
  fileName: z.string()
    .min(1, 'File name is required')
    .max(255, 'File name must be less than 255 characters'),
  fileSize: z.number()
    .max(10 * 1024 * 1024, 'File size must be less than 10MB'),
  fileType: z.string()
    .regex(/^(application\/pdf|image\/(jpeg|png|gif))$/, 'Invalid file type. Only PDF and images allowed'),
});

// ============================================
// Time Keeping Validation
// ============================================
export const clockInOutSchema = z.object({
  action: z.enum(['clock_in', 'clock_out']),
  timestamp: z.string().datetime(),
  location: z.object({
    latitude: z.number().optional(),
    longitude: z.number().optional(),
  }).optional(),
});

// ============================================
// Event Creation Validation
// ============================================
export const eventCreateSchema = z.object({
  eventName: z.string()
    .min(3, 'Event name must be at least 3 characters')
    .max(200, 'Event name must be less than 200 characters'),
  
  artist: z.string()
    .max(200, 'Artist name must be less than 200 characters')
    .optional(),
  
  venue: z.string()
    .min(3, 'Venue is required')
    .max(200, 'Venue must be less than 200 characters'),
  
  eventDate: z.string().datetime('Invalid event date'),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid start time format (HH:MM)'),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Invalid end time format (HH:MM)'),
  
  ticketSales: z.number()
    .int('Total Collected must be a whole number')
    .min(0, 'Total Collected cannot be negative')
    .optional(),
  
  artistSharePercent: z.number()
    .min(0, 'Artist share must be at least 0%')
    .max(100, 'Artist share cannot exceed 100%')
    .optional(),
  
  venueSharePercent: z.number()
    .min(0, 'Venue share must be at least 0%')
    .max(100, 'Venue share cannot exceed 100%')
    .optional(),
  
  pdsSharePercent: z.number()
    .min(0, 'PDS share must be at least 0%')
    .max(100, 'PDS share cannot exceed 100%')
    .optional(),
});

// ============================================
// Sanitization Helpers
// ============================================

/**
 * Sanitize string input to prevent XSS
 */
export const sanitizeString = (input: string): string => {
  return input
    .trim()
    .replace(/[<>]/g, '') // Remove < and >
    .replace(/javascript:/gi, '') // Remove javascript: protocol
    .replace(/on\w+=/gi, ''); // Remove event handlers
};

/**
 * Sanitize email
 */
export const sanitizeEmail = (email: string): string => {
  return email.toLowerCase().trim();
};

/**
 * Validate and sanitize state code
 */
export const validateStateCode = (state: string): string => {
  const validStates = [
    'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
    'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
    'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
    'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
    'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY',
  ];
  
  const upperState = state.toUpperCase().trim();
  
  if (!validStates.includes(upperState)) {
    throw new Error('Invalid state code');
  }
  
  return upperState;
};


