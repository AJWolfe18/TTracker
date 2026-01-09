#!/usr/bin/env node
// backfill-eo-signing-dates.js
// Updates existing EO records to use signing_date instead of publication_date

import fetch from 'node-fetch';
import { supabaseRequest } from '../config/supabase-config-node.js';

const BATCH_SIZE = 50;
const DELAY_MS = 1000; // 1 second between batches to avoid rate limits

async function fetchSigningDate(documentNumber) {
    try {
        const url = `https://www.federalregister.gov/api/v1/documents/${documentNumber}.json`;
        const response = await fetch(url);

        if (!response.ok) {
            console.log(`   ⚠️ Failed to fetch ${documentNumber}: ${response.status}`);
            return null;
        }

        const data = await response.json();
        return data.signing_date || null;
    } catch (error) {
        console.log(`   ❌ Error fetching ${documentNumber}:`, error.message);
        return null;
    }
}

async function backfillSigningDates() {
    console.log('📅 Executive Order Signing Date Backfill');
    console.log('=========================================\n');

    // Fetch all EOs with document numbers
    console.log('📊 Fetching all executive orders from database...');
    const eos = await supabaseRequest('executive_orders?select=id,order_number,document_number,date,publication_date&order=order_number');

    console.log(`   Found ${eos.length} executive orders\n`);

    let updated = 0;
    let skipped = 0;
    let errors = 0;

    // Process in batches
    for (let i = 0; i < eos.length; i += BATCH_SIZE) {
        const batch = eos.slice(i, i + BATCH_SIZE);
        console.log(`\n📦 Processing batch ${Math.floor(i / BATCH_SIZE) + 1} (${batch.length} records)...`);

        for (const eo of batch) {
            if (!eo.document_number) {
                console.log(`   ⏭️  EO ${eo.order_number}: No document number, skipping`);
                skipped++;
                continue;
            }

            // Fetch signing date from Federal Register API
            const signingDate = await fetchSigningDate(eo.document_number);

            if (!signingDate) {
                console.log(`   ⚠️ EO ${eo.order_number}: No signing date found, keeping current date`);
                skipped++;
                continue;
            }

            // Only update if signing date differs from current date
            if (signingDate === eo.date) {
                console.log(`   ✓ EO ${eo.order_number}: Already correct (${signingDate})`);
                skipped++;
                continue;
            }

            try {
                // Update the date field
                await supabaseRequest(
                    `executive_orders?id=eq.${eo.id}`,
                    'PATCH',
                    { date: signingDate }
                );

                console.log(`   ✅ EO ${eo.order_number}: Updated ${eo.date} → ${signingDate}`);
                updated++;
            } catch (updateError) {
                console.log(`   ❌ EO ${eo.order_number}: Update failed:`, updateError.message);
                errors++;
            }

            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        // Delay between batches
        if (i + BATCH_SIZE < eos.length) {
            console.log(`   ⏸️  Pausing ${DELAY_MS}ms before next batch...`);
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
    }

    console.log('\n\n✨ Backfill Complete!');
    console.log('======================');
    console.log(`   Updated: ${updated}`);
    console.log(`   Skipped: ${skipped}`);
    console.log(`   Errors: ${errors}`);
    console.log(`   Total: ${eos.length}`);
}

// Run backfill
backfillSigningDates().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
