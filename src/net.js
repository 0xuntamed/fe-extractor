import dns from "node:dns/promises";
import { isIP } from "node:net";

export const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 10_000);
const MAX_REDIRECTS = 5;

const DEFAULT_HEADERS = {
  "user-agent": "interface-auditor-v1",
  "accept": "text/html,application/json,text/css,text/plain,*/*"
};

function ipv4ToInt(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function ipv4IsPrivate(ip) {
  const value = ipv4ToInt(ip);
  if (value === null) return true; // Unparseable → treat as unsafe.

  const inRange = (base, bits) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(base) & mask);
  };

  return (
    inRange("0.0.0.0", 8) ||        // "this network"
    inRange("10.0.0.0", 8) ||       // private
    inRange("100.64.0.0", 10) ||    // carrier-grade NAT
    inRange("127.0.0.0", 8) ||      // loopback
    inRange("169.254.0.0", 16) ||   // link-local (incl. cloud metadata)
    inRange("172.16.0.0", 12) ||    // private
    inRange("192.0.0.0", 24) ||     // IETF protocol assignments
    inRange("192.168.0.0", 16) ||   // private
    inRange("198.18.0.0", 15) ||    // benchmarking
    value >= ipv4ToInt("224.0.0.0") // multicast + reserved
  );
}

function ipIsPrivate(ip) {
  const lower = ip.toLowerCase();

  // IPv4-mapped IPv6 (e.g. ::ffff:169.254.169.254).
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return ipv4IsPrivate(mapped[1]);

  if (isIP(ip) === 4) return ipv4IsPrivate(ip);

  // IPv6
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  const firstHextet = parseInt(lower.split(":")[0] || "0", 16) || 0;
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link local
  return false;
}

/**
 * Resolves a URL's host and rejects it if it points at a private, loopback,
 * link-local, or otherwise internal address. Guards against SSRF.
 */
export async function assertPublicUrl(inputUrl) {
  const url = new URL(inputUrl);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Only http and https URLs are allowed.");
  }

  const host = url.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets
  let addresses;
  if (isIP(host)) {
    addresses = [host];
  } else {
    const records = await dns.lookup(host, { all: true }).catch(() => []);
    addresses = records.map((record) => record.address);
  }

  if (!addresses.length) {
    throw new Error(`Could not resolve host "${host}".`);
  }
  if (addresses.some(ipIsPrivate)) {
    throw new Error(`Refusing to fetch a private or internal address ("${host}").`);
  }

  return url;
}

async function fetchWithTimeout(url, { timeoutMs, redirect } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { headers: DEFAULT_HEADERS, redirect, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Timed out after ${timeoutMs ?? FETCH_TIMEOUT_MS}ms fetching ${url}.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches text from a trusted host (e.g. the GitHub API) with a timeout.
 */
export async function fetchText(url, options = {}) {
  const response = await fetchWithTimeout(url, options);
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

/**
 * Fetches text from a user-supplied URL, validating every redirect hop against
 * the SSRF guard so a public URL cannot bounce to an internal one.
 */
export async function fetchTextGuarded(inputUrl, options = {}) {
  let current = inputUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    await assertPublicUrl(current);
    const response = await fetchWithTimeout(current, { ...options, redirect: "manual" });

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).href;
      continue;
    }
    if (!response.ok) {
      throw new Error(`Fetch failed for ${current}: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }
  throw new Error(`Too many redirects while fetching ${inputUrl}.`);
}

/**
 * Maps over items with a bounded number of concurrent workers, preserving
 * input order in the returned array.
 */
export async function pooledMap(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}
