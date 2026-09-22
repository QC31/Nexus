import { Card } from "../components/ui/Card";

export function SshManagerPage() {
  return (
    <>
      <div className="mb-10">
        <p className="font-mono text-xs tracking-[0.25em] text-[#9D8589]">
          // REMOTE ACCESS
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          SSH Manager
        </h1>

        <p className="mt-2 text-sm text-[#9D8589]">
          Manage hosts, credentials and remote sessions.
        </p>
      </div>

      <section className="grid grid-cols-3 gap-4">
        <Card>
          <p className="text-xs text-[#9D8589]">HOSTS</p>
          <p className="mt-3 font-mono text-2xl">0</p>
          <p className="mt-2 text-sm text-[#9D8589]">
            No hosts configured.
          </p>
        </Card>

        <Card>
          <p className="text-xs text-[#9D8589]">GROUPS</p>
          <p className="mt-3 font-mono text-2xl">0</p>
          <p className="mt-2 text-sm text-[#9D8589]">
            Organize hosts by environment.
          </p>
        </Card>

        <Card>
          <p className="text-xs text-[#9D8589]">SESSIONS</p>
          <p className="mt-3 font-mono text-2xl">0</p>
          <p className="mt-2 text-sm text-[#9D8589]">
            No active sessions.
          </p>
        </Card>
      </section>

      <section className="mt-4">
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Host inventory</p>
              <p className="mt-1 text-xs text-[#9D8589]">
                Your SSH hosts will appear here.
              </p>
            </div>

            <button className="rounded-md bg-gradient-to-r from-[#6F111C] to-[#B52636] px-4 py-2 text-sm font-medium transition hover:brightness-110">
              Add host
            </button>
          </div>
        </Card>
      </section>
    </>
  );
}
