import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Card } from "../components/ui/Card";

interface Ipv6AddressInfo {
  address: string;
  is_temporary: boolean;
  is_link_local: boolean;
}

interface NetworkInterfaceInfo {
  name: string;
  ipv4_addresses: string[];
  ipv6_addresses: Ipv6AddressInfo[];
  is_up: boolean;
  is_loopback: boolean;
  wifi_ssid: string | null;
  wifi_rx_bitrate_mbps: number | null;
  wifi_tx_bitrate_mbps: number | null;
}

interface NetworkRouteInfo {
  destination: string;
  gateway: string | null;
  interface_name: string | null;
  metric: number | null;
}

interface NetworkNeighborInfo {
  ip_address: string;
  mac_address: string | null;
  interface_name: string;
  state: string;
}

interface DnsInfo {
  interface_name: string | null;
  current_server: string | null;
  servers: string[];
}

interface PingResult {
  target: string;
  sent: number;
  received: number;
  packet_loss: number;
  min_ms: number | null;
  avg_ms: number | null;
  max_ms: number | null;
  jitter_ms: number | null;
}

interface ConnectivityCheck {
  name: string;
  status: 'online' | 'degraded' | 'offline';
  latency_ms: number | null;
  detail: string | null;
}

interface GlobalConnectivityResult {
  status: 'online' | 'degraded' | 'offline';
  checks: ConnectivityCheck[];
}

interface RouteLookupResult {
  target: string;
  destination: string;
  gateway: string | null;
  interface_name: string | null;
  metric: number | null;
}

interface NetworkDiscoveryDevice {
  ip_address: string;
  mac_address: string | null;
  hostname: string | null;
  vendor: string | null;
  interface_name: string;
  state: string;
  latency_ms: number | null;
}

interface NetworkDiscoveryProgress {
  scanned: number;
  total: number;
  discovered: number;
}

interface PingSample {
  timestamp: number;
  latency_ms: number | null;
  packet_loss: number;
  success: boolean;
}

interface TcpCheckResult {
  target: string;
  port: number;
  open: boolean;
  connect_time_ms: number | null;
}

interface PortScanResult {
  port: number;
  open: boolean;
  service: string | null;
  connect_time_ms: number | null;
}

interface PortScanProgress {
  scanned: number;
  total: number;
  open_ports: number;
}

interface PortScanPreset {
  name: string;
  ports: number[];
}

interface DnsLookupResult {
  name: string;
  record_type: string;
  records: string[];
  response_time_ms: number;
}

interface DnsComparisonServerResult {
  server: string;
  response_time_ms: number | null;
  records: string[];
  error: string | null;
  records_match: boolean | null;
}

interface DnsComparisonResult {
  name: string;
  record_type: string;
  results: DnsComparisonServerResult[];
}

interface ReverseDnsResult {
  ip_address: string;
  hostnames: string[];
}

interface HttpHeader {
  name: string;
  value: string;
}

interface HttpRedirect {
  url: string;
  status_code: number;
}

interface TlsInfo {
  version: string | null;
  cipher_suite: string | null;
  subject: string | null;
  issuer: string | null;
  valid_from: string | null;
  valid_until: string | null;
  days_remaining: number | null;
  certificate_status: string | null;
  domains: string[];
}

interface HttpDiagnosticResult {
  url: string;
  final_url: string;
  status_code: number;
  response_time_ms: number;
  response_size_bytes: number;
  headers: HttpHeader[];
  redirects: HttpRedirect[];
  tls: TlsInfo | null;
}

interface TracerouteHop {
  hop: number;
  address: string | null;
  latency_ms: number | null;
}

const PORT_SCAN_PRESETS: PortScanPreset[] = [
  {
    name: "COMMON",
    ports: [
      21,
      22,
      23,
      25,
      53,
      80,
      110,
      143,
      443,
      445,
      587,
      993,
      995,
      1433,
      3306,
      3389,
      5432,
      5900,
      6379,
      8080,
    ],
  },
  {
    name: "WEB",
    ports: [80, 443, 3000, 5000, 8000, 8080, 8443],
  },
  {
    name: "DATABASE",
    ports: [1433, 3306, 5432, 6379, 27017],
  },
  {
    name: "REMOTE ACCESS",
    ports: [22, 23, 3389, 5900],
  },
];

