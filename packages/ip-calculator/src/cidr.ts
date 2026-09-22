export function validatePrefix(prefix: number): number {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error("Invalid CIDR prefix");
  }

  return prefix;
}

export function prefixToMask(prefix: number): number {
  validatePrefix(prefix);

  if (prefix === 0) {
    return 0;
  }

  return (0xffffffff << (32 - prefix)) >>> 0;
}

export function maskToString(mask: number): string {
  return [
    (mask >>> 24) & 255,
    (mask >>> 16) & 255,
    (mask >>> 8) & 255,
    mask & 255,
  ].join(".");
}
