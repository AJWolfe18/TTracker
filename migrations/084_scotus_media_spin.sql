-- ADO-82: Add media spin columns to scotus_cases
-- These support the "Media Spin" panel (media_says vs actually_means)

ALTER TABLE public.scotus_cases ADD COLUMN IF NOT EXISTS media_says TEXT;
ALTER TABLE public.scotus_cases ADD COLUMN IF NOT EXISTS actually_means TEXT;
