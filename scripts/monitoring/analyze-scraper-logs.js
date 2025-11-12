#!/usr/bin/env node

/**
 * TTRC-260 Scraper Log Analyzer
 *
 * Parses worker logs to extract scraping metrics:
 * - Success rates by source (PBS, NYT, WaPo, etc.)
 * - Success rates by method (Readability, Regex, RSS fallback)
 * - Error patterns and failure reasons
 * - Timeline of scraping events
 *
 * Usage: node scripts/monitoring/analyze-scraper-logs.js <logfile>
 * Example: node scripts/monitoring/analyze-scraper-logs.js worker-ttrc260.log
 */

import fs from 'fs';
import path from 'path';

function analyzeScraperLogs(logFilePath) {
  if (!fs.existsSync(logFilePath)) {
    console.error(`❌ Log file not found: ${logFilePath}`);
    process.exit(1);
  }

  const logContent = fs.readFileSync(logFilePath, 'utf-8');
  const lines = logContent.split('\n');

  // Metrics
  const bySource = {};
  const byMethod = {
    readability: 0,
    regex: 0,
    rss_fallback: 0,
    failed: 0
  };
  const errors = [];
  const timeline = [];

  // Parse log lines
  lines.forEach((line, index) => {
    // Extract scraping events
    // Format: [scraper] method=readability url=... source=... chars=...
    // Format: [scraper] scraped_ok method=readability ...
    // Format: [scraper] scraped_fail reason=...
    // Format: [scraper] scrape_fallback_to_rss ...

    if (line.includes('[scraper]') || line.includes('scraped')) {
      const timestamp = extractTimestamp(line);

      // Success with Readability
      if (line.includes('method=readability') && (line.includes('scraped_ok') || line.includes('extracted'))) {
        byMethod.readability++;
        const source = extractSource(line);
        const chars = extractChars(line);
        if (source) {
          if (!bySource[source]) bySource[source] = { readability: 0, regex: 0, rss: 0, failed: 0 };
          bySource[source].readability++;
        }
        timeline.push({ timestamp, event: 'success', method: 'readability', source, chars });
      }

      // Success with Regex fallback
      else if (line.includes('method=regex') || line.includes('regex_fallback')) {
        byMethod.regex++;
        const source = extractSource(line);
        const chars = extractChars(line);
        if (source) {
          if (!bySource[source]) bySource[source] = { readability: 0, regex: 0, rss: 0, failed: 0 };
          bySource[source].regex++;
        }
        timeline.push({ timestamp, event: 'success', method: 'regex', source, chars });
      }

      // Fallback to RSS
      else if (line.includes('scrape_fallback_to_rss') || line.includes('rss_fallback')) {
        byMethod.rss_fallback++;
        const source = extractSource(line);
        if (source) {
          if (!bySource[source]) bySource[source] = { readability: 0, regex: 0, rss: 0, failed: 0 };
          bySource[source].rss++;
        }
        timeline.push({ timestamp, event: 'rss_fallback', method: 'rss', source });
      }

      // Scraping failed
      else if (line.includes('scraped_fail') || line.includes('scrape_error')) {
        byMethod.failed++;
        const source = extractSource(line);
        const reason = extractReason(line);
        if (source) {
          if (!bySource[source]) bySource[source] = { readability: 0, regex: 0, rss: 0, failed: 0 };
          bySource[source].failed++;
        }
        errors.push({ line: index + 1, source, reason, timestamp });
        timeline.push({ timestamp, event: 'failed', source, reason });
      }
    }
  });

  // Calculate totals and percentages
  const totalAttempts = byMethod.readability + byMethod.regex + byMethod.rss_fallback + byMethod.failed;
  const totalSuccess = byMethod.readability + byMethod.regex;
  const successRate = totalAttempts > 0 ? ((totalSuccess / totalAttempts) * 100).toFixed(1) : 0;

  // Generate report
  console.log('');
  console.log('='.repeat(80));
  console.log('📊 TTRC-260 Scraper Log Analysis');
  console.log('='.repeat(80));
  console.log('');
  console.log(`📁 Log File: ${logFilePath}`);
  console.log(`📏 Total Lines: ${lines.length.toLocaleString()}`);
  console.log(`⏰ Analysis Time: ${new Date().toLocaleString()}`);
  console.log('');

  // Overall metrics
  console.log('📈 OVERALL METRICS');
  console.log('─'.repeat(80));
  console.log(`Total Scraping Attempts: ${totalAttempts}`);
  console.log(`  ✅ Successful: ${totalSuccess} (${((totalSuccess / totalAttempts) * 100).toFixed(1)}%)`);
  console.log(`  ❌ Failed: ${byMethod.failed} (${((byMethod.failed / totalAttempts) * 100).toFixed(1)}%)`);
  console.log(`  📰 RSS Fallback: ${byMethod.rss_fallback} (${((byMethod.rss_fallback / totalAttempts) * 100).toFixed(1)}%)`);
  console.log('');
  console.log(`🎯 Success Rate: ${successRate}% (Target: >70%)`);
  console.log('');

  // Success by method
  console.log('🔧 SUCCESS BY METHOD');
  console.log('─'.repeat(80));
  console.log(`Mozilla Readability: ${byMethod.readability} (${((byMethod.readability / totalSuccess) * 100).toFixed(1)}% of successes)`);
  console.log(`Regex Fallback: ${byMethod.regex} (${((byMethod.regex / totalSuccess) * 100).toFixed(1)}% of successes)`);
  console.log('');

  // Success by source
  console.log('🌐 SUCCESS BY SOURCE');
  console.log('─'.repeat(80));
  console.log('Source                  | Readability | Regex | RSS | Failed | Total | Success %');
  console.log('─'.repeat(80));

  const sourceNames = Object.keys(bySource).sort();
  sourceNames.forEach(source => {
    const stats = bySource[source];
    const total = stats.readability + stats.regex + stats.rss + stats.failed;
    const successes = stats.readability + stats.regex;
    const successPct = total > 0 ? ((successes / total) * 100).toFixed(1) : 0;
    const displayName = source.padEnd(22);
    const r = String(stats.readability).padStart(11);
    const reg = String(stats.regex).padStart(5);
    const rss = String(stats.rss).padStart(3);
    const fail = String(stats.failed).padStart(6);
    const tot = String(total).padStart(5);
    const pct = String(successPct + '%').padStart(9);
    console.log(`${displayName} | ${r} | ${reg} | ${rss} | ${fail} | ${tot} | ${pct}`);
  });
  console.log('');

  // Error summary
  if (errors.length > 0) {
    console.log('❌ ERROR SUMMARY');
    console.log('─'.repeat(80));
    console.log(`Total Errors: ${errors.length}`);
    console.log('');

    // Group by reason
    const errorsByReason = {};
    errors.forEach(err => {
      const reason = err.reason || 'unknown';
      if (!errorsByReason[reason]) errorsByReason[reason] = [];
      errorsByReason[reason].push(err);
    });

    Object.keys(errorsByReason).sort().forEach(reason => {
      const count = errorsByReason[reason].length;
      console.log(`  ${reason}: ${count} occurrences`);
    });
    console.log('');
  }

  // Timeline (last 10 events)
  if (timeline.length > 0) {
    console.log('⏱️  RECENT EVENTS (Last 10)');
    console.log('─'.repeat(80));
    const recentEvents = timeline.slice(-10);
    recentEvents.forEach(evt => {
      const time = evt.timestamp || 'N/A';
      const event = evt.event.padEnd(12);
      const method = (evt.method || '').padEnd(12);
      const source = (evt.source || '').padEnd(20);
      const chars = evt.chars ? `(${evt.chars} chars)` : '';
      const reason = evt.reason ? `- ${evt.reason}` : '';
      console.log(`  ${time} | ${event} | ${method} | ${source} ${chars}${reason}`);
    });
    console.log('');
  }

  // Go/No-Go Assessment
  console.log('🚦 GO/NO-GO ASSESSMENT');
  console.log('─'.repeat(80));
  const criteria = [
    { name: 'Success Rate >70%', pass: parseFloat(successRate) > 70, value: `${successRate}%` },
    { name: 'At least 3 sources validated', pass: sourceNames.length >= 3, value: `${sourceNames.length} sources` },
    { name: 'Zero HTTP 429 errors', pass: errors.filter(e => e.reason?.includes('429')).length === 0, value: `${errors.filter(e => e.reason?.includes('429')).length} errors` }
  ];

  criteria.forEach(c => {
    const status = c.pass ? '✅' : '❌';
    console.log(`  ${status} ${c.name}: ${c.value}`);
  });
  console.log('');

  // Summary
  const allPassed = criteria.every(c => c.pass);
  if (allPassed) {
    console.log('✅ LOOKING GOOD - On track for PROD deployment');
  } else {
    console.log('⚠️  NEEDS ATTENTION - Some criteria not met');
  }
  console.log('');
  console.log('='.repeat(80));
  console.log('');

  // Return data for programmatic use
  return {
    totalAttempts,
    totalSuccess,
    successRate: parseFloat(successRate),
    byMethod,
    bySource,
    errors,
    criteria
  };
}

