import { describe, expect, it } from "vitest";
import { calculateSubnet } from "../src/subnet";

describe("calculateSubnet", () => {
  it("calculates a /24 subnet correctly", () => {
    const result = calculateSubnet("192.168.1.42", 24);

    expect(result).toEqual({
      ip: "192.168.1.42",
      prefix: 24,
      mask: "255.255.255.0",
      network: "192.168.1.0",
      broadcast: "192.168.1.255",
      firstHost: "192.168.1.1",
      lastHost: "192.168.1.254",
      usableHosts: 254,
    });
  });

  it("calculates a /30 subnet correctly", () => {
    const result = calculateSubnet("10.0.0.2", 30);

    expect(result.network).toBe("10.0.0.0");
    expect(result.broadcast).toBe("10.0.0.3");
    expect(result.firstHost).toBe("10.0.0.1");
    expect(result.lastHost).toBe("10.0.0.2");
    expect(result.usableHosts).toBe(2);
  });

  it("calculates a /32 subnet correctly", () => {
    const result = calculateSubnet("192.168.1.42", 32);

    expect(result.network).toBe("192.168.1.42");
    expect(result.broadcast).toBe("192.168.1.42");
    expect(result.usableHosts).toBe(1);
  });

  it("calculates a /0 subnet correctly", () => {
    const result = calculateSubnet("192.168.1.42", 0);

    expect(result.network).toBe("0.0.0.0");
    expect(result.broadcast).toBe("255.255.255.255");
  });

  it("rejects an invalid IPv4 address", () => {
    expect(() => calculateSubnet("192.168.1.999", 24)).toThrow();
  });

  it("rejects an invalid CIDR prefix", () => {
    expect(() => calculateSubnet("192.168.1.1", 33)).toThrow();
  });
});

it("handles /31 point-to-point subnets", () => {
  const result = calculateSubnet("10.0.0.0", 31);

  expect(result.network).toBe("10.0.0.0");
  expect(result.broadcast).toBe("10.0.0.1");
  expect(result.firstHost).toBe("10.0.0.0");
  expect(result.lastHost).toBe("10.0.0.1");
  expect(result.usableHosts).toBe(2);
});

it("handles /32 host routes", () => {
  const result = calculateSubnet("192.168.1.42", 32);

  expect(result.network).toBe("192.168.1.42");
  expect(result.broadcast).toBe("192.168.1.42");
  expect(result.firstHost).toBe("192.168.1.42");
  expect(result.lastHost).toBe("192.168.1.42");
  expect(result.usableHosts).toBe(1);
});