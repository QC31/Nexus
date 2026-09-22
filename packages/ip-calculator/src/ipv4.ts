export interface IPv4Address {
  octets: [number, number, number, number];
  value: number;
}

export function parseIPv4(input: string): IPv4Address {
  const parts = input.trim().split(".");

  if (parts.length !== 4) {
    throw new Error("Invalid IPv4 address");
  }

  const octets = parts.map((part) => {
    if (!/^\d+$/.test(part)) {
      throw new Error("Invalid IPv4 address");
    }

    const value = Number(part);

    if (value < 0 || value > 255) {
      throw new Error("Invalid IPv4 address");
    }

    return value;
  }) as [number, number, number, number];

  const value =
    (octets[0] * 256 ** 3 +
      octets[1] * 256 ** 2 +
      octets[2] * 256 +
      octets[3]) >>>
    0;

  return {
    octets,
    value,
  };
}

export function ipv4ToString(address: IPv4Address): string {
  return address.octets.join(".");
}
