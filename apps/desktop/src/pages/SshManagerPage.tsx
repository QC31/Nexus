import { useEffect, useState } from 'react';
import { confirm, open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  SshAuthenticationMethod,
  SshServer,
} from '../types/ssh';
import { Card } from '../components/ui/Card';
import { SshTerminal } from '../components/SshTerminal';
import { useSshSessions } from "../contexts/SshSessionsContext";

interface SshServerRecord {
  id: string;
  name: string;
  host: string;
  username: string;
  port: number;
  authentication_method: SshAuthenticationMethod;
  private_key_path?: string;
  group_name?: string;
  favorite: boolean;
  remember_password: boolean;
}

interface SshKeyInfo {
  name: string;
  path: string;
  key_type: string;
  public_key_path: string | null;
  fingerprint: string | null;
}

interface SshConnectionHistoryRecord {
  id: number;
  server_id: string;
  server_name: string;
  host: string;
  authentication_method: SshAuthenticationMethod;
  status: string;
  message: string;
  created_at: string;
}

interface SftpDirectoryEntry {
  name: string;
  entry_type: string;
  size: number;
}

interface SftpDirectoryResult {
  path: string;
  entries: SftpDirectoryEntry[];
}

const INITIAL_SERVERS: SshServer[] = [
  {
    id: 'demo-01',
    name: 'Web Server',
    host: '192.168.1.1',
    username: 'root',
    port: 22,
    authenticationMethod: 'ssh-agent',
    group: 'Production',
    favorite: true,
    rememberPassword: false,
  },
  {
    id: 'demo-02',
    name: 'Database Server',
    host: '192.168.1.30',
    username: 'admin',
    port: 22,
    authenticationMethod: 'private-key',
    group: 'Production',
    favorite: false,
    rememberPassword: false,
  },
];

export default function SshManagerPage() {

  const [servers, setServers] = useState<SshServer[]>([]);
  const [defaultSshPort, setDefaultSshPort] = useState('22');
  const [confirmBeforeClosingSessions, setConfirmBeforeClosingSessions] =
    useState(true);
  
  const [confirmSensitiveActions, setConfirmSensitiveActions] =
    useState(true);

useEffect(() => {
  let cancelled = false;

  const loadAppSettings = async () => {
    try {
      const settings = await invoke<Record<string, string>>('get_app_settings');

      if (cancelled) {
        return;
      }

      const configuredPort = Number(settings.default_ssh_port);

      if (
        Number.isInteger(configuredPort) &&
        configuredPort >= 1 &&
        configuredPort <= 65535
      ) {
        setDefaultSshPort(String(configuredPort));
      }

      setConfirmBeforeClosingSessions(
        settings.confirm_before_closing_sessions !== 'false',
      );

      setConfirmSensitiveActions(
        settings.confirm_sensitive_actions !== 'false',
      );

    } catch (loadError) {
      console.error('Failed to load app settings:', loadError);
    }
  };

  void loadAppSettings();

  return () => {
    cancelled = true;
  };
}, []);

  const [connectionHistory, setConnectionHistory] = useState<
    SshConnectionHistoryRecord[]
  >([]);
  const [serverSearch, setServerSearch] = useState('');
  const [serverGroupFilter, setServerGroupFilter] = useState('');
  const [isGroupFilterOpen, setIsGroupFilterOpen] = useState(false);

  const [selectedServerId, setSelectedServerId] = useState<string | null>(
    INITIAL_SERVERS[0]?.id ?? null,
  );

  const [isAddingServer, setIsAddingServer] = useState(false);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [isSavingServer, setIsSavingServer] = useState(false);
  const [error, setError] = useState('');

  interface SshSessionTab {
  id: string;
  serverId: string;
  serverName: string;
  sessionId: string;
}

  const [sshSessionId, setSshSessionId] = useState<string | null>(null);

  const [sshSessionTabs, setSshSessionTabs] = useState<SshSessionTab[]>([]);
  const { setSessions } = useSshSessions();
  useEffect(() => {
    setSessions(sshSessionTabs);
  }, [sshSessionTabs, setSessions]);

  const [activeSshSessionTabId, setActiveSshSessionTabId] =
    useState<string | null>(null);
  const [sshSessionOutputs, setSshSessionOutputs] =
    useState<Record<string, string>>({});

  const [sshOutput, setSshOutput] = useState('');

  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [username, setUsername] = useState('');
  const [port, setPort] = useState('22');
  const [authenticationMethod, setAuthenticationMethod] =
    useState<SshAuthenticationMethod>('ssh-agent');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [sshKeys, setSshKeys] = useState<SshKeyInfo[]>([]);
  const [isLoadingSshKeys, setIsLoadingSshKeys] = useState(false);
  const [password, setPassword] = useState('');
  const [rememberPassword, setRememberPassword] = useState(false);
  const [group, setGroup] = useState('');
  const [favorite, setFavorite] = useState(false);
  const [sshAgentAvailable, setSshAgentAvailable] =
    useState<boolean | null>(null);
  const [isLoadingSftp, setIsLoadingSftp] = useState(false);
  const [sftpEntries, setSftpEntries] = useState<SftpDirectoryEntry[]>([]);
  const [selectedSftpEntries, setSelectedSftpEntries] = useState<string[]>([]);
  const [sftpTransferProgress, setSftpTransferProgress] = useState<{
    transferId: string;
    transferredBytes: number;
    totalBytes: number;
    fileName: string;
    completed: boolean;
  } | null>(null);
  const [sftpTransferCancelled, setSftpTransferCancelled] = useState(false);
  const cancelSftpTransfer = async () => {
  if (!sftpTransferProgress || sftpTransferProgress.completed) {
    return;
  }

  try {
    await invoke('cancel_sftp_transfer', {
      transferId: sftpTransferProgress.transferId,
    });
  } catch (error) {
    console.error('Failed to cancel SFTP transfer:', error);
  }
};

  const [sftpCurrentPath, setSftpCurrentPath] = useState('/');
  const [activeSessionView, setActiveSessionView] = useState<
    'terminal' | 'sftp'
  >('terminal');
  const [isCreateDirectoryOpen, setIsCreateDirectoryOpen] =
    useState(false);
  const [newDirectoryName, setNewDirectoryName] = useState('');
  const [isCreatingDirectory, setIsCreatingDirectory] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);

  const toggleSftpEntrySelection = (entryName: string) => {
  setSelectedSftpEntries((current) =>
    current.includes(entryName)
      ? current.filter((name) => name !== entryName)
      : [...current, entryName]
  );
};

const deleteSelectedSftpEntries = async () => {
  if (!selectedServer || selectedSftpEntries.length === 0) {
    return;
  }

  const selectedNames = [...selectedSftpEntries];

  const confirmed = window.confirm(
    `Are you sure you want to permanently delete ${selectedNames.length} selected item(s)?\n\n${selectedNames.join('\n')}\n\nFolders and their contents will also be deleted.`
  );

  if (!confirmed) {
    return;
  }

  setError('');

  try {
    for (const entryName of selectedNames) {
      const remotePath =
        sftpCurrentPath === '/'
          ? `/${entryName}`
          : `${sftpCurrentPath.replace(/\/+$/, '')}/${entryName}`;

      await invoke('sftp_delete_entry', {
        serverId: selectedServer.id,
        remotePath,
        recursive: true,
      });
    }

    setSelectedSftpEntries([]);
    await loadSftpDirectory(sftpCurrentPath);
  } catch (error) {
    setError(
      error instanceof Error
        ? error.message
        : String(error)
    );

    await loadSftpDirectory(sftpCurrentPath);
  }
};

useEffect(() => {
  let unlisten: (() => void) | undefined;
  let active = true;

  const setupListener = async () => {
    const stopListening = await listen<{
      transfer_id: string;
      transferred_bytes: number;
      total_bytes: number;
      file_name: string;
      completed: boolean;
    }>('sftp-transfer-progress', (event) => {
      if (!active) return;

      const progress = event.payload;

      setSftpTransferProgress({
        transferId: progress.transfer_id,
        transferredBytes: progress.transferred_bytes,
        totalBytes: progress.total_bytes,
        fileName: progress.file_name,
        completed: progress.completed,
      });
    });

    if (active) {
      unlisten = stopListening;
    } else {
      stopListening();
    }
  };

  void setupListener();

  return () => {
    active = false;
    unlisten?.();
  };
}, []);

