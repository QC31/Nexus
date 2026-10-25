import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export interface SshActiveSession {
  id: string;
  serverId: string;
  serverName: string;
  sessionId: string;
}

interface SshSessionsContextValue {
  sessions: SshActiveSession[];
  setSessions: React.Dispatch<React.SetStateAction<SshActiveSession[]>>;
}

const SshSessionsContext = createContext<SshSessionsContextValue | null>(null);

export function SshSessionsProvider({ children }: { children: ReactNode }) {
  const [sessions, setSessions] = useState<SshActiveSession[]>([]);

  const value = useMemo(
    () => ({ sessions, setSessions }),
    [sessions],
  );

  return (
    <SshSessionsContext.Provider value={value}>
      {children}
    </SshSessionsContext.Provider>
  );
}

export function useSshSessions() {
  const context = useContext(SshSessionsContext);

  if (!context) {
    throw new Error(
      "useSshSessions must be used within a SshSessionsProvider",
    );
  }

  return context;
}