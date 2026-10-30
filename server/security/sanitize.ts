/**
 * Input sanitization for user-provided text. React escapes rendered text, but
 * names and chat are also cleaned server-side so no client ever receives
 * control characters or markup-looking content.
 */

// Control characters, zero-width characters and bidi overrides.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

export function sanitizeChat(text: string, maxLength: number): string {
  return text.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export const NAME_PATTERN = /^[A-Za-z0-9 _.-]{2,16}$/;

/** Returns a cleaned display name or null if it is not acceptable. */
export function sanitizeDisplayName(raw: string): string | null {
  const name = raw.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
  if (!NAME_PATTERN.test(name)) return null;
  return name;
}

export function sanitizeWorldName(raw: string): string | null {
  const name = raw.replace(CONTROL_CHARS, '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > 32) return null;
  return name;
}

const COLOR = /^#[0-9a-fA-F]{6}$/;

export function sanitizeColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && COLOR.test(value) ? value.toLowerCase() : fallback;
}
