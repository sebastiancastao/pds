'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { AuthGuard } from '@/lib/auth-guard';
import { supabase } from '@/lib/supabase';

const US_STATES = [
  { value: '', label: 'Select State' },
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
];

// Regex Patterns for Validation
const VALIDATION_PATTERNS = {
  // Name: Letters, spaces, hyphens, apostrophes only, 2-50 characters
  name: /^[a-zA-Z\s'-]{2,50}$/,
  
  // Email: Standard email format
  email: /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/,
  
  // Address: Alphanumeric, spaces, commas, periods, hyphens, #, 5-200 characters
  address: /^[a-zA-Z0-9\s,.'#-]{5,200}$/,
  
  // City: Letters, spaces, hyphens, apostrophes, 2-100 characters
  city: /^[a-zA-Z\s'-]{2,100}$/,
  
  // ZIP Code: 5 digits or 5+4 format (12345 or 12345-6789)
  zipCode: /^\d{5}(-\d{4})?$/,
  
  // Phone (optional future use): (123) 456-7890 or 123-456-7890 or 1234567890
  phone: /^(\+?1[-.\s]?)?\(?([0-9]{3})\)?[-.\s]?([0-9]{3})[-.\s]?([0-9]{4})$/,
};

// Photo upload constants
const PHOTO_UPLOAD_CONFIG = {
  maxSize: 5 * 1024 * 1024, // 5MB
  allowedTypes: ['image/jpeg', 'image/jpg', 'image/png'],
  allowedExtensions: ['.jpg', '.jpeg', '.png'],
};

// Validation Error Messages
const VALIDATION_MESSAGES = {
  firstName: {
    required: 'First name is required',
    invalid: 'First name must be 2-50 characters and contain only letters, spaces, hyphens, or apostrophes',
  },
  lastName: {
    required: 'Last name is required',
    invalid: 'Last name must be 2-50 characters and contain only letters, spaces, hyphens, or apostrophes',
  },
  email: {
    required: 'Email address is required',
    invalid: 'Please enter a valid email address (e.g., name@example.com)',
  },
  address: {
    required: 'Street address is required',
    invalid: 'Address must be 5-200 characters and contain only letters, numbers, and basic punctuation',
  },
  city: {
    invalid: 'City must be 2-100 characters and contain only letters, spaces, hyphens, or apostrophes',
  },
  state: {
    required: 'State is required',
  },
  zipCode: {
    invalid: 'ZIP code must be 5 digits or 5+4 format (e.g., 12345 or 12345-6789)',
  },
  photo: {
    invalid: 'Please upload a valid image file (JPG, PNG) under 5MB',
    required: 'Profile photo is required for employee identification',
  },
};

interface ValidationErrors {
  firstName?: string;
  lastName?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  photo?: string;
}

export default function RegisterPage() {
  const router = useRouter();
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    address: '',
    city: '',
    state: '',
    zipCode: '',
    photo: null as File | null,
  });
  const [validationErrors, setValidationErrors] = useState<ValidationErrors>({});
  const [touchedFields, setTouchedFields] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Check if MFA verification code has been validated
  useEffect(() => {
    console.log('[REGISTER] Checking MFA verification status...');

    const mfaCheckpoint = sessionStorage.getItem('mfa_checkpoint');
    const mfaVerified = sessionStorage.getItem('mfa_verified');

    console.log('[REGISTER] MFA status:', {
      checkpoint: mfaCheckpoint,
      verified: mfaVerified
    });

    // If checkpoint is set but not verified, user needs to verify MFA
    if (mfaCheckpoint === 'true' && mfaVerified !== 'true') {
      console.log('[REGISTER] ❌ MFA verification required but not completed');
      console.log('[REGISTER] Redirecting to /login');
      router.push('/login');
      return;
    }

    console.log('[REGISTER] ✅ MFA verification check passed');

    // Save onboarding progress so user can be redirected back here on login
    saveOnboardingProgress();
  }, [router]);

  // Save onboarding progress so user can be redirected back here on login
  const saveOnboardingProgress = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await fetch('/api/auth/save-onboarding-stage', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ stage: 'onboarding-register' }),
      });
      console.log('[REGISTER] Onboarding progress saved');
    } catch (err) {
      console.error('[REGISTER] Failed to save onboarding progress:', err);
    }
  };

  /**
   * Validate a single field using regex patterns
   */
  const validateField = (name: string, value: string): string | undefined => {
    // Skip validation for empty optional fields
    if (!value && (name === 'city' || name === 'zipCode')) {
      return undefined;
    }

    switch (name) {
      case 'firstName':
        if (!value.trim()) return VALIDATION_MESSAGES.firstName.required;
        if (!VALIDATION_PATTERNS.name.test(value)) return VALIDATION_MESSAGES.firstName.invalid;
        break;
      
      case 'lastName':
        if (!value.trim()) return VALIDATION_MESSAGES.lastName.required;
        if (!VALIDATION_PATTERNS.name.test(value)) return VALIDATION_MESSAGES.lastName.invalid;
        break;
      
      case 'email':
        if (!value.trim()) return VALIDATION_MESSAGES.email.required;
        if (!VALIDATION_PATTERNS.email.test(value)) return VALIDATION_MESSAGES.email.invalid;
        break;
      
      case 'address':
        if (!value.trim()) return VALIDATION_MESSAGES.address.required;
        if (!VALIDATION_PATTERNS.address.test(value)) return VALIDATION_MESSAGES.address.invalid;
        break;
      
      case 'city':
        if (value && !VALIDATION_PATTERNS.city.test(value)) return VALIDATION_MESSAGES.city.invalid;
        break;
      
      case 'state':
        if (!value) return VALIDATION_MESSAGES.state.required;
        break;
      
      case 'zipCode':
        if (value && !VALIDATION_PATTERNS.zipCode.test(value)) return VALIDATION_MESSAGES.zipCode.invalid;
        break;
      
      case 'photo':
        if (!value || !formData.photo) return VALIDATION_MESSAGES.photo.required;
        if (formData.photo) {
          if (!PHOTO_UPLOAD_CONFIG.allowedTypes.includes(formData.photo.type)) {
            return VALIDATION_MESSAGES.photo.invalid;
          }
          if (formData.photo.size > PHOTO_UPLOAD_CONFIG.maxSize) {
            return VALIDATION_MESSAGES.photo.invalid;
          }
        }
        break;
    }
    
    return undefined;
  };

  /**
   * Validate all fields
   */
  const validateAllFields = (): boolean => {
    const errors: ValidationErrors = {};
    
    Object.keys(formData).forEach((key) => {
      if (key === 'photo') {
        const error = validateField(key, formData.photo ? 'photo' : '');
        if (error) {
          errors[key as keyof ValidationErrors] = error;
        }
      } else {
        const error = validateField(key, formData[key as keyof typeof formData] as string);
        if (error) {
          errors[key as keyof ValidationErrors] = error;
        }
      }
    });
    
    setValidationErrors(errors);
    return Object.keys(errors).length === 0;
  };

  /**
   * Handle input change with real-time validation
   */
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    // Remove all state-based redirects from here
    setFormData((prev) => ({
      ...prev,
      [name]: value,
    }));
    setError('');
    if (touchedFields.has(name)) {
      const fieldError = validateField(name, value);
      setValidationErrors((prev) => ({
        ...prev,
        [name]: fieldError,
      }));
    }
  };

  /**
   * Handle field blur (mark as touched)
   */
  const handleBlur = (e: React.FocusEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    
    // Mark field as touched
    setTouchedFields((prev) => new Set([...prev, name]));
    
    // Validate the field
    const fieldError = validateField(name, value);
    setValidationErrors((prev) => ({
      ...prev,
      [name]: fieldError,
    }));
  };

  /**
   * Validate and process uploaded photo
   */
  const handlePhotoUpload = (file: File) => {
    // Validate file type
    if (!PHOTO_UPLOAD_CONFIG.allowedTypes.includes(file.type)) {
      setError('Please upload a valid image file (JPG, PNG)');
      return;
    }

    // Validate file size
    if (file.size > PHOTO_UPLOAD_CONFIG.maxSize) {
      setError('Image file must be smaller than 5MB');
      return;
    }

    // Update form data
    setFormData(prev => ({
      ...prev,
      photo: file,
    }));

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setPhotoPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    // Clear any existing errors
    setError('');
    setValidationErrors(prev => ({
      ...prev,
      photo: undefined,
    }));
  };

  /**
   * Handle drag and drop events
   */
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handlePhotoUpload(files[0]);
    }
  };

  /**
   * Handle file input change
   */
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handlePhotoUpload(file);
    }
  };

  /**
   * Remove uploaded photo
   */
  const removePhoto = () => {
    setFormData(prev => ({
      ...prev,
      photo: null,
    }));
    setPhotoPreview(null);
    setValidationErrors(prev => ({
      ...prev,
      photo: undefined,
    }));
  };

  /**
   * Handle form submission
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    // Mark all fields as touched (including photo)
    setTouchedFields(new Set([...Object.keys(formData), 'photo']));
    
    // Validate all fields
    if (!validateAllFields()) {
      setError('Please correct the errors below before submitting');
      return;
    }
    
    setIsLoading(true);

    try {
      // Prepare form data for API call
      const apiFormData = new FormData();
      
      // Add the photo file
      if (formData.photo) {
        apiFormData.append('photo', formData.photo);
      }
      
      // Add profile data as JSON string
      const profileData = {
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        address: formData.address,
        city: formData.city,
        state: formData.state,
        zipCode: formData.zipCode,
      };
      apiFormData.append('profileData', JSON.stringify(profileData));

      // Get current access token (works with cookie auth fallback server-side)
      const { data: { session } } = await supabase.auth.getSession();
      const accessToken = session?.access_token;

      // Call the API endpoint (send cookies and bearer token)
      const response = await fetch('/api/profile/upload-photo', {
        method: 'POST',
        body: apiFormData,
        credentials: 'include',
        headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to upload profile data');
      }

      console.log('Registration successful:', {
        profileId: result.profileId,
        photoUploaded: result.photoUploaded,
        redirectPath: result.redirectPath
      });

      // Redirect immediately to appropriate payroll packet page
      router.push(result.redirectPath || '/dashboard');

    } catch (error) {
      console.error('Registration error:', error);
      setIsLoading(false);
      setError(error instanceof Error ? error.message : 'Failed to submit registration. Please try again.');
    }
  };

  return (
    <AuthGuard requireMFA={false} allowTemporaryPassword={true} onboardingOnly={true}>
      <div className="min-h-screen flex bg-gradient-to-br from-primary-50 to-primary-100">
      {/* Left Side - Branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-primary-600 p-12 flex-col justify-between relative overflow-hidden">
        <div className="relative z-10">
         
          <div className="mt-16">
            <h1 className="text-4xl font-bold text-white mb-4">
              Employee Onboarding
            </h1>
            <p className="text-primary-100 text-lg">
              Join PDS with secure, compliant digital onboarding
            </p>
          </div>
        </div>

        {/* Compliance Features */}
        <div className="relative z-10 space-y-4">
          <h2 className="text-white font-semibold text-xl mb-6">Why Digital Onboarding?</h2>
          <div className="space-y-3">
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Secure Data Storage</p>
                <p className="text-sm text-primary-100">AES-256 encryption protects your personal information</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">FLSA Compliant</p>
                <p className="text-sm text-primary-100">Meet all federal labor standards requirements</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">Faster Processing</p>
                <p className="text-sm text-primary-100">Get started quickly with streamlined onboarding</p>
              </div>
            </div>
            <div className="flex items-start gap-3 text-white">
              <svg className="w-6 h-6 text-primary-200 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div>
                <p className="font-medium">State Compliance</p>
                <p className="text-sm text-primary-100">Automatic handling of state-specific requirements</p>
              </div>
            </div>
          </div>
        </div>

        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute inset-0" style={{
            backgroundImage: 'radial-gradient(circle at 2px 2px, white 1px, transparent 0)',
            backgroundSize: '40px 40px'
          }}></div>
        </div>
      </div>

      {/* Right Side - Registration Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile Back Button */}
          <div className="lg:hidden mb-6">
            <Link href="/" className="text-primary-600 hover:text-primary-700 transition-colors">
              ← Back to Home
            </Link>
          </div>

          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            {/* Header */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-gray-900">Employee Registration</h2>
              <p className="text-gray-600 mt-2">Complete your onboarding information</p>
            </div>

            {/* Registration Form */}
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* First Name */}
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-700 mb-2">
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="firstName"
                  name="firstName"
                  value={formData.firstName}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all ${
                    validationErrors.firstName ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                  placeholder="Enter your first name"
                  required
                  aria-invalid={!!validationErrors.firstName}
                  aria-describedby={validationErrors.firstName ? 'firstName-error' : undefined}
                />
                {validationErrors.firstName && (
                  <p id="firstName-error" className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {validationErrors.firstName}
                  </p>
                )}
              </div>

              {/* Last Name */}
              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-700 mb-2">
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="lastName"
                  name="lastName"
                  value={formData.lastName}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all ${
                    validationErrors.lastName ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                  placeholder="Enter your last name"
                  required
                  aria-invalid={!!validationErrors.lastName}
                  aria-describedby={validationErrors.lastName ? 'lastName-error' : undefined}
                />
                {validationErrors.lastName && (
                  <p id="lastName-error" className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {validationErrors.lastName}
                  </p>
                )}
              </div>

              {/* Email */}
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  id="email"
                  name="email"
                  value={formData.email}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all ${
                    validationErrors.email ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                  placeholder="your.email@example.com"
                  required
                  aria-invalid={!!validationErrors.email}
                  aria-describedby={validationErrors.email ? 'email-error' : undefined}
                />
                {validationErrors.email && (
                  <p id="email-error" className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {validationErrors.email}
                  </p>
                )}
              </div>

              {/* Photo Upload */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Profile Photo <span className="text-red-500">*</span>
                </label>
                
                {!photoPreview ? (
                  <div
                    className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
                      isDragOver
                        ? 'border-primary-500 bg-primary-50'
                        : validationErrors.photo
                        ? 'border-red-500 bg-red-50'
                        : 'border-gray-300 hover:border-primary-400'
                    }`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  >
                    <input
                      type="file"
                      id="photo"
                      name="photo"
                      accept="image/jpeg,image/jpg,image/png"
                      onChange={handleFileInputChange}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      required
                    />
                    
                    <div className="space-y-3">
                      <div className="mx-auto w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center">
                        <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                      </div>
                      
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {isDragOver ? 'Drop your photo here' : 'Click to upload profile photo or drag and drop'}
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          PNG, JPG up to 5MB
                        </p>
                      </div>
                      
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 text-primary-600 hover:text-primary-700 text-sm font-medium"
                        onClick={() => document.getElementById('photo')?.click()}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                        </svg>
                        Choose File
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="relative">
                    <div className="w-full h-48 bg-gray-100 rounded-lg overflow-hidden border border-gray-300">
                      <img
                        src={photoPreview}
                        alt="Profile preview"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    
                    <button
                      type="button"
                      onClick={removePhoto}
                      className="absolute top-2 right-2 w-8 h-8 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 transition-colors"
                      title="Remove photo"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                    
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm text-gray-600">
                        {formData.photo?.name} ({(formData.photo?.size! / 1024 / 1024).toFixed(1)}MB)
                      </span>
                      <button
                        type="button"
                        onClick={() => document.getElementById('photo')?.click()}
                        className="text-sm text-primary-600 hover:text-primary-700 font-medium"
                      >
                        Change Photo
                      </button>
                    </div>
                  </div>
                )}
                
                {validationErrors.photo && (
                  <p className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {validationErrors.photo}
                  </p>
                )}
              </div>

              {/* Address */}
              <div>
                <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-2">
                  Street Address <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  id="address"
                  name="address"
                  value={formData.address}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all ${
                    validationErrors.address ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                  placeholder="123 Main Street, Apt 4B"
                  required
                  aria-invalid={!!validationErrors.address}
                  aria-describedby={validationErrors.address ? 'address-error' : undefined}
                />
                {validationErrors.address && (
                  <p id="address-error" className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {validationErrors.address}
                  </p>
                )}
              </div>

              {/* City & State Row */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* City */}
                <div>
                  <label htmlFor="city" className="block text-sm font-medium text-gray-700 mb-2">
                    City
                  </label>
                  <input
                    type="text"
                    id="city"
                    name="city"
                    value={formData.city}
                    onChange={handleInputChange}
                    onBlur={handleBlur}
                    className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all ${
                      validationErrors.city ? 'border-red-500 bg-red-50' : 'border-gray-300'
                    }`}
                    placeholder="City"
                    aria-invalid={!!validationErrors.city}
                    aria-describedby={validationErrors.city ? 'city-error' : undefined}
                  />
                  {validationErrors.city && (
                    <p id="city-error" className="mt-1 text-sm text-red-600 flex items-center gap-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {validationErrors.city}
                    </p>
                  )}
                </div>

                {/* State */}
                <div>
                  <label htmlFor="state" className="block text-sm font-medium text-gray-700 mb-2">
                    State <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="state"
                    name="state"
                    value={formData.state}
                    onChange={handleInputChange}
                    onBlur={handleBlur}
                    className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all bg-white ${
                      validationErrors.state ? 'border-red-500 bg-red-50' : 'border-gray-300'
                    }`}
                    required
                    aria-invalid={!!validationErrors.state}
                    aria-describedby={validationErrors.state ? 'state-error' : undefined}
                  >
                    {US_STATES.map((state) => (
                      <option key={state.value} value={state.value}>
                        {state.label}
                      </option>
                    ))}
                  </select>
                  {validationErrors.state && (
                    <p id="state-error" className="mt-1 text-sm text-red-600 flex items-center gap-1">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      {validationErrors.state}
                    </p>
                  )}
                </div>
              </div>

              {/* ZIP Code */}
              <div>
                <label htmlFor="zipCode" className="block text-sm font-medium text-gray-700 mb-2">
                  ZIP Code
                </label>
                <input
                  type="text"
                  id="zipCode"
                  name="zipCode"
                  value={formData.zipCode}
                  onChange={handleInputChange}
                  onBlur={handleBlur}
                  className={`w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent transition-all ${
                    validationErrors.zipCode ? 'border-red-500 bg-red-50' : 'border-gray-300'
                  }`}
                  placeholder="12345 or 12345-6789"
                  maxLength={10}
                  aria-invalid={!!validationErrors.zipCode}
                  aria-describedby={validationErrors.zipCode ? 'zipCode-error' : undefined}
                />
                {validationErrors.zipCode && (
                  <p id="zipCode-error" className="mt-1 text-sm text-red-600 flex items-center gap-1">
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {validationErrors.zipCode}
                  </p>
                )}
              </div>

              {/* Privacy Notice */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="text-xs text-blue-800">
                  <p className="font-medium">Your privacy is protected</p>
                  <p>All information including your profile photo is encrypted with AES-256 and stored securely in our database in compliance with SOC2, FLSA, and state regulations.</p>
                </div>
              </div>

              {/* Error Message */}
              {error && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-2">
                  <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-red-800">{error}</p>
                </div>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className="liquid-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-2"
              >
                {isLoading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Submitting...</span>
                  </>
                ) : (
                  <>
                    <span>Submit Registration</span>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </>
                )}
              </button>
            </form>

            {/* Footer */}
            <div className="mt-6 pt-6 border-t border-gray-200">
              <p className="text-center text-sm text-gray-600">
                Already registered?{' '}
                <Link href="/login" className="text-primary-600 hover:text-primary-700 font-medium">
                  Login here
                </Link>
              </p>
            </div>
          </div>

          {/* Help Section */}
          <div className="mt-6 text-center">
            <p className="text-sm text-gray-600">
              Need help?{' '}
                Contact Support at portal@1pds.net
            </p>
          </div>
        </div>
      </div>
    </div>
    </AuthGuard>
  );
}
