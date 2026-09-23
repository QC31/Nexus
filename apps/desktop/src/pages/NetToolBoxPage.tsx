import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card } from "../components/ui/Card";

interface NetworkInterfaceInfo {
  name: string;
  ipv4_addresses: string[];
  ipv6_addresses: string[];
  is_up: boolean;
  is_loopback: boolean;
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
}

interface TcpCheckResult {
  target: string;
  port: number;
  open: boolean;
  connect_time_ms: number | null;
}

interface TracerouteHop {
  hop: number;
  address: string | null;
  latency_ms: number | null;
}

export function NetToolBoxPage() {
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [error, setError] = useState("");
  const [routes, setRoutes] = useState<NetworkRouteInfo[]>([]);
  const [dnsInfo, setDnsInfo] = useState<DnsInfo | null>(null);
  const [neighbors, setNeighbors] = useState<NetworkNeighborInfo[]>([]);
  const [pingTarget, setPingTarget] = useState("192.168.1.254");
  const [pingResult, setPingResult] = useState<PingResult | null>(null);
  const [pingError, setPingError] = useState("");
  const [isPinging, setIsPinging] = useState(false);
  const [tcpTarget, setTcpTarget] = useState("127.0.0.1");
  const [tcpPort, setTcpPort] = useState("22");
  const [tcpResult, setTcpResult] = useState<TcpCheckResult | null>(null);
  const [tcpError, setTcpError] = useState("");
  const [isTcpChecking, setIsTcpChecking] = useState(false);
  const [tracerouteTarget, setTracerouteTarget] = useState("192.168.1.254");
  const [tracerouteResult, setTracerouteResult] = useState<TracerouteHop[]>([]);
  const [tracerouteError, setTracerouteError] = useState("");
  const [isTracerouting, setIsTracerouting] = useState(false);
  console.log("NEXUS neighbors:", neighbors);

  useEffect(() => {
    invoke<NetworkInterfaceInfo[]>("network_interfaces")
      .then(setInterfaces)
      .catch((error) => {
        setError(String(error));
      });

      invoke<NetworkRouteInfo[]>("network_routes")
        .then(setRoutes)
        .catch((error) => {
        console.error("Failed to load network routes:", error);
  });

      invoke<NetworkNeighborInfo[]>("network_neighbors")
        .then(setNeighbors)
        .catch((error) => {
        console.error("Failed to load network neighbors:", error);
  });

      invoke<DnsInfo>("dns_info")
        .then(setDnsInfo)
        .catch((error) => {
        console.error("Failed to load DNS information:", error);
  });

  }, []);

  async function handlePing() {
  if (!pingTarget.trim()) {
    setPingError("Enter a target.");
    return;
  }

  setIsPinging(true);
  setPingError("");
  setPingResult(null);

  try {
    const result = await invoke<PingResult>("ping_host", {
      target: pingTarget.trim(),
    });

    setPingResult(result);
  } catch (error) {
    setPingError(String(error));
  } finally {
    setIsPinging(false);
  }
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
        disabled={isPinging}
        className="rounded-md border border-[#542028] bg-gradient-to-r from-[#6F111C] to-[#8F1826] px-6 py-3 text-sm font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isPinging ? "PINGING..." : "PING"}
      </button>
    </div>

    {pingError && (
      <p className="mt-4 rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 text-sm text-[#D45767]">
        {pingError}
      </p>
    )}

    {pingResult && (
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
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
          <p className="text-[10px] text-[#9D8589]">AVG</p>
          <p className="mt-1 font-mono text-sm">
            {pingResult.avg_ms !== null ? `${pingResult.avg_ms.toFixed(2)} ms` : "—"}
          </p>
        </div>

        <div>
          <p className="text-[10px] text-[#9D8589]">MIN / MAX</p>
          <p className="mt-1 font-mono text-sm">
            {pingResult.min_ms !== null && pingResult.max_ms !== null
              ? `${pingResult.min_ms.toFixed(2)} / ${pingResult.max_ms.toFixed(2)} ms`
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
                      className="flex items-center gap-3"
                    >
                      <span className="w-10 text-[#9D8589]">IPv4</span>
                      <span>{address}</span>
                    </div>
                  ))}

                  {networkInterface.ipv6_addresses.map((address) => (
                    <div
                      key={`ipv6-${address}`}
                      className="flex items-center gap-3"
                    >
                      <span className="w-10 text-[#9D8589]">IPv6</span>
                      <span className="break-all">{address}</span>
                    </div>
                  ))}

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

<div className="mt-6 border-t border-[#3B171D] pt-5">
  <p className="text-xs text-[#9D8589]">NETWORK NEIGHBORS</p>

{neighbors.length > 0 ? (
  <div className="mt-4 space-y-2">
    {neighbors.map((neighbor) => (
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
        <p className="mt-1">{neighbor.state}</p>
      </div>
    </div>
  </div>
))}
  </div>
) : (
  <p className="mt-4 text-sm text-[#9D8589]">
    No network neighbors detected.
  </p>
)}






</div>






</div>
        </Card>
      </section>
    </>
  );
}