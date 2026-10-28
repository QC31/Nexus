# Build and Packaging Guide

This document describes how to build NEXUS and prepare desktop packages.

NEXUS uses Tauri 2, Vite, TypeScript, Rust, and Cargo.

## 1. Prerequisites

Before building, ensure that the following tools are installed:

- Node.js.
- pnpm.
- Rust and Cargo.
- Platform-specific Tauri build dependencies.

See [INSTALLATION.md](INSTALLATION.md) and the official Tauri prerequisites documentation:

https://v2.tauri.app/start/prerequisites/

## 2. Install Dependencies

From the desktop application directory:

```bash
pnpm install
```

## 3. Build the Frontend

Run:

```bash
pnpm build
```

This executes the configured TypeScript and Vite production build.

A successful frontend build does not verify the Rust backend or guarantee that the complete desktop application will run correctly.

## 4. Check the Rust Backend

Run:

```bash
cargo check --manifest-path src-tauri/Cargo.toml
```

Review compiler output for errors and warnings.

Warnings should be assessed before a public release, even when they do not prevent compilation.

## 5. Run the Application in Development

Run:

```bash
pnpm tauri dev
```

This launches the desktop application using the development configuration.

## 6. Build the Desktop Application

Run:

```bash
pnpm tauri build
```

Tauri uses the settings in `src-tauri/tauri.conf.json` to build the application and generate the configured bundles supported by the current build environment.

The required native toolchain and dependencies depend on the target operating system.

## 7. Linux Builds

Build on a supported Linux environment with the Tauri system dependencies installed.

After building:

- Install or launch the generated package using the appropriate method.
- Verify application startup.
- Test SSH authentication and session management.
- Test SFTP file browsing and transfers.
- Verify that application settings persist.
- Check filesystem permissions and database initialization.

The available package formats depend on the build configuration and installed system tools.

## 8. Windows Builds

Windows builds should be performed on a supported Windows environment.

Install the prerequisites required by Tauri 2, including the appropriate Microsoft C++ build tools and WebView2 components.

After installing dependencies:

```powershell
pnpm install
pnpm tauri build
```

Verify the generated installer or application package.

For the current Windows build (`0.1.0`), the generated files are:

- **MSI installer:** `src-tauri/target/release/bundle/msi/nexus_0.1.0_x64_en-US.msi`
- **NSIS installer:** `src-tauri/target/release/bundle/nsis/nexus_0.1.0_x64-setup.exe`
- **Application executable:** `src-tauri/target/release/nexus.exe`

These paths are relative to the `apps/desktop/` directory. File names may change when the application version or bundle configuration changes.

Functional testing should include:

- Application startup and shutdown.
- SSH connections using supported authentication methods.
- SSH agent behavior.
- SFTP uploads and downloads.
- Remote file operations.
- Settings persistence.
- Application data paths and filesystem permissions.

Do not declare Windows compatibility based on compilation alone.

## 9. macOS Builds

Build on a supported macOS environment with the required Xcode and Rust toolchains installed.

Run:

```bash
pnpm install
pnpm tauri build
```

Validate the resulting application bundle and any generated distribution package.

Before public distribution, evaluate code signing, notarization, and architecture requirements.

## 10. Cross-Platform Validation

Build and test each target operating system independently.

A successful build on one platform does not establish compatibility with another.

Maintain a record of:

- Operating system and version.
- Architecture.
- Build result.
- Generated package format.
- Functional test results.
- Known issues.

## 11. Release Preparation

Before creating a public release:

1. Verify the intended source revision.
2. Run the frontend build.
3. Check the Rust backend.
4. Build the application on the target operating system.
5. Complete the functional test checklist.
6. Review security-sensitive changes.
7. Verify that no credentials or private keys are included.
8. Record known limitations.
9. Prepare release notes.
10. Publish only the packages that have been built and appropriately tested.