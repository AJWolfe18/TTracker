#!/usr/bin/env node
/**
 * Analyze remaining entity quality issues
 */

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function analyze() {
  const { data: articles } = await supabase.from('articles').select('entities');

  // Collect all unique entity IDs with counts
  const entityCounts = {};
  for (const row of articles || []) {
    for (const e of row.entities || []) {
      if (e.id) {
        entityCounts[e.id] = (entityCounts[e.id] || 0) + 1;
      }
    }
  }

  // Categorize issues
  const issues = {
    wrongPrefix: [],
    genericOrVague: [],
    programsAsEvents: [],
    possibleDuplicates: [],
    lowValue: [],
    singletons: 0,
    total: Object.keys(entityCounts).length
  };

  // Known international figures that should NOT have US- prefix
  const intlFigures = /^US-(PETRO|MACHADO|ROBISON|KHAN|ORBAN|MADURO|XI|ERDOGAN|STARMER|FARAGE|TEDROS|RAE|LOPEZ|AL-SHARA|BUKELE)/i;

  // Generic patterns that provide little clustering value
  const genericPatterns = /^(EVT-ELECTION|EVT-ELECTIONS|EVT-CAMPAIGN|EVT-PRIMARY|EVT-CONGRESSIONAL|EVT-GOVERNORS|EVT-SPECIAL-ELECTION|EVT-MIDTERMS|EVT-2026|EVT-2028|ORG-HOUSE|ORG-ADMINISTRATION|EVT-CULTURE-WARS)/i;

  // Programs/concepts that shouldn't be events
  const programPatterns = /^EVT-(SNAP|ACA|H1B|GLP1|TYLENOL|CHIP-EXPORTS|ASYLUM|IMMIGRATION|TARIFFS?|ECONOMY|FREE-SPEECH|TRANS-IDENTITY)/i;

  for (const [id, count] of Object.entries(entityCounts)) {
    if (intlFigures.test(id)) {
      issues.wrongPrefix.push({ id, count });
    }

    if (genericPatterns.test(id)) {
      issues.genericOrVague.push({ id, count });
    }

    if (programPatterns.test(id)) {
      issues.programsAsEvents.push({ id, count });
    }

    if (count === 1) {
      issues.singletons++;
    }
  }

  // Find duplicate names across prefixes
  const byLastName = {};
  for (const id of Object.keys(entityCounts)) {
    const match = id.match(/^([A-Z]{2,3})-(.+)$/);
    if (match) {
      const [, prefix, name] = match;
      if (!byLastName[name]) byLastName[name] = [];
      byLastName[name].push({ prefix, id, count: entityCounts[id] });
    }
  }

  for (const [name, entries] of Object.entries(byLastName)) {
    if (entries.length > 1) {
      // Check if there are different country/type prefixes for same name
      const prefixes = [...new Set(entries.map(e => e.prefix))];
      if (prefixes.length > 1) {
        issues.possibleDuplicates.push({ name, entries });
      }
    }
  }

  // Find low-value singleton entities that seem like noise
  for (const [id, count] of Object.entries(entityCounts)) {
    if (count === 1) {
      // Single appearance + looks like a minor figure
      if (id.match(/^US-[A-Z]+-[A-Z]+$/) || // hyphenated names like US-YAFFE-BELLANY
          id.match(/^EVT-[A-Z]+-[A-Z]+-[A-Z]+/) || // long event names
          id.match(/^ORG-[A-Z]{2,3}$/) // very short org abbrevs
      ) {
        issues.lowValue.push({ id, count });
      }
    }
  }

  // Report
  console.log('=== Remaining Entity Quality Issues ===');
  console.log('');

  console.log('1. WRONG PREFIX (international figures with US-):');
  if (issues.wrongPrefix.length > 0) {
    for (const { id, count } of issues.wrongPrefix.sort((a,b) => b.count - a.count)) {
      console.log(`   ${id}: ${count} occurrences`);
    }
  } else {
    console.log('   None found');
  }

  console.log('');
  console.log('2. GENERIC/VAGUE (limited clustering value):');
  if (issues.genericOrVague.length > 0) {
    for (const { id, count } of issues.genericOrVague.sort((a,b) => b.count - a.count)) {
      console.log(`   ${id}: ${count} occurrences`);
    }
  } else {
    console.log('   None found');
  }

  console.log('');
  console.log('3. PROGRAMS/CONCEPTS AS EVENTS:');
  if (issues.programsAsEvents.length > 0) {
    for (const { id, count } of issues.programsAsEvents.sort((a,b) => b.count - a.count)) {
      console.log(`   ${id}: ${count} occurrences`);
    }
  } else {
    console.log('   None found');
  }

  console.log('');
  console.log('4. POSSIBLE DUPLICATES (same name, different prefix):');
  if (issues.possibleDuplicates.length > 0) {
    for (const { name, entries } of issues.possibleDuplicates.slice(0, 15)) {
      const ids = entries.map(e => `${e.id}(${e.count})`).join(', ');
      console.log(`   ${name}: ${ids}`);
    }
    if (issues.possibleDuplicates.length > 15) {
      console.log(`   ... and ${issues.possibleDuplicates.length - 15} more`);
    }
  } else {
    console.log('   None found');
  }

  console.log('');
  console.log('5. LOW-VALUE SINGLETONS (appear once, look like noise):');
  if (issues.lowValue.length > 0) {
    for (const { id } of issues.lowValue.slice(0, 10)) {
      console.log(`   ${id}`);
    }
    if (issues.lowValue.length > 10) {
      console.log(`   ... and ${issues.lowValue.length - 10} more`);
    }
  } else {
    console.log('   None found');
  }

  console.log('');
  console.log('=== SUMMARY ===');
  console.log(`Total unique entities: ${issues.total}`);
  console.log(`Singletons (appear once): ${issues.singletons} (${Math.round(issues.singletons/issues.total*100)}%)`);
  console.log(`Wrong prefix issues: ${issues.wrongPrefix.length}`);
  console.log(`Generic/vague entities: ${issues.genericOrVague.length}`);
  console.log(`Programs as events: ${issues.programsAsEvents.length}`);
  console.log(`Possible duplicates: ${issues.possibleDuplicates.length}`);
  console.log(`Low-value singletons: ${issues.lowValue.length}`);

  console.log('');
  console.log('=== RECOMMENDATION ===');
  const actionable = issues.wrongPrefix.length + issues.programsAsEvents.length + issues.possibleDuplicates.length;
  if (actionable > 10) {
    console.log(`Found ${actionable} actionable issues that could improve clustering.`);
    console.log('Consider adding more aliases to entity-normalization.js');
  } else if (actionable > 0) {
    console.log(`Only ${actionable} minor issues remaining - data quality is good.`);
  } else {
    console.log('No significant issues found - entity data is clean!');
  }
}

analyze().catch(console.error);
