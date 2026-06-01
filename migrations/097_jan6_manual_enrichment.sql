-- Migration 097: Jan 6 Mass Pardon - Manual Enrichment (locked card)
-- This is the flagship group card representing ~1500 defendants.
-- Locked from automated enrichment via prompt_version = 'locked'.

UPDATE pardons
SET
  crime_description = $txt$Approximately 1,500 individuals charged in connection with the January 6, 2021 attack on the United States Capitol. Offenses ranged from trespassing and obstruction of an official proceeding to assaulting law enforcement officers with weapons, seditious conspiracy, and destruction of government property. Over 140 police officers were injured during the attack. Sentences ranged from probation to 22 years in federal prison.$txt$,
  corruption_level = 4,
  primary_connection_type = 'jan6_defendant',
  secondary_connection_types = ARRAY[]::text[],
  corruption_reasoning = $txt$Level 4: These defendants attacked the Capitol to keep Trump in power after he lost the 2020 election. Trump promised pardons during his 2024 campaign, explicitly telling rally crowds he would free "the hostages" on Day One. He delivered within hours of inauguration. The defendants acted for Trump and Trump rewarded them for it. The pardon covers violent offenders who assaulted police, not just peaceful protesters.$txt$,
  trump_connection_detail = $txt$The January 6 defendants stormed the Capitol in direct response to Trump's rally speech on the Ellipse, where he told supporters to "fight like hell" and march to the Capitol. During his 2024 campaign, Trump called the convicted attackers "hostages" and "political prisoners," promising pardons at virtually every rally. He signed the mass pardon executive order within hours of his second inauguration on January 20, 2025. The pardon covered all federal J6 charges regardless of severity, from misdemeanor trespass to seditious conspiracy and assault on officers.$txt$,
  donation_amount_usd = NULL,
  receipts_timeline = '[{"date": "2021-01-06", "event_type": "political_action", "description": "Attack on US Capitol. 140+ officers injured. Congress evacuated during electoral vote certification.", "source_url": "https://www.justice.gov/usao-dc/capitol-breach-cases", "amount_usd": null}, {"date": "2024-03-01", "event_type": "campaign_event", "description": "Trump campaigns on promise to pardon Jan 6 defendants, calling them hostages at rallies nationwide", "source_url": null, "amount_usd": null}, {"date": "2025-01-20", "event_type": "pardon_granted", "description": "Mass pardon signed within hours of inauguration. All federal J6 charges covered regardless of severity.", "source_url": null, "amount_usd": null}, {"date": "2025-12-01", "event_type": "legal_proceeding", "description": "33+ pardoned defendants rearrested for new crimes including child sex offenses, weapons charges, assault, and domestic violence", "source_url": null, "amount_usd": null}]'::jsonb,
  summary_neutral = $txt$President Trump signed a mass pardon on January 20, 2025 covering approximately 1,500 individuals charged in the January 6, 2021 Capitol attack. The clemency applied to all federal charges regardless of severity, releasing defendants convicted of offenses ranging from trespassing to seditious conspiracy and assault on law enforcement officers.$txt$,
  summary_spicy = $txt$1,500 people attacked the United States Capitol to stop the certification of an election Donald Trump lost by seven million votes. They beat 140 police officers with flagpoles, fire extinguishers, and their fists. They sprayed bear mace point-blank into cops' faces. They crushed Officer Daniel Hodges in a doorway until he screamed and bled from his mouth on live television. They built a functional gallows on the Capitol lawn. They chanted "hang Mike Pence" while hunting through the building for him. They smeared shit on the walls of the United States Congress. Four officers killed themselves in the aftermath.

Trump told them to fight like hell or they wouldn't have a country anymore. They took him literally. Then he ran again and spent two years calling these convicted terrorists "hostages" and "political prisoners" at every fucking rally. He promised to free them. Made it a centerpiece. Crowd went wild every time.

Day One. First act. Before the new furniture arrived. A blanket pardon for every last one of them. Seditious conspiracy convictions. Assaulting federal officers. Doesn't matter. No case reviewed. No sentence weighed. No victim consulted. The officers who lost eyes, lost fingers, suffered traumatic brain injuries. Nobody called them.

33 of these pardoned terrorists have already been rearrested for new crimes. Child sex offenses. Weapons charges. Beating their wives. Threatening public officials. One got picked up for assaulting another cop. These are the people the President of the United States called hostages. These are the people he freed as his very first official act. And every future political extremist in America now knows exactly what you get for committing violence in the right man's name.$txt$,
  why_it_matters = $txt$The largest mass pardon in American history establishes a permanent precedent: commit political violence for the president, and the president will erase the consequences. 33 pardoned defendants rearrested within a year. The pardon did not just free the guilty. It told the next generation of extremists exactly what loyalty buys.$txt$,
  pattern_analysis = $txt$The foundational transaction of the second term. Every other pardon in this dataset exists downstream of this one. If you will pardon 1,500 people who attacked Congress for you, pardoning a donor or an ally is nothing.$txt$,
  source_urls = '["https://www.justice.gov/usao-dc/capitol-breach-cases", "https://apnews.com/article/trump-jan-6-pardons", "https://www.reuters.com/world/us/some-jan-6-rioters-pardoned-by-trump-have-been-rearrested-2025-11-15/"]'::jsonb,
  enriched_at = NOW(),
  prompt_version = 'locked',
  enrichment_meta = '{"model": "manual", "prompt_version": "locked", "run_source": "manual-curated", "note": "Flagship group card. Manually written. Do not overwrite via automated enrichment."}'::jsonb,
  is_public = true,
  research_status = 'complete',
  needs_review = false,
  post_pardon_status = 're_offended',
  post_pardon_notes = $txt$33+ pardoned defendants rearrested for new crimes as of late 2025, including child sex offenses, weapons charges, domestic violence, assault, and threats against public officials. Multiple defendants violated conditions of release within weeks of being freed.$txt$
WHERE id = 3;
