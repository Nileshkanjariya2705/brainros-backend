/**
 * Phone Number Normalization Utility
 *
 * Centralizes all phone formatting logic for WhatsApp/Twilio messaging.
 * Handles Indian 10-digit numbers, E.164 international format, and Twilio's
 * whatsapp: URI prefix.
 *
 * SECURITY: Mask phone numbers in logs (show last 4 digits only).
 * NEVER log full phone numbers or credentials.
 */

/**
 * Removes all non-digit characters (including leading +).
 */
function stripToDigits(phone: string): string {
  return phone.replace(/\D/g, '');
}

/**
 * Masks a phone number for safe logging (shows last 4 digits only).
 * Example: "+919876543210" → "******3210"
 */
export function maskPhone(phone: string): string {
  if (!phone) return '[no-phone]';
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length <= 4) return '****';
  return '*'.repeat(cleaned.length - 4) + cleaned.slice(-4);
}

/**
 * Normalizes a phone number to E.164 format (+<country><number>).
 *
 * Rules:
 * - 10-digit number (Indian) → +91XXXXXXXXXX
 * - 12-digit starting with 91 → +91XXXXXXXXXX
 * - Already starts with + and 10+ digits → used as-is
 * - Others → returned as-is with warning (caller must validate)
 *
 * @param phone Raw phone number string (any format)
 * @returns E.164 formatted string (e.g., "+919876543210") or null if invalid
 */
export function normalizeToE164(phone: string | null | undefined): string | null {
  if (!phone) return null;

  // Strip whatsapp: prefix if present
  const cleaned = phone.replace(/^whatsapp:/i, '').trim();
  const digits = stripToDigits(cleaned);

  if (digits.length === 0) return null;

  // Already E.164 with + prefix — validate length
  if (cleaned.startsWith('+')) {
    if (digits.length >= 10 && digits.length <= 15) {
      return `+${digits}`;
    }
    return null; // Too short or too long
  }

  // Indian 10-digit number (e.g., 9876543210)
  if (digits.length === 10) {
    return `+91${digits}`;
  }

  // Indian number with country code prefix 91 (e.g., 919876543210 — 12 digits)
  if (digits.length === 12 && digits.startsWith('91')) {
    return `+${digits}`;
  }

  // Generic international number within valid E.164 range
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }

  return null; // Unrecognizable format
}

/**
 * Normalizes a phone number to Twilio's WhatsApp URI format.
 * Example: "9876543210" → "whatsapp:+919876543210"
 *
 * @param phone Raw phone number string (any format)
 * @returns Twilio WhatsApp URI (e.g., "whatsapp:+919876543210") or null if invalid
 */
export function normalizeToWhatsApp(phone: string | null | undefined): string | null {
  const e164 = normalizeToE164(phone);
  if (!e164) return null;
  return `whatsapp:${e164}`;
}

/**
 * Validates whether a normalized E.164 number looks plausible for WhatsApp.
 * Does NOT call Twilio — purely structural validation.
 *
 * @param e164 E.164 phone number (e.g., "+919876543210")
 * @returns true if structurally valid
 */
export function isValidE164(e164: string | null | undefined): boolean {
  if (!e164) return false;
  // E.164: + followed by 7–15 digits
  return /^\+[1-9]\d{6,14}$/.test(e164);
}
