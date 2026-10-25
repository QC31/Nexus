import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card } from "../components/ui/Card";
import { useSshSessions } from "../contexts/SshSessionsContext";

interface SshServerRecord {
  id: string;
  name: string;
  host: string;
  username: string;
  port: number;
  authentication_method: string;
  private_key_path: string | null;
  group_name: string | null;
  favorite: boolean;
  remember_password: boolean;
  host_key_fingerprint: string | null;
}

export function DashboardPage() {
  const [configuredHosts, setConfiguredHosts] = useState<number | null>(null);
  const [sshAgentAvailable, setSshAgentAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const { sessions } = useSshSessions();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadDashboardData() {
      setLoading(true);
      setError(null);

      try {
        const [servers, agentAvailable] = await Promise.all([
          invoke<SshServerRecord[]>("list_ssh_servers"),
          invoke<boolean>("ssh_agent_available"),
        ]);

        if (cancelled) return;

        setConfiguredHosts(servers.length);
        setSshAgentAvailable(agentAvailable);
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadDashboardData();

    return () => {
      cancelled = true;
    };
  }, []);

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

      {error && (
        <div className="mb-4 rounded-lg border border-red-900/60 bg-red-950/20 px-4 py-3 text-sm text-red-300">
          Unable to load dashboard data: {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <p className="text-xs text-[#9D8589]">CONFIGURED HOSTS</p>
          <p className="mt-3 font-mono text-2xl">
            {loading ? "—" : configuredHosts ?? "—"}
          </p>
          <p className="mt-2 text-xs text-[#9D8589]">
            Registered SSH servers
          </p>
        </Card>

        <Card>
          <p className="text-xs text-[#9D8589]">ACTIVE SESSIONS</p>
          <p className="mt-3 font-mono text-2xl">{sessions.length}</p>
          <p className="mt-2 text-xs text-[#9D8589]">
            Currently open SSH sessions
          </p>
        </Card>

        <Card>
          <p className="text-xs text-[#9D8589]">CONNECTION STATUS</p>
          <p
            className={`mt-3 font-mono text-2xl ${
              sessions.length > 0 ? "text-emerald-400" : "text-[#9D8589]"
            }`}
          >
            {sessions.length > 0 ? "Connected" : "Disconnected"}
          </p>
          <p className="mt-2 text-xs text-[#9D8589]">
            SSH session status
          </p>
        </Card>

        <Card>
          <p className="text-xs text-[#9D8589]">SSH AGENT</p>
          <p
            className={`mt-3 font-mono text-2xl ${
              sshAgentAvailable === true
                ? "text-emerald-400"
                : sshAgentAvailable === false
                  ? "text-red-400"
                  : ""
            }`}
          >
            {loading
              ? "—"
              : sshAgentAvailable === null
                ? "Unknown"
                : sshAgentAvailable
                  ? "Available"
                  : "Unavailable"}
          </p>
          <p className="mt-2 text-xs text-[#9D8589]">
            SSH key authentication service
          </p>
        </Card>
      </section>
    </>
  );
}