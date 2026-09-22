import { Card } from "../components/ui/Card";

export function SettingsPage() {
  return (
    <>
      <div className="mb-10">
        <p className="font-mono text-xs tracking-[0.25em] text-[#9D8589]">
          // SYSTEM CONFIGURATION
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Settings
        </h1>

        <p className="mt-2 text-sm text-[#9D8589]">
          Configure your NEXUS environment.
        </p>
      </div>

      <section className="space-y-4">
        <Card>
          <p className="text-xs text-[#9D8589]">GENERAL</p>

          <div className="mt-4 flex items-center justify-between">
            <div>
              <p className="text-sm">Interface theme</p>
              <p className="mt-1 text-xs text-[#9D8589]">
                Crimson Gothic
              </p>
            </div>

            <span className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-3 py-2 text-xs">
              ACTIVE
            </span>
          </div>
        </Card>

        <Card>
          <p className="text-xs text-[#9D8589]">NETWORK</p>

          <div className="mt-4 flex items-center justify-between">
            <div>
              <p className="text-sm">NEXUS Agent</p>
              <p className="mt-1 text-xs text-[#9D8589]">
                Local network services
              </p>
            </div>

            <span className="font-mono text-xs text-[#C89A65]">
              NOT CONNECTED
            </span>
          </div>
        </Card>

        <Card>
          <p className="text-xs text-[#9D8589]">ABOUT</p>

          <div className="mt-4">
            <p className="text-sm font-medium">NEXUS</p>
            <p className="mt-1 font-mono text-xs text-[#9D8589]">
              Network Operations Suite · v0.1.0
            </p>
          </div>
        </Card>
      </section>
    </>
  );
}
