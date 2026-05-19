import { url, anonKey } from './supabase';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export async function subscribeNewsletter(
  email: string,
  source: string,
): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(`${url}/functions/v1/newsletter-signup`, {
      method: 'POST',
      headers: {
        'apikey': anonKey,
        'Authorization': `Bearer ${anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: email.trim().toLowerCase(),
        signup_source: source,
        honeypot: '',
      }),
    });

    const data = await res.json();

    if (res.ok) {
      return { ok: true, message: data.message || 'Thanks! Check your email soon.' };
    }
    return { ok: false, message: data.error || 'Something went wrong. Try again.' };
  } catch {
    return { ok: false, message: 'Network error. Please try again.' };
  }
}