export function NetToolBoxPage() {
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [error, setError] = useState("");
  const [routes, setRoutes] = useState<NetworkRouteInfo[]>([]);
  const [discoveredDevices, setDiscoveredDevices] = useState<
    NetworkDiscoveryDevice[]
  >([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryProgress, setDiscoveryProgress] =
    useState<NetworkDiscoveryProgress | null>(null);

    useEffect(() => {
  let unlisten: (() => void) | null = null;

  const setup = async () => {
    unlisten = await listen<NetworkDiscoveryProgress>(
      "network-discovery-progress",
      (event) => {
        setDiscoveryProgress(event.payload);
      },
    );
  };

  void setup();

  return () => {
    unlisten?.();
  };
}, []);

useEffect(() => {
  let unlisten: (() => void) | null = null;

  const setup = async () => {
    unlisten = await listen<NetworkDiscoveryProgress>(
      "network-discovery-progress",
      (event) => {
        setDiscoveryProgress(event.payload);
      },
    );
  };

  void setup();

  return () => {
    unlisten?.();
  };
}, []);

// LISTENER PORT SCANNER
useEffect(() => {
  let unlisten: (() => void) | null = null;

  const setup = async () => {
    unlisten = await listen<PortScanProgress>(
      "port-scan-progress",
      (event) => {
        setPortScanProgress(event.payload);
      },
    );
  };

  void setup();

  return () => {
    unlisten?.();
  };
}, []);

  const [dnsInfo, setDnsInfo] = useState<DnsInfo | null>(null);
  const [neighbors, setNeighbors] = useState<NetworkNeighborInfo[]>([]);
  const [neighborSearch, setNeighborSearch] = useState("");
  const [neighborInterfaceFilter, setNeighborInterfaceFilter] = useState("all");
  const [neighborSort, setNeighborSort] = useState<"ip" | "mac" | "state">("ip");
  const [isRefreshingNeighbors, setIsRefreshingNeighbors] = useState(false);
  const [pingTarget, setPingTarget] = useState("192.168.1.254");
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [globalConnectivity, setGlobalConnectivity] =
    useState<GlobalConnectivityResult | null>(null);
  const [isCheckingConnectivity, setIsCheckingConnectivity] = useState(false);
  const [connectivityError, setConnectivityError] = useState('');
  const [routeLookupTarget, setRouteLookupTarget] = useState('');
  const [routeLookupResult, setRouteLookupResult] =
    useState<RouteLookupResult | null>(null);
  const [isLookingUpRoute, setIsLookingUpRoute] = useState(false);
  const [routeLookupError, setRouteLookupError] = useState('');
  const [pingError, setPingError] = useState("");
  const [isPinging, setIsPinging] = useState(false);
  const [pingHistory, setPingHistory] = useState<PingSample[]>([]);
  const [isPingMonitoring, setIsPingMonitoring] = useState(false);
  const pingMonitoringRef = useRef(false);
  const [tcpTarget, setTcpTarget] = useState("127.0.0.1");
  const [tcpPort, setTcpPort] = useState("22");
  const [tcpResult, setTcpResult] = useState<TcpCheckResult | null>(null);
  const [tcpError, setTcpError] = useState("");
  const [isTcpChecking, setIsTcpChecking] = useState(false);
  const [tracerouteTarget, setTracerouteTarget] = useState("192.168.1.254");
  const [tracerouteResult, setTracerouteResult] = useState<TracerouteHop[]>([]);
  const [tracerouteError, setTracerouteError] = useState("");
  const [isTracerouting, setIsTracerouting] = useState(false);
  const [dnsLookupName, setDnsLookupName] = useState("example.com");
  const [dnsLookupType, setDnsLookupType] = useState("A");
  const [dnsServerMode, setDnsServerMode] = useState("system");
  const [dnsServer, setDnsServer] = useState("");
  const [dnsComparisonResult, setDnsComparisonResult] =
    useState<DnsComparisonResult | null>(null);
  const [dnsComparisonError, setDnsComparisonError] = useState("");
  const [isDnsComparing, setIsDnsComparing] = useState(false);
  const [dnsLookupResult, setDnsLookupResult] = useState<DnsLookupResult | null>(null);
  const [dnsLookupError, setDnsLookupError] = useState("");
  const [isDnsLookingUp, setIsDnsLookingUp] = useState(false);
  const [reverseDnsIp, setReverseDnsIp] = useState("192.168.1.254");
  const [reverseDnsResult, setReverseDnsResult] =
  useState<ReverseDnsResult | null>(null);
  const [reverseDnsError, setReverseDnsError] = useState("");
  const [isReverseDnsLookingUp, setIsReverseDnsLookingUp] = useState(false);
  const [httpUrl, setHttpUrl] = useState("https://example.com");
  const [httpResult, setHttpResult] = useState<HttpDiagnosticResult | null>(null);
  const [httpError, setHttpError] = useState("");
  const [isHttpChecking, setIsHttpChecking] = useState(false);
  const [portScanTarget, setPortScanTarget] = useState("");
  const [portScanResults, setPortScanResults] = useState<PortScanResult[]>([]);
  const [isPortScanning, setIsPortScanning] = useState(false);
  const [portScanProgress, setPortScanProgress] =
    useState<PortScanProgress | null>(null);
  const [portScanPreset, setPortScanPreset] = useState("COMMON");
  const [customPorts, setCustomPorts] = useState("");

useEffect(() => {
  let cancelled = false;
  const isWindows = navigator.userAgent.includes("Windows");

  const loadInterfaces = async () => {
    try {
      const initialInterfaces = await invoke<NetworkInterfaceInfo[]>(
        "network_interfaces",
      );

      if (!cancelled) {
        setInterfaces(initialInterfaces);
      }
    } catch (error) {
      if (!cancelled) {
        setError(String(error));
      }
    }
  };

  const loadInitialNetworkData = async () => {
    console.log("[NetToolBox] Début loadInitialNetworkData");
    console.log("[NetToolBox] Windows détecté :", isWindows);

    try {
      if (isWindows) {
        console.log("[NetToolBox] Appel net_toolbox_initial_data");

        const result = await invoke<{
          routes: NetworkRouteInfo[];
          neighbors: NetworkNeighborInfo[];
          dns_info: DnsInfo;
        }>("net_toolbox_initial_data");

        // Ne pas poursuivre si cet effet a été annulé par React StrictMode.
        if (cancelled) {
          return;
        }

        setRoutes(result.routes);
        setNeighbors(result.neighbors);
        setDnsInfo(result.dns_info);

        // Les états des adaptateurs sont maintenant en cache.
        // Charger les interfaces uniquement pour l'effet actif.
        await loadInterfaces();

      } else {
        // Conserver le comportement existant sur les autres systèmes.
        const [neighbors, routes, dnsInfo] = await Promise.all([
          invoke<NetworkNeighborInfo[]>("network_neighbors"),
          invoke<NetworkRouteInfo[]>("network_routes"),
          invoke<DnsInfo>("dns_info"),
        ]);

        if (!cancelled) {
          setNeighbors(neighbors);
          setRoutes(routes);
          setDnsInfo(dnsInfo);
        }
      }
    } catch (error) {
      if (!cancelled) {
        console.error("[NetToolBox] Échec du chargement initial :", error);
        setError(String(error));
      }
    }
  };

  if (isWindows) {
    // Windows : collecte groupée, puis chargement des interfaces.
    void loadInitialNetworkData();
  } else {
    // Autres systèmes : conserver le chargement parallèle.
    void loadInterfaces();
    void loadInitialNetworkData();
  }

// Actualiser les interfaces réseau toutes les 10 secondes.
const interfacesInterval = window.setInterval(() => {
if (!cancelled) {
void loadInterfaces();
}
}, 10_000);

// Sous Windows, rafraîchir aussi l'état des adaptateurs toutes les 30 secondes.
const interfaceStatesInterval = isWindows
? window.setInterval(async () => {
if (cancelled) {
return;
}

    try {
      await invoke("refresh_interface_states");

      if (!cancelled) {
        await loadInterfaces();
      }
    } catch (error) {
      console.error(
        "[NetToolBox] Échec du rafraîchissement des états des interfaces :",
        error,
      );
    }
  }, 30_000)
: undefined;

return () => {
cancelled = true;
window.clearInterval(interfacesInterval);


if (interfaceStatesInterval !== undefined) {
  window.clearInterval(interfaceStatesInterval);
}

};
}, []);


const neighborInterfaces = Array.from(
  new Set(neighbors.map((neighbor) => neighbor.interface_name)),
).sort();

const filteredNeighbors = [...neighbors]
  .filter((neighbor) => {
    const search = neighborSearch.trim().toLowerCase();

    const matchesSearch =
      search === "" ||
      neighbor.ip_address.toLowerCase().includes(search) ||
      (neighbor.mac_address?.toLowerCase().includes(search) ?? false);

    const matchesInterface =
      neighborInterfaceFilter === "all" ||
      neighbor.interface_name === neighborInterfaceFilter;

    return matchesSearch && matchesInterface;
  })
  .sort((a, b) => {
    if (neighborSort === "mac") {
      return (a.mac_address ?? "").localeCompare(b.mac_address ?? "");
    }

    if (neighborSort === "state") {
      return a.state.localeCompare(b.state);
    }

    return a.ip_address.localeCompare(b.ip_address, undefined, {
      numeric: true,
    });
  });

const handleRefreshNeighbors = async () => {
  setIsRefreshingNeighbors(true);

  try {
    const result = await invoke<NetworkNeighborInfo[]>("network_neighbors");
    setNeighbors(result);
  } catch (error) {
    console.error("Failed to refresh network neighbors:", error);
  } finally {
    setIsRefreshingNeighbors(false);
  }
};

const handleNetworkDiscovery = async () => {
  try {
    setError("");
    setIsDiscovering(true);
    setDiscoveredDevices([]);
    setDiscoveryProgress(null);

    const result = await invoke<NetworkDiscoveryDevice[]>("network_discovery");

    setDiscoveredDevices(result);
  } catch (error) {
    console.error("Failed to run network discovery:", error);
    setError(String(error));
  } finally {
    setIsDiscovering(false);
  }
};

const handlePortScan = async () => {
  try {
    setError("");
    setIsPortScanning(true);
    setPortScanResults([]);
    setPortScanProgress(null);

    const target = portScanTarget.trim();

    if (!target) {
      setError("Please enter a target.");
      return;
    }

    let ports: number[];

    if (portScanPreset === "CUSTOM") {
      ports = customPorts
        .split(",")
        .map((port) => Number(port.trim()))
        .filter((port) => Number.isInteger(port) && port >= 1 && port <= 65535);

      if (ports.length === 0) {
        setError("Please enter valid ports between 1 and 65535.");
        return;
      }
    } else {
      const preset = PORT_SCAN_PRESETS.find(
        (item) => item.name === portScanPreset,
      );

      if (!preset) {
        setError("Invalid port scan preset.");
        return;
      }

      ports = preset.ports;
    }

    const uniquePorts = [...new Set(ports)];

    const result = await invoke<PortScanResult[]>("port_scan", {
      target,
      ports: uniquePorts,
    });

    setPortScanResults(result);
  } catch (error) {
    console.error("Failed to run port scan:", error);
    setError(String(error));
  } finally {
    setIsPortScanning(false);
  }
};

async function handleRouteLookup() {
  if (!routeLookupTarget.trim()) {
    setRouteLookupError('Enter an IP address.');
    return;
  }

  if (isLookingUpRoute) return;

  setIsLookingUpRoute(true);
  setRouteLookupError('');
  setRouteLookupResult(null);

  try {
    const result = await invoke<RouteLookupResult>('route_lookup', {
      target: routeLookupTarget.trim(),
    });

    setRouteLookupResult(result);
  } catch (error) {
    setRouteLookupError(String(error));
  } finally {
    setIsLookingUpRoute(false);
  }
}

async function handleGlobalConnectivityTest() {
  if (isCheckingConnectivity) {
    return;
  }

  setIsCheckingConnectivity(true);
  setConnectivityError('');
  setGlobalConnectivity(null);

  try {
    const result = await invoke<GlobalConnectivityResult>(
      'global_connectivity_test',
    );

    setGlobalConnectivity(result);
  } catch (error) {
    setConnectivityError(String(error));
  } finally {
    setIsCheckingConnectivity(false);
  }
}

async function handlePing() {
  if (!pingTarget.trim()) {
    setPingError("Enter a target.");
    return;
  }

  if (pingMonitoringRef.current) {
    pingMonitoringRef.current = false;
    setIsPingMonitoring(false);
    setIsPinging(false);
    return;
  }

  pingMonitoringRef.current = true;
  setIsPingMonitoring(true);
  setPingError("");
  setPingResult(null);
  setPingHistory([]);

  const target = pingTarget.trim();

  while (pingMonitoringRef.current) {
    setIsPinging(true);

    try {
      const result = await invoke<PingResult>("ping_host", {
        target,
      });

      setPingResult(result);

      setPingHistory((history) => [
        ...history.slice(-19),
        {
          timestamp: Date.now(),
          latency_ms: result.avg_ms,
          packet_loss: result.packet_loss,
          success: result.packet_loss < 100,
        },
      ]);

    } catch (error) {
      setPingError(String(error));

      setPingHistory((history) => [
        ...history.slice(-19),
        {
          timestamp: Date.now(),
          latency_ms: null,
          packet_loss: 100,
          success: false,
        },
      ]);

    } finally {
      setIsPinging(false);
    }

    if (!pingMonitoringRef.current) {
      break;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, 2000);
    });
  }

  setIsPingMonitoring(false);
  setIsPinging(false);
}

async function handleTcpCheck() {
  if (!tcpTarget.trim()) {
    setTcpError("Enter a target.");
    return;
  }

  const port = Number(tcpPort);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    setTcpError("Enter a valid TCP port between 1 and 65535.");
    return;
  }

  setIsTcpChecking(true);
  setTcpError("");
  setTcpResult(null);

  try {
    const result = await invoke<TcpCheckResult>("tcp_check", {
      target: tcpTarget.trim(),
      port,
    });

    setTcpResult(result);
  } catch (error) {
    setTcpError(String(error));
  } finally {
    setIsTcpChecking(false);
  }
}

