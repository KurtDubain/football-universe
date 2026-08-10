import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const audioDir = new URL('../src/assets/audio/', import.meta.url);
const expectedTracks = [
  'eastern-cup-theme-v1.m4a',
  'league-cup-theme-v1.m4a',
  'mainland-cup-theme-v1.m4a',
  'southern-cup-theme-v1.m4a',
  'super-cup-theme-v1.m4a',
  'world-cup-champion-v1.m4a',
  'world-cup-final-v1.m4a',
  'world-cup-theme-v1.m4a',
] as const;

const MAX_TRACK_BYTES = 560_000;
const MAX_TOTAL_BYTES = 2_800_000;

function durationSeconds(buffer: Buffer): number {
  const marker = buffer.indexOf(Buffer.from('mvhd'));
  if (marker < 0) throw new Error('missing mvhd duration metadata');
  const version = buffer.readUInt8(marker + 4);
  const timescaleOffset = marker + (version === 1 ? 28 : 16);
  const durationOffset = marker + (version === 1 ? 32 : 20);
  const timescale = buffer.readUInt32BE(timescaleOffset);
  const duration = version === 1
    ? Number(buffer.readBigUInt64BE(durationOffset))
    : buffer.readUInt32BE(durationOffset);
  if (timescale <= 0) throw new Error('invalid mvhd timescale');
  return duration / timescale;
}

const actualTracks = readdirSync(audioDir)
  .filter(name => name.endsWith('.m4a'))
  .sort();
if (actualTracks.join('\n') !== expectedTracks.join('\n')) {
  throw new Error(`Tournament music manifest mismatch:\n${actualTracks.join('\n')}`);
}

let totalBytes = 0;
const report = expectedTracks.map(name => {
  const url = new URL(name, audioDir);
  const bytes = statSync(url).size;
  const buffer = readFileSync(url);
  const brand = buffer.subarray(4, 8).toString('ascii');
  if (brand !== 'ftyp') throw new Error(`${name} is not an MPEG-4 audio asset`);
  if (bytes > MAX_TRACK_BYTES) throw new Error(`${name} exceeds ${MAX_TRACK_BYTES} bytes (${bytes})`);
  const seconds = durationSeconds(buffer);
  if (seconds < 10 || seconds > 45) throw new Error(`${name} duration is outside 10-45s (${seconds.toFixed(2)}s)`);
  totalBytes += bytes;
  return `${name}: ${(bytes / 1024).toFixed(0)} KiB / ${seconds.toFixed(1)}s`;
});

if (totalBytes > MAX_TOTAL_BYTES) {
  throw new Error(`Tournament music exceeds ${MAX_TOTAL_BYTES} bytes (${totalBytes})`);
}

process.stdout.write(`${report.join('\n')}\n`);
process.stdout.write(`Tournament music: ${expectedTracks.length} tracks / ${(totalBytes / 1024 / 1024).toFixed(2)} MiB / source ${fileURLToPath(audioDir)}\n`);
