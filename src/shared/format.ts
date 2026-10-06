/**
 * Standard formatting utilities for timestamps, currency, and relative time.
 * Zero external dependencies — uses native Intl APIs.
 */

/**
 * Dollars as a person writes them: whole when whole, cents when not ($9,600,
 * $43.20). The separators are fixed to en-US because the currency is: a "$"
 * pasted onto the browser's own grouping read "$9.600" in Berlin, which is
 * nine dollars sixty to anyone else.
 */
export function formatDollars(n: number): string {
  const cents = Number.isInteger(n) ? 0 : 2;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: cents,
    maximumFractionDigits: cents,
  }).format(n);
}

/**
 * The English the reader's browser asks for, so a date reads "6 Oct, 14:05" in
 * London and "Oct 6, 2:05 PM" in Chicago. The page is written in English, so a
 * browser that asks for no English at all gets en-US, never "6. Okt." inside an
 * English sentence.
 */
export function readerLocale(): string {
  const asked =
    typeof navigator === 'undefined' ? [] : (navigator.languages ?? [navigator.language]);
  return asked.find(l => /^en(-|$)/i.test(l)) ?? 'en-US';
}

/**
 * A large count as a person reads it: 3.8M, 547M, 12K, 940. Token counts run
 * to hundreds of millions, and nine digits do not compare at a glance.
 */
export function formatCount(n: number): string {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    n
  );
}

/**
 * Format a timestamp as standard ISO 8601 UTC string.
 */
export function formatIsoTimestamp(date: Date | string | number = new Date()): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  return d.toISOString();
}

/**
 * Format a past or future date relative to now (e.g. "2 hours ago", "in 3 days").
 */
export function formatRelativeTime(date: Date | string | number): string {
  const d = typeof date === 'string' || typeof date === 'number' ? new Date(date) : date;
  const now = Date.now();
  const diffMs = d.getTime() - now;
  const diffSeconds = Math.round(diffMs / 1000);
  const diffMinutes = Math.round(diffSeconds / 60);
  const diffHours = Math.round(diffMinutes / 60);
  const diffDays = Math.round(diffHours / 24);

  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

  if (Math.abs(diffSeconds) < 60) return rtf.format(diffSeconds, 'second');
  if (Math.abs(diffMinutes) < 60) return rtf.format(diffMinutes, 'minute');
  if (Math.abs(diffHours) < 24) return rtf.format(diffHours, 'hour');
  return rtf.format(diffDays, 'day');
}
