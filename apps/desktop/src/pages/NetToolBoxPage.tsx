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

interface DnsInfo {
  interface_name: string | null;
  current_server: string | null;
  servers: string[];
}

export function NetToolBoxPage() {
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [error, setError] = useState("");
  const [routes, setRoutes] = useState<NetworkRouteInfo[]>([]);
  const [dnsInfo, setDnsInfo] = useState<DnsInfo | null>(null);

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

      invoke<DnsInfo>("dns_info")
        .then(setDnsInfo)
        .catch((error) => {
        console.error("Failed to load DNS information:", error);
  });

  }, []);

  return (
    <>
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

</div>
        </Card>
      </section>
    </>
  );
}