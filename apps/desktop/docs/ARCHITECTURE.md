# Architecture Overview

This document describes the main architectural components of NEXUS.

## 1. Overview

NEXUS is a desktop application built with:

- Tauri 2 for desktop integration.
- React for the user interface.
- TypeScript for frontend application logic.
- Vite for frontend development and production builds.
- Rust for native backend operations.
- SQLite for persistent application data.

The frontend communicates with the Rust backend through Tauri commands.

## 2. Frontend

The frontend source code is located in `src/`.

### Application entry points

- `src/main.tsx` initializes the frontend.
- `src/App.tsx` contains the main application component.
- `src/router.tsx` defines application routes.
- `src/index.css` and `src/App.css` contain global and application styles.

### Pages

The application currently contains the following pages:

| File | Purpose |
|---|---|
| `DashboardPage.tsx` | Overview of application and SSH status |
| `SshManagerPage.tsx` | SSH connection management and related operations |
| `KeyManagerPage.tsx` | SSH key management interface |
| `NetToolBoxPage.tsx` | Network utilities |
| `IpCalculatorPage.tsx` | IP addressing calculations |
| `SettingsPage.tsx` | Application preferences and status information |

### Components and state

Shared layout components are located in `src/components/layout/`.

Reusable UI components are located in `src/components/ui/`.

The SSH session context is implemented in:

`src/contexts/SshSessionsContext.tsx`

This context provides shared state for active SSH sessions to components within its provider.

SSH-related TypeScript types are located in `src/types/ssh.ts`.

## 3. Backend

The Rust source code is located in `src-tauri/src/`.

### Main files

| File | Purpose |
|---|---|
| `main.rs` | Native application entry point |
| `lib.rs` | Tauri application setup, commands, and database operations |
| `ssh_auth.rs` | SSH authentication-related functionality |

The backend exposes Tauri commands that the frontend can call through `@tauri-apps/api/core`.

The backend is responsible for native operations that should not be implemented solely in the web interface.

## 4. Persistent Storage

NEXUS uses SQLite for local application data.

The database is initialized by the Rust backend and stored in the application's data directory.

The database currently includes tables for:

- SSH server configuration.
- SSH connection history.
- Application settings.

The `app_settings` table stores key-value preferences.

Database access is performed by backend commands rather than directly by frontend components.

## 5. Application Settings

The Settings page retrieves saved settings through the `get_app_settings` command and persists individual values through `save_app_setting`.

Some settings may currently be stored without being applied to the corresponding SSH operations. Consult `FEATURES.md` for known limitations.

## 6. SSH Sessions

The frontend maintains shared active-session state through `SshSessionsContext`.

This state is used to expose session information to components such as the dashboard and SSH manager.

The context represents frontend session state; it should not be treated as a persistent record of live connections across application restarts.

## 7. Build Configuration

The Tauri configuration is stored in:

`src-tauri/tauri.conf.json`

The configuration defines the application identifier, version, frontend development command, build command, window defaults, and bundle settings.

The frontend is built using Vite and TypeScript.

The Rust backend is built using Cargo.

## 8. Security Considerations

SSH authentication, private key handling, server host key verification, filesystem access, and database storage are security-sensitive areas.

Changes to these components should be reviewed carefully.

Do not store private keys, passwords, or authentication tokens in source control.

## 9. Platform Considerations

Tauri provides platform-specific integration for desktop operating systems.

Native dependencies and packaging requirements differ between Linux, Windows, and macOS. Platform compatibility must be validated independently on each target.