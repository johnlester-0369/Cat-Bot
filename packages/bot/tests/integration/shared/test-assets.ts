/**
 * Shared test assets for all platform integration tests.
 *
 * Downloads real media from the internet at test startup to exercise the full
 * attachment pipeline (buffer → bufferToStream → platform API). Falls back to
 * inline assets when network is unavailable so tests can still run.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 * Previously each platform test downloaded its own assets, causing:
 *   1. Network amplification — 4 platform suites each downloading the same 4 assets
 *   2. Inconsistent test behavior — one platform's asset fetch failure didn't affect others
 *   3. Code duplication — identical download logic in 4 separate files
 *
 * Centralizing asset setup ensures:
 *   - Single source of truth for test data
 *   - Consistent asset availability across all platforms
 *   - Shared cleanup (temp file removal) runs once after all tests
 */

import axios from 'axios';
import fs from 'fs';
import path from 'path';
import os from 'os';

// ============================================================================
// EXPORTED ASSETS
// ============================================================================

export let TEST_IMAGE: Buffer = Buffer.alloc(0);
export let TEST_IMAGE_PATH: string = '';
export let TTS_AUDIO_BUFFER: Buffer = Buffer.alloc(0);
export let TEST_GIF: Buffer = Buffer.alloc(0);

/**
 * Minimal MPEG-1 Layer 3 frame with a valid sync word.
 * Discord accepts any binary upload without server-side content validation.
 * Telegram's sendVoice validates playability — content errors are expected and caught.
 */
export const TINY_MP3 = (() => {
  const buf = Buffer.alloc(417, 0x00);
  // MPEG1 Layer3 128 kbps 44100 Hz stereo sync word — minimal valid frame header
  buf[0] = 0xff;
  buf[1] = 0xfb;
  buf[2] = 0x90;
  buf[3] = 0x00;
  return buf;
})();

// ============================================================================
// SETUP — runs before all platform test suites
// ============================================================================

export function setupTestAssets(): void {
  const tmpDir = os.tmpdir();
  TEST_IMAGE_PATH = path.join(tmpDir, `cat-bot-test-${Date.now()}.jpg`);
}

export async function loadTestAssets(): Promise<void> {
  // Download real JPEG from Picsum Photos
  try {
    const res = await axios.get('https://picsum.photos/seed/catbot/512/512', {
      responseType: 'arraybuffer',
      timeout: 15_000,
    });
    fs.writeFileSync(TEST_IMAGE_PATH, Buffer.from(res.data));
    TEST_IMAGE = fs.readFileSync(TEST_IMAGE_PATH);
    console.info(
      `[Assets] Downloaded ${TEST_IMAGE.length}-byte test JPEG → ${TEST_IMAGE_PATH}`,
    );
  } catch (err) {
    // Fallback to 1×1 greyscale PNG when network is unavailable
    console.warn(
      `[Assets] Internet fetch failed — using inline fallback PNG: ${(err as Error).message}`,
    );
    TEST_IMAGE = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x00, 0x00, 0x00, 0x00, 0x3a, 0x7e, 0x9b, 0x55, 0x00, 0x00, 0x00,
      0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02,
      0x00, 0x01, 0xe5, 0x27, 0xde, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
      0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
  }

  // Download real TTS audio from Google Translate — same endpoint say.js uses
  try {
    const ttsRes = await axios.get(
      'https://translate.google.com/translate_tts',
      {
        params: { ie: 'UTF-8', q: 'hello world', tl: 'en', client: 'tw-ob' },
        responseType: 'arraybuffer',
        timeout: 15_000,
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Referer: 'https://translate.google.com/',
        },
      },
    );
    TTS_AUDIO_BUFFER = Buffer.from(ttsRes.data);
    console.info(
      `[Assets] Downloaded ${TTS_AUDIO_BUFFER.length}-byte TTS audio from Google Translate`,
    );
  } catch (err) {
    // Fall back to minimal MPEG frame when Google TTS is rate-limited
    console.warn(
      `[Assets] Google TTS fetch failed — using TINY_MP3 fallback: ${(err as Error).message}`,
    );
    TTS_AUDIO_BUFFER = TINY_MP3;
  }

  // Download animated GIF for gif-type branch of sendMultipleMedia tests
  try {
    const gifRes = await axios.get(
      'https://mir-s3-cdn-cf.behance.net/project_modules/max_1200/5eeea355389655.59822ff824b72.gif',
      { responseType: 'arraybuffer', timeout: 15_000 },
    );
    TEST_GIF = Buffer.from(gifRes.data);
    console.info(`[Assets] Downloaded ${TEST_GIF.length}-byte test GIF`);
  } catch (err) {
    // Minimal valid GIF89a (1×1 transparent pixel) so API calls don't crash on zero-byte buffer
    TEST_GIF = Buffer.from(
      'R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==',
      'base64',
    );
    console.warn(
      `[Assets] GIF fetch failed — using 1×1 GIF89a fallback: ${(err as Error).message}`,
    );
  }
}

export function cleanupTestAssets(): void {
  if (TEST_IMAGE_PATH && fs.existsSync(TEST_IMAGE_PATH)) {
    fs.unlinkSync(TEST_IMAGE_PATH);
    console.info(`[Assets] Cleaned up temp file: ${TEST_IMAGE_PATH}`);
  }
}

/**
 * Returns true only for JavaScript-level programming defects.
 * Platform API errors (permissions, rate limits, content rejection, unknown IDs)
 * are NOT programming defects and must never fail the test.
 */
export function isProgrammingError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return /TypeError|is not a function|Cannot read prop|undefined is not/i.test(
    err.message,
  );
}

// ============================================================================
// GLOBAL SETUP — vitest automatically runs beforeAll/afterAll in each test file
// We export a setup function that platform tests can call if they need assets
// ============================================================================

export async function initializeSharedAssets(): Promise<void> {
  setupTestAssets();
  await loadTestAssets();
}

export function finalizeSharedAssets(): void {
  cleanupTestAssets();
}
