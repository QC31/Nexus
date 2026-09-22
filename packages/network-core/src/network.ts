export interface NetworkInterface {
  name: string;
  macAddress?: string;
  ipv4Addresses: string[];
  ipv6Addresses: string[];
  isUp: boolean;
  isLoopback: boolean;
}

export interface NetworkRoute {
  destination: string;
  gateway?: string;
  interfaceName: string;
  metric?: number;
}

export interface NetworkNeighbor {
  ipAddress: string;
  macAddress?: string;
  interfaceName: string;
  state: string;
}
