import { test, expect, vi, afterEach } from 'vitest';
import { formatDollars, formatIsoTimestamp, formatRelativeTime, readerLocale } from './format';

afterEach(() => {
  vi.unstubAllGlobals();
});

test('dollars are whole when whole and carry cents when not', () => {
  expect(formatDollars(0)).toBe('$0');
  expect(formatDollars(9600)).toBe('$9,600');
  expect(formatDollars(43.2)).toBe('$43.20');
  expect(formatDollars(12.4)).toBe('$12.40');
  expect(formatDollars(1234567)).toBe('$1,234,567');
});

test('dollars keep US separators whatever the browser asks for', () => {
  vi.stubGlobal('navigator', { language: 'de-DE', languages: ['de-DE'] });
  expect(formatDollars(9600)).toBe('$9,600');
  expect(formatDollars(12.4)).toBe('$12.40');
});

test('the reader locale is the first English the browser asks for, else en-US', () => {
  vi.stubGlobal('navigator', { language: 'en-GB', languages: ['en-GB', 'en-US'] });
  expect(readerLocale()).toBe('en-GB');
  vi.stubGlobal('navigator', { language: 'de-DE', languages: ['de-DE', 'en-IE', 'en'] });
  expect(readerLocale()).toBe('en-IE');
  vi.stubGlobal('navigator', { language: 'de-DE', languages: ['de-DE'] });
  expect(readerLocale()).toBe('en-US');
});

test('formatIsoTimestamp returns valid ISO string', () => {
  const ts = formatIsoTimestamp('2026-08-16T12:00:00Z');
  expect(ts).toBe('2026-08-16T12:00:00.000Z');
});

test('formatRelativeTime returns human-readable relative time', () => {
  const now = Date.now();
  const pastMinute = new Date(now - 65 * 1000);
  const pastHour = new Date(now - 3600 * 1000);
  expect(formatRelativeTime(pastMinute)).toContain('minute');
  expect(formatRelativeTime(pastHour)).toContain('hour');
});
