import { parseIPv4 } from "./ipv4";
import { maskToString, prefixToMask, validatePrefix } from "./cidr";

export interface SubnetInfo {
  ip: string;
  prefix: number;
  mask: string;
  network: string;
  broadcast: string;
  firstHost: string;
  lastHost: string;
  usableHosts: number;
}

function numberToIPv4(value: number): string {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

export function calculateSubnet(ip: string, prefix: number): SubnetInfo {
  const address = parseIPv4(ip);
  validatePrefix(prefix);

  const mask = prefixToMask(prefix);
  const network = (address.value & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;

  let firstHost = network;
  let lastHost = broadcast;
  let usableHosts = 0;

  if (prefix <= 30) {
    firstHost = (network + 1) >>> 0;
    lastHost = (broadcast - 1) >>> 0;
    usableHosts = broadcast - network - 1;
  } else if (prefix === 31) {
    firstHost = network;
    lastHost = broadcast;
    usableHosts = 2;
  } else if (prefix === 32) {
    firstHost = network;
    lastHost = network;
    usableHosts = 1;
  }

  return {
    ip,
    prefix,
    mask: maskToString(mask),
    network: numberToIPv4(network),
    broadcast: numberToIPv4(broadcast),
    firstHost: numberToIPv4(firstHost),
    lastHost: numberToIPv4(lastHost),
    usableHosts,
  };
}