const toggleSelectAllSftpEntries = () => {
  setSelectedSftpEntries((current) => {
    const allNames = sftpEntries.map((entry) => entry.name);

    const allSelected =
      allNames.length > 0 &&
      allNames.every((name) => current.includes(name));

    return allSelected ? [] : allNames;
  });
};

  useEffect(() => {
    const loadServers = async () => {
      try {
        const records = await invoke<SshServerRecord[]>('list_ssh_servers');

        const loadedServers: SshServer[] = records.map((record) => ({
          id: record.id,
          name: record.name,
          host: record.host,
          username: record.username,
          port: record.port,
          authenticationMethod: record.authentication_method,
          privateKeyPath: record.private_key_path,
          group: record.group_name,
          favorite: record.favorite,
          rememberPassword: record.remember_password,
        }));

        setServers(loadedServers);
        setSelectedServerId(loadedServers[0]?.id ?? null);

        const history = await invoke<SshConnectionHistoryRecord[]>(
          'ssh_connection_history',
          { serverId: null },
        );

        setConnectionHistory(history);
      } catch (error) {
        console.error('Failed to load SSH data:', error);
      }
    };

    void loadServers();
  }, []);

useEffect(() => {
  const checkSshAgent = async () => {
    try {
      const available = await invoke<boolean>(
        'ssh_agent_available',
      );

      setSshAgentAvailable(available);
    } catch (error) {
      console.error(
        'Failed to check SSH agent:',
        error,
      );

      setSshAgentAvailable(false);
    }
  };

  void checkSshAgent();
}, []);

useEffect(() => {
  const loadSshKeys = async () => {
    setIsLoadingSshKeys(true);

    try {
      const keys = await invoke<SshKeyInfo[]>('list_ssh_keys');
      setSshKeys(keys);
    } catch (error) {
      console.error('Failed to load SSH keys:', error);
      setSshKeys([]);
    } finally {
      setIsLoadingSshKeys(false);
    }
  };

  void loadSshKeys();
}, []);

useEffect(() => {
  if (!sshSessionId) {
    return;
  }

  let unlistenOutput: (() => void) | undefined;
  let unlistenClosed: (() => void) | undefined;

  const subscribeToSshEvents = async () => {
    try {      
      const existingOutput = await invoke<string>('ssh_get_output', {
        sessionId: sshSessionId,
      });

      setSshOutput(existingOutput);

      setSshSessionOutputs((currentOutputs) => ({
        ...currentOutputs,
        [sshSessionId]: existingOutput,
      }));

      unlistenOutput = await listen<string>(
        `ssh-output-${sshSessionId}`,
        (event) => {
          setSshOutput((currentOutput) => currentOutput + event.payload);

          setSshSessionOutputs((currentOutputs) => ({
            ...currentOutputs,
            [sshSessionId]:
              (currentOutputs[sshSessionId] ?? '') + event.payload,
          }));
        },
      );

      unlistenClosed = await listen(
        `ssh-session-closed-${sshSessionId}`,
        () => {
          setSshSessionTabs((currentTabs) =>
            currentTabs.filter((tab) => tab.sessionId !== sshSessionId),
          );

          setSshSessionOutputs((currentOutputs) => {
            const nextOutputs = { ...currentOutputs };
            delete nextOutputs[sshSessionId];
            return nextOutputs;
          });

          setSshSessionId(null);
          setActiveSshSessionTabId(null);
          setSshOutput('');
        },
      );
    } catch (error) {
      console.error(
        'Failed to subscribe to SSH events:',
        error,
      );
    }
  };

  void subscribeToSshEvents();

  return () => {
    unlistenOutput?.();
    unlistenClosed?.();
  };
}, [sshSessionId]);

  const selectedServer = servers.find(
    (server) => server.id === selectedServerId,
);

const filteredServers = servers.filter((server) => {
  const query = serverSearch.trim().toLowerCase();
  const groupFilter = serverGroupFilter.trim().toLowerCase();

  const matchesSearch =
    !query ||
    server.name.toLowerCase().includes(query) ||
    server.host.toLowerCase().includes(query) ||
    server.username.toLowerCase().includes(query) ||
    server.group?.toLowerCase().includes(query);

  const matchesGroup =
    !groupFilter ||
    server.group?.toLowerCase() === groupFilter;

  return matchesSearch && matchesGroup;
});

const selectedServerSession = selectedServer
  ? sshSessionTabs.find(
      (tab) => tab.serverId === selectedServer.id,
    )
  : undefined;

const selectedServerIsConnected = Boolean(selectedServerSession);

useEffect(() => {
  if (
    activeSessionView === 'sftp' &&
    selectedServerIsConnected
  ) {
    void loadSftpDirectory('/');
  }
}, [activeSessionView, selectedServerIsConnected]);

const isServerConnected = (serverId: string) =>
  sshSessionTabs.some(
    (tab) => tab.serverId === serverId,
  );

  const startEditingServer = () => {
  if (!selectedServer) {
    return;
  }

  setEditingServerId(selectedServer.id);

  setName(selectedServer.name);
  setHost(selectedServer.host);
  setUsername(selectedServer.username);
  setPort(String(selectedServer.port));
  setAuthenticationMethod(selectedServer.authenticationMethod);
  setPrivateKeyPath(selectedServer.privateKeyPath ?? '');
  setPassword('');
  setRememberPassword(selectedServer.rememberPassword);
  setGroup(selectedServer.group ?? '');
  setFavorite(selectedServer.favorite);
  setIsAddingServer(true);
  setError('');
};

  const resetForm = () => {
    setName('');
    setHost('');
    setUsername('');
    setPort(defaultSshPort);
    setAuthenticationMethod('ssh-agent');
    setPrivateKeyPath('');
    setPassword('');
    setRememberPassword(false);
    setGroup('');
    setFavorite(false);
    setError('');
  };

    const handleCancelAdd = () => {
    if (isSavingServer) {
      return;
    }

    setIsAddingServer(false);
    setEditingServerId(null);
    resetForm();
  };

  const handleAddServer = async () => {
    try {
      setError('');
      setIsSavingServer(true);

      const trimmedName = name.trim();
      const trimmedHost = host.trim();
      const trimmedUsername = username.trim();
      const parsedPort = Number(port);

      if (!trimmedName || !trimmedHost || !trimmedUsername) {
        setError('Please fill in name, host and username.');
        return;
      }

      if (
        !Number.isInteger(parsedPort) ||
        parsedPort < 1 ||
        parsedPort > 65535
      ) {
        setError('SSH port must be between 1 and 65535.');
        return;
      }

      if (
        authenticationMethod === 'private-key' &&
        !privateKeyPath.trim()
      ) {
        setError('Please select an SSH private key.');
        return;
      }

      if (authenticationMethod === 'password' && !password) {
        setError('Please enter an SSH password.');
        return;
      }

      const serverId = editingServerId ?? crypto.randomUUID();

      const newServer: SshServer = {
        id: serverId,
        name: trimmedName,
        host: trimmedHost,
        username: trimmedUsername,
        port: parsedPort,
        authenticationMethod,
        privateKeyPath:
          authenticationMethod === 'private-key'
            ? privateKeyPath.trim()
            : undefined,
        group: group.trim() || undefined,
        favorite,
        rememberPassword:
          authenticationMethod === 'password' ? rememberPassword : false,
      };

      const serverRecord: SshServerRecord = {
        id: newServer.id,
        name: newServer.name,
        host: newServer.host,
        username: newServer.username,
        port: newServer.port,
        authentication_method: newServer.authenticationMethod,
        private_key_path: newServer.privateKeyPath,
        group_name: newServer.group,
        favorite: newServer.favorite,
        remember_password: newServer.rememberPassword,
      };

      await invoke('save_ssh_server', {
        server: serverRecord,
      });

      if (
        authenticationMethod === 'password' &&
        rememberPassword
      ) {
        await invoke('save_ssh_password', {
          serverId: newServer.id,
          password,
        });
      }

      setServers((currentServers) => {
  const existingServer = currentServers.some(
    (server) => server.id === newServer.id,
  );

  if (existingServer) {
    return currentServers.map((server) =>
      server.id === newServer.id ? newServer : server,
    );
  }

  return [...currentServers, newServer];
});

setSelectedServerId(newServer.id);
setEditingServerId(null);
setIsAddingServer(false);
resetForm();

    } catch (error) {
      console.error('Failed to save SSH server:', error);
      setError(String(error));
    } finally {
      setIsSavingServer(false);
    }
  };

  const handleToggleFavorite = async (server: SshServer) => {
  const updatedServer: SshServer = {
    ...server,
    favorite: !server.favorite,
  };

  const serverRecord: SshServerRecord = {
    id: updatedServer.id,
    name: updatedServer.name,
    host: updatedServer.host,
    username: updatedServer.username,
    port: updatedServer.port,
    authentication_method:
      updatedServer.authenticationMethod,
    private_key_path: updatedServer.privateKeyPath,
    group_name: updatedServer.group,
    favorite: updatedServer.favorite,
    remember_password: updatedServer.rememberPassword,
  };

  try {
    setError('');

    await invoke('save_ssh_server', {
      server: serverRecord,
    });

    setServers((currentServers) =>
      currentServers.map((currentServer) =>
        currentServer.id === updatedServer.id
          ? updatedServer
          : currentServer,
      ),
    );
  } catch (error) {
    console.error(
      'Failed to update SSH server favorite:',
      error,
    );

    setError(String(error));
  }
};

