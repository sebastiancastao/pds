export const I9_SSN_FIELD_NAME = 'US Social Security Number';
export const I9_STATE_FIELD_NAME = 'State';
export const I9_SSN_LENGTH = 9;

export const sanitizeI9Ssn = (value: string | null | undefined) =>
  String(value ?? '').replace(/\D/g, '').slice(0, I9_SSN_LENGTH);

export const isValidI9Ssn = (value: string | null | undefined) =>
  new RegExp(`^\\d{${I9_SSN_LENGTH}}$`).test(String(value ?? ''));
