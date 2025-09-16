// Pagination utilities for cursor-based pagination
export interface PaginationParams {
  limit: number
  cursor?: string
}

export interface CursorData {
  ts: string  // timestamp
  id: string  // record id
}

export function parseCursor(cursor?: string): CursorData | null {
  if (!cursor) return null
  
  try {
    const decoded = atob(cursor)
    return JSON.parse(decoded)
  } catch {
    return null
  }
}

export function createCursor(timestamp: string, id: string): string {
  return btoa(JSON.stringify({ ts: timestamp, id }))
}

export function getPaginationParams(url: URL): PaginationParams {
  const limit = Math.min(
    parseInt(url.searchParams.get('limit') || '30'),
    100
  )
  const cursor = url.searchParams.get('cursor') || undefined
  
  return { limit, cursor }
}