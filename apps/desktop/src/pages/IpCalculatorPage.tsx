import { useState } from "react";
import type { SubnetInfo } from "@nexus/ip-calculator";
import { calculateSubnet } from "@nexus/ip-calculator";
import { Card } from "../components/ui/Card";

export function IpCalculatorPage() {
  const [ip, setIp] = useState("192.168.1.1");
  const [prefix, setPrefix] = useState("24");
  const [result, setResult] = useState<SubnetInfo | null>(() =>
    calculateSubnet("192.168.1.1", 24),
  );
  const [error, setError] = useState("");

  function handleCalculate() {
    try {
      const calculated = calculateSubnet(ip, Number(prefix));

      setResult(calculated);
      setError("");
    } catch {
      setResult(null);
      setError("Invalid IPv4 address or CIDR prefix.");
    }
  }

  return (
    <>
      <div className="mb-10">
        <p className="font-mono text-xs tracking-[0.25em] text-[#9D8589]">
          // ADDRESS INTELLIGENCE
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          IP Calculator++
        </h1>

        <p className="mt-2 text-sm text-[#9D8589]">
          IPv4 subnet and address calculations.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-4">
        <Card>
          <p className="text-xs text-[#9D8589]">INPUT</p>

          <div className="mt-4 grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="ip-address"
                className="text-xs text-[#9D8589]"
              >
                IP ADDRESS
              </label>

              <input
                id="ip-address"
                value={ip}
                onChange={(event) => setIp(event.target.value)}
                className="mt-2 w-full rounded-md border border-[#3B171D] bg-[#1D0D11] px-3 py-2 font-mono text-sm outline-none transition focus:border-[#B52636]"
                placeholder="192.168.1.1"
              />
            </div>

            <div>
              <label
                htmlFor="cidr"
                className="text-xs text-[#9D8589]"
              >
                CIDR
              </label>

              <input
                id="cidr"
                type="number"
                min="0"
                max="32"
                value={prefix}
                onChange={(event) => setPrefix(event.target.value)}
                className="mt-2 w-full rounded-md border border-[#3B171D] bg-[#1D0D11] px-3 py-2 font-mono text-sm outline-none transition focus:border-[#B52636]"
                placeholder="24"
              />
            </div>
          </div>

          {error && (
            <p className="mt-3 text-xs text-[#D45767]">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleCalculate}
            className="mt-5 w-full rounded-md bg-gradient-to-r from-[#6F111C] to-[#B52636] px-4 py-2 text-sm font-medium transition hover:brightness-110"
          >
            Calculate
          </button>
        </Card>

        <Card>
          <p className="text-xs text-[#9D8589]">RESULT</p>

          {result ? (
            <div className="mt-4 space-y-3 font-mono text-sm">
              <div className="flex justify-between">
                <span className="text-[#9D8589]">NETWORK</span>
                <span>{result.network}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-[#9D8589]">BROADCAST</span>
                <span>{result.broadcast}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-[#9D8589]">MASK</span>
                <span>{result.mask}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-[#9D8589]">FIRST HOST</span>
                <span>{result.firstHost}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-[#9D8589]">LAST HOST</span>
                <span>{result.lastHost}</span>
              </div>

              <div className="flex justify-between">
                <span className="text-[#9D8589]">USABLE HOSTS</span>
                <span>{result.usableHosts}</span>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-sm text-[#D45767]">
              No valid calculation.
            </p>
          )}
        </Card>
      </section>
    </>
  );
}
