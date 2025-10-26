"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import "./team-confirmation-styles.css";

interface EventDetails {
  id: string;
  event_name: string;
  event_date: string;
  venue?: string;
}

interface InvitationData {
  id: string;
  eventId: string;
  vendorId: string;
  status: string;
  createdAt: string;
  event: EventDetails;
  vendor: {
    firstName: string;
    lastName: string;
  };
}

export default function TeamConfirmationPage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [alreadyResponded, setAlreadyResponded] = useState(false);
  const [currentStatus, setCurrentStatus] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [responseMessage, setResponseMessage] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      fetchInvitation();
    }
  }, [token]);

  const fetchInvitation = async () => {
    try {
      setLoading(true);
      console.log('🔍 Fetching invitation with token:', token);
      const response = await fetch(`/api/team-confirmation/${token}`);
      const data = await response.json();

      console.log('📥 Response status:', response.status);
      console.log('📥 Response data:', data);

      if (!response.ok) {
        console.error('❌ Error response:', data);
        const errorMessage = data.error || 'Failed to load invitation';
        const errorDetails = data.details ? `\n\nDetails: ${data.details}` : '';
        setError(errorMessage + errorDetails);
        return;
      }

      if (data.alreadyResponded) {
        setAlreadyResponded(true);
        setCurrentStatus(data.status);
      } else {
        setInvitation(data.invitation);
      }
    } catch (err: any) {
      console.error('❌ Exception:', err);
      setError(err.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const handleResponse = async (action: 'confirm' | 'decline') => {
    try {
      setProcessing(true);
      console.log('🔄 Submitting response:', action);
      const response = await fetch(`/api/team-confirmation/${token}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action }),
      });

      const data = await response.json();
      console.log('📥 Response data:', data);

      if (!response.ok) {
        console.error('❌ Error response:', data);
        setError(data.error || 'Failed to process your response');
        return;
      }

      console.log('✅ Success! Status:', data.status);
      setResponseMessage(data.message);
      setCurrentStatus(data.status);

      // Redirect to login after 3 seconds
      setTimeout(() => {
        router.push('/login');
      }, 3000);

    } catch (err: any) {
      console.error('❌ Exception:', err);
      setError(err.message || 'An error occurred');
    } finally {
      setProcessing(false);
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  if (loading) {
    return (
      <div className="confirmation-container">
        <div className="confirmation-card">
          <div className="loading-spinner"></div>
          <p className="loading-text">Loading invitation...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="confirmation-container">
        <div className="confirmation-card">
          <div className="error-icon">⚠️</div>
          <h1 className="confirmation-title">Invitation Not Found</h1>
          <p className="confirmation-message">{error}</p>
          <button
            onClick={() => router.push('/login')}
            className="apple-button apple-button-primary"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (alreadyResponded) {
    return (
      <div className="confirmation-container">
        <div className="confirmation-card">
          <div className={`status-icon ${currentStatus === 'confirmed' ? 'success' : 'declined'}`}>
            {currentStatus === 'confirmed' ? '✓' : '✕'}
          </div>
          <h1 className="confirmation-title">Already Responded</h1>
          <p className="confirmation-message">
            You have already {currentStatus === 'confirmed' ? 'confirmed' : 'declined'} this invitation.
          </p>
          <button
            onClick={() => router.push('/login')}
            className="apple-button apple-button-primary"
          >
            Go to Login
          </button>
        </div>
      </div>
    );
  }

  if (responseMessage) {
    return (
      <div className="confirmation-container">
        <div className="confirmation-card">
          <div className={`status-icon success ${currentStatus === 'declined' ? 'declined' : ''}`}>
            {currentStatus === 'confirmed' ? '✓' : '✕'}
          </div>
          <h1 className="confirmation-title">
            {currentStatus === 'confirmed' ? 'Confirmed!' : 'Declined'}
          </h1>
          <p className="confirmation-message">{responseMessage}</p>
          <p className="redirect-message">Redirecting to login...</p>
        </div>
      </div>
    );
  }

  if (!invitation) {
    return null;
  }

  return (
    <div className="confirmation-container">
      <div className="confirmation-card">
        <div className="confirmation-header">
          <div className="invitation-icon">🎉</div>
          <h1 className="confirmation-title">Team Invitation</h1>
          <p className="confirmation-subtitle">You've been selected!</p>
        </div>

        <div className="vendor-greeting">
          <p>Hello <strong>{invitation.vendor.firstName} {invitation.vendor.lastName}</strong>,</p>
          <p>You've been selected to join the team for the following event:</p>
        </div>

        <div className="event-details-card">
          <h2 className="event-details-title">Event Details</h2>
          <div className="event-details-grid">
            <div className="event-detail-row">
              <span className="detail-label">Event:</span>
              <span className="detail-value">{invitation.event.event_name}</span>
            </div>
            <div className="event-detail-row">
              <span className="detail-label">Date:</span>
              <span className="detail-value">{formatDate(invitation.event.event_date)}</span>
            </div>
            {invitation.event.venue && (
              <div className="event-detail-row">
                <span className="detail-label">Venue:</span>
                <span className="detail-value">{invitation.event.venue}</span>
              </div>
            )}
          </div>
        </div>

        <div className="confirmation-prompt">
          <p className="prompt-text">
            Please confirm your participation or decline if you're unable to attend.
          </p>
        </div>

        <div className="action-buttons">
          <button
            onClick={() => handleResponse('confirm')}
            disabled={processing}
            className="apple-button apple-button-confirm"
          >
            {processing ? (
              <>
                <span className="button-spinner"></span>
                Processing...
              </>
            ) : (
              <>
                <svg className="button-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
                Confirm Participation
              </>
            )}
          </button>

          <button
            onClick={() => handleResponse('decline')}
            disabled={processing}
            className="apple-button apple-button-decline"
          >
            {processing ? (
              <>
                <span className="button-spinner"></span>
                Processing...
              </>
            ) : (
              <>
                <svg className="button-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                </svg>
                Decline
              </>
            )}
          </button>
        </div>

        <div className="important-note">
          <p className="note-text">
            <strong>⏰ Action Required:</strong> Please respond within 48 hours to secure your spot on the team.
          </p>
        </div>
      </div>
    </div>
  );
}
