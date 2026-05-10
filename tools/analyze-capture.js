/**
 * Analyze a captured traffic session from the interceptor.
 * 
 * Reads .jsonl capture files and produces statistics about API usage patterns.
 * 
 * Usage: node analyze-capture.js <capture-file.jsonl>
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('Usage: node analyze-capture.js <capture-file.jsonl>');
  process.exit(1);
}

const lines = fs.readFileSync(file, 'utf-8').split('\n').filter(Boolean);
const entries = lines.map(l => { try { return JSON.parse(l); } catch(e) { return null; } }).filter(Boolean);

// Filter to only main request entries (not stream chunks)
const requests = entries.filter(e => e.method && !e.type);
const streamChunks = entries.filter(e => e.type === 'stream_chunk');

console.log(`\n=== Traffic Analysis: ${path.basename(file)} ===\n`);
console.log(`Total entries: ${entries.length}`);
console.log(`Requests: ${requests.length}`);
console.log(`Stream chunks: ${streamChunks.length}`);

// Method frequency
const methodCounts = {};
const methodLatencies = {};
const methodSizes = {};

for (const r of requests) {
  const m = r.method;
  methodCounts[m] = (methodCounts[m] || 0) + 1;
  if (r.elapsed) {
    if (!methodLatencies[m]) methodLatencies[m] = [];
    methodLatencies[m].push(r.elapsed);
  }
  if (!methodSizes[m]) methodSizes[m] = { reqTotal: 0, resTotal: 0 };
  methodSizes[m].reqTotal += (r.requestSize || 0);
  methodSizes[m].resTotal += (r.responseSize || 0);
}

// Sort by frequency
const sorted = Object.entries(methodCounts).sort((a, b) => b[1] - a[1]);

console.log(`\n--- Top Methods by Frequency ---`);
console.log(`${'Method'.padEnd(40)} ${'Count'.padStart(6)} ${'Avg ms'.padStart(8)} ${'Req KB'.padStart(8)} ${'Res KB'.padStart(8)}`);
console.log('-'.repeat(80));

for (const [method, count] of sorted) {
  const lats = methodLatencies[method] || [];
  const avgLat = lats.length > 0 ? (lats.reduce((a, b) => a + b, 0) / lats.length).toFixed(0) : '-';
  const sizes = methodSizes[method];
  const avgReq = (sizes.reqTotal / count / 1024).toFixed(1);
  const avgRes = (sizes.resTotal / count / 1024).toFixed(1);
  console.log(`${method.padEnd(40)} ${String(count).padStart(6)} ${String(avgLat).padStart(8)} ${avgReq.padStart(8)} ${avgRes.padStart(8)}`);
}

// Streaming methods
const streamingReqs = requests.filter(r => r.isStreaming || r.streamChunks > 0);
if (streamingReqs.length > 0) {
  console.log(`\n--- Streaming Requests ---`);
  for (const r of streamingReqs) {
    console.log(`  ${r.method}: ${r.streamChunks || '?'} chunks, ${r.responseSize || '?'}b, ${r.elapsed || '?'}ms`);
  }
}

// Error analysis
const errors = requests.filter(r => r.error || (r.status && r.status >= 400));
if (errors.length > 0) {
  console.log(`\n--- Errors (${errors.length}) ---`);
  for (const e of errors.slice(0, 20)) {
    console.log(`  ${e.method}: ${e.error || `HTTP ${e.status}`}`);
  }
}

// Timeline
if (requests.length >= 2) {
  const first = new Date(requests[0].timestamp);
  const last = new Date(requests[requests.length - 1].timestamp);
  const durationSec = ((last - first) / 1000).toFixed(1);
  const rps = (requests.length / (last - first) * 1000).toFixed(2);
  console.log(`\n--- Timeline ---`);
  console.log(`  Duration: ${durationSec}s`);
  console.log(`  Avg RPS: ${rps}`);
  console.log(`  First: ${requests[0].timestamp}`);
  console.log(`  Last: ${requests[requests.length - 1].timestamp}`);
}

// Decoded content summary
const decoded = requests.filter(r => r.requestDecoded || r.responseDecoded);
if (decoded.length > 0) {
  console.log(`\n--- Decoded Content (${decoded.length}/${requests.length} requests) ---`);
  for (const d of decoded.slice(0, 10)) {
    if (d.requestDecoded) {
      const keys = Object.keys(d.requestDecoded).join(', ');
      console.log(`  → ${d.method}: {${keys.substring(0, 80)}}`);
    }
    if (d.responseDecoded) {
      const keys = Object.keys(d.responseDecoded).join(', ');
      console.log(`  ← ${d.method}: {${keys.substring(0, 80)}}`);
    }
  }
}

console.log('\n');
