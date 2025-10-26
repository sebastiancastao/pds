'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function PayrollPacketNYPage() {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    // Personal Information
    firstName: '',
    middleName: '',
    lastName: '',
    ssn: '',
    dateOfBirth: '',
    email: '',
    phone: '',
    
    // Address
    streetAddress: '',
    apartment: '',
    city: '',
    state: 'NY',
    zipCode: '',
    
    // Employment Information
    position: '',
    startDate: '',
    employmentType: 'Full-Time',
    
    // W-4 Federal Tax Withholding
    filingStatus: '',
    dependents: '',
    extraWithholding: '',
    
    // Direct Deposit
    bankName: '',
    accountType: 'Checking',
    routingNumber: '',
    accountNumber: '',
    
    // Emergency Contact
    emergencyName: '',
    emergencyRelationship: '',
    emergencyPhone: '',
    
    // I-9 Employment Eligibility
    citizenshipStatus: '',
    alienRegistrationNumber: '',
    
    // Additional Information
    preferredName: '',
    pronouns: '',
    uniformSize: '',
    dietaryRestrictions: '',
    transportationMethod: '',
    availabilityNotes: '',
    previousExperience: '',
    references: '',
    
    // Meal Waivers
    mealWaiver6Hour: false,
    mealWaiver10Hour: false,
    mealWaiverDate: '',
    mealWaiverPrintedName: '',
    mealWaiverSignature: '',
    
    // Certifications
    backgroundCheck: false,
    certification: false,
  });

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.certification) {
      alert('Please certify that all information is accurate before submitting.');
      return;
    }

    setIsSubmitting(true);
    
    try {
      const response = await fetch('/api/payroll-packet-ny/submit-full', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });

      if (response.ok) {
        alert('NY Payroll Packet submitted successfully! HR will review your information.');
        // Optionally redirect or reset form
        window.location.href = '/';
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Submission failed');
      }
    } catch (error: any) {
      console.error('Submission error:', error);
      alert(`Failed to submit form: ${error.message}`);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50">
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        {/* Header */}
        <div className="mb-8">
          <Link href="/register" className="text-primary-600 hover:text-primary-700 transition-colors inline-flex items-center gap-2 mb-4">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Registration
          </Link>
          
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            <div className="flex items-center gap-4 mb-4">
              <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center">
                <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>
              <div>
                <h1 className="text-3xl font-bold text-gray-900">PDS New York Payroll Packet 2025</h1>
                <p className="text-gray-600">Complete all required information below</p>
              </div>
            </div>
            
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-yellow-900">
                  <strong>Important:</strong> All fields marked with an asterisk (*) are required. Please ensure all information is accurate before submitting.
                </p>
              </div>
            </div>

            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border-2 border-blue-200 rounded-lg p-6">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 mb-2 flex items-center gap-2">
                    <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    Prefer to Fill Out a PDF?
                  </h3>
                  <p className="text-sm text-gray-700">
                    View the fillable PDF in your browser. Fill it out and print if needed (cannot be saved).
                  </p>
                </div>
                <a
                  href="/api/payroll-packet-ny/fillable"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="bg-blue-600 text-white px-6 py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center gap-2 shadow-lg whitespace-nowrap"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  <span>View Fillable PDF</span>
                </a>
              </div>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-8">
          
          {/* Meal Waiver Section */}
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <span className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-bold text-sm">9</span>
              6 Hour and 10-12 Hour Meal Waiver
            </h2>
            
            <div className="space-y-6">
              {/* 6 Hour Meal Break Waiver */}
              <div className="bg-blue-50 rounded-lg p-6 border border-blue-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4">6 Hour Meal Break Waiver</h3>
                <div className="prose prose-sm text-gray-700 space-y-3 mb-4">
                  <p>
                    I understand that my employer has provided me with an unpaid meal period of at least 30 
                    minutes in length whenever I work more than 5 hours in a workday. Although I am entitled to take 
                    this meal period on any day I choose, I hereby confirm and request that on any day in which my 
                    work schedule lasts for more than 5 hours, but no more than 6 hours, I prefer and choose to 
                    voluntarily waive my 30-minute unpaid meal period, rather than taking the meal period and then 
                    extending my workday by another thirty minutes.
                  </p>
                  <p>
                    I understand that my waiver of the meal period is only permissible if my shift will be no 
                    more than 6 hours. I confirm that my employer has not encouraged me to skip my meal period at 
                    any time, and that I have the opportunity to take my uninterrupted 30-minute meal period on any 
                    day I wish to take it.
                  </p>
                </div>
                <div className="flex items-start gap-3 p-4 bg-white rounded-lg border-2 border-blue-300">
                  <input
                    type="checkbox"
                    id="mealWaiver6Hour"
                    name="mealWaiver6Hour"
                    checked={formData.mealWaiver6Hour}
                    onChange={handleInputChange}
                    required
                    className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <label htmlFor="mealWaiver6Hour" className="text-sm text-gray-900 font-medium">
                    I acknowledge and agree to the 6 Hour Meal Break Waiver *
                  </label>
                </div>
              </div>

              {/* 10-12 Hour Break Waiver */}
              <div className="bg-purple-50 rounded-lg p-6 border border-purple-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4">10-12 Hour Break Waiver</h3>
                <div className="prose prose-sm text-gray-700 space-y-3 mb-4">
                  <p>
                    I understand that when I work more than 10 hours in a workday, I am entitled to a second 
                    30-minute unpaid meal period hours. Although I am entitled to take this second meal period on 
                    any day I choose, I hereby confirm and request that on any day in which my work schedule lasts 
                    for more than 10 hours, but less than 12 hours, I prefer and choose to voluntarily waive the second 
                    30-minute unpaid meal period, rather than taking the meal period and then extending my workday 
                    by another thirty minutes.
                  </p>
                  <p>
                    I understand that my waiver of the second meal period is only permissible if I have properly 
                    taken my first 30-minute meal period of the workday. I understand that my waiver of the second 
                    meal period is only permissible if my shift will be less than 12 hours.
                  </p>
                </div>
                <div className="flex items-start gap-3 p-4 bg-white rounded-lg border-2 border-purple-300">
                  <input
                    type="checkbox"
                    id="mealWaiver10Hour"
                    name="mealWaiver10Hour"
                    checked={formData.mealWaiver10Hour}
                    onChange={handleInputChange}
                    required
                    className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                  />
                  <label htmlFor="mealWaiver10Hour" className="text-sm text-gray-900 font-medium">
                    I acknowledge and agree to the 10-12 Hour Break Waiver *
                  </label>
                </div>
              </div>

              {/* General Terms */}
              <div className="bg-gray-50 rounded-lg p-6 border border-gray-200">
                <h3 className="text-lg font-bold text-gray-900 mb-4">General Terms</h3>
                <div className="prose prose-sm text-gray-700 space-y-3">
                  <p>
                    I further acknowledge and understand that notwithstanding these waivers, on any day I 
                    choose to take a meal period even though my shift will be more than 5 hours but less than 6 
                    hours, or more than 10 hours but no more than 12 hours, I may do so on that day by informing 
                    my supervisor of my choice to take a meal period.
                  </p>
                  <p>
                    I confirm that my employer has not encouraged me to skip my meals, and that I have the 
                    opportunity to take my 30-minute meal period on any day I wish to take it. I also acknowledge 
                    that I have read this waiver and understand it, and I am voluntarily agreeing to its provisions 
                    without coercion by my employer. I further acknowledge and understand that this meal period 
                    waiver may be revoked by me at any time.
                  </p>
                </div>
              </div>

              {/* Signature Section */}
              <div className="bg-white rounded-lg p-6 border-2 border-gray-300">
                <h3 className="text-lg font-bold text-gray-900 mb-4">Meal Waiver Signature</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <div>
                    <label htmlFor="mealWaiverDate" className="block text-sm font-medium text-gray-700 mb-2">
                      Date *
                    </label>
                    <input
                      type="date"
                      id="mealWaiverDate"
                      name="mealWaiverDate"
                      value={formData.mealWaiverDate}
                      onChange={handleInputChange}
                      required
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label htmlFor="mealWaiverPrintedName" className="block text-sm font-medium text-gray-700 mb-2">
                      Name (Print) *
                    </label>
                    <input
                      type="text"
                      id="mealWaiverPrintedName"
                      name="mealWaiverPrintedName"
                      value={formData.mealWaiverPrintedName}
                      onChange={handleInputChange}
                      required
                      placeholder="Your full name"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label htmlFor="mealWaiverSignature" className="block text-sm font-medium text-gray-700 mb-2">
                      Electronic Signature *
                    </label>
                    <input
                      type="text"
                      id="mealWaiverSignature"
                      name="mealWaiverSignature"
                      value={formData.mealWaiverSignature}
                      onChange={handleInputChange}
                      required
                      placeholder="Type your full name"
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent font-signature"
                      style={{ fontFamily: 'cursive' }}
                    />
                  </div>
                </div>
                <p className="text-xs text-gray-500 mt-4">
                  By typing your name above, you are providing an electronic signature that has the same legal effect as a handwritten signature.
                </p>
              </div>
            </div>
          </div>

          {/* Certification Section */}
          <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
            <h2 className="text-2xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <span className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center text-primary-600 font-bold text-sm">10</span>
              Certification & Consent
            </h2>
            
            <div className="space-y-4">
              <div className="flex items-start gap-3 p-4 bg-gray-50 rounded-lg">
                <input
                  type="checkbox"
                  id="backgroundCheck"
                  name="backgroundCheck"
                  checked={formData.backgroundCheck}
                  onChange={handleInputChange}
                  className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="backgroundCheck" className="text-sm text-gray-700">
                  I consent to a background check as required by venue policies and regulatory requirements.
                </label>
              </div>

              <div className="flex items-start gap-3 p-4 bg-primary-50 rounded-lg border-2 border-primary-200">
                <input
                  type="checkbox"
                  id="certification"
                  name="certification"
                  checked={formData.certification}
                  onChange={handleInputChange}
                  required
                  className="mt-1 h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                />
                <label htmlFor="certification" className="text-sm text-gray-900 font-medium">
                  I certify that all information provided in this form is true, complete, and accurate to the best of my knowledge. I understand that any false or misleading information may result in termination of employment. *
                </label>
              </div>
            </div>
          </div>

          {/* Submit Section */}
          <div className="bg-gradient-to-r from-primary-600 to-primary-700 rounded-2xl shadow-xl p-8 text-white">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6">
              <div>
                <h3 className="text-2xl font-bold mb-2">Ready to Submit?</h3>
                <p className="text-primary-100">
                  Please review all information before submitting. HR will contact you if additional information is needed.
                </p>
              </div>
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-white text-primary-600 px-8 py-4 rounded-lg font-bold text-lg hover:bg-primary-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-3 shadow-lg whitespace-nowrap"
              >
                {isSubmitting ? (
                  <>
                    <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Submitting...
                  </>
                ) : (
                  <>
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    Submit Payroll Packet
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Help Section */}
        <div className="mt-8 bg-gray-50 rounded-xl p-6 border border-gray-200">
          <h3 className="font-semibold text-gray-900 mb-3">Need Help?</h3>
          <div className="text-sm text-gray-600 space-y-2">
            <p>
              <strong>Email:</strong> <a href="mailto:hr@pdsvendor.com" className="text-primary-600 hover:underline">hr@pdsvendor.com</a>
            </p>
            <p>
              <strong>Phone:</strong> <a href="tel:+1234567890" className="text-primary-600 hover:underline">(XXX) XXX-XXXX</a>
            </p>
            <p className="text-xs text-gray-500 mt-4">
              All information is encrypted and stored securely in compliance with FLSA, IRS, and SOC2 standards.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
