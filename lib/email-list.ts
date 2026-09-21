// Shared email-list parsing for the admin email UI and the send-email API.
// Dependency-free so it can run in the browser and on the server, which keeps
// the recipient count on screen identical to what the API actually sends.
//
// Handles the messy things people paste from Excel, Outlook, Gmail and CSVs:
//   "John Doe <john@x.com>, Jane <jane@x.com>"   display names + angle brackets
//   "a@x.com","b@x.com"                            quoted CSV cells
//   a@x.com; b@x.com | c@x.com                     mixed separators, newlines
//   mailto:a@x.com, (b@x.com), a@x.com.            prefixes, brackets, trailing dots
//   zero-width spaces, non-breaking spaces, full-width commas

const ZERO_WIDTH = /[​-‍⁠﻿]/g;

// Whitespace (including NBSP) plus every separator or wrapper seen in pastes.
const TOKEN_SEPARATORS = /[\s,;|<>()[\]"“”„，；、،]+/;

// Punctuation that sticks to the start or end of an address in prose or CSV.
const EDGE_JUNK = /^['‘’.:*-]+|['‘’.:!?*-]+$/g;

const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
const TLD = /^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/i;

/**
 * Strict address check. Stricter than "something@something.something" on
 * purpose: one malformed address makes the email provider reject the whole
 * batch it is in, so it must never reach a send.
 */
export function isValidEmailAddress(value: string): boolean {
  const email = String(value || '');
  if (email.length > 254) return false;

  const at = email.indexOf('@');
  if (at < 1 || at !== email.lastIndexOf('@')) return false;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || !LOCAL_PART.test(local)) return false;

  const labels = domain.split('.');
  if (labels.length < 2) return false;
  if (!labels.every((label) => DOMAIN_LABEL.test(label))) return false;
  return TLD.test(labels[labels.length - 1]);
}

export type ParsedEmailList = {
  /** Unique, lowercased, valid addresses in the order they first appeared. */
  valid: string[];
  /** Entries that contained an "@" but are not valid addresses, as pasted. */
  invalid: string[];
};

/**
 * Pulls every email address out of free-form text (one or more inputs).
 * Words without an "@" (names, headers such as "Email") are ignored quietly.
 * Anything with an "@" that fails validation is returned in `invalid` so the
 * caller can show it instead of dropping it silently.
 */
export function parseEmailInput(
  ...values: Array<string | null | undefined>
): ParsedEmailList {
  const valid = new Set<string>();
  const invalid = new Set<string>();

  for (const value of values) {
    const text = String(value ?? '').replace(ZERO_WIDTH, '');
    for (const piece of text.split(TOKEN_SEPARATORS)) {
      const token = piece.replace(EDGE_JUNK, '').replace(/^mailto:/i, '');
      if (!token.includes('@')) continue;

      const email = token.toLowerCase();
      if (isValidEmailAddress(email)) {
        valid.add(email);
      } else {
        invalid.add(token);
      }
    }
  }

  return { valid: Array.from(valid), invalid: Array.from(invalid) };
}