async function handleTraceroute() {
  if (!tracerouteTarget.trim()) {
    setTracerouteError("Enter a target.");
    return;
  }

  setIsTracerouting(true);
  setTracerouteError("");
  setTracerouteResult([]);

  try {
    const result = await invoke<TracerouteHop[]>("traceroute_host", {
      target: tracerouteTarget.trim(),
    });

    setTracerouteResult(result);
  } catch (error) {
    setTracerouteError(String(error));
  } finally {
    setIsTracerouting(false);
  }
}

async function handleDnsLookup() {
  if (!dnsLookupName.trim()) {
    setDnsLookupError("Enter a domain name.");
    return;
  }

  setIsDnsLookingUp(true);
  setDnsLookupError("");
  setDnsLookupResult(null);

  try {
    const result = await invoke<DnsLookupResult>("dns_lookup", {
      name: dnsLookupName.trim(),
      recordType: dnsLookupType,
      dnsServer:
        dnsServerMode === "system"
        ? null
        : dnsServerMode === "custom"
        ? dnsServer.trim()
        : dnsServerMode,
    });

    setDnsLookupResult(result);
  } catch (error) {
    setDnsLookupError(String(error));
  } finally {
    setIsDnsLookingUp(false);
  }
}

async function handleDnsComparison() {
  if (!dnsLookupName.trim()) {
    setDnsComparisonError("Enter a domain.");
    return;
  }

  setIsDnsComparing(true);
  setDnsComparisonError("");
  setDnsComparisonResult(null);

  try {
    const result = await invoke<DnsComparisonResult>("dns_compare", {
      name: dnsLookupName.trim(),
      recordType: dnsLookupType,
      dnsServers: ["1.1.1.1", "8.8.8.8", "9.9.9.9"],
    });

    setDnsComparisonResult(result);
  } catch (error) {
    setDnsComparisonError(String(error));
  } finally {
    setIsDnsComparing(false);
  }
}

async function handleReverseDnsLookup() {
  if (!reverseDnsIp.trim()) {
    setReverseDnsError("Enter an IP address.");
    return;
  }

  setIsReverseDnsLookingUp(true);
  setReverseDnsError("");
  setReverseDnsResult(null);

  try {
    const result = await invoke<ReverseDnsResult>("reverse_dns_lookup", {
      ipAddress: reverseDnsIp.trim(),
    });

    setReverseDnsResult(result);
  } catch (error) {
    setReverseDnsError(String(error));
  } finally {
    setIsReverseDnsLookingUp(false);
  }
}

