// Maps alarm_level (0-5) → severity_rating (legacy varchar consumed by public UI).
// Server-derived only — admin clients MUST NOT send severity_rating in update payloads;
// admin-update-executive-orders recomputes it on every alarm_level change.
//
// The EO Claude Agent encodes its own copy of this mapping in prompt-v1.md when it
// writes severity_rating directly. We accept the duplication rather than churn the
// validated prompt; if mappings drift in the future, this file is the canonical one.
export function deriveSeverityRating(alarmLevel: number | null | undefined): string | null {
  if (alarmLevel == null) return null
  if (alarmLevel >= 5) return 'critical'
  if (alarmLevel === 4) return 'high'
  if (alarmLevel === 3) return 'medium'
  if (alarmLevel === 2) return 'low'
  return null  // 0 or 1
}