const handleDeleteServer = async () => {
  if (!selectedServer) {
    return;
  }

  try {
    setError('');

    if (confirmSensitiveActions) {
      const confirmed = await confirm(
        `Are you sure you want to delete the SSH server "${selectedServer.name}"? This action cannot be undone.`,
        {
          title: 'Confirm server deletion',
          kind: 'warning',
          okLabel: 'Delete',
          cancelLabel: 'Cancel',
        },
      );

      if (!confirmed) {
        return;
      }
    }

    await invoke('delete_ssh_server', {
      serverId: selectedServer.id,
    });

    setServers((currentServers) =>
      currentServers.filter((server) => server.id !== selectedServer.id),
    );

    setSelectedServerId(null);
  } catch (error) {
    console.error('Failed to delete SSH server:', error);
    setError(String(error));
  }
};

const handleConnect = async () => {
  if (!selectedServer) {
    return;
  }

  try {
    const result = await invoke<{
      status: string;
      message: string;
      host_key_fingerprint?: string;
    }>('ssh_test_connection', {
      serverId: selectedServer.id,
    });

    if (
      result.status === 'error' ||
      result.status === 'host-key-mismatch'
    ) {
      throw new Error(result.message);
    }

    if (
      result.status === 'host-key-required' &&
      result.host_key_fingerprint
    ) {
      const shouldTrust = window.confirm(
        `${result.message}\n\n` +
          `Server: ${selectedServer.name}\n` +
          `Host: ${selectedServer.host}:${selectedServer.port}\n\n` +
          `SHA-256:\n${result.host_key_fingerprint}\n\n` +
          `Do you want to trust this host key?`,
      );

      if (!shouldTrust) {
        return;
      }

      await invoke('trust_ssh_host_key', {
        serverId: selectedServer.id,
        fingerprint: result.host_key_fingerprint,
      });
    }

    let passphrase: string | null = null;

    if (
      selectedServer.authenticationMethod ===
      'private-key'
    ) {
      const requiresPassphrase = await invoke<boolean>(
        'ssh_private_key_requires_passphrase',
        {
          serverId: selectedServer.id,
        },
      );

      if (requiresPassphrase) {
        const enteredPassphrase = window.prompt(
          'SSH private key passphrase\n\n' +
            'The selected private key is encrypted.\n' +
            'Enter its passphrase to continue:',
        );

        if (enteredPassphrase === null) {
          return;
        }

        passphrase = enteredPassphrase;
      }
    }

  const sessionId = await invoke<string>(
    'ssh_connect',
    {
      serverId: selectedServer.id,
      passphrase,
    },
  ).catch((error) => {

    throw error;
  });

    const tabId = crypto.randomUUID();

    const newTab: SshSessionTab = {
      id: tabId,
      serverId: selectedServer.id,
      serverName: selectedServer.name,
      sessionId,
    };

    setSshSessionTabs((currentTabs) => [
      ...currentTabs,
      newTab,
    ]);

    setActiveSshSessionTabId(tabId);
    setSshSessionId(sessionId);
    setSshOutput('');

    } catch (error) {
        window.alert(
          `SSH connection failed:\n\n${String(error)}`,
        );
      }
};

const closeSshSession = async (sessionId: string) => {

  const closingTab = sshSessionTabs.find(
    (tab) => tab.sessionId === sessionId,
  );

  if (!closingTab) {
    return;
  }

  if (confirmBeforeClosingSessions) {
  let confirmed: boolean;

  try {
    confirmed = await confirm(
      `Disconnect the SSH session "${closingTab.serverName}"?`,
      {
        title: 'Confirm SSH disconnection',
        kind: 'warning',
        okLabel: 'Disconnect',
        cancelLabel: 'Cancel',
      },
    );

  } catch (error) {
    console.error('SSH confirmation dialog failed:', error);
    window.alert(
      `Unable to open the SSH confirmation dialog:\n\n${String(error)}`,
    );
    return;
  }

  if (!confirmed) {
    return;
  }
}

  try {
    await invoke('ssh_disconnect', {
      sessionId,
    });

    setSshSessionTabs((currentTabs) => {
      const closingIndex = currentTabs.findIndex(
        (tab) => tab.id === closingTab.id,
      );

      const remainingTabs = currentTabs.filter(
        (tab) => tab.id !== closingTab.id,
      );

      if (remainingTabs.length === 0) {
        setActiveSshSessionTabId(null);
        setSshSessionId(null);
        setSshOutput('');
        return [];
      }

      if (activeSshSessionTabId === closingTab.id) {
        const nextTab =
          remainingTabs[closingIndex] ??
          remainingTabs[closingIndex - 1] ??
          remainingTabs[0];

        setActiveSshSessionTabId(nextTab.id);
        setSshSessionId(nextTab.sessionId);
        setSshOutput(
          sshSessionOutputs[nextTab.sessionId] ?? '',
        );
      }

      return remainingTabs;
    });

    setSshSessionOutputs((currentOutputs) => {
      const nextOutputs = { ...currentOutputs };
      delete nextOutputs[sessionId];
      return nextOutputs;
    });
  } catch (error) {
    window.alert(
      `SSH disconnect failed:\n\n${String(error)}`,
    );
  }
};

const handleDisconnectSelectedServer = async () => {
  if (!selectedServerSession) {
    return;
  }

  await closeSshSession(selectedServerSession.sessionId);
};

const loadSftpDirectory = async (path: string) => {
  setSelectedSftpEntries([]);

  if (!selectedServer) {
    setError('Please select an SSH server first.');
    return;
  }

  setIsLoadingSftp(true);

  try {
    const result = await invoke<SftpDirectoryResult>(
      'sftp_list_directory',
      {
        serverId: selectedServer.id,
        path,
      },
    );

    setSftpEntries(result.entries);
    setSftpCurrentPath(result.path);
  } catch (error) {
    console.error('Failed to load SFTP directory:', error);
    setError(String(error));
  } finally {
    setIsLoadingSftp(false);
  }
};

const createSftpDirectory = async () => {
  if (!selectedServer) {
    setError('Please select an SSH server first.');
    return;
  }

  const name = newDirectoryName.trim();

  if (!name) {
    setError('Please enter a directory name.');
    return;
  }

  setIsCreatingDirectory(true);

  try {
    await invoke('sftp_create_directory', {
      serverId: selectedServer.id,
      path: sftpCurrentPath,
      name,
    });

    setNewDirectoryName('');
    setIsCreateDirectoryOpen(false);
    setError('');

    await loadSftpDirectory(sftpCurrentPath);
  } catch (error) {
    console.error('Failed to create SFTP directory:', error);
    setError(String(error));
  } finally {
    setIsCreatingDirectory(false);
  }
};

