import { useEffect, useState } from 'react';
import { isTest } from '@/lib/supabase';

// React-side reader for the same flag files the vanilla pages use
// (public/shared/flags-{prod,test}.json). Supports the ?ff_name=true URL
// override so features can be verified on PROD before the flag flips.

let cache: Record<string, boolean> | null = null;
let pending: Promise<Record<string, boolean>> | null = null;

function urlOverrides(): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of params.entries()) {
    if (key.startsWith('ff_')) {
      out[key.substring(3)] = value === 'true' || value === '1';
    }
  }
  return out;
}

async function loadFlags(): Promise<Record<string, boolean>> {
  if (cache) return cache;
  if (!pending) {
    const file = isTest ? '/shared/flags-test.json' : '/shared/flags-prod.json';
    pending = fetch(file)
      .then(res => (res.ok ? res.json() : {}))
      .catch(() => ({}))
      .then((raw: Record<string, unknown>) => {
        const flags: Record<string, boolean> = {};
        for (const [k, v] of Object.entries(raw)) {
          if (!k.startsWith('_')) flags[k] = v === true;
        }
        cache = { ...flags, ...urlOverrides() };
        return cache;
      });
  }
  return pending;
}

/**
 * True once the flag file has loaded (or failed and defaulted). Lets routing
 * decisions wait instead of flashing the flag-off surface for a frame.
 */
export function useFlagsReady(): boolean {
  const [ready, setReady] = useState(() => cache !== null);

  useEffect(() => {
    let alive = true;
    loadFlags().then(() => { if (alive) setReady(true); });
    return () => { alive = false; };
  }, []);

  return ready;
}

/** Returns false until flags load, then the flag's value. */
export function useFeatureFlag(name: string): boolean {
  const [enabled, setEnabled] = useState(() => cache?.[name] === true);

  useEffect(() => {
    let alive = true;
    loadFlags().then(flags => {
      if (alive) setEnabled(flags[name] === true);
    });
    return () => { alive = false; };
  }, [name]);

  return enabled;
}
