import dns from "node:dns/promises";
import { URL } from "node:url";

export interface SsrfGuardOptions {
  /** Narrow, explicit exception for the local batch-evaluation harness — never set true in production. */
  allowLoopback: boolean;
}

function isLoopbackV4(ip: string): boolean {
  return ip.startsWith("127.");
}

function isPrivateOrLinkLocalV4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true; // RFC1918
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 169 && b === 254) return true; // link-local
  if (a === 0) return true;
  return false;
}

function isLoopbackV6(ip: string): boolean {
  return ip === "::1";
}

function isPrivateOrLinkLocalV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  return lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80");
}

/**
 * Resolves the hostname and validates every resolved IP — never trusts the
 * hostname string alone, since a public-looking name can resolve to a
 * private/loopback address. Production: blocks loopback + all private/
 * link-local ranges, no exceptions. Evaluation mode (`allowLoopback: true`,
 * driven only by ALLOW_LOOPBACK_URLS): permits loopback ONLY — RFC1918/
 * link-local stay blocked even then, since the batch harness only needs
 * `localhost`.
 */
export async function assertUrlIsSafe(rawUrl: string, options: SsrfGuardOptions): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid URL: ${rawUrl}`);
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Unsupported protocol for ${rawUrl}: ${url.protocol}`);
  }

  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.lookup(url.hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`DNS resolution failed for host: ${url.hostname}`);
  }

  if (addresses.length === 0) {
    throw new Error(`No addresses resolved for host: ${url.hostname}`);
  }

  for (const { address, family } of addresses) {
    const loopback = family === 4 ? isLoopbackV4(address) : isLoopbackV6(address);
    const privateAddr = family === 4 ? isPrivateOrLinkLocalV4(address) : isPrivateOrLinkLocalV6(address);

    if (loopback) {
      if (!options.allowLoopback) {
        throw new Error(`Blocked loopback address ${address} for host ${url.hostname}`);
      }
      continue;
    }
    if (privateAddr) {
      throw new Error(`Blocked private/link-local address ${address} for host ${url.hostname}`);
    }
  }

  return url;
}
