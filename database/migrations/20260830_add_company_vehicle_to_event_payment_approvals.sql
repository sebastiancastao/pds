-- Marks that an employee used a company vehicle for an event, which makes
-- mileage reimbursement not applicable (forced to $0) regardless of the
-- mileage_approved flag or any manual mileage_amount_override.
-- Default FALSE: mileage pay is unaffected unless explicitly flagged.

ALTER TABLE event_payment_approvals
  ADD COLUMN IF NOT EXISTS mileage_company_vehicle BOOLEAN DEFAULT FALSE;
