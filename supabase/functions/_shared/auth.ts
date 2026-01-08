// Authentication utilities for Edge Functions
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

export function getSupabaseClient(req: Request) {
  const authHeader = req.headers.get('Authorization')
  
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    {
      global: {
        headers: {
          Authorization: authHeader ?? '',
        },
      },
    }
  )
}

export function getAdminClient() {
  return createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  )
}

export function checkAdminAuth(req: Request): boolean {
  const apiKey = req.headers.get('x-api-key')
  const adminKey = Deno.env.get('ADMIN_API_KEY')
  
  if (!adminKey) {
    console.warn('ADMIN_API_KEY not set')
    return false
  }
  
  return apiKey === adminKey
}