const uploadMultipleSftpFiles = async () => {
  if (!selectedServer) {
    setError('Please select an SSH server first.');
    return;
  }

  if (isUploadingFile) {
    return;
  }

  try {
    const selectedFiles = await open({
      multiple: true,
      directory: false,
      title: 'Select files to upload',
    });

    if (!selectedFiles || !Array.isArray(selectedFiles) || selectedFiles.length === 0) {
      return;
    }

    setIsUploadingFile(true);
    setError('');
    setSftpTransferCancelled(false);

    await invoke('sftp_upload_multiple', {
      serverId: selectedServer.id,
      localPaths: selectedFiles,
      remoteDirectory: sftpCurrentPath,
    });

    await loadSftpDirectory(sftpCurrentPath);
  } catch (error) {
    console.error('Failed to upload multiple SFTP files:', error);
    setError(String(error));
  } finally {
    setIsUploadingFile(false);
  }
};

const uploadSftpFolder = async () => {
  if (!selectedServer) {
    setError('Please select an SSH server first.');
    return;
  }

  if (isUploadingFile) {
    return;
  }

  try {
    const selectedFolder = await open({
      multiple: false,
      directory: true,
      title: 'Select a folder to upload',
    });

    if (!selectedFolder || Array.isArray(selectedFolder)) {
      return;
    }

    setIsUploadingFile(true);
    setError('');
    setSftpTransferCancelled(false);

    await invoke('sftp_upload_multiple', {
      serverId: selectedServer.id,
      localPaths: [selectedFolder],
      remoteDirectory: sftpCurrentPath,
    });

    await loadSftpDirectory(sftpCurrentPath);
  } catch (error) {
    console.error('Failed to upload SFTP folder:', error);
    setError(String(error));
  } finally {
    setIsUploadingFile(false);
  }
};

const downloadSftpFile = async (remoteFileName: string) => {
  console.log('[SFTP] 1. Fonction appelée :', remoteFileName);

  if (!selectedServer) {
    console.error('[SFTP] Aucun serveur sélectionné');
    setError('Aucun serveur SSH sélectionné.');
    return;
  }

  const remotePath =
    sftpCurrentPath === '/'
      ? `/${remoteFileName}`
      : `${sftpCurrentPath.replace(/\/$/, '')}/${remoteFileName}`;

  try {
    setError('');

    console.log('[SFTP] 2. Chemin distant :', remotePath);
    console.log('[SFTP] 3. Ouverture de la boîte de dialogue');

    const localPath = await save({
      title: 'Enregistrer le fichier téléchargé',
      defaultPath: remoteFileName,
    });

    console.log('[SFTP] 4. Résultat de la boîte de dialogue :', localPath);

    if (!localPath) {
      console.log('[SFTP] Téléchargement annulé par l’utilisateur');
      return;
    }

    console.log('[SFTP] 5. Appel de sftp_download_file');

    await invoke('sftp_download_file', {
      serverId: selectedServer.id,
      remotePath,
      localPath,
    });

    console.log('[SFTP] 6. Téléchargement terminé avec succès');
  } catch (error) {
    console.error('[SFTP] ERREUR :', error);
    setError(`Échec du téléchargement : ${String(error)}`);
  }
};

const downloadSelectedSftpEntries = async () => {
  if (!selectedServer) {
    setError('Aucun serveur SSH sélectionné.');
    return;
  }

  if (selectedSftpEntries.length === 0) {
    setError('Sélectionne au moins un fichier ou un dossier.');
    return;
  }

  try {
    setError('');
    setSftpTransferCancelled(false);
    setSftpTransferProgress(null);

    // Choose the destination local folder.
    const localDirectory = await open({
      title: 'Choisir le dossier de destination',
      directory: true,
      multiple: false,
    });

    if (!localDirectory || Array.isArray(localDirectory)) {
      return;
    }

    // Build the complete remote paths.
    const remotePaths = selectedSftpEntries.map((name) =>
      sftpCurrentPath === '/'
        ? `/${name}`
        : `${sftpCurrentPath.replace(/\/$/, '')}/${name}`
    );

    console.log('[SFTP] Téléchargement multiple');
    console.log('[SFTP] Chemins distants :', remotePaths);
    console.log('[SFTP] Destination locale :', localDirectory);

    await invoke('sftp_download_multiple', {
      serverId: selectedServer.id,
      remotePaths,
      localDirectory,
    });

    setSelectedSftpEntries([]);

    console.log('[SFTP] Téléchargement multiple terminé');
  } catch (error) {
    console.error('[SFTP] Erreur de téléchargement multiple :', error);

    if (String(error).includes('Transfert annulé')) {
      setSftpTransferCancelled(true);
      setError('');
    } else {
      setError(`Échec du téléchargement multiple : ${String(error)}`);
    }
  }
};

