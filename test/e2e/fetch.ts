import { SELF } from 'cloudflare:test';
import { describe, it, expect, beforeAll } from 'vitest';

const PNG_IMG_URL = 'https://raw.githubusercontent.com/adzukimame/media-proxy-workers/main/test/assets/image.png';
const WEBP_IMG_URL = 'https://raw.githubusercontent.com/adzukimame/media-proxy-workers/main/test/assets/image.webp';
const GIF_IMG_URL = 'https://raw.githubusercontent.com/adzukimame/media-proxy-workers/main/test/assets/image.gif';
const SVG_IMG_URL = 'https://raw.githubusercontent.com/adzukimame/media-proxy-workers/main/test/assets/image.svg';

let ORIGINAL_GIF_LEN: number;

beforeAll(async () => {
  ORIGINAL_GIF_LEN = await SELF.fetch(`http://example.local/?url=${encodeURIComponent(GIF_IMG_URL)}`)
    .then(res => res.arrayBuffer())
    .then(buf => buf.byteLength);
});

describe('urlパラメータが', () => {
  it('存在しないと400エラー', async () => {
    const res = await SELF.fetch('http://example.local/');
    expect(res.status).toBe(400);
  });

  it('不正だと400エラー', async () => {
    const res = await SELF.fetch('http://example.local/?url=aaa');
    expect(res.status).toBe(400);
  });
});

describe('エラー時にfallbackパラメータが', () => {
  it('存在しないとレスポンス本体が空', async () => {
    const res = await SELF.fetch('http://example.local/?url=aaa');
    expect(res.status).toBe(400);
    expect((await res.arrayBuffer()).byteLength).toBe(0);
  });

  // fetchの返り値のPromiseが永遠に履行も拒否もされない
  // it('存在するとレスポンス本体が空でない', async () => {
  //   const res = await SELF.fetch('http://example.local/?url=aaa&fallback=1');
  //   expect(res.status).toBe(404);
  //   expect((await res.arrayBuffer()).byteLength).toBeGreaterThan(0);
  // });
});

describe.each([
  { type: 'PNG', url: PNG_IMG_URL },
  { type: 'WebP', url: WEBP_IMG_URL },
  { type: 'GIF', url: GIF_IMG_URL },
])('$type画像が', ({ url }) => {
  it('配信できる', async () => {
    const res = await SELF.fetch(`http://example.local/?url=${encodeURIComponent(url)}`);
    expect(res.status).toBe(200);
  });
});

describe('\'GIF\'画像が', () => {
  describe.each([
    { query: 'static' },
    { query: 'preview' },
  ])('$queryパラメータのあるときに', async ({ query }: { query: string }) => {
    it('変換して返される', async () => {
      const res = await SELF.fetch(`http://example.local/?url=${encodeURIComponent(GIF_IMG_URL)}&${query}=1`);
      expect(res.status).toBe(200);
      expect((await res.arrayBuffer()).byteLength).toBeLessThan(ORIGINAL_GIF_LEN);
    });
  });
});

describe('\'SVG\'画像が', () => {
  it('配信できない', async () => {
    const res = await SELF.fetch(`http://example.local/?url=${encodeURIComponent(SVG_IMG_URL)}`);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe('');
  });
});
