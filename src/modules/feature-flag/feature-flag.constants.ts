export const FEATURE_KEYS = {
  ADD_QUESTION: 'ADD_QUESTION',
  BULK_IMPORT_QUESTION: 'BULK_IMPORT_QUESTION',
  QUESTION_BANK: 'QUESTION_BANK',
  BULK_IMPORT_TRANSLATION: 'BULK_IMPORT_TRANSLATION',
} as const;

export type FeatureKey = (typeof FEATURE_KEYS)[keyof typeof FEATURE_KEYS];

export const FEATURE_ENV_MAP: Record<FeatureKey, string> = {
  [FEATURE_KEYS.ADD_QUESTION]: 'FEATURE_ADD_QUESTION',
  [FEATURE_KEYS.BULK_IMPORT_QUESTION]: 'FEATURE_BULK_IMPORT_QUESTION',
  [FEATURE_KEYS.QUESTION_BANK]: 'FEATURE_QUESTION_BANK',
  [FEATURE_KEYS.BULK_IMPORT_TRANSLATION]: 'FEATURE_BULK_IMPORT_TRANSLATION',
};

/**
 * Feature dependency graph:
 * - ADD_QUESTION requires QUESTION_BANK
 * - BULK_IMPORT_QUESTION requires QUESTION_BANK
 */
export const FEATURE_DEPENDENCIES: Partial<Record<FeatureKey, FeatureKey[]>> = {
  [FEATURE_KEYS.ADD_QUESTION]: [FEATURE_KEYS.QUESTION_BANK],
  [FEATURE_KEYS.BULK_IMPORT_QUESTION]: [FEATURE_KEYS.QUESTION_BANK],
};

/**
 * Safe boolean parser for environment variables.
 * Treats only explicit 'true', '1', 'yes', 'on' (case-insensitive) as true.
 * Missing, undefined, 'false', '0', 'no', 'off', or invalid strings default to false.
 */
export function parseBooleanFlag(val?: string | boolean | null): boolean {
  if (typeof val === 'boolean') return val;
  if (!val) return false;
  const normalized = String(val).trim().toLowerCase();
  return (
    normalized === 'true' ||
    normalized === '1' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
}
