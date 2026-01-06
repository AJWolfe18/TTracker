#!/usr/bin/env node
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: arts, error } = await supabase
    .from('articles')
    .select('id, title, source_name, content, excerpt')
    .eq('entities', '[]')
    .limit(30);

  if (error) {
    console.log('Error:', error);
    return;
  }

  console.log('=== ARTICLES WITH EMPTY ENTITIES ===');
  console.log('Sample of ' + arts.length + ' articles\n');

  let extractable = 0;
  let noContent = 0;

  for (const a of arts) {
    const contentLen = (a.content || '').length;
    const excerptLen = (a.excerpt || '').length;
    const canExtract = contentLen > 100 || excerptLen > 50;

    if (canExtract) {
      extractable++;
    } else {
      noContent++;
    }

    console.log('"' + a.title.slice(0, 55) + '..."');
    console.log('  Source: ' + a.source_name);
    console.log('  Content: ' + contentLen + ' chars | Excerpt: ' + excerptLen + ' chars');
    console.log('  Status: ' + (canExtract ? '✅ Can extract' : '❌ No content'));
    console.log('');
  }

  console.log('=== SUMMARY ===');
  console.log('Can extract entities: ' + extractable + '/' + arts.length);
  console.log('No content (cannot extract): ' + noContent + '/' + arts.length);
}

check().catch(console.error);
