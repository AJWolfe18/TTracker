#!/usr/bin/env node
// Simple launcher for the atomic worker

import { runWorker } from './job-queue-worker-atomic.js';

console.log('Starting RSS Job Queue Worker...\n');

runWorker().catch(err => {
  console.error('Worker failed:', err);
  process.exit(1);
});
