import { test, expect } from 'vitest';
import { formatCents, formatIsoTimestamp, formatRelativeTime } from './format';

test('formatCents formats USD currency accurately', () => {
  expect(formatCents(0)).toBe('$0.00');
  expect(formatCents(1250)).toBe('$12.50');
  expect(formatCents(99)).toBe('$0.99');
  expect(formatCents(100000)).toBe('$1,000.00');
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