async function handleHttpDiagnostic() {
  if (!httpUrl.trim()) {
    setHttpError("Enter a URL.");
    return;
  }

  setIsHttpChecking(true);
  setHttpError("");
  setHttpResult(null);

  try {
    const result = await invoke<HttpDiagnosticResult>("http_diagnostic", {
      url: httpUrl.trim(),
    });

    setHttpResult(result);
  } catch (error) {
    setHttpError(String(error));
  } finally {
    setIsHttpChecking(false);
  }
}

  return (
    <>
    <section className="mb-6">
  <Card>
    <div className="mb-5">
      <p className="text-xs tracking-[0.2em] text-[#9D8589]">CONNECTIVITY</p>
      <h2 className="mt-2 text-lg font-semibold">Ping</h2>
      <p className="mt-1 text-sm text-[#9D8589]">
        Measure latency and packet loss to a target.
      </p>
    </div>

    <div className="flex flex-col gap-3 sm:flex-row">
      <input
        type="text"
        value={pingTarget}
        onChange={(event) => setPingTarget(event.target.value)}
        placeholder="192.168.1.254"
        className="min-w-0 flex-1 rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826]"
      />

      <button
        type="button"
        onClick={handlePing}
        disabled={isPinging && !isPingMonitoring}
        className="rounded-md border border-[#542028] bg-gradient-to-r from-[#6F111C] to-[#8F1826] px-6 py-3 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPingMonitoring ? "STOP MONITORING" : isPinging ? "PINGING..." : "START MONITORING"}
      </button>
    </div>

    {pingError && (
      <p className="mt-4 rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 text-sm text-[#D45767]">
        {pingError}
      </p>
    )}

    {pingResult && (
      <div className="mt-5 grid grid-cols-6 gap-3">
        <div>
          <p className="text-[10px] text-[#9D8589]">PACKETS</p>
          <p className="mt-1 font-mono text-sm">
            {pingResult.received}/{pingResult.sent}
          </p>
        </div>

        <div>
          <p className="text-[10px] text-[#9D8589]">LOSS</p>
          <p className="mt-1 font-mono text-sm">{pingResult.packet_loss}%</p>
        </div>

        <div>
          <p className="text-[10px] text-[#9D8589]">MIN</p>
          <p className="mt-1 font-mono text-sm">
            {pingResult.min_ms !== null
              ? `${pingResult.min_ms.toFixed(2)} ms`
              : '—'}
          </p>
        </div>

        <div>
          <p className="text-[10px] text-[#9D8589]">AVG</p>
          <p className="mt-1 font-mono text-sm">
            {pingResult.avg_ms !== null
              ? `${pingResult.avg_ms.toFixed(2)} ms`
              : '—'}
          </p>
        </div>

        <div>
          <p className="text-[10px] text-[#9D8589]">JITTER</p>
          <p className="mt-1 font-mono text-sm text-[#EEE5E6]">
            {pingResult.jitter_ms !== null
              ? `${pingResult.jitter_ms.toFixed(2)} ms`
              : '—'}
          </p>
        </div>

        <div>
          <p className="text-[10px] text-[#9D8589]">MAX</p>
          <p className="mt-1 font-mono text-sm">
            {pingResult.max_ms !== null
              ? `${pingResult.max_ms.toFixed(2)} ms`
              : '—'}
          </p>
        </div>
      </div>
    )}

    {pingHistory.length > 0 && (
  <div className="mt-5 border-t border-[#3B171D] pt-5">
    <div className="flex items-center justify-between">
      <p className="text-[10px] tracking-[0.15em] text-[#9D8589]">
        LATENCY HISTORY
      </p>

      <span className="font-mono text-[10px] text-[#6F5A5E]">
        {pingHistory.length} samples
      </span>
    </div>

    <div className="mt-4 overflow-hidden rounded-md border border-[#3B171D] bg-[#170A0D]">
      <svg
        viewBox="0 0 800 240"
        className="h-60 w-full"
        role="img"
        aria-label="Ping latency history"
      >
        <line
          x1="48"
          y1="24"
          x2="48"
          y2="210"
          stroke="#3B171D"
          strokeWidth="1"
        />

        <line
          x1="48"
          y1="210"
          x2="780"
          y2="210"
          stroke="#3B171D"
          strokeWidth="1"
        />

        {pingHistory.slice(-20).map((sample, index, samples) => {
          const successfulSamples = samples.filter(
            (item) => item.latency_ms !== null,
          );

          const maxLatency = Math.max(
            10,
            ...successfulSamples.map((item) => item.latency_ms ?? 0),
          );

          const x =
            samples.length === 1
              ? 414
              : 48 + (index / (samples.length - 1)) * 732;

          const y =
            sample.latency_ms === null
              ? 210
              : 210 - ((sample.latency_ms / maxLatency) * 170);

          return (
            <g key={`${sample.timestamp}-${index}`}>
              <circle
                cx={x}
                cy={y}
                r="4"
                fill={sample.success ? "#B52636" : "#D45767"}
              />

              {index > 0 &&
                samples[index - 1].latency_ms !== null &&
                sample.latency_ms !== null && (
                  <line
                    x1={
                      48 +
                      ((index - 1) / (samples.length - 1)) * 732
                    }
                    y1={
                      210 -
                      ((samples[index - 1].latency_ms ?? 0) / maxLatency) *
                        170
                    }
                    x2={x}
                    y2={y}
                    stroke="#8F1826"
                    strokeWidth="2"
                  />
                )}
            </g>
          );
        })}

        <text
          x="12"
          y="30"
          fill="#9D8589"
          fontSize="10"
          fontFamily="monospace"
        >
          MAX
        </text>

        <text
          x="20"
          y="215"
          fill="#9D8589"
          fontSize="10"
          fontFamily="monospace"
        >
          0 ms
        </text>
      </svg>
    </div>
  </div>
)}

{pingHistory.length > 0 && (
  <div className="mt-5 border-t border-[#3B171D] pt-5">
    <div className="flex items-center justify-between">
      <p className="text-[10px] tracking-[0.15em] text-[#9D8589]">
        PACKET LOSS HISTORY
      </p>

      <span className="font-mono text-[10px] text-[#6F5A5E]">
        {pingHistory.length} samples
      </span>
    </div>

    <div className="mt-4 overflow-hidden rounded-md border border-[#3B171D] bg-[#170A0D]">
      <svg
        viewBox="0 0 800 240"
        className="h-60 w-full"
        role="img"
        aria-label="Packet loss history"
      >
        <line
          x1="48"
          y1="24"
          x2="48"
          y2="210"
          stroke="#3B171D"
          strokeWidth="1"
        />

        <line
          x1="48"
          y1="210"
          x2="780"
          y2="210"
          stroke="#3B171D"
          strokeWidth="1"
        />

        <line
          x1="48"
          y1="117"
          x2="780"
          y2="117"
          stroke="#3B171D"
          strokeWidth="1"
          strokeDasharray="4 4"
        />

        {pingHistory.slice(-20).map((sample, index, samples) => {
          const x =
            samples.length === 1
              ? 414
              : 48 + (index / (samples.length - 1)) * 732;

          const y = 210 - (sample.packet_loss / 100) * 186;

          return (
            <g key={`loss-${sample.timestamp}-${index}`}>
              <circle
                cx={x}
                cy={y}
                r="4"
                fill={sample.packet_loss === 0 ? "#8DBB9D" : "#D45767"}
              />

              {index > 0 && (
                <line
                  x1={
                    48 +
                    ((index - 1) / (samples.length - 1)) * 732
                  }
                  y1={
                    210 -
                    (samples[index - 1].packet_loss / 100) * 186
                  }
                  x2={x}
                  y2={y}
                  stroke="#8F1826"
                  strokeWidth="2"
                />
              )}
            </g>
          );
        })}

        <text
          x="12"
          y="30"
          fill="#9D8589"
          fontSize="10"
          fontFamily="monospace"
        >
          100%
        </text>

        <text
          x="20"
          y="122"
          fill="#9D8589"
          fontSize="10"
          fontFamily="monospace"
        >
          50%
        </text>

        <text
          x="26"
          y="215"
          fill="#9D8589"
          fontSize="10"
          fontFamily="monospace"
        >
          0%
        </text>
      </svg>
    </div>
  </div>
)}

  </Card>
</section>

<section className="mb-6">
  <Card>
    <div className="mb-5">
      <p className="text-xs tracking-[0.2em] text-[#9D8589]">CONNECTIVITY</p>
      <h2 className="mt-2 text-lg font-semibold">TCP Port Check</h2>
      <p className="mt-1 text-sm text-[#9D8589]">
        Check whether a TCP port is accepting connections.
      </p>
    </div>

    <div className="flex flex-col gap-3 sm:flex-row">
      <input
        type="text"
        value={tcpTarget}
        onChange={(event) => setTcpTarget(event.target.value)}
        placeholder="192.168.1.254"
        className="min-w-0 flex-1 rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826]"
      />

      <input
        type="number"
        min="1"
        max="65535"
        value={tcpPort}
        onChange={(event) => setTcpPort(event.target.value)}
        placeholder="443"
        className="w-full rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826] sm:w-32"
      />

      <button
        type="button"
        onClick={handleTcpCheck}
        disabled={isTcpChecking}
        className="rounded-md border border-[#542028] bg-gradient-to-r from-[#6F111C] to-[#8F1826] px-6 py-3 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isTcpChecking ? "CHECKING..." : "CHECK"}
      </button>
    </div>

    {tcpError && (
      <p className="mt-4 rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 text-sm text-[#D45767]">
        {tcpError}
      </p>
    )}

    {tcpResult && (
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[10px] text-[#9D8589]">TARGET</p>
          <p className="mt-1 break-all font-mono text-sm">
            {tcpResult.target}
          </p>
        </div>

        <div>
          <p className="text-[10px] text-[#9D8589]">PORT</p>
          <p className="mt-1 font-mono text-sm">{tcpResult.port}</p>
        </div>

        <div>
          <p className="text-[10px] text-[#9D8589]">STATUS</p>
          <p className="mt-1 font-mono text-sm">
            {tcpResult.open ? "OPEN" : "CLOSED"}
          </p>
        </div>

        <div>
          <p className="text-[10px] text-[#9D8589]">CONNECT TIME</p>
          <p className="mt-1 font-mono text-sm">
            {tcpResult.connect_time_ms !== null
              ? `${tcpResult.connect_time_ms.toFixed(2)} ms`
              : "—"}
          </p>
        </div>
      </div>
    )}
  </Card>
</section>

<section className="mb-6">
  <Card>
    <div className="mb-5">
      <p className="text-xs tracking-[0.2em] text-[#9D8589]">CONNECTIVITY</p>
      <h2 className="mt-2 text-lg font-semibold">Traceroute</h2>
      <p className="mt-1 text-sm text-[#9D8589]">
        Trace the network path to a target.
      </p>
    </div>

    <div className="flex flex-col gap-3 sm:flex-row">
      <input
        type="text"
        value={tracerouteTarget}
        onChange={(event) => setTracerouteTarget(event.target.value)}
        placeholder="192.168.1.254"
        className="min-w-0 flex-1 rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826]"
      />

      <button
        type="button"
        onClick={handleTraceroute}
        disabled={isTracerouting}
        className="rounded-md border border-[#542028] bg-gradient-to-r from-[#6F111C] to-[#8F1826] px-6 py-3 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isTracerouting ? "TRACING..." : "TRACE"}
      </button>
    </div>

    {tracerouteError && (
      <p className="mt-4 rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 text-sm text-[#D45767]">
        {tracerouteError}
      </p>
    )}

    {tracerouteResult.length > 0 && (
      <div className="mt-5 space-y-2">
        {tracerouteResult.map((hop) => (
          <div
            key={hop.hop}
            className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3"
          >
            <div className="grid grid-cols-[3rem_1fr_auto] items-center gap-4 font-mono text-xs">
              <div className="text-[#9D8589]">
                {String(hop.hop).padStart(2, "0")}
              </div>

              <div className="min-w-0">
                <p className="break-all">
                  {hop.address ?? "*"}
                </p>
              </div>

              <div className="text-right text-[#9D8589]">
                {hop.latency_ms !== null
                  ? `${hop.latency_ms.toFixed(2)} ms`
                  : "—"}
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
  </Card>
</section>

<section className="mb-6">
  <Card>
    <div className="mb-5">
      <p className="text-xs tracking-[0.2em] text-[#9D8589]">
        NETWORK
      </p>

      <h2 className="mt-2 text-lg font-semibold">Network Discovery</h2>

      <p className="mt-1 text-sm text-[#9D8589]">
        Discover active devices on the local IPv4 network.
      </p>
    </div>

    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm text-[#9D8589]">
        {discoveredDevices.length > 0
          ? `${discoveredDevices.length} device${discoveredDevices.length > 1 ? "s" : ""} discovered`
          : "No discovery results yet."}
      </div>

      <button
        type="button"
        onClick={handleNetworkDiscovery}
        disabled={isDiscovering}
        className="rounded-md border border-[#542028] bg-gradient-to-r from-[#6F111C] to-[#8F1826] px-6 py-3 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isDiscovering ? "SCANNING..." : "SCAN NETWORK"}
      </button>

      {isDiscovering && discoveryProgress && (
        <div className="mt-5">
          <div className="mb-2 flex items-center justify-between text-xs font-mono text-[#9D8589]">
            <span>
              Scanning {discoveryProgress.scanned} / {discoveryProgress.total}
            </span>

            <span className="ml-4">
              {discoveryProgress.discovered} discovered
            </span>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-[#1D0D11]">
            <div
              className="h-full rounded-full bg-[#8F1826] transition-[width] duration-150"
              style={{
                width: `${
                  discoveryProgress.total > 0
                    ? Math.min(
                        100,
                        (discoveryProgress.scanned / discoveryProgress.total) * 100,
                      )
                    : 0
                }%`,
              }}
            />
          </div>
        </div>
      )}

    </div>

    {discoveredDevices.length > 0 && (
      <div className="mt-5 space-y-2">
        {discoveredDevices.map((device) => (
          <div
            key={device.ip_address}
            className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3"
          >
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <p className="font-mono text-sm text-[#EEE5E6]">
                  {device.ip_address}
                </p>

                <p className="mt-1 truncate text-xs text-[#9D8589]">
                  {device.hostname ?? "Hostname unavailable"}
                </p>

                <p className="mt-1 truncate text-xs text-[#6F5B5F]">
                  {device.vendor ?? "Vendor unavailable"}
                </p>

              </div>

              <div className="min-w-0">
                <p className="font-mono text-xs text-[#9D8589]">
                  {device.mac_address ?? "MAC unavailable"}
                </p>

                <p className="mt-1 text-xs text-[#6F5B5F]">
                  {device.interface_name}
                </p>
              </div>

              <div className="text-left lg:text-right">
                <p className="font-mono text-xs text-[#8DBB9D]">
                  {device.latency_ms !== null
                    ? `${device.latency_ms.toFixed(2)} ms`
                    : "—"}
                </p>

                <p className="mt-1 text-xs text-[#9D8589]">
                  {device.state}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
  </Card>
</section>

<section className="mb-6">
  <Card>
    <div className="mb-5">
      <p className="text-xs tracking-[0.2em] text-[#9D8589]">
        NETWORK
      </p>

      <h2 className="mt-2 text-lg font-semibold">Port Scanner</h2>

      <p className="mt-1 text-sm text-[#9D8589]">
        Scan common TCP ports on a target host.
      </p>
    </div>

    <div className="mb-4">
      <label
        htmlFor="port-scan-preset"
        className="mb-2 block text-xs tracking-[0.15em] text-[#9D8589]"
      >
        PRESET
      </label>

      <select
        id="port-scan-preset"
        value={portScanPreset}
        onChange={(event) => setPortScanPreset(event.target.value)}
        disabled={isPortScanning}
        className="w-full appearance-none rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 text-sm text-[#EEE5E6] outline-none focus:border-[#8F1826] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {PORT_SCAN_PRESETS.map((preset) => (
          <option
            key={preset.name}
            value={preset.name}
            className="bg-[#1D0D11] text-[#EEE5E6]"
          >
            {preset.name}
          </option>
        ))}

        <option
          value="CUSTOM"
          className="bg-[#1D0D11] text-[#EEE5E6]"
        >
          CUSTOM
        </option>
      </select>
    </div>

    {portScanPreset === "CUSTOM" && (
      <div className="mb-4">
        <label
          htmlFor="custom-ports"
          className="mb-2 block text-xs tracking-[0.15em] text-[#9D8589]"
        >
          CUSTOM PORTS
        </label>

        <input
          id="custom-ports"
          type="text"
          value={customPorts}
          onChange={(event) => setCustomPorts(event.target.value)}
          placeholder="22,80,443,3000,8080"
          disabled={isPortScanning}
          className="w-full rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826] disabled:cursor-not-allowed disabled:opacity-50"
        />

        <p className="mt-2 text-xs text-[#6F5B5F]">
          Enter ports separated by commas. Valid range: 1–65535.
        </p>
      </div>
    )}

    <div className="flex flex-col gap-3 sm:flex-row">
      <input
        type="text"
        value={portScanTarget}
        onChange={(event) => setPortScanTarget(event.target.value)}
        placeholder="192.168.1.42 or hostname"
        disabled={isPortScanning}
        className="min-w-0 flex-1 rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826]"
      />

      <button
        type="button"
        onClick={handlePortScan}
        disabled={isPortScanning}
        className="rounded-md border border-[#542028] bg-gradient-to-r from-[#6F111C] to-[#8F1826] px-6 py-3 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPortScanning ? "SCANNING..." : "SCAN PORTS"}
      </button>
    </div>

    {isPortScanning && portScanProgress && (
      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-4 text-xs font-mono text-[#9D8589]">
          <span>
            Scanning {portScanProgress.scanned} / {portScanProgress.total}
          </span>

          <span className="shrink-0">
            {portScanProgress.open_ports} open ports
          </span>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-[#1D0D11]">
          <div
            className="h-full rounded-full bg-[#8F1826] transition-[width] duration-150"
            style={{
              width: `${
                portScanProgress.total > 0
                  ? Math.min(
                      100,
                      (portScanProgress.scanned / portScanProgress.total) * 100,
                    )
                  : 0
              }%`,
            }}
          />
        </div>
      </div>
    )}

    {portScanResults.length > 0 && (
      <div className="mt-5 space-y-2">
        {portScanResults.map((result) => (
          <div
            key={result.port}
            className="flex items-center justify-between rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3"
          >
            <div className="flex items-center gap-4">
              <span className="font-mono text-sm text-[#EEE5E6]">
                {result.port}
              </span>

              <span
                className={`text-xs ${
                  result.open ? "text-[#8DBB9D]" : "text-[#9D8589]"
                }`}
              >
                {result.open ? "OPEN" : "CLOSED"}
              </span>

              {result.open && result.service && (
                <span className="text-xs text-[#EEE5E6]">
                  {result.service}
                </span>
              )}
            </div>

            <span
              className={`font-mono text-xs ${
                result.open ? "text-[#8DBB9D]" : "text-[#6F5B5F]"
              }`}
            >
              {result.connect_time_ms !== null
                ? `${result.connect_time_ms.toFixed(2)} ms`
                : "—"}
            </span>
          </div>
        ))}
      </div>
    )}
  </Card>
</section>

<section className="mb-6">
  <Card>
    <div className="mb-5">
      <p className="text-xs tracking-[0.2em] text-[#9D8589]">DNS</p>

      <h2 className="mt-2 text-lg font-semibold">DNS Lookup</h2>

      <p className="mt-1 text-sm text-[#9D8589]">
        Query DNS records for a domain.
      </p>
    </div>

    <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_140px_220px_auto]">
      <input
        type="text"
        value={dnsLookupName}
        onChange={(event) => setDnsLookupName(event.target.value)}
        placeholder="example.com"
        className="min-w-0 rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826]"
      />

      <div className="relative">
        <label htmlFor="dns-record-type" className="sr-only">
          DNS record type
        </label>

        <select
          id="dns-record-type"
          value={dnsLookupType}
          onChange={(event) => setDnsLookupType(event.target.value)}
          className="w-full appearance-none rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 pr-10 font-mono text-sm font-semibold text-[#EEE5E6] outline-none focus:border-[#B52636] focus:ring-1 focus:ring-[#8F1826]"
        >
          <option value="A">A</option>
          <option value="AAAA">AAAA</option>
          <option value="CNAME">CNAME</option>
          <option value="MX">MX</option>
          <option value="NS">NS</option>
          <option value="TXT">TXT</option>
          <option value="SOA">SOA</option>
        </select>

        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[#B52636]">
          <svg
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </div>

      <div className="relative">
        <label htmlFor="dns-server" className="sr-only">
          DNS server
        </label>

        <select
          id="dns-server"
          value={dnsServerMode}
          onChange={(event) => setDnsServerMode(event.target.value)}
          className="w-full appearance-none rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 pr-10 text-sm text-[#EEE5E6] outline-none focus:border-[#B52636] focus:ring-1 focus:ring-[#8F1826]"
        >
          <option value="system" className="bg-[#1D0D11] text-[#EEE5E6]">
            System DNS
          </option>

          <option value="1.1.1.1" className="bg-[#1D0D11] text-[#EEE5E6]">
            Cloudflare — 1.1.1.1
          </option>

          <option value="8.8.8.8" className="bg-[#1D0D11] text-[#EEE5E6]">
            Google — 8.8.8.8
          </option>

          <option value="9.9.9.9" className="bg-[#1D0D11] text-[#EEE5E6]">
            Quad9 — 9.9.9.9
          </option>

          <option value="custom" className="bg-[#1D0D11] text-[#EEE5E6]">
            Custom
          </option>
        </select>

        <div className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[#B52636]">
          <svg
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.168l3.71-3.938a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1-.02-1.06Z"
              clipRule="evenodd"
            />
          </svg>
        </div>
      </div>

      <button
        type="button"
        onClick={handleDnsLookup}
        disabled={isDnsLookingUp}
        className="rounded-md border border-[#542028] bg-gradient-to-r from-[#6F111C] to-[#8F1826] px-6 py-3 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isDnsLookingUp ? "LOOKING UP..." : "LOOKUP"}
      </button>

      <button
        type="button"
        onClick={handleDnsComparison}
        disabled={isDnsComparing}
        className="rounded-md border border-[#542028] bg-[#1D0D11] px-6 py-3 text-sm font-medium text-[#EEE5E6] transition-colors hover:border-[#8F1826] hover:bg-[#6F111C] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isDnsComparing ? "COMPARING..." : "RUN COMPARISON"}
      </button>
    </div>

    {dnsServerMode === "custom" && (
      <div className="mt-3">
        <label
          htmlFor="custom-dns-server"
          className="mb-2 block text-[10px] tracking-[0.15em] text-[#9D8589]"
        >
          CUSTOM DNS SERVER
        </label>

        <input
          id="custom-dns-server"
          type="text"
          value={dnsServer}
          onChange={(event) => setDnsServer(event.target.value)}
          placeholder="192.168.1.1"
          className="w-full rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5A5E] focus:border-[#B52636]"
        />
      </div>
    )}

    {dnsLookupError && (
      <p className="mt-4 rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 text-sm text-[#D45767]">
        {dnsLookupError}
      </p>
    )}

    {dnsLookupResult && (
      <div className="mt-5 space-y-4">
        <div className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3">
          <p className="text-[10px] tracking-[0.15em] text-[#9D8589]">
            RESPONSE TIME
          </p>

          <p className="mt-2 font-mono text-lg">
            {dnsLookupResult.response_time_ms.toFixed(2)} ms
          </p>
        </div>

        <div className="space-y-2">
          {dnsLookupResult.records.length > 0 ? (
            dnsLookupResult.records.map((record, index) => (
              <div
                key={`${record}-${index}`}
                className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3"
              >
                <p className="break-all font-mono text-xs">{record}</p>
              </div>
            ))
          ) : (
            <div className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3">
              <p className="font-mono text-xs text-[#9D8589]">
                No records found.
              </p>
            </div>
          )}
        </div>
      </div>
    )}


    {dnsComparisonError && (
  <p className="mt-4 rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 text-sm text-[#D45767]">
    {dnsComparisonError}
  </p>
)}

{dnsComparisonResult && (
  <div className="mt-5 rounded-lg border border-[#3B171D] bg-[#170A0D] p-5">
    <div className="mb-4">
      <p className="text-xs tracking-[0.15em] text-[#9D8589]">
        DNS COMPARISON
      </p>

      <p className="mt-2 font-mono text-sm">
        {dnsComparisonResult.name}
        <span className="ml-2 text-[#9D8589]">
          / {dnsComparisonResult.record_type}
        </span>
      </p>
    </div>

    <div className="space-y-2">
      {dnsComparisonResult.results.map((result) => (
        <div
          key={result.server}
          className="flex flex-col gap-3 rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div>
            <p className="font-mono text-sm">{result.server}</p>

            {result.error && (
              <p className="mt-1 text-xs text-[#D45767]">
                {result.error}
              </p>
            )}
          </div>

      <div className="flex items-center gap-3">
        <div className="font-mono text-sm">
          {result.response_time_ms !== null
            ? `${result.response_time_ms.toFixed(2)} ms`
            : "FAILED"}
        </div>

        {result.records_match !== null && (
          <span
            className={
              result.records_match
                ? "rounded border border-[#3B171D] bg-[#170A0D] px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-[#8DBB9D]"
                : "rounded border border-[#542028] bg-[#1D0D11] px-2 py-1 text-[10px] font-semibold tracking-[0.12em] text-[#D45767]"
            }
          >
            {result.records_match ? "MATCH" : "DIFFERENT"}
          </span>
        )}
    </div>

        </div>
      ))}
    </div>
  </div>
)}
  </Card>
</section>

<div className="mt-4 rounded-lg border border-[#3B171D] bg-[#170A0D] p-5">
  <p className="text-xs tracking-[0.15em] text-[#9D8589]">
    REVERSE DNS
  </p>

  <div className="mt-4 flex flex-col gap-3 sm:flex-row">
    <input
      type="text"
      value={reverseDnsIp}
      onChange={(event) => setReverseDnsIp(event.target.value)}
      placeholder="192.168.1.254"
      className="min-w-0 flex-1 rounded-md border border-[#3B171D] bg-[#1D0D11] px-3 py-2 font-mono text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5A5E] focus:border-[#B52636]"
    />

    <button
      type="button"
      onClick={handleReverseDnsLookup}
      disabled={isReverseDnsLookingUp}
      className="rounded-md bg-[#8F1826] px-5 py-2 text-sm font-medium transition-colors hover:bg-[#B52636] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isReverseDnsLookingUp ? "LOOKING UP..." : "LOOKUP"}
    </button>
  </div>

  {reverseDnsError && (
    <p className="mt-3 text-xs text-[#D45767]">
      {reverseDnsError}
    </p>
  )}

  {reverseDnsResult && (
    <div className="mt-4 rounded-md border border-[#3B171D] bg-[#1D0D11] p-4">
      <p className="text-[10px] tracking-[0.15em] text-[#9D8589]">
        HOSTNAMES
      </p>

      <div className="mt-3">
        {reverseDnsResult.hostnames.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {reverseDnsResult.hostnames.map((hostname) => (
              <span
                key={hostname}
                className="rounded border border-[#3B171D] bg-[#170A0D] px-2 py-1 font-mono text-xs"
              >
                {hostname}
              </span>
            ))}
          </div>
        ) : (
          <p className="font-mono text-xs text-[#9D8589]">
            No PTR record found.
          </p>
        )}
      </div>
    </div>
  )}
</div>

<section className="mt-8">
  <h2 className="font-mono text-xs tracking-[0.2em] text-[#9D8589]">
    HTTP / HTTPS
  </h2>

  <div className="mt-4 flex gap-3">
    <input
      type="url"
      value={httpUrl}
      onChange={(event) => setHttpUrl(event.target.value)}
      className="flex-1 rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none focus:border-[#B52636]"
    />

    <button
      type="button"
      onClick={handleHttpDiagnostic}
      disabled={isHttpChecking}
      className="rounded-md bg-[#8F1826] px-5 py-3 text-sm font-semibold transition-colors hover:bg-[#B52636] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isHttpChecking ? "CHECKING..." : "CHECK"}
    </button>
  </div>

  {httpError && (
    <p className="mt-4 rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 text-sm text-[#D45767]">
      {httpError}
    </p>
  )}

  {httpResult && (
  <>
    <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div className="rounded-md border border-[#3B171D] bg-[#1D0D11] p-4">
        <p className="text-[10px] text-[#9D8589]">STATUS</p>
        <p className="mt-1 font-mono">{httpResult.status_code}</p>
      </div>

      <div className="rounded-md border border-[#3B171D] bg-[#1D0D11] p-4">
        <p className="text-[10px] text-[#9D8589]">RESPONSE TIME</p>
        <p className="mt-1 font-mono">
          {httpResult.response_time_ms.toFixed(2)} ms
        </p>
      </div>

      <div className="rounded-md border border-[#3B171D] bg-[#1D0D11] p-4">
        <p className="text-[10px] text-[#9D8589]">RESPONSE SIZE</p>
        <p className="mt-1 font-mono">
          {httpResult.response_size_bytes} bytes
        </p>
      </div>

      <div className="rounded-md border border-[#3B171D] bg-[#1D0D11] p-4">
        <p className="text-[10px] text-[#9D8589]">FINAL URL</p>
        <p className="mt-1 break-all font-mono text-xs">
          {httpResult.final_url}
        </p>
      </div>
    </div>

    <div className="mt-4 rounded-md border border-[#3B171D] bg-[#1D0D11] p-4">
      <p className="text-[10px] text-[#9D8589]">RESPONSE HEADERS</p>

      <div className="mt-3 space-y-2">
        {httpResult.headers.map((header) => (
          <div
            key={`${header.name}-${header.value}`}
            className="grid grid-cols-1 gap-1 font-mono text-xs sm:grid-cols-[180px_1fr]"
          >
            <span className="text-[#B52636]">{header.name}</span>
            <span className="break-all text-[#9D8589]">{header.value}</span>
          </div>
        ))}
      </div>
    </div>
    <div className="mt-4 rounded-md border border-[#3B171D] bg-[#1D0D11] p-4">
  <p className="text-[10px] text-[#9D8589]">REDIRECT CHAIN</p>

  {httpResult.tls && (
  <div className="mt-4 rounded-md border border-[#3B171D] bg-[#1D0D11] p-4">
    <p className="text-[10px] tracking-[0.15em] text-[#9D8589]">
      TLS
    </p>

<div className="mb-4">
  <p className="text-[10px] text-[#9D8589]">DOMAINS</p>

  <div className="mt-2 flex flex-wrap gap-2">
    {httpResult.tls.domains.length > 0 ? (
      httpResult.tls.domains.map((domain) => (
        <span
          key={domain}
          className="rounded border border-[#3B171D] bg-[#170A0D] px-2 py-1 font-mono text-xs"
        >
          {domain}
        </span>
      ))
    ) : (
      <span className="font-mono text-xs text-[#9D8589]">
        —
      </span>
    )}
  </div>
</div>

    <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div>
        <p className="text-[10px] text-[#9D8589]">VERSION</p>
        <p className="mt-1 break-all font-mono text-xs">
          {httpResult.tls.version ?? "—"}
        </p>
      </div>

      <div>
        <p className="text-[10px] text-[#9D8589]">CIPHER SUITE</p>
        <p className="mt-1 break-all font-mono text-xs">
          {httpResult.tls.cipher_suite ?? "—"}
        </p>
      </div>

      <div>
        <p className="text-[10px] text-[#9D8589]">SUBJECT</p>
        <p className="mt-1 break-all font-mono text-xs text-[#9D8589]">
          {httpResult.tls.subject ?? "—"}
        </p>
      </div>

      <div>
        <p className="text-[10px] text-[#9D8589]">ISSUER</p>
        <p className="mt-1 break-all font-mono text-xs text-[#9D8589]">
          {httpResult.tls.issuer ?? "—"}
        </p>
      </div>

      <div>
        <p className="text-[10px] text-[#9D8589]">CERTIFICATE STATUS</p>
        <p className="mt-1 font-mono text-xs">
        {httpResult.tls.certificate_status ?? "—"}
      </p>
      </div>

      <div>
        <p className="text-[10px] text-[#9D8589]">DAYS REMAINING</p>
        <p className="mt-1 font-mono text-xs">
          {httpResult.tls.days_remaining !== null
            ? `${httpResult.tls.days_remaining} days`
          : "—"}
        </p>
      </div>

      <div>
        <p className="text-[10px] text-[#9D8589]">VALID FROM</p>
        <p className="mt-1 break-all font-mono text-xs text-[#9D8589]">
          {httpResult.tls.valid_from ?? "—"}
        </p>
      </div>

      <div>
        <p className="text-[10px] text-[#9D8589]">VALID UNTIL</p>
        <p className="mt-1 break-all font-mono text-xs text-[#9D8589]">
          {httpResult.tls.valid_until ?? "—"}
        </p>
      </div>
    </div>
  </div>
)}

  {httpResult.redirects.length === 0 ? (
    <p className="mt-3 font-mono text-xs text-[#9D8589]">
      No redirects
    </p>
  ) : (
    <div className="mt-3 space-y-2">
      {httpResult.redirects.map((redirect, index) => (
        <div
          key={`${redirect.status_code}-${redirect.url}-${index}`}
          className="grid grid-cols-1 gap-1 rounded-md border border-[#3B171D] bg-[#170A0D] px-3 py-2 font-mono text-xs sm:grid-cols-[80px_1fr]"
        >
          <span className="text-[#B52636]">
            {redirect.status_code}
          </span>

          <span className="break-all text-[#9D8589]">
            {redirect.url}
          </span>
        </div>
      ))}
    </div>
  )}
</div>
  </>
)}
</section>

    <br></br>

      <div className="mb-10">
        <p className="font-mono text-xs tracking-[0.25em] text-[#9D8589]">
          // NETWORK DIAGNOSTICS
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          NetToolBox
        </h1>

        <p className="mt-2 text-sm text-[#9D8589]">
          Connectivity and network diagnostics.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-[#9D8589]">GLOBAL CONNECTIVITY</p>
                <p className="mt-1 text-xs text-[#6F5A5E]">
                  Gateway · DNS · Internet · HTTPS
                </p>
              </div>

              <button
                type="button"
                onClick={handleGlobalConnectivityTest}
                disabled={isCheckingConnectivity}
                className="rounded-md border border-[#542028] bg-gradient-to-r from-[#6F111C] to-[#8F1826] px-4 py-2 text-xs font-medium tracking-wide transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isCheckingConnectivity ? 'TESTING...' : 'RUN TEST'}
              </button>
            </div>

  {connectivityError && (
    <div className="mt-4 rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3">
      <p className="text-xs text-[#D45767]">{connectivityError}</p>
    </div>
  )}

  {globalConnectivity && (
    <div className="mt-5 grid grid-cols-2 gap-3">
      {globalConnectivity.checks.map((check) => (
        <div
          key={check.name}
          className="rounded-md border border-[#3B171D] bg-[#170A0D] p-4"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium tracking-wide text-[#EEE5E6]">
              {check.name}
            </span>

            <span
              className={`text-[10px] font-medium uppercase tracking-wide ${
                check.status === 'online'
                  ? 'text-[#8DBB9D]'
                  : check.status === 'degraded'
                    ? 'text-[#C89A65]'
                    : 'text-[#D45767]'
              }`}
            >
              {check.status}
            </span>
          </div>

          <div className="mt-4 space-y-2">
            {check.name === 'Internet' && check.detail ? (
              check.detail.split(' · ').map((endpoint) => {
                const [target, status] = endpoint.split(': ');

                return (
                  <div
                    key={target}
                    className="flex items-center justify-between gap-4 font-mono text-xs"
                  >
                    <span className="text-[#9D8589]">{target}</span>

                    <span
                      className={
                        status === 'reachable'
                          ? 'text-[#8DBB9D]'
                          : 'text-[#D45767]'
                      }
                    >
                      → {status?.toUpperCase() ?? 'UNKNOWN'}
                    </span>
                  </div>
                );
              })
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 font-mono text-xs">
                <span className="min-w-0 break-words text-[#9D8589]">
                  {check.detail ?? '—'}
                </span>

                <span
                  className={`whitespace-nowrap ${
                    check.status === 'online'
                      ? 'text-[#8DBB9D]'
                      : check.status === 'degraded'
                        ? 'text-[#C89A65]'
                        : 'text-[#D45767]'
                  }`}
                >
                  → {check.status === 'online' ? 'REACHABLE' : 'UNREACHABLE'}
                </span>
              </div>
            )}
          </div>

          {check.latency_ms !== null && (
            <div className="mt-3 flex justify-end border-t border-[#3B171D] pt-2">
              <span className="font-mono text-xs text-[#EEE5E6]">
                {check.latency_ms.toFixed(1)} ms
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  )}

  {globalConnectivity && (
    <div className="mt-4 flex items-center justify-between border-t border-[#3B171D] pt-4">
      <span className="text-[10px] tracking-[0.15em] text-[#9D8589]">
        OVERALL STATUS
      </span>

      <span
        className={`font-mono text-xs uppercase ${
          globalConnectivity.status === 'online'
            ? 'text-[#8DBB9D]'
            : globalConnectivity.status === 'degraded'
              ? 'text-[#C89A65]'
              : 'text-[#D45767]'
        }`}
      >
        {globalConnectivity.status}
      </span>
    </div>
  )}
    </Card>
      </div>

      <Card>
  <div className="flex items-center justify-between">
    <div>
      <p className="text-xs text-[#9D8589]">ROUTE LOOKUP</p>
      <p className="mt-1 text-xs text-[#6F5A5E]">
        Find the route used to reach an IP address
      </p>
    </div>
  </div>

  <div className="mt-4 flex gap-3">
    <input
      type="text"
      value={routeLookupTarget}
      onChange={(event) => setRouteLookupTarget(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          void handleRouteLookup();
        }
      }}
      placeholder="8.8.8.8"
      className="min-w-0 flex-1 rounded-md border border-[#3B171D] bg-[#100709] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5A5E] focus:border-[#8F1826]"
    />

    <button
      type="button"
      onClick={() => void handleRouteLookup()}
      disabled={isLookingUpRoute}
      className="rounded-md border border-[#542028] bg-gradient-to-r from-[#6F111C] to-[#8F1826] px-5 py-3 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isLookingUpRoute ? 'LOOKING UP...' : 'LOOK UP'}
    </button>
  </div>

  {routeLookupError && (
    <div className="mt-4 rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 text-xs text-[#D45767]">
      {routeLookupError}
    </div>
  )}

  {routeLookupResult && (
    <div className="mt-4 grid grid-cols-2 gap-3">
      <div className="rounded-md border border-[#3B171D] bg-[#170A0D] px-4 py-3">
        <p className="text-[10px] text-[#6F5A5E]">TARGET</p>
        <p className="mt-1 break-all font-mono text-xs text-[#EEE5E6]">
          {routeLookupResult.target}
        </p>
      </div>

      <div className="rounded-md border border-[#3B171D] bg-[#170A0D] px-4 py-3">
        <p className="text-[10px] text-[#6F5A5E]">ROUTE</p>
        <p className="mt-1 break-all font-mono text-xs text-[#EEE5E6]">
          {routeLookupResult.destination}
        </p>
      </div>

      <div className="rounded-md border border-[#3B171D] bg-[#170A0D] px-4 py-3">
        <p className="text-[10px] text-[#6F5A5E]">GATEWAY</p>
        <p className="mt-1 break-all font-mono text-xs text-[#EEE5E6]">
          {routeLookupResult.gateway ?? 'DIRECT'}
        </p>
      </div>

      <div className="rounded-md border border-[#3B171D] bg-[#170A0D] px-4 py-3">
        <p className="text-[10px] text-[#6F5A5E]">INTERFACE</p>
        <p className="mt-1 break-all font-mono text-xs text-[#EEE5E6]">
          {routeLookupResult.interface_name ?? '—'}
        </p>
      </div>

      <div className="col-span-2 rounded-md border border-[#3B171D] bg-[#170A0D] px-4 py-3">
        <p className="text-[10px] text-[#6F5A5E]">METRIC</p>
        <p className="mt-1 font-mono text-xs text-[#EEE5E6]">
          {routeLookupResult.metric ?? '—'}
        </p>
      </div>
    </div>
  )}
</Card>

      <Card>
        <div className="flex items-center justify-between">
            <p className="text-xs text-[#9D8589]">NETWORK INTERFACES</p>

            <span className="font-mono text-xs text-[#9D8589]">
              {interfaces.length} detected
            </span>
          </div>

          <div className="mt-4 space-y-3">
            {interfaces.map((networkInterface) => (
              <div
                key={networkInterface.name}
                className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-mono text-sm font-semibold">
                      {networkInterface.name}
                    </p>

                    <p className="mt-1 text-xs text-[#9D8589]">
                      {networkInterface.is_loopback
                        ? "LOOPBACK"
                        : "NETWORK"}
                    </p>
                  </div>

                  <span
                    className={`font-mono text-xs ${
                      networkInterface.is_up
                        ? "text-[#8DBB9D]"
                        : "text-[#D45767]"
                    }`}
                  >
                    {networkInterface.is_up ? "UP" : "DOWN"}
                  </span>
                </div>

                <div className="mt-4 space-y-2 font-mono text-xs">
                  
                  {networkInterface.ipv4_addresses.map((address) => (
                    <div
                      key={`ipv4-${address}`}
                      className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3"
                    >
                      <span className="text-[#9D8589]">IPv4</span>
                      <span className="break-all">{address}</span>
                    </div>
                  ))}

                  {[...networkInterface.ipv6_addresses]
                    .sort((a, b) => {
                      const order = (address: typeof a) => {
                        if (address.is_link_local) return 2;
                        if (address.is_temporary) return 1;
                        return 0;
                      };

                      return order(a) - order(b);
                    })
                    .map((addressInfo) => {
                      const label = addressInfo.is_link_local
                        ? "IPv6 LL"
                        : addressInfo.is_temporary
                          ? "IPv6 TEMP"
                          : "IPv6";

                      return (
                        <div
                          key={`ipv6-${addressInfo.address}`}
                          className="grid grid-cols-[5rem_minmax(0,1fr)] items-start gap-3"
                        >
                          <span className="whitespace-nowrap text-[#9D8589]">{label}</span>
                          <span className="break-all">{addressInfo.address}</span>
                        </div>
                      );
                    })}

                  {networkInterface.wifi_rx_bitrate_mbps !== null && (
                    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
                      <span className="text-[#9D8589]">RX</span>
                      <span>{networkInterface.wifi_rx_bitrate_mbps.toFixed(1)} Mbps</span>
                    </div>
                  )}

                  {networkInterface.wifi_tx_bitrate_mbps !== null && (
                    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
                      <span className="text-[#9D8589]">TX</span>
                      <span>{networkInterface.wifi_tx_bitrate_mbps.toFixed(1)} Mbps</span>
                    </div>
                  )}

                  {networkInterface.wifi_ssid !== null && (
                    <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3">
                      <span className="text-[#9D8589]">SSID</span>
                      <span className="break-all">{networkInterface.wifi_ssid}</span>
                    </div>
                  )}

                  {networkInterface.ipv4_addresses.length === 0 &&
                    networkInterface.ipv6_addresses.length === 0 && (
                      <p className="text-[#9D8589]">
                        No addresses detected.
                      </p>
                    )}
                </div>
              </div>
            ))}

            {error && (
              <p className="text-xs text-[#D45767]">
                {error}
              </p>
            )}

            {!error && interfaces.length === 0 && (
              <p className="text-sm text-[#9D8589]">
                Loading interfaces...
              </p>
            )}

            </div>
        </Card>

        <Card>
  <div className="flex items-center justify-between">
    <p className="text-xs text-[#9D8589]">NETWORK NEIGHBORS</p>

    <span className="font-mono text-xs text-[#9D8589]">
      {filteredNeighbors.length} detected
    </span>
  </div>

  <div className="mt-4 grid gap-3 md:grid-cols-2">
    <input
      type="text"
      value={neighborSearch}
      onChange={(event) => setNeighborSearch(event.target.value)}
      placeholder="Search by IP or MAC..."
      className="w-full rounded-md border border-[#3B171D] bg-[#170A0D] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none transition-colors placeholder:text-[#6F5A5E] focus:border-[#8F1826]"
    />

    <div className="grid grid-cols-2 gap-2">
  <button
    type="button"
    onClick={() => setNeighborInterfaceFilter("all")}
    className={`rounded-md border px-3 py-3 text-sm transition-colors ${
      neighborInterfaceFilter === "all"
        ? "border-[#8F1826] bg-[#6F111C] text-[#EEE5E6]"
        : "border-[#3B171D] bg-[#170A0D] text-[#9D8589] hover:border-[#542028] hover:text-[#EEE5E6]"
    }`}
  >
    All interfaces
  </button>

  {neighborInterfaces.map((interfaceName) => (
    <button
      key={interfaceName}
      type="button"
      onClick={() => setNeighborInterfaceFilter(interfaceName)}
      className={`rounded-md border px-3 py-3 font-mono text-sm transition-colors ${
        neighborInterfaceFilter === interfaceName
          ? "border-[#8F1826] bg-[#6F111C] text-[#EEE5E6]"
          : "border-[#3B171D] bg-[#170A0D] text-[#9D8589] hover:border-[#542028] hover:text-[#EEE5E6]"
      }`}
    >
      {interfaceName}
    </button>
  ))}
</div>

    <div className="grid grid-cols-3 gap-2">
  <button
    type="button"
    onClick={() => setNeighborSort("ip")}
    className={`rounded-md border px-3 py-3 text-sm transition-colors ${
      neighborSort === "ip"
        ? "border-[#8F1826] bg-[#6F111C] text-[#EEE5E6]"
        : "border-[#3B171D] bg-[#170A0D] text-[#9D8589] hover:border-[#542028] hover:text-[#EEE5E6]"
    }`}
  >
    IP
  </button>

  <button
    type="button"
    onClick={() => setNeighborSort("mac")}
    className={`rounded-md border px-3 py-3 text-sm transition-colors ${
      neighborSort === "mac"
        ? "border-[#8F1826] bg-[#6F111C] text-[#EEE5E6]"
        : "border-[#3B171D] bg-[#170A0D] text-[#9D8589] hover:border-[#542028] hover:text-[#EEE5E6]"
    }`}
  >
    MAC
  </button>

  <button
    type="button"
    onClick={() => setNeighborSort("state")}
    className={`rounded-md border px-3 py-3 text-sm transition-colors ${
      neighborSort === "state"
        ? "border-[#8F1826] bg-[#6F111C] text-[#EEE5E6]"
        : "border-[#3B171D] bg-[#170A0D] text-[#9D8589] hover:border-[#542028] hover:text-[#EEE5E6]"
    }`}
  >
    State
  </button>
</div>

    <button
      type="button"
      onClick={handleRefreshNeighbors}
      disabled={isRefreshingNeighbors}
      className="w-full rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 text-sm font-medium text-[#EEE5E6] transition-colors hover:border-[#8F1826] hover:bg-[#250F14] disabled:cursor-not-allowed disabled:opacity-50"
    >
      {isRefreshingNeighbors ? "Refreshing..." : "Refresh"}
    </button>
  </div>

  {filteredNeighbors.length > 0 ? (
    <div className="mt-4 space-y-2">
      {filteredNeighbors.map((neighbor) => (
        <div
          key={`${neighbor.ip_address}-${neighbor.mac_address ?? "unknown"}`}
          className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3"
        >
          <div className="grid grid-cols-1 gap-4 font-mono text-xs sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-[10px] text-[#9D8589]">IP ADDRESS</p>
              <p className="mt-1 break-all">{neighbor.ip_address}</p>
            </div>

            <div className="min-w-0">
              <p className="text-[10px] text-[#9D8589]">MAC ADDRESS</p>
              <p className="mt-1 break-all text-[#9D8589]">
                {neighbor.mac_address ?? "—"}
              </p>
            </div>

            <div className="min-w-0">
              <p className="text-[10px] text-[#9D8589]">INTERFACE</p>
              <p className="mt-1">{neighbor.interface_name}</p>
            </div>

            <div className="min-w-0">
              <p className="text-[10px] text-[#9D8589]">STATE</p>

              <span
                className={`mt-1 inline-flex items-center gap-2 rounded-md border px-2.5 py-1 font-mono text-[11px] ${
                  neighbor.state === "Reachable"
                    ? "border-[#315B43] bg-[#14241B] text-[#8DBB9D]"
                    : neighbor.state === "Stale"
                      ? "border-[#6B512F] bg-[#251C12] text-[#C89A65]"
                      : neighbor.state === "Failed"
                        ? "border-[#6B2732] bg-[#281117] text-[#D45767]"
                        : "border-[#3B171D] bg-[#170A0D] text-[#9D8589]"
                }`}
              >
                <span className="text-[9px]">●</span>
                {neighbor.state}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  ) : (
    <p className="mt-4 text-sm text-[#9D8589]">
      {neighbors.length > 0
        ? "No neighbors match the current filters."
        : "No network neighbors detected."}
    </p>
  )}
</Card>










































        <Card>
          <p className="text-xs text-[#9D8589]">NETWORK ROUTES</p>

          <div className="mt-4 space-y-3">
            {routes.map((route, index) => (
          <div
            key={`${route.destination}-${route.interface_name}-${index}`}
            className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3"
          >
          <p className="font-mono text-sm">
            {route.destination}
          </p>

          <div className="mt-2 space-y-1 font-mono text-xs text-[#9D8589]">
            <p>
              GATEWAY&nbsp;&nbsp;&nbsp;{route.gateway ?? "—"}
            </p>

            <p>
              INTERFACE&nbsp;{route.interface_name ?? "—"}
            </p>

            <p>
              METRIC&nbsp;&nbsp;&nbsp;&nbsp;{route.metric ?? "—"}
            </p>
        </div>
      </div>
  ))}

  {routes.length === 0 && (
    <p className="text-sm text-[#9D8589]">
      No routes detected.
    </p>
  )}

  <div className="mt-6 border-t border-[#3B171D] pt-5">
  <p className="text-xs text-[#9D8589]">DNS CONFIGURATION</p>

  {dnsInfo ? (
    <div className="mt-4 space-y-3 font-mono text-xs">
      <div className="flex justify-between gap-4">
        <span className="text-[#9D8589]">INTERFACE</span>
        <span>{dnsInfo.interface_name ?? "—"}</span>
      </div>

      <div className="flex justify-between gap-4">
        <span className="text-[#9D8589]">CURRENT SERVER</span>
        <span>{dnsInfo.current_server ?? "—"}</span>
      </div>

      <div>
        <p className="text-[#9D8589]">DNS SERVERS</p>

        <div className="mt-2 space-y-1">
          {dnsInfo.servers.map((server) => (
            <p key={server}>{server}</p>
          ))}
        </div>
      </div>
    </div>
  ) : (
    <p className="mt-4 text-sm text-[#9D8589]">
      Loading DNS configuration...
    </p>
  )}
</div>

</div>
        </Card>
      </section>
    </>
  );
}