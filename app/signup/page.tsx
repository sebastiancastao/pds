'use client';

import React, { useState, useRef, useEffect } from 'react';
import Link from 'next/link';
import { isValidEmail, supabase } from '@/lib/supabase';
import Papa from 'papaparse';

interface NewUser {
  id: string;
  email: string;
  role: 'worker' | 'manager' | 'finance' | 'exec' | 'hr' | 'backgroundchecker';
  division: 'vendor' | 'trailers' | 'both';
  firstName: string;
  lastName: string;
  official_name: string;
}

interface CreatedUser extends NewUser {
  temporaryPassword: string;
  status: 'success' | 'error';
  message?: string;
  emailSent?: boolean;
  emailSending?: boolean;
}

interface VendorRecord {
  firstName: string;
  lastName: string;
  addressLine1: string;
  city: string;
  state: string;
  zip: string;
  cellPhone: string;
  email: string;
  newHirePacket: boolean;
}

export default function SignupPage() {
  const [users, setUsers] = useState<NewUser[]>([
    {
      id: crypto.randomUUID(),
      email: '',
      role: 'worker',
      division: 'vendor',
      firstName: '',
      lastName: '',
      official_name: '',
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [successResults, setSuccessResults] = useState<CreatedUser[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [vendorRoster, setVendorRoster] = useState<VendorRecord[]>([]);
  const [vendorLoading, setVendorLoading] = useState(false);
  const [vendorError, setVendorError] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const usersPerPage = 20;

  const addUser = () => {
    setUsers([
      ...users,
      {
        id: crypto.randomUUID(),
        email: '',
        role: 'worker',
        division: 'vendor',
        firstName: '',
        lastName: '',
        official_name: '',
      },
    ]);
  };

  const removeUser = (id: string) => {
    if (users.length > 1) {
      setUsers(users.filter((u) => u.id !== id));
    }
  };

  const updateUser = (id: string, field: keyof NewUser, value: string) => {
    setUsers(
      users.map((u) => {
        if (u.id === id) {
          const updated = { ...u, [field]: value };
          // Auto-update official_name when firstName or lastName changes
          if (field === 'firstName' || field === 'lastName') {
            const firstName = field === 'firstName' ? value : u.firstName;
            const lastName = field === 'lastName' ? value : u.lastName;
            const fullName = `${firstName} ${lastName}`.trim();
            updated.official_name = fullName;
          }
          return updated;
        }
        return u;
      })
    );
  };

  const validateUsers = (): boolean => {
    for (const user of users) {
      if (!user.email.trim()) {
        setError('All users must have an email address');
        return false;
      }
      if (!isValidEmail(user.email)) {
        setError(`Invalid email format: ${user.email}`);
        return false;
      }
      if (!user.firstName.trim() || !user.lastName.trim()) {
        setError('All users must have first and last names');
        return false;
      }
    }

    // Check for duplicate emails
    const emails = users.map((u) => u.email.toLowerCase());
    const duplicates = emails.filter((e, i) => emails.indexOf(e) !== i);
    if (duplicates.length > 0) {
      setError(`Duplicate email addresses found: ${duplicates.join(', ')}`);
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessResults([]);
    setShowResults(false);

    if (!validateUsers()) {
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ users }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create users');
      }

      setSuccessResults(data.results);
      setShowResults(true);

      // Reset form for successful users
      const failedUsers = data.results.filter((r: CreatedUser) => r.status === 'error');
      if (failedUsers.length === 0) {
        // All succeeded, reset form
        setUsers([
          {
            id: crypto.randomUUID(),
            email: '',
            role: 'worker',
            division: 'vendor',
            firstName: '',
            lastName: '',
            official_name: '',
          },
        ]);
      } else {
        // Keep only failed users in form
        setUsers(
          failedUsers.map((u: CreatedUser) => ({
            id: crypto.randomUUID(),
            email: u.email,
            role: u.role,
            division: u.division,
            firstName: u.firstName,
            lastName: u.lastName,
            official_name: u.official_name,
          }))
        );
      }
    } catch (err: any) {
      console.error('Signup error:', err);
      setError(err.message || 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const sendCredentialsEmail = async (user: CreatedUser) => {
    // Set loading state
    setSuccessResults(results =>
      results.map(r =>
        r.id === user.id ? { ...r, emailSending: true } : r
      )
    );

    try {
      const response = await fetch('/api/auth/send-credentials', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          temporaryPassword: user.temporaryPassword,
        }),
      });

      const data = await response.json();

      console.log('[Frontend] Email send response:', {
        ok: response.ok,
        status: response.status,
        data,
        userId: user.id,
        email: user.email
      });

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send email');
      }

      // Verify the response contains success field
      if (!data.success) {
        throw new Error(data.error || 'Email sending was not successful');
      }

      // Update to show email sent
      setSuccessResults(results => {
        const updated = results.map(r => {
          if (r.id === user.id) {
            console.log('[Frontend] Updating user state to emailSent=true:', { userId: r.id, email: r.email });
            return { ...r, emailSent: true, emailSending: false };
          }
          return r;
        });
        console.log('[Frontend] State updated, emailSent should now be true');
        return updated;
      });
    } catch (err: any) {
      console.error('Send email error:', err);
      alert(`Failed to send email: ${err.message}`);

      // Remove loading state
      setSuccessResults(results =>
        results.map(r =>
          r.id === user.id ? { ...r, emailSending: false } : r
        )
      );
    }
  };

  const sendAllCredentialsEmails = async () => {
    // Get all successful users who haven't received emails yet
    const usersToEmail = successResults.filter(
      r => r.status === 'success' && !r.emailSent && !r.emailSending
    );

    if (usersToEmail.length === 0) {
      alert('No users to send emails to. All emails have already been sent.');
      return;
    }

    if (!confirm(`Send credentials emails to ${usersToEmail.length} user(s)?`)) {
      return;
    }

    // Set loading state for all users
    setSuccessResults(results =>
      results.map(r =>
        r.status === 'success' && !r.emailSent
          ? { ...r, emailSending: true }
          : r
      )
    );

    let successCount = 0;
    let failCount = 0;

    // Send emails sequentially to avoid rate limiting
    for (const user of usersToEmail) {
      try {
        const response = await fetch('/api/auth/send-credentials', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            userId: user.id,
            email: user.email,
            firstName: user.firstName,
            lastName: user.lastName,
            temporaryPassword: user.temporaryPassword,
          }),
        });

        const data = await response.json();

        console.log('[Frontend] Bulk email send response:', {
          ok: response.ok,
          status: response.status,
          data,
          userId: user.id,
          email: user.email
        });

        if (!response.ok) {
          throw new Error(data.error || 'Failed to send email');
        }

        // Verify the response contains success field
        if (!data.success) {
          throw new Error(data.error || 'Email sending was not successful');
        }

        // Update individual user to show email sent
        setSuccessResults(results =>
          results.map(r =>
            r.id === user.id
              ? { ...r, emailSent: true, emailSending: false }
              : r
          )
        );

        successCount++;
      } catch (err: any) {
        console.error(`Failed to send email to ${user.email}:`, err);

        // Remove loading state for failed user
        setSuccessResults(results =>
          results.map(r =>
            r.id === user.id ? { ...r, emailSending: false } : r
          )
        );

        failCount++;
      }
    }

    // Show summary
    if (failCount === 0) {
      alert(`✅ Successfully sent credentials emails to all ${successCount} user(s)!`);
    } else {
      alert(`📧 Sent ${successCount} email(s) successfully.\n❌ Failed to send ${failCount} email(s).`);
    }
  };

  const downloadCSVTemplate = () => {
    const template = `firstName,lastName,email,role,division
John,Doe,john.doe@example.com,worker,vendor
Jane,Smith,jane.smith@example.com,manager,trailers
Bob,Johnson,bob.johnson@example.com,finance,both
Helen,Reed,helen.reed@example.com,hr,vendor
Ben,Check,ben.check@example.com,backgroundchecker,vendor`;

    const blob = new Blob([template], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'user_import_template.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const handleCSVImport = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setImportError('');

    // Validate file type
    if (!file.name.endsWith('.csv')) {
      setImportError('Please upload a CSV file');
      return;
    }

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const importedUsers: NewUser[] = [];
          const errors: string[] = [];

          results.data.forEach((row: any, index: number) => {
            const rowNum = index + 2; // +2 because of header row and 0-based index

            // Validate required fields
            if (!row.firstName || !row.lastName || !row.email || !row.role || !row.division) {
              errors.push(`Row ${rowNum}: Missing required fields`);
              return;
            }

            // Validate email
            if (!isValidEmail(row.email)) {
              errors.push(`Row ${rowNum}: Invalid email format (${row.email})`);
              return;
            }

            // Validate role
            if (!['worker', 'manager', 'finance', 'exec', 'hr', 'backgroundchecker'].includes(row.role.toLowerCase())) {
              errors.push(`Row ${rowNum}: Invalid role (must be: worker, manager, finance, exec, hr, or backgroundchecker)`);
              return;
            }

            // Validate division
            if (!['vendor', 'trailers', 'both'].includes(row.division.toLowerCase())) {
              errors.push(`Row ${rowNum}: Invalid division (must be: vendor, trailers, or both)`);
              return;
            }

            const firstName = row.firstName.trim();
            const lastName = row.lastName.trim();
            const fullName = `${firstName} ${lastName}`.trim();

            importedUsers.push({
              id: crypto.randomUUID(),
              firstName,
              lastName,
              email: row.email.trim().toLowerCase(),
              role: row.role.toLowerCase() as 'worker' | 'manager' | 'finance' | 'exec' | 'hr' | 'backgroundchecker',
              division: row.division.toLowerCase() as 'vendor' | 'trailers' | 'both',
              official_name: fullName,
            });
          });

          if (errors.length > 0) {
            setImportError(`CSV Import Errors:\n${errors.join('\n')}`);
            return;
          }

          if (importedUsers.length === 0) {
            setImportError('No valid users found in CSV file');
            return;
          }

          // Check for duplicate emails in imported data
          const emails = importedUsers.map(u => u.email);
          const duplicates = emails.filter((e, i) => emails.indexOf(e) !== i);
          if (duplicates.length > 0) {
            setImportError(`Duplicate emails found in CSV: ${[...new Set(duplicates)].join(', ')}`);
            return;
          }

          // Replace current users with imported users
          setUsers(importedUsers);
          setError('');
          setImportError('');
          setCurrentPage(1); // Reset to first page

          // Show success message
          alert(`✅ Successfully imported ${importedUsers.length} user(s) from CSV`);
        } catch (err: any) {
          setImportError(`CSV parsing error: ${err.message}`);
        }
      },
      error: (err: any) => {
        setImportError(`Failed to read CSV file: ${err.message}`);
      },
    });

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  useEffect(() => {
    const fetchVendorRoster = async () => {
      setVendorLoading(true);
      setVendorError('');
      try {
        console.log('[Vendor Roster Frontend] Starting fetch...');
        const { data: { session } } = await supabase.auth.getSession();
        console.log('[Vendor Roster Frontend] Session:', { hasSession: !!session, hasToken: !!session?.access_token });

        const response = await fetch('/api/vendor-roster', {
          method: 'GET',
          headers: {
            ...(session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}),
          },
          credentials: 'include',
        });
        console.log('[Vendor Roster Frontend] Response status:', response.status);

        const payload = await response.json().catch(() => ({}));
        console.log('[Vendor Roster Frontend] Response payload:', payload);

        if (!response.ok) {
          throw new Error(payload.error || 'Failed to load vendor roster');
        }

        console.log('[Vendor Roster Frontend] Number of vendors:', payload.vendors?.length || 0);

        const normalized = (payload.vendors || []).map((vendor: any) => ({
          firstName: vendor.first_name || '',
          lastName: vendor.last_name || '',
          addressLine1: vendor.address_line1 || '',
          city: vendor.city || '',
          state: vendor.state || '',
          zip: vendor.zip || '',
          cellPhone: vendor.cell_phone || '',
          email: vendor.email || '',
          newHirePacket: Boolean(vendor.new_hire_packet),
        }));

        console.log('[Vendor Roster Frontend] Normalized vendors:', normalized);
        setVendorRoster(normalized);
      } catch (err: any) {
        console.error('[Vendor Roster Frontend] Error loading vendor roster:', err);
        setVendorError(err.message || 'Failed to load vendor roster');
      } finally {
        setVendorLoading(false);
      }
    };

    fetchVendorRoster();
  }, []);

  const createAllVendorUsers = () => {
    // Get all vendors with email addresses
    const vendorsWithEmail = vendorRoster.filter(vendor => vendor.email?.trim());

    if (vendorsWithEmail.length === 0) {
      alert('No vendors with email addresses found.');
      return;
    }

    // Get existing emails in the user creation form (excluding empty users)
    const existingEmails = new Set(
      users
        .filter(u => u.email.trim())
        .map(u => u.email.toLowerCase().trim())
    );

    // Filter out vendors already in the form
    const newVendors = vendorsWithEmail.filter(vendor => {
      const vendorEmail = vendor.email.toLowerCase().trim();
      return !existingEmails.has(vendorEmail);
    });

    if (newVendors.length === 0) {
      alert('All vendors with email addresses are already in the user creation form.');
      return;
    }

    if (!confirm(`Add ${newVendors.length} vendor(s) to the user creation form?`)) {
      return;
    }

    // Create user objects for all new vendors
    const vendorUsers: NewUser[] = newVendors.map(vendor => {
      const firstName = vendor.firstName || '';
      const lastName = vendor.lastName || '';
      const fullName = `${firstName} ${lastName}`.trim();

      return {
        id: crypto.randomUUID(),
        email: vendor.email.trim(),
        role: 'worker' as const,
        division: 'vendor' as const,
        firstName,
        lastName,
        official_name: fullName,
      };
    });

    // Skip placeholders so we only keep rows with actual data before merging
    const meaningfulUsers = users.filter((user) =>
      user.email.trim() || user.firstName.trim() || user.lastName.trim()
    );

    if (meaningfulUsers.length === 0) {
      setUsers(vendorUsers);
    } else {
      setUsers([...meaningfulUsers, ...vendorUsers]);
    }

    // Show success message
    const message = document.createElement('div');
    message.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
    message.textContent = `✓ Added ${vendorUsers.length} vendor(s) to form`;
    document.body.appendChild(message);
    setTimeout(() => message.remove(), 3000);

    // Scroll to the form
    setTimeout(() => {
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
    }, 100);
  };

  const isCompactMode = users.length > 3;
  const isPaginated = users.length > 20;

  // Pagination calculations
  const totalPages = Math.ceil(users.length / usersPerPage);
  const startIndex = (currentPage - 1) * usersPerPage;
  const endIndex = startIndex + usersPerPage;
  const paginatedUsers = isPaginated ? users.slice(startIndex, endIndex) : users;
  const displayUsers = isCompactMode ? paginatedUsers : users;

  // Reset to page 1 if current page is out of bounds
  if (currentPage > totalPages && totalPages > 0) {
    setCurrentPage(1);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-50 to-primary-100 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <Link href="/" className="text-primary-600 hover:text-primary-700 transition-colors">
            ← Back to Home
          </Link>
          <div className="mt-6">
            <div className="w-16 h-16 bg-primary-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900">Create New Users</h1>
            <p className="text-gray-600 mt-2">
              Add one or multiple users to the PDS Time keeping System
            </p>
            <p className="text-sm text-gray-500 mt-1">
              Create accounts first, then send credentials via email when ready
            </p>
          </div>
        </div>

        {/* Vendor Roster */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6 border border-gray-100">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Vendor Roster</h2>
                <p className="text-sm text-gray-600 mt-1">
                  Provided vendor details with new hire packet status.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center justify-center px-3 py-1 rounded-full bg-gray-100 text-gray-700 text-sm font-medium">
                  {vendorLoading ? 'Loading...' : `${vendorRoster.length} vendors`}
                </span>
                {!vendorLoading && vendorRoster.length > 0 && (
                  <button
                    onClick={createAllVendorUsers}
                    className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-green-600 to-green-700 rounded-lg hover:from-green-700 hover:to-green-800 shadow-md hover:shadow-lg transition-all duration-200"
                    title="Add all vendors with email addresses to user creation form"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                    </svg>
                    <span>Create All Users</span>
                  </button>
                )}
              </div>
            </div>

            {vendorError && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
                {vendorError}
              </div>
            )}

          {vendorLoading ? (
            <div className="mt-4 border border-gray-200 rounded-lg p-6 text-sm text-gray-600">
              Loading vendor roster...
            </div>
          ) : vendorRoster.length === 0 ? (
            <div className="mt-4 border border-gray-200 rounded-lg p-6 text-sm text-gray-600">
              No vendor records found.
            </div>
          ) : (
            <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
              <div className="overflow-auto max-h-[520px]">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase keeping-wide">Vendor First Name</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase keeping-wide">Vendor Last Name</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase keeping-wide">Address Line 1</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase keeping-wide">City</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase keeping-wide">State</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase keeping-wide">Zip</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase keeping-wide">Cell Phone</th>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase keeping-wide">Email</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase keeping-wide">New Hire Packet</th>
                      <th className="px-3 py-2 text-center text-xs font-semibold text-gray-500 uppercase keeping-wide">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {vendorRoster.map((vendor, index) => (
                      <tr key={`${vendor.email || vendor.firstName}-${index}`} className="hover:bg-gray-50">
                        <td className="px-3 py-2 whitespace-nowrap">{vendor.firstName}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{vendor.lastName}</td>
                        <td className="px-3 py-2">{vendor.addressLine1 || 'N/A'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{vendor.city || 'N/A'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{vendor.state || 'N/A'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{vendor.zip || 'N/A'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{vendor.cellPhone || 'N/A'}</td>
                        <td className="px-3 py-2">{vendor.email || 'N/A'}</td>
                        <td className="px-3 py-2 text-center">
                          {vendor.newHirePacket ? (
                            <span className="inline-flex items-center justify-center px-2 py-1 text-xs font-semibold text-green-700 bg-green-50 rounded-full">✓</span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            onClick={() => {
                              // Check if vendor email already exists in the form
                              const vendorEmail = vendor.email?.toLowerCase().trim();
                              if (!vendorEmail) {
                                alert('This vendor has no email address');
                                return;
                              }

                              const isDuplicate = users.some(u => u.email.toLowerCase().trim() === vendorEmail);
                              if (isDuplicate) {
                                alert(`${vendor.firstName} ${vendor.lastName} is already in the user creation form`);
                                return;
                              }

                              // Add vendor to user creation form
                              const firstName = vendor.firstName || '';
                              const lastName = vendor.lastName || '';
                              const fullName = `${firstName} ${lastName}`.trim();

                              setUsers([
                                ...users,
                                {
                                  id: crypto.randomUUID(),
                                  email: vendorEmail,
                                  role: 'worker',
                                  division: 'vendor',
                                  firstName,
                                  lastName,
                                  official_name: fullName,
                                }
                              ]);

                              // Show success message
                              const message = document.createElement('div');
                              message.className = 'fixed top-4 right-4 bg-green-500 text-white px-6 py-3 rounded-lg shadow-lg z-50 animate-fade-in';
                              message.textContent = `✓ Added ${vendor.firstName} ${vendor.lastName} to form`;
                              document.body.appendChild(message);
                              setTimeout(() => message.remove(), 3000);

                              // Scroll to the form
                              setTimeout(() => {
                                window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
                              }, 100);
                            }}
                            disabled={!vendor.email}
                            className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold text-white bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg hover:from-blue-700 hover:to-blue-800 shadow-md hover:shadow-lg transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed disabled:from-gray-400 disabled:to-gray-400 whitespace-nowrap"
                            title={vendor.email ? "Add to user creation form" : "No email address"}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                            </svg>
                            <span>Create User</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* CSV Import Section */}
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-6 border border-gray-100">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <svg className="w-6 h-6 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Bulk Import from CSV
              </h2>
              <p className="text-sm text-gray-600 mt-1">
                Upload a CSV file to create multiple users at once
              </p>
            </div>
            <button
              onClick={downloadCSVTemplate}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary-600 bg-primary-50 rounded-lg hover:bg-primary-100 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Download Template
            </button>
          </div>

          {/* Import Error */}
          {importError && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
              <pre className="text-sm text-red-800 whitespace-pre-wrap font-mono">{importError}</pre>
            </div>
          )}

          {/* File Upload */}
          <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-primary-500 transition-colors">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              onChange={handleCSVImport}
              className="hidden"
              id="csv-upload"
            />
            <label
              htmlFor="csv-upload"
              className="cursor-pointer flex flex-col items-center"
            >
              <svg className="w-12 h-12 text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <p className="text-lg font-medium text-gray-900 mb-1">
                Click to upload CSV file
              </p>
              <p className="text-sm text-gray-500">
                or drag and drop your CSV file here
              </p>
            </label>
          </div>

          {/* CSV Format Info */}
          <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <div className="text-sm text-blue-800">
                <p className="font-medium mb-2">Required CSV Format:</p>
                <ul className="list-disc ml-4 space-y-1">
                  <li><strong>Headers:</strong> firstName, lastName, email, role, division</li>
                  <li><strong>Role values:</strong> worker, manager, finance, exec, hr, or backgroundchecker</li>
                  <li><strong>Division values:</strong> vendor, trailers, or both</li>
                  <li>Download the template above for an example</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        {/* Success Results Modal */}
        {showResults && successResults.length > 0 && (
          <div className="bg-white rounded-2xl shadow-xl p-8 mb-6 border border-gray-100">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Users Created</h2>
              <button
                onClick={() => setShowResults(false)}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Send All Button */}
            {successResults.some(r => r.status === 'success' && !r.emailSent) && (
              <div className="mb-6 bg-gradient-to-r from-primary-50 to-blue-50 border border-primary-200 rounded-lg p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                      <svg className="w-5 h-5 text-primary-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-gray-900">
                        Send Credentials to All Users
                      </p>
                      <p className="text-xs text-gray-600">
                        {successResults.filter(r => r.status === 'success' && !r.emailSent).length} user(s) pending email
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={sendAllCredentialsEmails}
                    disabled={successResults.some(r => r.emailSending)}
                    className="liquid-btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {successResults.some(r => r.emailSending) ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Sending...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                        </svg>
                        <span>Send to All</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            <div className="space-y-4">
              {successResults.map((result) => (
                <div
                  key={result.id}
                  className={`p-4 rounded-lg border ${
                    result.status === 'success'
                      ? 'bg-green-50 border-green-200'
                      : 'bg-red-50 border-red-200'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        {result.status === 'success' ? (
                          <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        ) : (
                          <svg className="w-5 h-5 text-red-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          </svg>
                        )}
                        <div>
                          <p className="font-semibold text-gray-900">
                            {result.firstName} {result.lastName}
                          </p>
                          <p className="text-sm text-gray-600">{result.email}</p>
                        </div>
                      </div>

                      {result.status === 'success' ? (
                        <div className="mt-3 bg-white p-3 rounded border border-gray-200">
                          <p className="text-xs text-gray-500 mb-1">Temporary Password:</p>
                          <div className="flex items-center gap-2 mb-3">
                            <code className="text-sm font-mono bg-gray-50 px-2 py-1 rounded flex-1">
                              {result.temporaryPassword}
                            </code>
                            <button
                              onClick={() => copyToClipboard(result.temporaryPassword)}
                              className="text-primary-600 hover:text-primary-700 text-xs px-2 py-1 border border-primary-300 rounded hover:bg-primary-50 transition-colors"
                              title="Copy to clipboard"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                          </div>
                          
                          {result.emailSent ? (
                            <div className="flex items-center gap-2 text-green-600 text-xs">
                              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                              </svg>
                              <span>Email sent to user successfully!</span>
                            </div>
                          ) : (
                            <button
                              onClick={() => sendCredentialsEmail(result)}
                              disabled={result.emailSending}
                              className="liquid-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              {result.emailSending ? (
                                <>
                                  <svg className="animate-spin h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  <span>Sending Email...</span>
                                </>
                              ) : (
                                <>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                                  </svg>
                                  <span>Send Credentials Email</span>
                                </>
                              )}
                            </button>
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-red-600 mt-2">{result.message}</p>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Google Authenticator Notice */}
            <div className="mt-6 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-3">
                <img
                  src="/googleAuthenticator.png"
                  alt="Google Authenticator"
                  className="w-12 h-12 rounded-lg flex-shrink-0"
                />
                <div className="flex-1">
                  <p className="font-semibold text-gray-900 mb-2">Google Authenticator Required</p>
                  <p className="text-sm text-gray-700 mb-3">
                    Users will need to download Google Authenticator on their mobile phones to complete MFA setup during onboarding.
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <a
                      href="https://apps.apple.com/us/app/google-authenticator/id388497605"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg transition-colors text-xs font-medium"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z"/>
                      </svg>
                      Download for iOS
                    </a>
                    <a
                      href="https://play.google.com/store/apps/details?id=com.google.android.apps.authenticator2"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-center gap-1.5 bg-white hover:bg-gray-50 border border-gray-300 text-gray-700 px-3 py-2 rounded-lg transition-colors text-xs font-medium"
                    >
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M3,20.5V3.5C3,2.91 3.34,2.39 3.84,2.15L13.69,12L3.84,21.85C3.34,21.6 3,21.09 3,20.5M16.81,15.12L6.05,21.34L14.54,12.85L16.81,15.12M20.16,10.81C20.5,11.08 20.75,11.5 20.75,12C20.75,12.5 20.53,12.9 20.18,13.18L17.89,14.5L15.39,12L17.89,9.5L20.16,10.81M6.05,2.66L16.81,8.88L14.54,11.15L6.05,2.66Z"/>
                      </svg>
                      Download for Android
                    </a>
                  </div>
                  <p className="text-xs text-gray-600 mt-2">
                    Share these download links with users so they can prepare for MFA setup
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="text-sm text-blue-800">
                  <p className="font-medium">Two-Step Workflow:</p>
                  <ul className="list-disc ml-4 mt-1 space-y-1">
                    <li><strong>Step 1:</strong> Create user accounts and view/copy temporary passwords</li>
                    <li><strong>Step 2:</strong> Click "Send Credentials Email" to send login instructions to each user</li>
                    <li>Passwords expire in 7 days if not used</li>
                    <li>Users must change password on first login (FLSA compliant)</li>
                    <li>Users will need Google Authenticator app for MFA setup during onboarding</li>
                    <li>Save passwords before sending email - cannot be retrieved later</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Main Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8 border border-gray-100">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Error Message */}
            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
                <p className="text-sm text-red-800">{error}</p>
              </div>
            )}

            {/* User Forms */}
            {isCompactMode ? (
              /* Compact Table View for 3+ users */
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm text-gray-600">
                    <span className="font-semibold text-gray-900">{users.length}</span> users in bulk mode
                    {isPaginated && (
                      <span className="text-gray-500 ml-2">
                        (showing {startIndex + 1}-{Math.min(endIndex, users.length)})
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-500">
                    Compact view • Remove users to see full form
                  </p>
                </div>
              <div className="border border-gray-200 rounded-lg overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">First Name</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Last Name</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Email</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Division</th>
                        <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase w-16"></th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {displayUsers.map((user, index) => (
                        <tr key={user.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={user.firstName}
                              onChange={(e) => updateUser(user.id, 'firstName', e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-transparent"
                              placeholder="John"
                              required
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="text"
                              value={user.lastName}
                              onChange={(e) => updateUser(user.id, 'lastName', e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-transparent"
                              placeholder="Doe"
                              required
                            />
                          </td>
                          <td className="px-3 py-2">
                            <input
                              type="email"
                              value={user.email}
                              onChange={(e) => updateUser(user.id, 'email', e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-transparent"
                              placeholder="john@pds.com"
                              required
                            />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={user.role}
                              onChange={(e) => updateUser(user.id, 'role', e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-transparent"
                              required
                            >
                              <option value="worker">Worker</option>
                              <option value="manager">Manager</option>
                              <option value="finance">Finance</option>
                              <option value="exec">Executive</option>
                              <option value="hr">HR</option>
                              <option value="backgroundchecker">Background Checker</option>
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value={user.division}
                              onChange={(e) => updateUser(user.id, 'division', e.target.value)}
                              className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 focus:border-transparent"
                              required
                            >
                              <option value="vendor">Vendor</option>
                              <option value="trailers">Trailers</option>
                              <option value="both">Both</option>
                            </select>
                          </td>
                          <td className="px-3 py-2 text-center">
                            {users.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeUser(user.id)}
                                className="text-gray-400 hover:text-red-600 transition-colors"
                                title="Remove user"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination Controls */}
              {isPaginated && (
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border border-t-0 border-gray-200 rounded-b-lg">
                  <div className="flex items-center gap-2">
                    <p className="text-sm text-gray-700">
                      Page <span className="font-medium">{currentPage}</span> of{' '}
                      <span className="font-medium">{totalPages}</span>
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrentPage(Math.max(1, currentPage - 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Previous
                    </button>
                    
                    {/* Page Numbers */}
                    <div className="flex gap-1">
                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter((pageNum) => {
                          // Show first page, last page, current page, and 2 pages around current
                          return (
                            pageNum === 1 ||
                            pageNum === totalPages ||
                            Math.abs(pageNum - currentPage) <= 1
                          );
                        })
                        .map((pageNum, index, array) => {
                          // Add ellipsis if there's a gap
                          const prevPageNum = array[index - 1];
                          const showEllipsis = prevPageNum && pageNum - prevPageNum > 1;
                          
                          return (
                            <React.Fragment key={pageNum}>
                              {showEllipsis && (
                                <span className="px-2 py-1 text-sm text-gray-500">...</span>
                              )}
                              <button
                                type="button"
                                onClick={() => setCurrentPage(pageNum)}
                                className={`px-3 py-1 text-sm font-medium rounded-md ${
                                  currentPage === pageNum
                                    ? 'bg-primary-600 text-white'
                                    : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                                }`}
                              >
                                {pageNum}
                              </button>
                            </React.Fragment>
                          );
                        })}
                    </div>
                    
                    <button
                      type="button"
                      onClick={() => setCurrentPage(Math.min(totalPages, currentPage + 1))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
              </div>
            ) : (
              /* Full Card View for 1-3 users */
              users.map((user, index) => (
                <div key={user.id} className="border border-gray-200 rounded-lg p-6 relative">
                  {/* Remove Button */}
                  {users.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeUser(user.id)}
                      className="absolute top-4 right-4 text-gray-400 hover:text-red-600 transition-colors"
                      title="Remove user"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}

                  <h3 className="text-lg font-semibold text-gray-900 mb-4">
                    User {index + 1}
                  </h3>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* First Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      First Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={user.firstName}
                      onChange={(e) => updateUser(user.id, 'firstName', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="John"
                      required
                    />
                  </div>

                  {/* Last Name */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Last Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={user.lastName}
                      onChange={(e) => updateUser(user.id, 'lastName', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="Doe"
                      required
                    />
                  </div>

                  {/* Email */}
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Email Address <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      value={user.email}
                      onChange={(e) => updateUser(user.id, 'email', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      placeholder="john.doe@pds.com"
                      required
                    />
                  </div>

                  {/* Role */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Role <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={user.role}
                      onChange={(e) => updateUser(user.id, 'role', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      required
                    >
                      <option value="worker">Worker/Vendor</option>
                      <option value="manager">Room Manager</option>
                      <option value="finance">Finance</option>
                      <option value="exec">Executive</option>
                      <option value="hr">HR</option>
                      <option value="backgroundchecker">Background Checker</option>
                    </select>
                  </div>

                  {/* Division */}
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Division <span className="text-red-500">*</span>
                    </label>
                    <select
                      value={user.division}
                      onChange={(e) => updateUser(user.id, 'division', e.target.value)}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                      required
                    >
                      <option value="vendor">PDS Vendor</option>
                      <option value="trailers">CWT Trailers</option>
                      <option value="both">Both Divisions</option>
                    </select>
                  </div>
                </div>
              </div>
            ))
            )}

            {/* Add User Button */}
            <button
              type="button"
              onClick={addUser}
              className="w-full py-3 px-4 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 hover:border-primary-500 hover:text-primary-600 transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              Add Another User
            </button>

            {/* Security Notice */}
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 flex items-start gap-3">
              <svg className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <div className="text-sm text-yellow-800">
                <p className="font-medium">Security & Compliance:</p>
                <ul className="list-disc ml-4 mt-1 space-y-1">
                  <li>Temporary passwords are randomly generated (16 characters, secure)</li>
                  <li>Passwords expire in 7 days if not used</li>
                  <li>Users must set a new password on first login (FLSA compliant)</li>
                  <li>All account creation events are logged for audit trail</li>
                  <li>Emails are encrypted in transit (TLS 1.2+)</li>
                </ul>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading || users.length === 0}
              className="liquid-btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Creating {users.length} User{users.length > 1 ? 's' : ''}...</span>
                </>
              ) : (
                <>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                  </svg>
                  <span>Create {users.length} User{users.length > 1 ? 's' : ''} (Email Separate)</span>
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer */}
        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Already have an account?{' '}
            <Link href="/login" className="text-primary-600 hover:text-primary-700 font-medium transition-colors">
              Sign in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
