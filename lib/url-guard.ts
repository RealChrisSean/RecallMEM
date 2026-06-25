// SSRF guard for user-supplied provider URLs.
//
// Provider `base_url` values are configured by the user and then fetched
// server-side. Without validation an attacker (in any networked/multi-user
// deployment) could point a provider at internal services or the cloud
// metadata endpoint (169.254.169.254) and use the server as a proxy —
// error responses in this codebase echo the upstream body, turning blind
// SSRF into a read primitive.
//
// This module rejects non-http(s) schemes and any host that resolves to a
// private / loopback / link-local / metadata address. Localhost is allowed
// ONLY for the local-first Ollama path (this is a local-first app and
// Ollama runs on 127.0.0.1 by design).

import net from "node:net";
import dns from "node:dns/promises";

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

// Returns true if the given IP literal is in a range we never allow a
// user-controlled URL to reach (loopback, private, link-local, metadata,
// CGNAT, unspecified, etc).
export function isPrivateOrReservedIp(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return isPrivateIpv4(ip);
  if (kind === 6) return isPrivateIpv6(ip);
  // Not a valid IP literal — treat as unsafe (caller resolves DNS first).
  return true;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 "this network"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (incl. metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a >= 224) return true; // 224.0.0.0/4 multicast + 240.0.0.0/4 reserved
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().split("%")[0]; // strip zone id
  if (lower === "::1" || lower === "::") return true; // loopback / unspecified
  // IPv4-mapped (::ffff:a.b.c.d) — validate the embedded v4 address.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  const head = lower.split(":")[0];
  const firstHextet = parseInt(head || "0", 16);
  if ((firstHextet & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((firstHextet & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  return false;
}

/**
 * Validate a user-supplied URL before the server fetches it.
 *
 * @param rawUrl   the URL to validate (provider base_url)
 * @param opts.allowLocalhost  permit loopback/private targets (Ollama only)
 * @throws BlockedUrlError if the URL is unsafe
 */
export async function assertSafeUrl(
  rawUrl: string,
  opts: { allowLocalhost?: boolean } = {}
): Promise<void> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new BlockedUrlError(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(`Unsupported URL scheme: ${url.protocol}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, ""); // unwrap [::1]
  if (!hostname) throw new BlockedUrlError("URL has no host");

  // If allowLocalhost is set (Ollama), skip the private-range checks entirely.
  if (opts.allowLocalhost) return;

  // Resolve the hostname and reject if ANY resolved address is private.
  // Checking all records limits (but does not fully eliminate) DNS-rebinding.
  const ipsToCheck: string[] = [];
  if (net.isIP(hostname)) {
    ipsToCheck.push(hostname);
  } else {
    // Block obvious localhost aliases before even resolving.
    if (hostname.toLowerCase() === "localhost" || hostname.toLowerCase().endsWith(".localhost")) {
      throw new BlockedUrlError(`Blocked host: ${hostname}`);
    }
    try {
      const records = await dns.lookup(hostname, { all: true });
      for (const r of records) ipsToCheck.push(r.address);
    } catch {
      throw new BlockedUrlError(`Could not resolve host: ${hostname}`);
    }
  }

  if (ipsToCheck.length === 0) {
    throw new BlockedUrlError(`Could not resolve host: ${hostname}`);
  }
  for (const ip of ipsToCheck) {
    if (isPrivateOrReservedIp(ip)) {
      throw new BlockedUrlError(
        `Blocked host ${hostname} (resolves to private/reserved address ${ip})`
      );
    }
  }
}
