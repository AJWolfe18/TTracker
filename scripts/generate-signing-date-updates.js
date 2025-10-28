#!/usr/bin/env node
// Generate SQL UPDATE statements to fix signing dates
// Run: node scripts/generate-signing-date-updates.js > updates.sql

import fetch from 'node-fetch';

// All document numbers from TEST (from workflow logs)
const DOCUMENT_NUMBERS = [
    '2025-19614', '2025-19495', '2025-19485', '2025-19483', '2025-19139',
    '2025-18602', '2025-18482', '2025-18479', '2025-17509', '2025-17508',
    // Add more as needed...we can get the full list from database
];

async function generateUpdates() {
    console.log('-- SQL to update executive_orders signing dates');
    console.log('-- Generated:', new Date().toISOString());
    console.log('');

    for (const docNum of DOCUMENT_NUMBERS) {
        try {
            const url = `https://www.federalregister.gov/api/v1/documents/${docNum}.json?fields[]=signing_date&fields[]=publication_date&fields[]=executive_order_number`;
            const response = await fetch(url);

            if (!response.ok) {
                console.log(`-- ERROR: Failed to fetch ${docNum}`);
                continue;
            }

            const data = await response.json();

            if (!data.signing_date) {
                console.log(`-- SKIP: No signing date for ${docNum}`);
                continue;
            }

            console.log(`-- EO ${data.executive_order_number}: ${data.publication_date} → ${data.signing_date}`);
            console.log(`UPDATE executive_orders SET date = '${data.signing_date}' WHERE document_number = '${docNum}';`);
            console.log('');

            // Delay to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
            console.log(`-- ERROR: ${docNum}: ${error.message}`);
        }
    }
}

generateUpdates();
