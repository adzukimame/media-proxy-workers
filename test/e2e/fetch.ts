import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('urlパラメータが', () => {
  it('存在しないと400エラー', async () => {
    const res = await SELF.fetch('http://example.com/');
    expect(res.status).toBe(400);
  });

  it('不正だと400エラー', async () => {
    const res = await SELF.fetch('http://example.com/url=aaa');
    expect(res.status).toBe(400);
  });
});
