-- Preview Domain Extraction
SELECT
  regexp_replace(
    lower(regexp_replace(url, '^https?://([^/]+).*$', '\1')),
    '^(www\.|rss\.|feeds\.|m\.|amp\.)',
    ''
  ) AS base_domain,
  source_domain,
  COUNT(*) as count
FROM public.articles
WHERE url IS NOT NULL
GROUP BY 1, 2
ORDER BY count DESC
LIMIT 15;

-- Preview Feed Domain Matching
SELECT
  id as feed_id,
  feed_name,
  regexp_replace(
    lower(regexp_replace(feed_url, '^https?://([^/]+).*$', '\1')),
    '^(www\.|rss\.|feeds\.|m\.|amp\.)',
    ''
  ) AS base_domain
FROM public.feed_registry
ORDER BY id;