const sftpPathSegments =
  sftpCurrentPath === '/'
    ? []
    : sftpCurrentPath
        .split('/')
        .filter(Boolean);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <span className="text-[#8F1826]">✦</span>

          <h1 className="text-2xl font-semibold tracking-tight text-[#EEE5E6]">
            SSH Manager
          </h1>

        </div>

        <p className="text-sm text-[#9D8589]">
          Manage your SSH infrastructure and remote sessions.
        </p>
        </div>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-[#3B171D] px-5 py-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs tracking-[0.18em] text-[#9D8589]">
                  CONNECTION HISTORY
                </p>

                <p className="mt-1 text-xs text-[#6F5B5F]">
                  Recent SSH connection attempts
                </p>
              </div>

              <span className="text-xs text-[#9D8589]">
                {connectionHistory.length}
              </span>
            </div>
          </div>

          <div className="p-4">
            {connectionHistory.length === 0 ? (
              <p className="text-xs text-[#6F5B5F]">
                No connection history yet.
              </p>
            ) : (
              <div className="space-y-2">
                {connectionHistory.slice(0, 5).map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-[#EEE5E6]">
                        {entry.server_name}
                      </span>

                      <span className="text-xs uppercase tracking-[0.08em] text-[#8DBB9D]">
                        {entry.status}
                      </span>
                    </div>

                    <div className="mt-1 text-xs text-[#9D8589]">
                      {entry.host} · {entry.authentication_method}
                    </div>

                    <div className="mt-1 text-[11px] text-[#6F5B5F]">
                      {new Date(`${entry.created_at.replace(' ', 'T')}Z`).toLocaleString()}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>

      {isAddingServer ? (
        <Card>
          <div className="border-b border-[#3B171D] pb-5">
            <p className="text-xs tracking-[0.18em] text-[#9D8589]">
              ADD SERVER
            </p>

            <p className="mt-2 text-sm text-[#6F5B5F]">
              Configure a new SSH server for NEXUS.
            </p>
          </div>

          {error && (
            <div className="mt-5 rounded-md border border-[#542028] bg-[#1D0D11] px-4 py-3 text-sm text-[#D45767]">
              {error}
            </div>
          )}

          <div className="mt-6 grid gap-5 md:grid-cols-2">
            <div>
              <label
                htmlFor="ssh-name"
                className="mb-2 block text-xs tracking-[0.15em] text-[#9D8589]"
              >
                NAME
              </label>

              <input
                id="ssh-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Production Web"
                disabled={isSavingServer}
                className="w-full rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826] disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div>
              <label
                htmlFor="ssh-host"
                className="mb-2 block text-xs tracking-[0.15em] text-[#9D8589]"
              >
                HOST / IP
              </label>

              <input
                id="ssh-host"
                type="text"
                value={host}
                onChange={(event) => setHost(event.target.value)}
                placeholder="192.168.1.1"
                disabled={isSavingServer}
                className="w-full rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826] disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div>
              <label
                htmlFor="ssh-username"
                className="mb-2 block text-xs tracking-[0.15em] text-[#9D8589]"
              >
                USERNAME
              </label>

              <input
                id="ssh-username"
                type="text"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="root"
                disabled={isSavingServer}
                className="w-full rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826] disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div>
              <label
                htmlFor="ssh-port"
                className="mb-2 block text-xs tracking-[0.15em] text-[#9D8589]"
              >
                SSH PORT
              </label>

              <input
                id="ssh-port"
                type="number"
                min="1"
                max="65535"
                value={port}
                onChange={(event) => setPort(event.target.value)}
                disabled={isSavingServer}
                className="w-full rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none focus:border-[#8F1826] disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>

            <div>
              <label
                htmlFor="ssh-authentication"
                className="mb-2 block text-xs tracking-[0.15em] text-[#9D8589]"
              >
                AUTHENTICATION
              </label>

              <select
                id="ssh-authentication"
                value={authenticationMethod}
                onChange={(event) =>
                  setAuthenticationMethod(
                    event.target.value as SshAuthenticationMethod,
                  )
                }
                disabled={isSavingServer}
                className="w-full appearance-none rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 text-sm text-[#EEE5E6] outline-none focus:border-[#8F1826] disabled:cursor-not-allowed disabled:opacity-50"
              >
                <option
                  value="ssh-agent"
                  className="bg-[#1D0D11] text-[#EEE5E6]"
                >
                  SSH Agent
                </option>

                <option
                  value="private-key"
                  className="bg-[#1D0D11] text-[#EEE5E6]"
                >
                  Private Key
                </option>

                <option
                  value="password"
                  className="bg-[#1D0D11] text-[#EEE5E6]"
                >
                  Password
                </option>
              </select>

              {authenticationMethod === 'ssh-agent' && (
                <p className="mt-2 flex items-center gap-2 text-xs">
                  <span
                    className={[
                      'h-2 w-2 rounded-full',
                      sshAgentAvailable === true
                        ? 'bg-[#8DBB9D]'
                        : sshAgentAvailable === false
                          ? 'bg-[#D45767]'
                          : 'bg-[#C89A65]',
                    ].join(' ')}
                  />

                  <span className="text-[#9D8589]">
                    {sshAgentAvailable === null
                      ? 'Checking SSH Agent...'
                      : sshAgentAvailable
                        ? 'SSH Agent available'
                        : 'SSH Agent not detected'}
                  </span>
                </p>
              )}

            </div>

            <div>
              <label
                htmlFor="ssh-group"
                className="mb-2 block text-xs tracking-[0.15em] text-[#9D8589]"
              >
                GROUP
              </label>

              <input
                id="ssh-group"
                type="text"
                list="ssh-group-options"
                value={group}
                onChange={(event) => setGroup(event.target.value)}
                placeholder="Production"
                disabled={isSavingServer}
                className="w-full rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826] disabled:cursor-not-allowed disabled:opacity-50"
              />

              <datalist id="ssh-group-options">
                {[...new Set(
                  servers
                    .map((server) => server.group?.trim())
                    .filter((value): value is string => Boolean(value)),
                )]
                  .sort()
                  .map((groupName) => (
                    <option key={groupName} value={groupName} />
                  ))}
              </datalist>
            </div>

            {authenticationMethod === 'private-key' && (
              <div className="md:col-span-2">
                <label
                  htmlFor="ssh-private-key"
                  className="mb-2 block text-xs tracking-[0.15em] text-[#9D8589]"
                >
                  SSH PRIVATE KEY
                </label>

                <select
                  id="ssh-private-key"
                  value={privateKeyPath}
                  onChange={(event) =>
                    setPrivateKeyPath(event.target.value)
                  }
                  disabled={isSavingServer || isLoadingSshKeys}
                  className="w-full appearance-none rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 font-mono text-sm text-[#EEE5E6] outline-none focus:border-[#8F1826] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="" className="bg-[#1D0D11] text-[#6F5B5F]">
                    {isLoadingSshKeys
                      ? 'Loading SSH keys...'
                      : 'Select an SSH private key'}
                  </option>

                  {sshKeys.map((key) => (
                    <option
                      key={key.path}
                      value={key.path}
                      className="bg-[#1D0D11] text-[#EEE5E6]"
                    >
                      {key.name} — {key.key_type}
                    </option>
                  ))}
                </select>

                {privateKeyPath && (
                  <p className="mt-2 truncate font-mono text-xs text-[#6F5B5F]">
                    {privateKeyPath}
                  </p>
                )}

                {!isLoadingSshKeys && sshKeys.length === 0 && (
                  <p className="mt-2 text-xs text-[#D45767]">
                    No SSH private keys detected. Generate one from Key Manager.
                  </p>
                )}

                <p className="mt-2 text-xs text-[#6F5B5F]">
                  Select one of the SSH keys managed by NEXUS.
                </p>
              </div>
            )}

            {authenticationMethod === 'password' && (
              <div className="md:col-span-2">
                <label
                  htmlFor="ssh-password"
                  className="mb-2 block text-xs tracking-[0.15em] text-[#9D8589]"
                >
                  PASSWORD
                </label>

                <input
                  id="ssh-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Enter SSH password"
                  autoComplete="new-password"
                  disabled={isSavingServer}
                  className="w-full rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-3 text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826] disabled:cursor-not-allowed disabled:opacity-50"
                />

                <div className="mt-3 flex items-start gap-3">
                  <input
                    id="ssh-remember-password"
                    type="checkbox"
                    checked={rememberPassword}
                    onChange={(event) =>
                      setRememberPassword(event.target.checked)
                    }
                    disabled={isSavingServer}
                    className="mt-0.5 h-4 w-4 accent-[#8F1826]"
                  />

                  <div>
                    <label
                      htmlFor="ssh-remember-password"
                      className="text-sm text-[#EEE5E6]"
                    >
                      Remember securely
                    </label>

                    <p className="mt-1 text-xs text-[#6F5B5F]">
                      The password will be stored in the operating system's
                      secure credential storage.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="mt-6 flex items-center gap-3">
            <input
              id="ssh-favorite"
              type="checkbox"
              checked={favorite}
              onChange={(event) => setFavorite(event.target.checked)}
              disabled={isSavingServer}
              className="h-4 w-4 accent-[#8F1826]"
            />

            <label
              htmlFor="ssh-favorite"
              className="text-sm text-[#EEE5E6]"
            >
              Add to favorites
            </label>
          </div>

          <div className="mt-8 flex flex-wrap justify-end gap-3 border-t border-[#3B171D] pt-5">
            <button
              type="button"
              onClick={handleCancelAdd}
              disabled={isSavingServer}
              className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-[#EEE5E6] transition hover:border-[#542028] disabled:cursor-not-allowed disabled:opacity-50"
            >
              CANCEL
            </button>

            <button
              type="button"
              onClick={() => void handleAddServer()}
              disabled={isSavingServer}
              className="rounded-md bg-gradient-to-r from-[#6F111C] to-[#8F1826] px-5 py-2.5 text-xs font-medium tracking-[0.12em] text-[#EEE5E6] transition hover:from-[#8F1826] hover:to-[#B52636] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSavingServer ? 'SAVING...' : 'SAVE SERVER'}
            </button>
          </div>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-[#3B171D] px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-xs tracking-[0.18em] text-[#9D8589]">
                    SERVER LIBRARY
                  </p>

                  <p className="mt-1 text-xs text-[#6F5B5F]">
                    {servers.length} configured servers
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setEditingServerId(null);
                    resetForm();
                    setIsAddingServer(true);
                    }}
                  className="rounded-md border border-[#542028] bg-[#1D0D11] px-3 py-2 text-xs font-medium tracking-[0.12em] text-[#EEE5E6] transition hover:border-[#8F1826] hover:bg-[#261015]"
                >
                  + ADD
                </button>
              </div>
            </div>

            <div className="p-3">
              <input
                type="text"
                value={serverSearch}
                onChange={(event) => setServerSearch(event.target.value)}
                placeholder="Search servers..."
                className="mb-3 w-full rounded-md border border-[#3B171D] bg-[#100709] px-3 py-2.5 text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5B5F] focus:border-[#8F1826]"
              />

              <div className="relative mb-3">
                <button
                  type="button"
                  onClick={() => setIsGroupFilterOpen((open) => !open)}
                  className="flex w-full items-center justify-between rounded-md border border-[#3B171D] bg-[#100709] px-3 py-2.5 text-sm text-[#EEE5E6] transition hover:border-[#542028] focus:border-[#8F1826] focus:outline-none"
                  aria-haspopup="listbox"
                  aria-expanded={isGroupFilterOpen}
                >
                  <span>
                    {serverGroupFilter || 'All groups'}
                  </span>

                  <span className="ml-3 text-xs text-[#9D8589]">
                    {isGroupFilterOpen ? '▲' : '▼'}
                  </span>
                </button>

                {isGroupFilterOpen && (
                  <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border border-[#3B171D] bg-[#100709] shadow-lg">
                    <button
                      type="button"
                      onClick={() => {
                        setServerGroupFilter('');
                        setIsGroupFilterOpen(false);
                      }}
                      className={`block w-full px-3 py-2.5 text-left text-sm transition hover:bg-[#1D0D11] ${
                        serverGroupFilter === ''
                          ? 'bg-[#1D0D11] text-[#B52636]'
                          : 'text-[#EEE5E6]'
                      }`}
                    >
                      All groups
                    </button>

                    {Array.from(
                      new Set(
                        servers
                          .map((server) => server.group?.trim())
                          .filter(
                            (group): group is string => Boolean(group),
                          ),
                      ),
                    )
                      .sort((a, b) => a.localeCompare(b))
                      .map((groupName) => (
                        <button
                          key={groupName}
                          type="button"
                          onClick={() => {
                            setServerGroupFilter(groupName);
                            setIsGroupFilterOpen(false);
                          }}
                          className={`block w-full px-3 py-2.5 text-left text-sm transition hover:bg-[#1D0D11] ${
                            serverGroupFilter === groupName
                              ? 'bg-[#1D0D11] text-[#B52636]'
                              : 'text-[#EEE5E6]'
                          }`}
                        >
                          {groupName}
                        </button>
                      ))}
                  </div>
                )}
              </div>

              {filteredServers.length === 0 ? (
                <div className="rounded-md border border-dashed border-[#3B171D] px-4 py-6 text-center text-xs text-[#6F5B5F]">
                  No servers match your search.
                </div>
              ) : (
                filteredServers.map((server) => {
                  const isSelected = server.id === selectedServerId;

                  return (
                    <button
                      key={server.id}
                      type="button"
                      onClick={() => setSelectedServerId(server.id)}
                      className={`mb-2 w-full rounded-md border px-4 py-3 text-left transition ${
                        isSelected
                          ? 'border-[#8F1826] bg-[#1D0D11]'
                          : 'border-transparent bg-transparent hover:border-[#3B171D] hover:bg-[#170A0D]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleToggleFavorite(server);
                              }}
                              aria-label={
                                server.favorite
                                  ? `Remove ${server.name} from favorites`
                                  : `Add ${server.name} to favorites`
                              }
                              className="shrink-0 text-sm text-[#B52636] transition hover:scale-110"
                            >
                              {server.favorite ? '★' : '☆'}
                            </button>

                            <span className="truncate text-sm font-medium text-[#EEE5E6]">
                              {server.name}
                            </span>
                          </div>

                          <p className="mt-1 truncate font-mono text-xs text-[#9D8589]">
                            {server.username}@{server.host}:{server.port}
                          </p>
                        </div>

                        <span
                          className={[
                            'mt-1 h-2 w-2 shrink-0 rounded-full',
                            isServerConnected(server.id)
                              ? 'bg-[#8DBB9D]'
                              : 'bg-[#6F5B5F]',
                          ].join(' ')}
                          title={
                            isServerConnected(server.id)
                              ? 'Connected'
                              : 'Disconnected'
                          }
                        />
                        
                      </div>

                      {server.group && (
                        <div className="mt-3 text-[10px] tracking-[0.14em] text-[#6F5B5F]">
                          {server.group.toUpperCase()}
                        </div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </Card>

          <Card>
            {selectedServer ? (
              <div>
                <div className="flex flex-col justify-between gap-4 border-b border-[#3B171D] pb-5 sm:flex-row sm:items-start">
                  <div>
                    
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <span
                          className={[
                            'h-2.5 w-2.5 rounded-full',
                            selectedServerIsConnected
                              ? 'bg-[#8DBB9D]'
                              : 'bg-[#6F5B5F]',
                          ].join(' ')}
                          title={
                            selectedServerIsConnected
                              ? 'Connected'
                              : 'Disconnected'
                          }
                        />

                        <h2 className="text-xl font-semibold text-[#EEE5E6]">
                          {selectedServer.name}
                        </h2>
                      </div>

                    </div>

                    <p className="mt-2 font-mono text-sm text-[#9D8589]">
                      {selectedServer.username}@{selectedServer.host}:
                      {selectedServer.port}
                    </p>
                  </div>

                 <div className="flex flex-wrap gap-2">
                    {selectedServerIsConnected ? (
                      <button
                        type="button"
                        onClick={() => void handleDisconnectSelectedServer()}
                        className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-2.5 text-xs font-medium tracking-[0.12em] text-[#EEE5E6] transition hover:border-[#542028]"
                      >
                        DISCONNECT
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleConnect()}
                        className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-2.5 text-xs font-medium tracking-[0.12em] text-[#EEE5E6] transition hover:border-[#542028]"
                      >
                        CONNECT
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={startEditingServer}
                      className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-2.5 text-xs font-medium tracking-[0.12em] text-[#EEE5E6] transition hover:border-[#542028]"
                    >
                      EDIT SERVER
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleDeleteServer()}
                      className="rounded-md border border-[#3B171D] bg-[#1D0D11] px-4 py-2.5 text-xs font-medium tracking-[0.12em] text-[#EEE5E6] transition hover:border-[#542028]"
                    >
                      DELETE SERVER
                    </button>
                  </div>
                </div>

                {sshSessionTabs.length > 0 && (
                  <div className="mt-4 flex items-center gap-2 overflow-x-auto border-b border-[#3B171D] pb-2">
                    {sshSessionTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => {
                          setActiveSshSessionTabId(tab.id);
                          setSshSessionId(tab.sessionId);
                          setSshOutput(sshSessionOutputs[tab.sessionId] ?? '');
                        }}
                        className={[
                          'flex shrink-0 items-center gap-2 rounded-md border px-3 py-2 text-xs transition',
                          activeSshSessionTabId === tab.id
                            ? 'border-[#8F1826] bg-[#1D0D11] text-[#EEE5E6]'
                            : 'border-[#3B171D] bg-[#170A0D] text-[#9D8589] hover:border-[#542028] hover:text-[#EEE5E6]',
                        ].join(' ')}
                      >
                        <span
                          className={[
                            'h-2 w-2 rounded-full',
                            activeSshSessionTabId === tab.id
                              ? 'bg-[#8DBB9D]'
                              : 'bg-[#6F111C]',
                          ].join(' ')}
                        />

                        <span>{tab.serverName}</span>

                        <span className="font-mono text-[10px] text-[#9D8589]">
                          {tab.sessionId.slice(0, 6)}
                        </span>

                        <span
                          role="button"
                          tabIndex={0}
                          aria-label={`Close ${tab.serverName} SSH session`}
                          className="ml-1 rounded px-1 text-[#9D8589] transition hover:bg-[#3B171D] hover:text-[#D45767]"
                          onClick={(event) => {
                            event.stopPropagation();
                            void closeSshSession(tab.sessionId);
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              event.currentTarget.click();
                            }
                          }}
                        >
                          ×
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                {sshSessionId && (
                  <div className="mt-4 overflow-hidden rounded-lg border border-[#3B171D] bg-[#0B0507]">
                    <div className="flex items-center justify-between border-b border-[#3B171D] bg-[#170A0D] px-4 py-2">
                      <div className="flex items-center gap-2">
                        <span className="h-2 w-2 rounded-full bg-[#8DBB9D]" />

                        <span className="text-xs font-medium tracking-[0.12em] text-[#EEE5E6]">
                          SSH TERMINAL
                        </span>
                      </div>

                      <span className="font-mono text-[10px] text-[#9D8589]">
                        {sshSessionId.slice(0, 8)}
                      </span>
                    </div>
                  
                    {selectedServerIsConnected && (
                      <div className="mb-4 flex gap-2 border-b border-[#3B171D] pb-3">
                        <button
                          type="button"
                          onClick={() => setActiveSessionView('terminal')}
                          className={`rounded-md px-4 py-2 text-xs font-medium tracking-[0.12em] transition ${
                            activeSessionView === 'terminal'
                              ? 'bg-[#3B171D] text-[#EEE5E6]'
                              : 'text-[#6F5B5F] hover:text-[#EEE5E6]'
                          }`}
                        >
                          SSH
                        </button>

                        <button
                          type="button"
                          onClick={() => setActiveSessionView('sftp')}
                          className={`rounded-md px-4 py-2 text-xs font-medium tracking-[0.12em] transition ${
                            activeSessionView === 'sftp'
                              ? 'bg-[#3B171D] text-[#EEE5E6]'
                              : 'text-[#6F5B5F] hover:text-[#EEE5E6]'
                          }`}
                        >
                          SFTP
                        </button>
                      </div>
                    )}

                    {activeSessionView === 'terminal' && (
                    <SshTerminal
                      sessionId={sshSessionId}
                      output={sshOutput}
                    />
                    )}

                    {activeSessionView === 'sftp' && (
                      <div className="rounded-lg border border-[#3B171D] bg-[#14090C]">
                        <div className="border-b border-[#3B171D] px-4 py-3">
                          <p className="text-xs tracking-[0.15em] text-[#9D8589]">
                            SFTP
                          </p>

                          <div className="mt-2 flex flex-wrap items-center gap-1 font-mono text-sm">
                            <button
                              type="button"
                              onClick={() => void loadSftpDirectory('/')}
                              className="rounded px-1.5 py-1 text-[#9D8589] transition hover:bg-[#1D0D11] hover:text-[#EEE5E6]"
                            >
                              /
                            </button>

                            {sftpPathSegments.map((segment, index) => {
                              const segmentPath = `/${sftpPathSegments
                                .slice(0, index + 1)
                                .join('/')}`;

                              const isCurrent = index === sftpPathSegments.length - 1;

                              return (
                                <div
                                  key={segmentPath}
                                  className="flex items-center gap-1"
                                >
                                  <span className="text-[#4F3035]">›</span>

                                  <button
                                    type="button"
                                    onClick={() => void loadSftpDirectory(segmentPath)}
                                    disabled={isCurrent || isLoadingSftp}
                                    className={`rounded px-1.5 py-1 transition ${
                                      isCurrent
                                        ? 'cursor-default text-[#EEE5E6]'
                                        : 'text-[#9D8589] hover:bg-[#1D0D11] hover:text-[#EEE5E6]'
                                    }`}
                                  >
                                    {segment}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>

                        <div className="mt-3 flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              if (sftpCurrentPath === '/') return;

                              const lastSlash = sftpCurrentPath.lastIndexOf('/');
                              const parentPath =
                                lastSlash <= 0 ? '/' : sftpCurrentPath.slice(0, lastSlash);

                              void loadSftpDirectory(parentPath);
                            }}
                            disabled={sftpCurrentPath === '/' || isLoadingSftp}
                            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#3B171D] bg-[#160B0E] px-3 py-2 text-xs font-medium text-[#C7B3B7] transition-all duration-200 hover:border-[#71303B] hover:bg-[#271116] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#994452] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <span aria-hidden="true">←</span>
                            Back
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              setNewDirectoryName('');
                              setError('');
                              setIsCreateDirectoryOpen(true);
                            }}
                            disabled={isLoadingSftp || isCreatingDirectory}
                            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#3B171D] bg-[#160B0E] px-3 py-2 text-xs font-medium text-[#EEE5E6] transition-all duration-200 hover:border-[#71303B] hover:bg-[#271116] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#994452] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <span className="text-base leading-none" aria-hidden="true">📂</span>
                            New directory
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              void uploadMultipleSftpFiles();
                            }}
                            disabled={isLoadingSftp || isUploadingFile}
                            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#3B171D] bg-[#160B0E] px-3 py-2 text-xs font-medium text-[#EEE5E6] transition-all duration-200 hover:border-[#71303B] hover:bg-[#271116] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#994452] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <span className="text-base leading-none" aria-hidden="true">📄</span>
                            Upload files
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              void uploadSftpFolder();
                            }}
                            disabled={isLoadingSftp || isUploadingFile}
                            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#3B171D] bg-[#160B0E] px-3 py-2 text-xs font-medium text-[#EEE5E6] transition-all duration-200 hover:border-[#71303B] hover:bg-[#271116] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#994452] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <span className="text-base leading-none" aria-hidden="true">📁</span>
                            Upload folder
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              void deleteSelectedSftpEntries();
                            }}
                            disabled={
                              isLoadingSftp ||
                              isUploadingFile ||
                              selectedSftpEntries.length === 0
                            }
                            className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-[#71303B] bg-[#271116] px-3 py-2 text-xs font-medium text-[#E8A0A8] transition-all duration-200 hover:border-[#994452] hover:bg-[#35131B] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#994452] disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <span aria-hidden="true">🗑️</span>
                            Delete selected
                          </button>

                        </div>

                        {isCreateDirectoryOpen && (
                          <div className="mt-3 rounded-lg border border-[#3B171D] bg-[#1A0B0F] p-3">
                            <div className="text-xs font-medium text-[#EEE5E6]">
                              New directory
                            </div>

                            <div className="mt-2 flex items-center gap-2">
                              <input
                                type="text"
                                value={newDirectoryName}
                                onChange={(event) =>
                                  setNewDirectoryName(event.target.value)
                                }
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter') {
                                    void createSftpDirectory();
                                  }

                                  if (event.key === 'Escape') {
                                    setIsCreateDirectoryOpen(false);
                                  }
                                }}
                                placeholder="Nom du dossier"
                                autoFocus
                                disabled={isCreatingDirectory}
                                className="min-w-0 flex-1 rounded-md border border-[#3B171D] bg-[#100609] px-3 py-2 text-sm text-[#EEE5E6] outline-none placeholder:text-[#6F5559] focus:border-[#6A2A34] disabled:opacity-50"
                              />

                              <button
                                type="button"
                                onClick={() => void createSftpDirectory()}
                                disabled={
                                  isCreatingDirectory ||
                                  !newDirectoryName.trim()
                                }
                                className="rounded-md border border-[#3B171D] px-3 py-2 text-xs text-[#EEE5E6] transition hover:bg-[#261016] disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                {isCreatingDirectory ? 'Création…' : 'Créer'}
                              </button>

                              <button
                                type="button"
                                onClick={() => setIsCreateDirectoryOpen(false)}
                                disabled={isCreatingDirectory}
                                className="rounded-md px-2 py-2 text-xs text-[#9D8589] transition hover:bg-[#1D0D11] hover:text-[#EEE5E6]"
                              >
                                Annuler
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="flex items-center justify-between border-b border-[#2A1115] px-4 py-3">
                          <label className="flex cursor-pointer items-center gap-2 text-sm text-[#C8B8BB]">
                            <input
                              type="checkbox"
                              checked={
                                sftpEntries.length > 0 &&
                                sftpEntries.every((entry) =>
                                  selectedSftpEntries.includes(entry.name)
                                )
                              }
                              onChange={toggleSelectAllSftpEntries}
                              className="h-4 w-4 cursor-pointer accent-[#A34A5A]"
                            />

                            Select all
                          </label>

                          <div className="flex items-center gap-3">
                            <span className="text-xs text-[#C8B8BB]">
                              {selectedSftpEntries.length} sélectionné(s)
                            </span>

                            <button
                              type="button"
                              onClick={() => void downloadSelectedSftpEntries()}
                              disabled={selectedSftpEntries.length === 0}
                              className="inline-flex items-center gap-2 rounded-lg border border-[#71303B] bg-gradient-to-b from-[#59212D] to-[#35131B] px-3 py-2 text-xs font-semibold text-white transition-all duration-200 hover:border-[#994452] hover:from-[#71303B] hover:to-[#481923] disabled:cursor-not-allowed disabled:opacity-40"
                              title="Télécharger les éléments sélectionnés"
                            >
                              <span aria-hidden="true">↓</span>
                              Download selection
                            </button>
                          </div>
                        </div>

                        {sftpTransferProgress && (
                          <div className="border-b border-[#2A1115] bg-[#160B0E] px-4 py-3">
                            <div className="mb-2 flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-[#EEE5E6]">
                                  {sftpTransferCancelled
                                    ? 'Download cancelled'
                                    : sftpTransferProgress.completed
                                      ? 'Download is complete'
                                      : 'Download in progress'}
                                </p>

                                {sftpTransferProgress.fileName && (
                                  <p className="truncate text-xs text-[#C8B8BB]">
                                    {sftpTransferProgress.fileName}
                                  </p>
                                )}
                              </div>

                              <div className="flex shrink-0 items-center gap-3">
                                <span className="text-sm font-semibold text-[#EEE5E6]">
                                  {sftpTransferProgress.totalBytes > 0
                                    ? `${Math.min(
                                        100,
                                        Math.round(
                                          (sftpTransferProgress.transferredBytes /
                                            sftpTransferProgress.totalBytes) *
                                            100
                                        )
                                      )}%`
                                    : sftpTransferProgress.completed
                                      ? '100%'
                                      : 'Calcul…'}
                                </span>

                                {!sftpTransferProgress.completed && !sftpTransferCancelled && (
                                  <button
                                    type="button"
                                    onClick={() => void cancelSftpTransfer()}
                                    className="rounded-md border border-[#71303B] px-3 py-1 text-xs font-medium text-[#EEE5E6] transition-colors hover:bg-[#3B171D] focus:outline-none focus:ring-2 focus:ring-[#A34A5A]"
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </div>
                            <div
                              className="h-2 overflow-hidden rounded-full bg-[#2A1115]"
                              role="progressbar"
                              aria-label="Progression du téléchargement"
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-valuenow={
                                sftpTransferProgress.totalBytes > 0
                                  ? Math.min(
                                      100,
                                      Math.round(
                                        (sftpTransferProgress.transferredBytes /
                                          sftpTransferProgress.totalBytes) *
                                          100
                                      )
                                    )
                                  : 0
                              }
                            >
                              <div
                                className="h-full rounded-full bg-gradient-to-r from-[#71303B] to-[#A34A5A] transition-all duration-150"
                                style={{
                                  width: `${
                                    sftpTransferProgress.totalBytes > 0
                                      ? Math.min(
                                          100,
                                          (sftpTransferProgress.transferredBytes /
                                            sftpTransferProgress.totalBytes) *
                                            100
                                        )
                                      : sftpTransferProgress.completed
                                        ? 100
                                        : 0
                                  }%`,
                                }}
                              />
                            </div>

                            <p className="mt-1 text-xs text-[#C8B8BB]">
                              {(sftpTransferProgress.transferredBytes / (1024 * 1024)).toFixed(2)} Mo
                              {' / '}
                              {(sftpTransferProgress.totalBytes / (1024 * 1024)).toFixed(2)} Mo
                            </p>
                          </div>
                        )}

                        <div className="divide-y divide-[#2A1115]">
                          {sftpEntries.map((entry) => (
                            <div
                              key={`${entry.entry_type}-${entry.name}`}
                              role={entry.entry_type === 'directory' ? 'button' : undefined}
                              tabIndex={entry.entry_type === 'directory' ? 0 : undefined}
                              onClick={() => {
                                if (entry.entry_type !== 'directory') {
                                  return;
                                }

                                const nextPath =
                                  sftpCurrentPath === '/'
                                    ? `/${entry.name}`
                                    : `${sftpCurrentPath.replace(/\/$/, '')}/${entry.name}`;

                                void loadSftpDirectory(nextPath);
                              }}
                              onKeyDown={(event) => {
                                if (
                                  entry.entry_type === 'directory' &&
                                  (event.key === 'Enter' || event.key === ' ')
                                ) {
                                  event.preventDefault();

                                  const nextPath =
                                    sftpCurrentPath === '/'
                                      ? `/${entry.name}`
                                      : `${sftpCurrentPath.replace(/\/$/, '')}/${entry.name}`;

                                  void loadSftpDirectory(nextPath);
                                }
                              }}
                              className={`flex items-center justify-between gap-3 px-4 py-3 ${
                                entry.entry_type === 'directory'
                                  ? 'cursor-pointer transition hover:bg-[#1D0D11]'
                                  : 'transition hover:bg-[#160B0E]'
                              }`}
                            >
                              <div className="flex min-w-0 items-center gap-3">
                                <input
                                  type="checkbox"
                                  checked={selectedSftpEntries.includes(entry.name)}
                                  onChange={() => toggleSftpEntrySelection(entry.name)}
                                  onClick={(event) => event.stopPropagation()}
                                  className="h-4 w-4 shrink-0 cursor-pointer accent-[#A34A5A]"
                                  aria-label={`Sélectionner ${entry.name}`}
                                />

                                <span className="shrink-0 text-lg" aria-hidden="true">
                                  {entry.entry_type === 'directory' ? '📁' : '📄'}
                                </span>

                                <span className="truncate font-mono text-sm text-[#EEE5E6]">
                                  {entry.name}
                                </span>
                              </div>

                              <div className="flex shrink-0 items-center gap-3">
                                <span className="text-xs text-[#6F5B5F]">
                                  {entry.entry_type === 'directory' ? 'Dossier' : 'Fichier'}
                                </span>

                                {entry.entry_type !== 'directory' && (
                                  <button
                                    type="button"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      console.log('[SFTP] Bouton Télécharger cliqué :', entry.name);
                                      void downloadSftpFile(entry.name);
                                    }}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-[#71303B] bg-gradient-to-b from-[#59212D] to-[#35131B] px-3 py-1.5 text-xs font-semibold text-white transition-all duration-200 hover:border-[#994452] hover:from-[#71303B] hover:to-[#481923] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#C05A6A] disabled:cursor-not-allowed disabled:opacity-40"
                                    title={`Télécharger ${entry.name}`}
                                    aria-label={`Télécharger ${entry.name}`}
                                  >
                                    <span aria-hidden="true">↓</span>
                                    Télécharger
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>

                        </div>
                    )}

                  </div>
                )}

                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-md border border-[#3B171D] bg-[#1D0D11] p-4">
                    <p className="text-[10px] tracking-[0.16em] text-[#6F5B5F]">
                      HOST
                    </p>

                    <p className="mt-2 font-mono text-sm text-[#EEE5E6]">
                      {selectedServer.host}
                    </p>
                  </div>

                  <div className="rounded-md border border-[#3B171D] bg-[#1D0D11] p-4">
                    <p className="text-[10px] tracking-[0.16em] text-[#6F5B5F]">
                      PORT
                    </p>

                    <p className="mt-2 font-mono text-sm text-[#EEE5E6]">
                      {selectedServer.port}
                    </p>
                  </div>

                  <div className="rounded-md border border-[#3B171D] bg-[#1D0D11] p-4">
                    <p className="text-[10px] tracking-[0.16em] text-[#6F5B5F]">
                      USERNAME
                    </p>

                    <p className="mt-2 font-mono text-sm text-[#EEE5E6]">
                      {selectedServer.username}
                    </p>
                  </div>

                  <div className="rounded-md border border-[#3B171D] bg-[#1D0D11] p-4">
                    <p className="text-[10px] tracking-[0.16em] text-[#6F5B5F]">
                      AUTHENTICATION
                    </p>

                    <p className="mt-2 text-sm text-[#EEE5E6]">
                      {selectedServer.authenticationMethod === 'ssh-agent'
                        ? 'SSH Agent'
                        : selectedServer.authenticationMethod === 'private-key'
                          ? 'Private Key'
                          : 'Password'}
                    </p>
                  </div>
                </div>

                <div className="mt-6 rounded-md border border-[#3B171D] bg-[#170A0D] p-5">
                  <div className="flex items-center gap-3">
                    <span className="text-[#8F1826]">✦</span>

                    <div>
                      <p className="text-sm font-medium text-[#EEE5E6]">
                        Connection status
                      </p>

                      <p className="mt-1 text-xs text-[#6F5B5F]">
                        No active SSH session.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex min-h-[420px] items-center justify-center text-center">
                <div>
                  <div className="text-2xl text-[#542028]">✦</div>

                  <p className="mt-3 text-sm text-[#9D8589]">
                    Select a server to view its details.
                  </p>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      <p className="font-mono text-[10px] tracking-[0.18em] text-[#542028]">
        // SYSTEMS BEYOND THE SURFACE
      </p>
    </div>
  );
}