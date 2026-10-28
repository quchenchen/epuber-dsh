import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { zstdDecompressSync } from 'node:zlib';

const run = promisify(execFile);

/**
 * Read a Session log written as a sequence of zstd frames.
 *
 * The Host appends one frame per flush, and Node's `zstdDecompressSync` (and the
 * stream/async variants) stop after the first frame — reading a 35-event turn
 * that way yields the single `session` header, which is why turn assertions
 * "never saw the turn". `zstd -dc` concatenates every frame, so the CLI is used
 * when present and the single-frame decoder is only a last resort.
 */
export async function readSessionLog(file) {
  for (const binary of ['/usr/local/bin/zstd', '/opt/homebrew/bin/zstd', 'zstd']) {
    try {
      const { stdout } = await run(binary, ['-dc', file], { maxBuffer: 64 * 1024 * 1024, encoding: 'buffer' });
      return { text: stdout.toString('utf8'), frames: 'all' };
    } catch (error) {
      // ENOENT means "not installed here"; a decode error means the frame is
      // still being written, which the caller's polling handles.
      if (error?.code === 'ENOENT') continue;
      if (error?.stdout?.length) return { text: error.stdout.toString('utf8'), frames: 'partial' };
      throw error;
    }
  }
  const buffer = await readFile(file);
  return { text: zstdDecompressSync(buffer).toString('utf8'), frames: 'first' };
}

/** Parsed events, tolerating a half-written trailing frame. */
export async function readSessionEvents(file) {
  const { text, frames } = await readSessionLog(file);
  const events = [];
  for (const line of text.trim().split('\n')) {
    try { events.push(JSON.parse(line)); } catch { /* trailing partial frame */ }
  }
  return { events, text, frames };
}
