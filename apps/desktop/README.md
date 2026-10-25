# NEXUS

**Network Operations Suite**

NEXUS is a desktop application designed to bring network utilities, SSH connection management, SFTP file transfers, and SSH key management together in a single interface.

Built with Tauri 2, React, TypeScript, and Rust, NEXUS combines a modern desktop interface with native system integration.

> **Project status:** Early development — version 0.1.0. Features and platform compatibility are still being validated.

## Features

### Dashboard
- Overview of configured SSH hosts.
- Active SSH session count.
- Connection status overview.
- Local SSH agent availability.

### SSH Manager
- Manage configured SSH servers.
- Establish SSH connections.
- Manage active SSH sessions.
- Browse remote files through SFTP.
- Upload and download files.
- Support recursive transfers for directories.
- Monitor transfer progress and cancel supported transfers.

### SSH Key Management
- Access SSH key management functionality.
- Manage SSH authentication-related resources.

### Network Toolbox
- Access network utility tools from the application.

### IP Calculator
- Access IP addressing and subnet calculation tools.

### Settings
- Configure application preferences.
- Store settings in a local SQLite database.
- Configure the default SSH port and connection timeout values.
- View local SSH agent availability.

Some settings are currently stored but may not yet affect the corresponding SSH operations.

## Technology Stack

| Component | Technology |
|---|---|
| Desktop framework | Tauri 2 |
| Frontend | React 19 |
| Language | TypeScript |
| Frontend build tool | Vite |
| Styling | Tailwind CSS 4 |
| Backend | Rust |
| Database | SQLite |
| Routing | React Router |
| Terminal component | xterm.js |

## Project Structure

apps/desktop/
├── src/
│   ├── components/
│   │   ├── layout/
│   │   ├── ui/
│   │   └── SshTerminal.tsx
│   ├── contexts/
│   │   └── SshSessionsContext.tsx
│   ├── pages/
│   │   ├── DashboardPage.tsx
│   │   ├── IpCalculatorPage.tsx
│   │   ├── KeyManagerPage.tsx
│   │   ├── NetToolBoxPage.tsx
│   │   ├── SettingsPage.tsx
│   │   └── SshManagerPage.tsx
│   ├── types/
│   ├── App.tsx
│   └── router.tsx
├── src-tauri/
│   └── src/
│       ├── lib.rs
│       ├── main.rs
│       └── ssh_auth.rs
├── docs/
├── package.json
└── README.md
```

## Requirements

The development environment requires:

- Node.js and pnpm.
- Rust and Cargo.
- The platform-specific prerequisites for Tauri 2.
- Git.

Additional platform dependencies may be required to build and package the application.

See [Installation](docs/INSTALLATION.md) for setup instructions.

## Development

From the desktop application directory:

```bash
pnpm install
pnpm dev
```

To run the application through Tauri:

```bash
pnpm tauri dev
```

## Build

Build the frontend:

```bash
pnpm build
```

Check the Rust backend:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Build the desktop application using Tauri:

```bash
pnpm tauri build
```

See [Build and Packaging](docs/BUILD.md) for additional details.

## Documentation

- [Installation](docs/INSTALLATION.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Features and Limitations](docs/FEATURES.md)
- [Build and Packaging](docs/BUILD.md)

## Security

NEXUS interacts with SSH credentials, private keys, remote servers, and local application data.

When using the application:

- Protect private keys and their passphrases.
- Verify server host keys and fingerprints.
- Use trusted SSH servers.
- Do not commit credentials, private keys, local databases, or other sensitive information to version control.
- Review security-related changes before distributing a release.

The application is still under development. Its security properties and credential-handling behavior should be reviewed before production use.

## Platform Support

NEXUS is built with Tauri 2, which supports desktop application development for Linux, Windows, and macOS.

However, successful compilation and functional compatibility must be verified separately on each target operating system.

Platform-specific installation instructions and tested compatibility will be documented as validation progresses.

## Version

Current application version: `0.1.0`

## License

No license has been declared yet. The project's licensing terms will be added once a license has been selected.