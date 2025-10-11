// Delete test stories 116+ in batches to avoid token limits
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  console.log('Deleting stories with id >= 116...\n');

  // Delete in batches of 10 to avoid token limits
  let totalDeleted = 0;

  for (let startId = 116; startId <= 200; startId += 10) {
    const endId = startId + 9;

    const { data, error } = await supabase
      .from('stories')
      .delete()
      .gte('id', startId)
      .lte('id', endId)
      .select('id');

    if (error) {
      console.error(`Error deleting stories ${startId}-${endId}:`, error);
      continue;
    }

    if (data && data.length > 0) {
      totalDeleted += data.length;
      console.log(`Deleted ${data.length} stories (${startId}-${endId})`);
    }
  }

  console.log(`\nTotal deleted: ${totalDeleted} stories`);
}

main().catch(console.error);