// Helper functions
function extractTimestamp(line) {
  const match = line.match(/(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})/);
  return match ? match[1] : null;
}

function extractSource(line) {
  // Try to extract source name from URL or explicit source field
  const urlMatch = line.match(/url=https?:\/\/([^\/\s]+)/);
  if (urlMatch) {
    const domain = urlMatch[1];
    // Map domain to friendly name
    if (domain.includes('pbs.org')) return 'PBS';
    if (domain.includes('nytimes.com')) return 'NYT';
    if (domain.includes('washingtonpost.com')) return 'WaPo';
    if (domain.includes('csmonitor.com')) return 'CSM';
    if (domain.includes('reuters.com')) return 'Reuters';
    if (domain.includes('apnews.com')) return 'AP';
    if (domain.includes('politico.com')) return 'Politico';
    if (domain.includes('propublica.org')) return 'ProPublica';
    return domain;
  }

  const sourceMatch = line.match(/source=([^\s]+)/);
  return sourceMatch ? sourceMatch[1] : null;
}

function extractChars(line) {
  const match = line.match(/chars=(\d+)/);
  return match ? match[1] : null;
}

function extractReason(line) {
  const match = line.match(/reason=([^\s]+)/);
  if (match) return match[1];

  // Look for HTTP status codes
  if (line.includes('403')) return '403_Forbidden';
  if (line.includes('404')) return '404_NotFound';
  if (line.includes('429')) return '429_RateLimit';
  if (line.includes('timeout')) return 'timeout';
  if (line.includes('ECONNREFUSED')) return 'connection_refused';

  return 'unknown';
}

// CLI execution
const logFile = process.argv[2] || 'worker-ttrc260.log';
analyzeScraperLogs(logFile);

export { analyzeScraperLogs };
