import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Card } from "../components/ui/Card";

type AppSettings = Record<string, string>;

const DEFAULT_SETTINGS: AppSettings = {
  confirm_before_closing_sessions: "true",
  default_ssh_port: "22",
  connection_timeout: "15",
  confirm_sensitive_actions: "true",
};

function SettingToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm">{label}</p>
        <p className="mt-1 text-xs text-[#9D8589]">{description}</p>
      </div>

      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mr-1 h-6 w-11 shrink-0 rounded-full border transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
          checked
            ? "border-[#8E3545] bg-[#6D2634]"
            : "border-[#51353A] bg-[#241216]"
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-[#EEE5E6] transition-transform ${
            checked ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [agentAvailable, setAgentAvailable] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function loadSettings() {
      setIsLoading(true);
      setError("");

      try {
        const [savedSettings, agentStatus] = await Promise.all([
          invoke<AppSettings>("get_app_settings"),
          invoke<boolean>("ssh_agent_available"),
        ]);

        if (cancelled) return;

        setSettings({
          ...DEFAULT_SETTINGS,
          ...savedSettings,
        });
        setAgentAvailable(agentStatus);
      } catch (loadError) {
        if (!cancelled) {
          setError(
            `Failed to load settings: ${
              loadError instanceof Error
                ? loadError.message
                : String(loadError)
            }`,
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    void loadSettings();

    return () => {
      cancelled = true;
    };
  }, []);

async function saveSetting(key: string, value: string) {
  setIsSaving(true);
  setMessage("");
  setError("");

  try {
    await invoke("save_app_setting", { key, value });

    setSettings((current) => ({
      ...current,
      [key]: value,
    }));
    setMessage("Settings saved successfully.");
  } catch (saveError) {

    setError(
      `Failed to save setting: ${
        saveError instanceof Error
          ? saveError.message
          : String(saveError)
      }`,
    );
  } finally {
    setIsSaving(false);
  }
}

  async function updateSetting(key: string, value: string) {
    await saveSetting(key, value);
  }

  const confirmBeforeClosing =
    settings.confirm_before_closing_sessions === "true";
  const confirmSensitiveActions =
    settings.confirm_sensitive_actions === "true";

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

      {(message || error) && (
        <div
          role="status"
          className={`mb-6 rounded-md border px-4 py-3 text-sm ${
            error
              ? "border-red-900 bg-red-950/30 text-red-300"
              : "border-[#3B171D] bg-[#1D0D11] text-[#D8B7BC]"
          }`}
        >
          {error || message}
        </div>
      )}

      {isLoading ? (
        <Card>
          <p className="text-sm text-[#9D8589]">Loading settings...</p>
        </Card>
      ) : (
        <section className="space-y-4">
          <Card>
            <p className="text-xs tracking-wider text-[#9D8589]">GENERAL</p>

            <div className="mt-4 flex items-center justify-between border-b border-[#3B171D] pb-4">
              <div>
                <p className="text-sm">Interface theme</p>
                <p className="mt-1 text-xs text-[#9D8589]">
                  Current application appearance
                </p>
              </div>

              <span className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-3 py-2 text-xs">
                CRIMSON GOTHIC · ACTIVE
              </span>
            </div>

            <SettingToggle
              label="Confirm before closing sessions"
              description="Ask for confirmation before closing an SSH session."
              checked={confirmBeforeClosing}
              disabled={isSaving}
              onChange={(checked) =>
                void updateSetting(
                  "confirm_before_closing_sessions",
                  String(checked),
                )
              }
            />
          </Card>

          <Card>
            <p className="text-xs tracking-wider text-[#9D8589]">NETWORK</p>

            <div className="grid gap-4 pt-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm">Default SSH port</span>
                <span className="mt-1 block text-xs text-[#9D8589]">
                  Port used as the default for new SSH hosts.
                </span>
                <input
                  type="number"
                  min="1"
                  max="65535"
                  value={settings.default_ssh_port}
                  disabled={isSaving}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      default_ssh_port: event.target.value,
                    }))
                  }
                  onBlur={() => {
                    const port = Number(settings.default_ssh_port);

                    if (
                      Number.isInteger(port) &&
                      port >= 1 &&
                      port <= 65535
                    ) {
                      void saveSetting("default_ssh_port", String(port));
                    } else {
                      setError("SSH port must be between 1 and 65535.");
                      setSettings((current) => ({
                        ...current,
                        default_ssh_port: DEFAULT_SETTINGS.default_ssh_port,
                      }));
                    }
                  }}
                  className="mt-2 w-full rounded-md border border-[#3B171D] bg-[#100709] px-3 py-2 text-sm outline-none focus:border-[#8E3545] disabled:opacity-50"
                />
              </label>

              <label className="block">
                <span className="text-sm">Connection timeout</span>
                <span className="mt-1 block text-xs text-[#9D8589]">
                  Timeout value in seconds.
                </span>
                <input
                  type="number"
                  min="1"
                  max="300"
                  value={settings.connection_timeout}
                  disabled={isSaving}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      connection_timeout: event.target.value,
                    }))
                  }
                  onBlur={() => {
                    const timeout = Number(settings.connection_timeout);

                    if (
                      Number.isInteger(timeout) &&
                      timeout >= 1 &&
                      timeout <= 300
                    ) {
                      void saveSetting(
                        "connection_timeout",
                        String(timeout),
                      );
                    } else {
                      setError("Timeout must be between 1 and 300 seconds.");
                      setSettings((current) => ({
                        ...current,
                        connection_timeout:
                          DEFAULT_SETTINGS.connection_timeout,
                      }));
                    }
                  }}
                  className="mt-2 w-full rounded-md border border-[#3B171D] bg-[#100709] px-3 py-2 text-sm outline-none focus:border-[#8E3545] disabled:opacity-50"
                />
              </label>
            </div>
          </Card>

          <Card>
            <p className="text-xs tracking-wider text-[#9D8589]">SECURITY</p>

            <div className="mt-4 flex items-center justify-between border-b border-[#3B171D] pb-4">
              <div>
                <p className="text-sm">SSH agent status</p>
                <p className="mt-1 text-xs text-[#9D8589]">
                  Availability of the local SSH authentication service.
                </p>
              </div>

              <span
                className={`font-mono text-xs ${
                  agentAvailable
                    ? "text-emerald-400"
                    : "text-[#C89A65]"
                }`}
              >
                {agentAvailable === null
                  ? "UNKNOWN"
                  : agentAvailable
                    ? "AVAILABLE"
                    : "UNAVAILABLE"}
              </span>
            </div>

            <SettingToggle
              label="Confirm sensitive actions"
              description="Ask for confirmation before sensitive operations."
              checked={confirmSensitiveActions}
              disabled={isSaving}
              onChange={(checked) =>
                void updateSetting(
                  "confirm_sensitive_actions",
                  String(checked),
                )
              }
            />

            <div className="border-t border-[#3B171D] pt-4">
              <p className="text-sm">Private key handling</p>
              <p className="mt-1 text-xs text-[#9D8589]">
                Private key operations are managed by NEXUS SSH authentication
                and key management services. Private key contents are not
                displayed here.
              </p>
            </div>
          </Card>

          <Card>
            <p className="text-xs tracking-wider text-[#9D8589]">ABOUT</p>

            <div className="mt-4">
              <p className="text-sm font-medium">NEXUS</p>
              <p className="mt-1 font-mono text-xs text-[#9D8589]">
                Network Operations Suite · v0.1.0
              </p>
              <p className="mt-3 text-xs text-[#9D8589]">
                Desktop application built with Tauri, React, and Rust.
              </p>
            </div>
          </Card>

          {isSaving && (
            <p className="text-xs text-[#9D8589]">Saving settings...</p>
          )}
        </section>
      )}
    </>
  );
}