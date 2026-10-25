# Features and Limitations

This document describes the current feature areas of NEXUS and identifies functionality that still requires validation.

NEXUS is currently at version `0.1.0` and remains under active development.

## 1. Dashboard

The dashboard provides an overview of the application's SSH configuration and status.

Current indicators include:

- Configured SSH host count.
- Active SSH session count.
- Connection status.
- Local SSH agent availability.

The dashboard uses backend data and shared frontend session state.

## 2. SSH Manager

The SSH manager provides an interface for managing SSH connections and interacting with remote systems.

Current functionality includes:

- SSH server configuration management.
- SSH connection workflows.
- Active session management.
- Remote file browsing through SFTP.
- File and directory uploads and downloads.
- Recursive transfers for directories.
- Transfer progress reporting.
- Cancellation support for applicable transfer operations.
- Remote file deletion functionality.

The exact behavior depends on the SSH server, authentication method, permissions, and network conditions.

## 3. SSH Key Management

NEXUS includes a dedicated SSH key management interface.

Authentication and private key operations are handled by the SSH-related backend functionality.

The complete set of key management operations and supported key formats should be validated during functional testing.

## 4. Network Toolbox

The application includes a Network Toolbox page for network-related utilities.

Individual tools and their expected behavior should be validated against the current implementation before being documented as supported features.

## 5. IP Calculator

The application includes an IP Calculator page for IP addressing calculations.

The calculation behavior should be verified with representative IPv4 and IPv6 inputs, as applicable to the implementation.

## 6. Settings

The Settings page is divided into four sections.

### General

- Displays the current interface theme.
- Stores the preference for confirmation before closing SSH sessions.

### Network

- Displays local SSH agent availability.
- Stores a default SSH port.
- Stores a connection timeout value.

### Security

- Displays local SSH agent availability.
- Stores the preference for confirmation before sensitive actions.
- Provides information about private key handling.

### About

- Displays application name, version, and technology information.

### Settings limitations

Settings are stored in the local SQLite database through the backend.

Persistence does not necessarily mean a setting is applied to the corresponding SSH operation. In particular, the default SSH port, connection timeout, and confirmation preferences require integration and functional verification before they can be considered fully operational.

## 7. Database

The application initializes a local SQLite database.

The current database includes tables for:

- SSH server configurations.
- SSH connection history.
- Application settings.

The database is managed by the Rust backend.

## 8. Known Limitations and Validation Required

The following areas require additional testing or implementation verification:

- Windows compatibility.
- macOS compatibility.
- Cross-platform SSH agent behavior.
- Platform-specific private key and filesystem handling.
- Application packaging and installation.
- Settings integration with actual SSH operations.
- Error handling under network interruptions.
- Security review before production distribution.

## 9. Release Status

NEXUS is not yet considered a production-ready release.

The application should be built and tested on each target operating system before compatibility is declared.

Security-sensitive functionality should be reviewed before distributing binaries publicly.