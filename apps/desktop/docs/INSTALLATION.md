# Installation Guide

This document describes how to prepare a development environment for NEXUS.

NEXUS is a desktop application built with Tauri 2, React, TypeScript, and Rust.

## 1. Prerequisites

Before starting, install the following tools:

- Git
- Node.js
- pnpm
- Rust and Cargo
- Platform-specific Tauri dependencies

### Node.js and pnpm

Install a supported Node.js version and enable pnpm.

Verify the installation:

```bash
node --version
pnpm --version
```

### Rust and Cargo

Install Rust using the official Rust installation instructions.

Verify the installation:

```bash
rustc --version
cargo --version
```

### Tauri dependencies

Tauri requires additional system libraries and build tools. These depend on the target operating system.

Refer to the official Tauri prerequisites guide:

https://v2.tauri.app/start/prerequisites/

## 2. Linux Development Environment

On Debian- or Ubuntu-based systems, install the system dependencies required by Tauri.

Consult the official Tauri documentation for the package names appropriate to your distribution and Tauri version.

A typical development environment also requires a C/C++ toolchain and the WebKitGTK development libraries.

After installing the prerequisites, verify that Rust and Node.js are available in your terminal.

## 3. Get the Source Code

Clone the repository:

```bash
git clone <repository-url>
```

Replace `<repository-url>` with the actual Git repository URL.

Enter the desktop application directory:

```bash
cd Nexus/apps/desktop
```

The exact path depends on where the repository was cloned.

## 4. Install JavaScript Dependencies

From the desktop application directory, run:

```bash
pnpm install
```

This installs the JavaScript and TypeScript dependencies declared by the project and its workspace configuration.

## 5. Run the Frontend Development Server

To run the Vite development server:

```bash
pnpm dev
```

This starts the frontend development server.

Stop the server with `Ctrl+C` when finished.

## 6. Run the Tauri Application

To launch the complete desktop application in development mode:

```bash
pnpm tauri dev
```

Tauri will use the development command configured in `src-tauri/tauri.conf.json`.

## 7. Verify the Build

Build the frontend:

```bash
pnpm build
```

Check the Rust backend:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Both commands should complete successfully before proceeding to packaging.

## 8. Troubleshooting

### Missing system dependencies

Check the official Tauri prerequisites for your operating system and install any missing libraries or build tools.

### Rust compilation errors

Verify the installed Rust toolchain:

```bash
rustc --version
cargo --version
```

Review the complete compiler output to identify missing dependencies or source errors.

### Frontend build errors

Verify the installed Node.js and pnpm versions, then install dependencies again if necessary:

```bash
pnpm install
pnpm build
```

### Application starts but does not connect to an SSH server

Check the SSH server address, port, username, authentication method, network connectivity, and server host key.

Consult the application logs and terminal output for additional information.

## 9. Platform Compatibility

The development environment described here does not guarantee that NEXUS works on every operating system.

Linux, Windows, and macOS must be built and tested separately. Refer to the build guide for packaging information.

## References

- Tauri prerequisites: https://v2.tauri.app/start/prerequisites/
- Rust installation: https://www.rust-lang.org/tools/install
- Node.js: https://nodejs.org/
- pnpm: https://pnpm.io/