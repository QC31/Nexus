import { Card } from "../components/ui/Card";

export function DashboardPage() {
  return (
    <>
      <div className="mb-10">
        <p className="font-mono text-xs tracking-[0.25em] text-[#9D8589]">
          // SYSTEMS BEYOND THE SURFACE
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Network Operations
        </h1>

        <p className="mt-2 text-sm text-[#9D8589]">
          Welcome to NEXUS.
        </p>
      </div>

      <section className="grid grid-cols-3 gap-4">
        <Card>
          <p className="text-xs text-[#9D8589]">NETWORK</p>
          <p className="mt-3 font-mono text-lg">ONLINE</p>
        </Card>

        <Card>
          <p className="text-xs text-[#9D8589]">LATENCY</p>
          <p className="mt-3 font-mono text-lg">— ms</p>
        </Card>

        <Card>
          <p className="text-xs text-[#9D8589]">HOSTS</p>
          <p className="mt-3 font-mono text-lg">0</p>
        </Card>
      </section>
    </>
  );
}
