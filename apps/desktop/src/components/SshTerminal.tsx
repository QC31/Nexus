import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

interface SshTerminalProps {
  sessionId: string;
  output: string;
}

export function SshTerminal({
  sessionId,
  output,
}: SshTerminalProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const outputInitializedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'JetBrains Mono, Fira Code, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.15,
      theme: {
        background: '#0B0507',
        foreground: '#EEE5E6',
        cursor: '#B52636',
        selectionBackground: '#542028',
      },
      scrollback: 5000,
      convertEol: true,
    });

    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    const xtermElement = containerRef.current.querySelector('.xterm');

    if (xtermElement instanceof HTMLElement) {
      xtermElement.style.height = '100%';
      xtermElement.style.width = '100%';
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    outputInitializedRef.current = false;

    const inputDisposable = terminal.onData((data) => {
      void invoke('ssh_write', {
        sessionId,
        data,
      }).catch((error) => {
        console.error('Failed to write to SSH session:', error);
      });
    });

    let unlisten: (() => void) | undefined;
    let unlistenClosed: (() => void) | undefined;

    const subscribeToOutput = async () => {
      try {
        unlisten = await listen<string>(
          `ssh-output-${sessionId}`,
          (event) => {
            terminal.write(event.payload);
          },
        );

        unlistenClosed = await listen(
          `ssh-session-closed-${sessionId}`,
          () => {
            terminal.write(
              '\r\n\r\n\x1b[31m[ SSH CONNECTION CLOSED ]\x1b[0m\r\n',
            );
          },
        );

        const existingOutput = await invoke<string>('ssh_get_output', {
          sessionId,
        });

        if (existingOutput && !outputInitializedRef.current) {
          terminal.write(existingOutput);
          outputInitializedRef.current = true;
        }
      } catch (error) {
        console.error(
          'Failed to subscribe to SSH output:',
          error,
        );
      }
    };

    void subscribeToOutput();

    requestAnimationFrame(() => {
    resizeTerminal();
});

    const resizeTerminal = () => {

    fitAddon.fit();

  void invoke('ssh_resize', {
    sessionId,
    cols: terminal.cols,
    rows: terminal.rows,
  }).catch((error) => {
    console.error(
      'Failed to resize SSH terminal:',
      error,
    );
  });
};

const handleResize = () => {
  resizeTerminal();
};

const resizeObserver = new ResizeObserver(() => {
  requestAnimationFrame(() => {
    resizeTerminal();
  });
});

resizeObserver.observe(containerRef.current);
window.addEventListener('resize', handleResize);

    return () => {
      unlisten?.();
      unlistenClosed?.();

      resizeObserver.disconnect();
      window.removeEventListener('resize', handleResize);

      inputDisposable.dispose();
      terminal.dispose();

      terminalRef.current = null;
      fitAddonRef.current = null;
      outputInitializedRef.current = false;
    };
  }, [sessionId]);

  useEffect(() => {
    if (!output) {
      return;
    }

    const terminal = terminalRef.current;

    if (!terminal || outputInitializedRef.current) {
      return;
    }

    terminal.write(output);
    outputInitializedRef.current = true;
  }, [output]);

  return (
    <div className="h-[420px] max-h-[620px] w-full overflow-hidden p-3">
      <div
        ref={containerRef}
        className="h-full w-full overflow-hidden"
      />
    </div>
  );
}