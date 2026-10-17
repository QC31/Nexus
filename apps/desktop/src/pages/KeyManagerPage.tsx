import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface SshKeyInfo {
  name: string;
  path: string;
  key_type: string;
  public_key_path: string | null;
  fingerprint: string | null;
}

export default function KeyManagerPage() {
  const [keys, setKeys] = useState<SshKeyInfo[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");

  const [isGenerateModalOpen, setIsGenerateModalOpen] = useState(false);
  const [keyName, setKeyName] = useState("id_ed25519_nexus");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState("");
  const [keyToDelete, setKeyToDelete] = useState<SshKeyInfo | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const loadKeys = async () => {
    setIsLoading(true);
    setError("");

    try {
      const result = await invoke<SshKeyInfo[]>("list_ssh_keys");
      setKeys(result);
    } catch (error) {
      setError(String(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadKeys();
  }, []);

  const closeGenerateModal = () => {
    if (isGenerating) {
      return;
    }

    setIsGenerateModalOpen(false);
    setGenerateError("");
    setPassphrase("");
    setConfirmPassphrase("");
  };

  const handleGenerateKey = async () => {
    const trimmedName = keyName.trim();

    if (!trimmedName) {
      setGenerateError("Key name cannot be empty.");
      return;
    }

    if (passphrase !== confirmPassphrase) {
      setGenerateError("Passphrases do not match.");
      return;
    }

    setIsGenerating(true);
    setGenerateError("");

    try {
      await invoke<SshKeyInfo>("generate_ssh_key", {
        name: trimmedName,
        passphrase: passphrase || null,
      });

      closeGenerateModal();
      await loadKeys();
    } catch (error) {
      setGenerateError(String(error));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDeleteKey = async () => {
  if (!keyToDelete) {
    return;
  }

  setIsDeleting(true);
  setDeleteError("");

  try {
    await invoke("delete_ssh_key", {
      path: keyToDelete.path,
    });

    setKeyToDelete(null);
    await loadKeys();
  } catch (error) {
    setDeleteError(String(error));
  } finally {
    setIsDeleting(false);
  }
};

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-white">Key Manager</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Manage your SSH keys and authentication identities.
        </p>
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-white">SSH KEYS</h2>
            <p className="mt-1 text-xs text-zinc-500">
              SSH keys detected on this machine.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setGenerateError("");
              setIsGenerateModalOpen(true);
            }}
            className="rounded-md border border-zinc-700 px-3 py-2 text-xs font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900"
          >
            GENERATE KEY
          </button>
        </div>

        <div className="mt-6">
          {isLoading ? (
            <div className="rounded-lg border border-zinc-800 px-4 py-10 text-center">
              <p className="text-sm text-zinc-500">Scanning SSH keys...</p>
            </div>
          ) : error ? (
            <div className="rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-4">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          ) : keys.length === 0 ? (
            <div className="rounded-lg border border-dashed border-zinc-800 px-4 py-10 text-center">
              <p className="text-sm text-zinc-500">
                No SSH keys detected.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-zinc-800">
              <div className="grid grid-cols-[1fr_100px_1.5fr] border-b border-zinc-800 bg-zinc-900/50 px-4 py-3 text-[10px] font-semibold tracking-wider text-zinc-500">
                <span>KEY</span>
                <span>TYPE</span>
                <span>PATH</span>
              </div>

              {keys.map((key) => (
                <div
                  key={key.path}
                  className="grid grid-cols-[1fr_100px_1.5fr] items-center border-b border-zinc-900 px-4 py-4 last:border-b-0"
                >
                  <div>
                    <p className="text-sm font-medium text-zinc-200">
                      {key.name}
                    </p>
                    <p className="mt-1 text-[11px] text-zinc-600">
                      {key.public_key_path
                        ? "Public key available"
                        : "No public key found"}
                    </p>
                  </div>

                  <span className="text-xs font-medium text-zinc-400">
                    {key.key_type}
                  </span>

                  <div className="flex min-w-0 items-center gap-3">
                    <span className="truncate font-mono text-xs text-zinc-500">
                      {key.path}
                    </span>

                    <button
                      type="button"
                      onClick={() => {
                        setDeleteError("");
                        setKeyToDelete(key);
                      }}
                      className="shrink-0 rounded-md border border-red-900/60 px-2.5 py-1.5 text-[10px] font-semibold text-red-400 transition hover:border-red-700 hover:bg-red-950/30"
                    >
                      DELETE
                    </button>
                  </div>

                  {key.fingerprint && (
                    <p className="col-span-3 mt-2 truncate font-mono text-[11px] text-zinc-600">
                      {key.fingerprint}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {isGenerateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-[#170A0D] p-6 shadow-2xl">
            <div>
              <h2 className="text-lg font-semibold text-white">
                Generate SSH Key
              </h2>
              <p className="mt-1 text-xs text-zinc-500">
                Generate a new ED25519 key in ~/.ssh.
              </p>
            </div>

            <div className="mt-6 space-y-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-zinc-400">
                  KEY NAME
                </label>
                <input
                  type="text"
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                  disabled={isGenerating}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2.5 font-mono text-sm text-zinc-200 outline-none transition focus:border-[#B52636] disabled:opacity-50"
                  placeholder="id_ed25519_nexus"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-zinc-400">
                  PASSPHRASE
                  <span className="ml-2 text-zinc-600">(OPTIONAL)</span>
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={(event) => setPassphrase(event.target.value)}
                  disabled={isGenerating}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none transition focus:border-[#B52636] disabled:opacity-50"
                  placeholder="Leave empty for no passphrase"
                />
              </div>

              <div>
                <label className="mb-2 block text-xs font-medium text-zinc-400">
                  CONFIRM PASSPHRASE
                </label>
                <input
                  type="password"
                  value={confirmPassphrase}
                  onChange={(event) =>
                    setConfirmPassphrase(event.target.value)
                  }
                  disabled={isGenerating}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2.5 text-sm text-zinc-200 outline-none transition focus:border-[#B52636] disabled:opacity-50"
                  placeholder="Repeat passphrase"
                />
              </div>

              {generateError && (
                <div className="rounded-md border border-red-900/50 bg-red-950/20 px-3 py-3">
                  <p className="text-xs text-red-400">{generateError}</p>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={closeGenerateModal}
                disabled={isGenerating}
                className="rounded-md border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                CANCEL
              </button>

              <button
                type="button"
                onClick={() => void handleGenerateKey()}
                disabled={isGenerating}
                className="rounded-md bg-[#B52636] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#C93445] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isGenerating ? "GENERATING..." : "GENERATE"}
              </button>
            </div>
          </div>
        </div>
      )}

      {keyToDelete && (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4">
    <div className="w-full max-w-md rounded-xl border border-red-900/50 bg-[#170A0D] p-6 shadow-2xl">
      <h2 className="text-lg font-semibold text-white">
        Delete SSH Key?
      </h2>

      <p className="mt-2 text-sm text-zinc-400">
        This will permanently delete the private key and its public key.
      </p>

      <div className="mt-4 rounded-md border border-zinc-800 bg-zinc-950 px-3 py-3">
        <p className="font-mono text-xs text-zinc-300">
          {keyToDelete.name}
        </p>
        <p className="mt-1 truncate font-mono text-[11px] text-zinc-600">
          {keyToDelete.path}
        </p>
      </div>

      {deleteError && (
        <div className="mt-4 rounded-md border border-red-900/50 bg-red-950/20 px-3 py-3">
          <p className="text-xs text-red-400">{deleteError}</p>
        </div>
      )}

      <div className="mt-6 flex justify-end gap-3">
        <button
          type="button"
          onClick={() => setKeyToDelete(null)}
          disabled={isDeleting}
          className="rounded-md border border-zinc-700 px-4 py-2 text-xs font-medium text-zinc-300 transition hover:bg-zinc-900 disabled:opacity-50"
        >
          CANCEL
        </button>

        <button
          type="button"
          onClick={() => void handleDeleteKey()}
          disabled={isDeleting}
          className="rounded-md bg-red-700 px-4 py-2 text-xs font-semibold text-white transition hover:bg-red-600 disabled:opacity-50"
        >
          {isDeleting ? "DELETING..." : "DELETE KEY"}
        </button>
      </div>
    </div>
  </div>
)}
    </div>
  );
}