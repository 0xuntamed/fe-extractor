import test from "node:test";
import assert from "node:assert/strict";
import { assertPublicUrl, pooledMap } from "../src/net.js";

test("assertPublicUrl rejects non-http(s) protocols", async () => {
  await assert.rejects(() => assertPublicUrl("ftp://example.com/file"), /http and https/);
});

test("assertPublicUrl blocks loopback and private IPv4 literals", async () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://10.0.0.5/",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://169.254.169.254/latest/meta-data/" // cloud metadata endpoint
  ]) {
    await assert.rejects(() => assertPublicUrl(url), /private or internal/, `expected ${url} to be blocked`);
  }
});

test("assertPublicUrl blocks IPv6 loopback and unique-local literals", async () => {
  await assert.rejects(() => assertPublicUrl("http://[::1]/"), /private or internal/);
  await assert.rejects(() => assertPublicUrl("http://[fd00::1]/"), /private or internal/);
});

test("assertPublicUrl allows a public IP literal", async () => {
  const url = await assertPublicUrl("http://8.8.8.8/");
  assert.equal(url.hostname, "8.8.8.8");
});

test("pooledMap preserves input order", async () => {
  const input = [1, 2, 3, 4, 5];
  const result = await pooledMap(input, 2, async (n) => n * 10);
  assert.deepEqual(result, [10, 20, 30, 40, 50]);
});

test("pooledMap never exceeds the concurrency limit", async () => {
  let active = 0;
  let peak = 0;
  await pooledMap([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return n;
  });
  assert.ok(peak <= 3, `peak concurrency ${peak} exceeded limit of 3`);
});
