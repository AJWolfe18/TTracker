// ADO-572: which records become social drafts. Pure query builders + row
// normalisers so the publish gates are unit-tested and never drift silently.
//
// Posting rule (PRD section 4): every alarm-5 main-line story, alarm-5 EO and
// corruption-5 pardon, once, after approval. Gates mirror the public read
// paths (og-tags / og-card-props ROUTES): a record the site would not show
// must never be drafted.

export const TYPES = Object.freeze(['story', 'eo', 'pardon']);

// Stories read the STORED main_line flag (migration 113) straight off `stories`
// - v_tracker_stories omits summary_spicy/source_count/last_updated_at, and the
// stored flag is what the homepage shows, so this is the same main line.
export function candidateQuery(type, sinceIso) {
  if (!sinceIso) throw new Error('candidateQuery: sinceIso required');
  const since = encodeURIComponent(sinceIso);
  switch (type) {
    case 'story':
      return `/stories?select=id,primary_headline,summary_spicy,alarm_level,source_count,last_updated_at`
        + `&main_line=is.true&alarm_level=eq.5&status=eq.active&summary_neutral=not.is.null`
        + `&last_updated_at=gt.${since}&order=last_updated_at.asc,id.asc&limit=50`;
    case 'eo':
      return `/executive_orders?select=id,title,spicy_summary,alarm_level,updated_at`
        + `&is_public=eq.true&alarm_level=eq.5`
        + `&updated_at=gt.${since}&order=updated_at.asc,id.asc&limit=50`;
    case 'pardon':
      return `/pardons?select=id,recipient_name,summary_spicy,corruption_level,updated_at`
        + `&is_public=eq.true&corruption_level=eq.5`
        + `&updated_at=gt.${since}&order=updated_at.asc,id.asc&limit=50`;
    default:
      throw new Error(`candidateQuery: unknown type ${type}`);
  }
}

/** Normalise a candidate row into what the copy builder needs. */
export function normalizeCandidate(type, row) {
  switch (type) {
    case 'story':
      return { id: row.id, headline: row.primary_headline, spicy: row.summary_spicy, alarm: row.alarm_level, sources: row.source_count ?? null, ts: row.last_updated_at };
    case 'eo':
      return { id: row.id, headline: row.title, spicy: row.spicy_summary, alarm: row.alarm_level, sources: null, ts: row.updated_at };
    case 'pardon':
      return { id: row.id, headline: row.recipient_name, spicy: row.summary_spicy, alarm: row.corruption_level, sources: null, ts: row.updated_at };
    default:
      throw new Error(`normalizeCandidate: unknown type ${type}`);
  }
}

export const watermarkKey = (type) => `draft_watermark_${type}`;
