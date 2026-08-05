/**
 * Location and network validation for punches.
 *
 * Everything here is pure arithmetic on values we already hold -- no external
 * geocoding service is called, so a punch is never blocked by a third party
 * being down.
 */

const EARTH_RADIUS_M = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in metres. Accurate to well under a metre at fence scale. */
export function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return Math.round(EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/**
 * Ray-casting point-in-polygon. `ring` is a list of [lng, lat] pairs, open or
 * closed -- the wrap-around edge is handled either way.
 */
export function pointInPolygon(lat: number, lng: number, ring: [number, number][]): boolean {
  if (!Array.isArray(ring) || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i]![0];
    const yi = ring[i]![1];
    const xj = ring[j]![0];
    const yj = ring[j]![1];
    const intersects = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Rough metre distance from a point to the closest vertex of a polygon. */
export function distanceToPolygon(lat: number, lng: number, ring: [number, number][]): number {
  let best = Number.POSITIVE_INFINITY;
  for (const [plng, plat] of ring) {
    const d = haversineMetres(lat, lng, plat, plng);
    if (d < best) best = d;
  }
  return Number.isFinite(best) ? best : 0;
}

// ---------------------------------------------------------------------------
// IP matching
// ---------------------------------------------------------------------------

/** IPv4 dotted quad to a 32-bit unsigned integer, or null if it is not IPv4. */
export function ipv4ToInt(ip: string): number | null {
  const clean = ip.trim().replace(/^::ffff:/i, '');
  const parts = clean.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value >>> 0;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsRaw] = cidr.split('/');
  if (!base) return false;
  const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;

  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  if (bits === 0) return true;

  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

export function ipInRange(ip: string, from: string, to: string): boolean {
  const ipInt = ipv4ToInt(ip);
  const fromInt = ipv4ToInt(from);
  const toInt = ipv4ToInt(to);
  if (ipInt === null || fromInt === null || toInt === null) return false;
  return ipInt >= fromInt && ipInt <= toInt;
}

export interface IpRuleLike {
  ruleType: 'ALLOW' | 'DENY';
  cidr: string | null;
  ipFrom: string | null;
  ipTo: string | null;
}

export interface IpDecision {
  allowed: boolean;
  reason: string;
}

/**
 * DENY wins over ALLOW. With allow rules present and none matching, the address
 * is refused -- an allow-list that does not actually restrict anything is worse
 * than no allow-list, because it reads as protection.
 *
 * IPv6 callers are allowed through with a note rather than silently denied:
 * these rules are IPv4 only, and failing closed on a v6 office network would
 * lock out an entire site over a rule that was never written for it.
 */
export function evaluateIpRules(ip: string | null, rules: IpRuleLike[]): IpDecision {
  if (!rules.length) return { allowed: true, reason: 'No IP restrictions configured' };
  if (!ip) return { allowed: true, reason: 'Client IP unavailable, restriction not applied' };
  if (ipv4ToInt(ip) === null) {
    return { allowed: true, reason: `IP ${ip} is not IPv4 and these rules only cover IPv4` };
  }

  const matches = (r: IpRuleLike): boolean => {
    if (r.cidr && ipInCidr(ip, r.cidr)) return true;
    if (r.ipFrom && r.ipTo && ipInRange(ip, r.ipFrom, r.ipTo)) return true;
    return false;
  };

  for (const rule of rules) {
    if (rule.ruleType === 'DENY' && matches(rule)) {
      return { allowed: false, reason: `IP ${ip} is on the deny list` };
    }
  }

  const allowRules = rules.filter((r) => r.ruleType === 'ALLOW');
  if (!allowRules.length) return { allowed: true, reason: 'No allow list configured' };

  for (const rule of allowRules) {
    if (matches(rule)) return { allowed: true, reason: `IP ${ip} matched an allowed network` };
  }
  return { allowed: false, reason: `IP ${ip} is not on any allowed network` };
}

// ---------------------------------------------------------------------------
// User agent
// ---------------------------------------------------------------------------

/** Best-effort browser and OS labels from a user agent string. */
export function parseUserAgent(ua: string | null | undefined): { browser: string | null; os: string | null } {
  if (!ua) return { browser: null, os: null };

  let browser: string | null = null;
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\/|opera/i.test(ua)) browser = 'Opera';
  else if (/chrome\//i.test(ua)) browser = 'Chrome';
  else if (/safari\//i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/firefox\//i.test(ua)) browser = 'Firefox';
  else if (/curl|wget|postman|node|axios/i.test(ua)) browser = 'API client';

  let os: string | null = null;
  if (/windows nt/i.test(ua)) os = 'Windows';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ios/i.test(ua)) os = 'iOS';
  else if (/mac os x/i.test(ua)) os = 'macOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  return { browser, os };
}
