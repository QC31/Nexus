mod ssh_auth;
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, OnceLock};
use std::net::{IpAddr, Ipv4Addr};
use std::time::Duration;
#[cfg(target_os = "linux")]
use futures_util::stream::TryStreamExt;
#[cfg(target_os = "linux")]
use rtnetlink::new_connection;
#[cfg(target_os = "linux")]
use rtnetlink::packet_route::route::RouteAttribute;
use tauri::Emitter;
use tauri::Manager;
use keyring::Entry;
use rusqlite::{params, Connection};
use russh::client;
use std::io::Cursor;
use rand_core::OsRng;
use std::path::{Path, PathBuf};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use russh_sftp::protocol::OpenFlags;
const OUI_DATABASE: &str =
    include_str!("../../../../packages/network-core/data/oui.csv");

#[cfg(target_os = "windows")]
fn hidden_powershell_command() -> std::process::Command {
    use std::os::windows::process::CommandExt;

    let mut command = std::process::Command::new("powershell");
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    command
}

#[derive(Debug, Serialize)]
struct Ipv6AddressInfo {
    address: String,
    is_temporary: bool,
    is_link_local: bool,
}

#[derive(Debug, Serialize)]
struct NetworkInterfaceInfo {
    name: String,
    ipv4_addresses: Vec<String>,
    ipv6_addresses: Vec<Ipv6AddressInfo>,
    is_up: bool,
    is_loopback: bool,
    wifi_ssid: Option<String>,
    wifi_rx_bitrate_mbps: Option<f64>,
    wifi_tx_bitrate_mbps: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
struct NetworkRouteInfo {
    destination: String,
    gateway: Option<String>,
    interface_name: Option<String>,
    metric: Option<u32>,
}

#[derive(Debug, Serialize)]
struct RouteLookupResult {
    target: String,
    destination: String,
    gateway: Option<String>,
    interface_name: Option<String>,
    metric: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
struct NetworkNeighborInfo {
    ip_address: String,
    mac_address: Option<String>,
    interface_name: String,
    state: String,
}

#[derive(Debug, Serialize)]
struct NetworkDiscoveryDevice {
    ip_address: String,
    mac_address: Option<String>,
    hostname: Option<String>,
    vendor: Option<String>,
    interface_name: String,
    state: String,
    latency_ms: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
struct NetworkDiscoveryProgress {
    scanned: usize,
    total: usize,
    discovered: usize,
}

fn lookup_mac_vendor(mac_address: &str) -> Option<String> {
    let normalized_mac = mac_address
        .replace(':', "")
        .replace('-', "")
        .to_uppercase();

    if normalized_mac.len() < 6 {
        return None;
    }

    let oui = &normalized_mac[..6];

    OUI_DATABASE
        .lines()
        .skip(1)
        .find_map(|line| {
            let (assignment, vendor) = line.split_once(',')?;

            if assignment.trim().eq_ignore_ascii_case(oui) {
                let vendor = vendor.trim();

                if vendor.is_empty() {
                    None
                } else {
                    Some(vendor.to_string())
                }
            } else {
                None
            }
        })
}

#[derive(Debug, Serialize, Clone)]
struct DnsInfo {
    interface_name: Option<String>,
    current_server: Option<String>,
    servers: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
struct NetToolBoxInitialData {
    routes: Vec<NetworkRouteInfo>,
    neighbors: Vec<NetworkNeighborInfo>,
    dns_info: DnsInfo,
}

#[derive(Debug, Serialize)]
struct PingResult {
    target: String,
    sent: u32,
    received: u32,
    packet_loss: f64,
    min_ms: Option<f64>,
    avg_ms: Option<f64>,
    max_ms: Option<f64>,
    jitter_ms: Option<f64>,
}

#[derive(Debug, Serialize)]
struct ConnectivityCheck {
    name: String,
    status: String,
    latency_ms: Option<f64>,
    detail: Option<String>,
}

#[derive(Debug, Serialize)]
struct GlobalConnectivityResult {
    status: String,
    checks: Vec<ConnectivityCheck>,
}

#[derive(Debug, Serialize)]
struct TcpCheckResult {
    target: String,
    port: u16,
    open: bool,
    connect_time_ms: Option<f64>,
}

#[derive(Debug, Serialize)]
struct PortScanResult {
    port: u16,
    open: bool,
    service: Option<String>,
    connect_time_ms: Option<f64>,
}

#[derive(Debug, Serialize, Clone)]
struct PortScanProgress {
    scanned: usize,
    total: usize,
    open_ports: usize,
}

#[derive(Debug, Serialize)]
struct DnsLookupResult {
    name: String,
    record_type: String,
    records: Vec<String>,
    response_time_ms: f64,
}

#[derive(Debug, Serialize)]
struct DnsComparisonResult {
    name: String,
    record_type: String,
    results: Vec<DnsComparisonServerResult>,
}

#[derive(Debug, Serialize)]
struct DnsComparisonServerResult {
    server: String,
    response_time_ms: Option<f64>,
    records: Vec<String>,
    error: Option<String>,
    records_match: Option<bool>,
}

#[derive(Debug, Serialize)]
struct HttpHeader {
    name: String,
    value: String,
}

#[derive(Debug, Serialize, Clone)]
struct HttpRedirect {
    url: String,
    status_code: u16,
}

#[derive(Debug, Serialize)]
struct TlsInfo {
    version: Option<String>,
    cipher_suite: Option<String>,
    subject: Option<String>,
    issuer: Option<String>,
    valid_from: Option<String>,
    valid_until: Option<String>,
    days_remaining: Option<i64>,
    certificate_status: Option<String>,
    domains: Vec<String>,
}

#[derive(Debug, Serialize)]
struct HttpDiagnosticResult {
    url: String,
    final_url: String,
    status_code: u16,
    response_time_ms: f64,
    response_size_bytes: u64,
    headers: Vec<HttpHeader>,
    redirects: Vec<HttpRedirect>,
    tls: Option<TlsInfo>,
}

#[derive(Debug, Serialize)]
struct TracerouteHop {
    hop: u32,
    address: Option<String>,
    latency_ms: Option<f64>,
}

#[derive(Clone, serde::Serialize)]
struct SftpTransferProgress {
    transfer_id: String,
    transferred_bytes: u64,
    total_bytes: u64,
    file_name: String,
    completed: bool,
}

use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Default)]
struct SftpTransferRegistry {
    active: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

#[tauri::command]
fn cancel_sftp_transfer(
    app_handle: tauri::AppHandle,
    transfer_id: String,
) -> Result<(), String> {
    use tauri::Manager;

    let registry = app_handle.state::<SftpTransferRegistry>();

    let active = registry
        .active
        .lock()
        .map_err(|_| "Impossible d'accéder au registre des transferts.".to_string())?;

    match active.get(&transfer_id) {
        Some(cancel_flag) => {
            cancel_flag.store(true, Ordering::Relaxed);
            Ok(())
        }
        None => Err("Ce transfert n'est plus actif.".to_string()),
    }
}

fn unregister_sftp_transfer(
    app_handle: &tauri::AppHandle,
    transfer_id: &str,
) {
    use tauri::Manager;

    let registry = app_handle.state::<SftpTransferRegistry>();

    if let Ok(mut active) = registry.active.lock() {
        active.remove(transfer_id);
    };
}

struct SftpTransferGuard {
    app_handle: tauri::AppHandle,
    transfer_id: String,
}

impl Drop for SftpTransferGuard {
    fn drop(&mut self) {
        unregister_sftp_transfer(
            &self.app_handle,
            &self.transfer_id,
        );
    }
}

async fn inspect_tls(host: &str, port: u16) -> Result<TlsInfo, String> {
    use rustls::pki_types::ServerName;
    use rustls::ClientConfig;
    use rustls_platform_verifier::ConfigVerifierExt;
    use std::sync::Arc;
    use tokio::net::TcpStream;
    use tokio_rustls::TlsConnector;

    let address = format!("{host}:{port}");

    let tcp_stream = TcpStream::connect(&address)
        .await
        .map_err(|error| error.to_string())?;

    let server_name = ServerName::try_from(host.to_string())
        .map_err(|error| format!("Invalid TLS server name: {error}"))?;

    let config = ClientConfig::with_platform_verifier()
        .map_err(|error| error.to_string())?;

    let connector = TlsConnector::from(Arc::new(config));

    let tls_stream = connector
        .connect(server_name, tcp_stream)
        .await
        .map_err(|error| error.to_string())?;

    let (_, connection) = tls_stream.get_ref();

    let version = connection
        .protocol_version()
        .map(|value| format!("{value:?}"));

    let cipher_suite = connection
        .negotiated_cipher_suite()
        .map(|value| format!("{:?}", value.suite()));

    let certificate = connection
        .peer_certificates()
        .and_then(|certificates| certificates.first());

    let (
        subject,
        issuer,
        valid_from,
        valid_until,
        days_remaining,
        certificate_status,
        domains,
    ) = if let Some(certificate) = certificate {
        let (_, parsed_certificate) =
            x509_parser::parse_x509_certificate(certificate.as_ref())
                .map_err(|error| error.to_string())?;

        let domains = parsed_certificate
            .subject_alternative_name()
            .ok()
            .flatten()
            .map(|extension| {
                extension
                    .value
                    .general_names
                    .iter()
                    .filter_map(|name| match name {
                        x509_parser::extensions::GeneralName::DNSName(domain) => {
                            Some(domain.to_string())
                        }
                        _ => None,
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let not_before = parsed_certificate.validity().not_before;
        let not_after = parsed_certificate.validity().not_after;

        let now = x509_parser::time::ASN1Time::now();

        let days_remaining = {
            let seconds = not_after.timestamp() - now.timestamp();
            seconds.div_euclid(86_400)
        };

        let certificate_status = if now < not_before {
            "NOT_YET_VALID".to_string()
        } else if now > not_after {
            "EXPIRED".to_string()
        } else {
            "VALID".to_string()
        };

        (
            Some(parsed_certificate.subject().to_string()),
            Some(parsed_certificate.issuer().to_string()),
            Some(not_before.to_string()),
            Some(not_after.to_string()),
            Some(days_remaining),
            Some(certificate_status),
            domains,
        )
    } else {
        (
            None,
            None,
            None,
            None,
            None,
            None,
            Vec::new(),
        )
    };

    Ok(TlsInfo {
        version,
        cipher_suite,
        subject,
        issuer,
        valid_from,
        valid_until,
        days_remaining,
        certificate_status,
        domains,
    })
}

#[tauri::command]
async fn http_diagnostic(url: String) -> Result<HttpDiagnosticResult, String> {
    use std::time::Instant;

    let redirect_chain = std::sync::Arc::new(std::sync::Mutex::new(Vec::<HttpRedirect>::new()));
    let redirect_chain_for_policy = std::sync::Arc::clone(&redirect_chain);

    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(move |attempt| {
            if attempt.previous().len() >= 10 {
                return attempt.stop();
            }

            if let Ok(mut redirects) = redirect_chain_for_policy.lock() {
                redirects.push(HttpRedirect {
                    url: attempt.url().to_string(),
                    status_code: attempt.status().as_u16(),
                });
            }

            attempt.follow()
        }))
        .build()
        .map_err(|error| error.to_string())?;

    let start = Instant::now();

    let response = client
        .get(&url)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    let tls = if url.to_lowercase().starts_with("https://") {
        let parsed_url =
            reqwest::Url::parse(&url).map_err(|error| error.to_string())?;

        let host = parsed_url
            .host_str()
            .ok_or_else(|| "Unable to determine HTTPS host".to_string())?;

        let port = parsed_url.port_or_known_default().unwrap_or(443);

        Some(inspect_tls(host, port).await?)
    } else {
        None
    };


    let response_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    let final_url = response.url().to_string();
    let status_code = response.status().as_u16();

    let headers = response
        .headers()
        .iter()
        .map(|(name, value)| HttpHeader {
            name: name.to_string(),
            value: value
                .to_str()
                .unwrap_or("<non-UTF8>")
                .to_string(),
        })
        .collect::<Vec<_>>();

    let body = response
        .bytes()
        .await
        .map_err(|error| error.to_string())?;

    let response_size_bytes = body.len() as u64;
    let redirects = redirect_chain
        .lock()
        .map_err(|_| "Unable to access redirect chain".to_string())?
        .clone();

    Ok(HttpDiagnosticResult {
        url,
        final_url,
        status_code,
        response_time_ms,
        response_size_bytes,
        headers,
        redirects,
        tls,
    })
}

#[tauri::command]
fn ping_host(target: String) -> Result<PingResult, String> {
    #[cfg(target_os = "windows")]
    let output = {
        let mut command = std::process::Command::new("ping");
        command
            .args(["-n", "4", "-w", "2000", &target])
            .env("LANG", "en_US.UTF-8")
            .env("LC_ALL", "en_US.UTF-8");

        command
            .output()
            .map_err(|error| format!("Unable to start Ping: {error}"))?
    };

    #[cfg(not(target_os = "windows"))]
    let output = std::process::Command::new("ping")
        .args(["-c", "4", "-W", "2", &target])
        .output()
        .map_err(|error| format!("Impossible de lancer Ping : {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() && stdout.trim().is_empty() {
        return Err(if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            format!("Ping n'a retourné aucun résultat pour {target}")
        });
    }

    let mut sent = 0u32;
    let mut received = 0u32;
    let mut packet_loss = 100.0;
    let mut min_ms: Option<f64> = None;
    let mut avg_ms: Option<f64> = None;
    let mut max_ms: Option<f64> = None;
    let mut latencies: Vec<f64> = Vec::new();

    for line in stdout.lines() {
        let lower = line.to_lowercase();

        #[cfg(target_os = "windows")]
        {
            // Count successful replies independently of the summary language.
            if lower.contains("bytes=") || lower.contains("octets=") {
                received += 1;
            }

            // Parse the number of packets sent from the summary.
            if lower.contains("sent") || lower.contains("envoy") {
                for part in line.split(',') {
                    let normalized = part.to_lowercase();

                    if normalized.contains("sent") || normalized.contains("envoy") {
                        if let Some(value) = part.split('=').nth(1) {
                            let digits: String = value
                                .trim()
                                .chars()
                                .take_while(|character| character.is_ascii_digit())
                                .collect();

                            if let Ok(count) = digits.parse::<u32>() {
                                sent = count;
                            }
                        }
                    }
                }
            }

            // Parse Windows latency summary in English or French.
            if lower.contains("minimum")
                && lower.contains("maximum")
                && (lower.contains("moyenne") || lower.contains("average"))
            {
                for part in line.split(',') {
                    let part_lower = part.to_lowercase();

                    let value = part
                        .split('=')
                        .nth(1)
                        .and_then(|value| {
                            value
                                .split_whitespace()
                                .next()
                                .and_then(|number| {
                                    number.trim_end_matches("ms").parse::<f64>().ok()
                                })
                        });

                    if let Some(value) = value {
                        if part_lower.contains("minimum") {
                            min_ms = Some(value);
                        } else if part_lower.contains("maximum") {
                            max_ms = Some(value);
                        } else if part_lower.contains("moyenne")
                            || part_lower.contains("average")
                        {
                            avg_ms = Some(value);
                        }
                    }
                }
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            if lower.contains("packets transmitted") {
                let parts: Vec<&str> = line.split(',').collect();

                if let Some(value) = parts.first() {
                    sent = value
                        .split_whitespace()
                        .next()
                        .and_then(|value| value.parse::<u32>().ok())
                        .unwrap_or(sent);
                }

                if let Some(value) = parts.get(1) {
                    received = value
                        .split_whitespace()
                        .next()
                        .and_then(|value| value.parse::<u32>().ok())
                        .unwrap_or(received);
                }

                if let Some(value) = parts.get(2) {
                    packet_loss = value
                        .trim()
                        .trim_end_matches('%')
                        .split_whitespace()
                        .next()
                        .and_then(|value| value.parse::<f64>().ok())
                        .unwrap_or(packet_loss);
                }
            }

            if lower.contains("min/avg/max") {
                if let Some((_, values)) = line.split_once('=') {
                    let values = values.trim().split_whitespace().next().unwrap_or("");
                    let stats: Vec<f64> = values
                        .split('/')
                        .filter_map(|value| value.parse::<f64>().ok())
                        .collect();

                    if stats.len() >= 3 {
                        min_ms = Some(stats[0]);
                        avg_ms = Some(stats[1]);
                        max_ms = Some(stats[2]);
                    }
                }
            }
        }

        // Parse individual reply latencies in English or French.
        if let Some(index) = lower.find("time=").or_else(|| lower.find("temps=")) {
            let prefix_length = if lower[index..].starts_with("temps=") { 6 } else { 5 };
            let value = &line[index + prefix_length..];

            if let Some(ms) = value
                .split_whitespace()
                .next()
                .and_then(|value| value.trim_end_matches("ms").parse::<f64>().ok())
            {
                latencies.push(ms);
            }
        } else if let Some(index) = lower.find("time<").or_else(|| lower.find("temps<")) {
            let prefix_length = if lower[index..].starts_with("temps<") { 6 } else { 5 };
            let value = &line[index + prefix_length..];

            if let Some(ms) = value
                .split_whitespace()
                .next()
                .and_then(|value| value.trim_end_matches("ms").parse::<f64>().ok())
            {
                latencies.push(ms / 2.0);
            }
        }
    }

    #[cfg(target_os = "windows")]
    {
        if sent == 0 {
            sent = 4;
        }

        if received > sent {
            received = sent;
        }

        if received == 0 {
            packet_loss = 100.0;
        } else if sent > 0 {
            packet_loss = ((sent - received) as f64 / sent as f64) * 100.0;
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if sent > 0 && received <= sent && !stdout.to_ascii_lowercase().contains("packet loss") {
            packet_loss = ((sent - received) as f64 / sent as f64) * 100.0;
        }
    }

    if sent == 0 && received == 0 {
        return Err(if !stderr.trim().is_empty() {
            stderr.trim().to_string()
        } else {
            format!("Impossible d'analyser les résultats Ping pour {target}")
        });
    }

    if !output.status.success() && received == 0 {
        // An unreachable host remains a valid result: 100% losses.
        packet_loss = 100.0;
    }

    if !output.status.success() && received > 0 {
        // Some responses may have been received despite a non-zero exit code.
        packet_loss = ((sent.saturating_sub(received)) as f64 / sent.max(1) as f64) * 100.0;
    }

    if !latencies.is_empty() {
        let measured_min = latencies.iter().copied().fold(f64::INFINITY, f64::min);
        let measured_max = latencies.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        let measured_avg = latencies.iter().sum::<f64>() / latencies.len() as f64;

        min_ms = min_ms.or(Some(measured_min));
        max_ms = max_ms.or(Some(measured_max));
        avg_ms = avg_ms.or(Some(measured_avg));
    }

    let jitter_ms = if latencies.len() >= 2 {
        let differences: Vec<f64> = latencies
            .windows(2)
            .map(|window| (window[1] - window[0]).abs())
            .collect();

        Some(differences.iter().sum::<f64>() / differences.len() as f64)
    } else {
        None
    };

    Ok(PingResult {
        target,
        sent,
        received,
        packet_loss,
        min_ms,
        avg_ms,
        max_ms,
        jitter_ms,
    })
}

#[tauri::command]
fn tcp_check(target: String, port: u16) -> Result<TcpCheckResult, String> {
    use std::net::{TcpStream, ToSocketAddrs};
    use std::time::{Duration, Instant};

    let address = format!("{target}:{port}");

    let socket_address = address
        .to_socket_addrs()
        .map_err(|error| error.to_string())?
        .next()
        .ok_or_else(|| "Unable to resolve target".to_string())?;

    let start = Instant::now();

    let result = TcpStream::connect_timeout(&socket_address, Duration::from_secs(3));

    let connect_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    match result {
        Ok(_) => Ok(TcpCheckResult {
            target,
            port,
            open: true,
            connect_time_ms: Some(connect_time_ms),
        }),
        Err(_) => Ok(TcpCheckResult {
            target,
            port,
            open: false,
            connect_time_ms: None,
        }),
    }
}

#[tauri::command]
async fn port_scan(
    app_handle: tauri::AppHandle,
    target: String,
    ports: Vec<u16>,
) -> Result<Vec<PortScanResult>, String> {
    let target = target.trim().to_string();

    if target.is_empty() {
        return Err("Target cannot be empty".to_string());
    }

    if ports.is_empty() {
        return Err("No ports specified".to_string());
    }

    let total = ports.len();
    let concurrency = 32usize;
    let mut results = Vec::with_capacity(total);
    let mut scanned = 0usize;
    let mut open_ports = 0usize;

    let _ = app_handle.emit(
        "port-scan-progress",
        PortScanProgress {
            scanned: 0,
            total,
            open_ports: 0,
        },
    );

    for chunk in ports.chunks(concurrency) {
        let mut handles = Vec::new();

        for &port in chunk {
            let target = target.clone();

            handles.push(tokio::spawn(async move {
                let start = std::time::Instant::now();

                let result = tokio::time::timeout(
                    std::time::Duration::from_secs(2),
                    tokio::net::TcpStream::connect((target.as_str(), port)),
                )
                .await;

                let service = match port {
                    21 => Some("FTP".to_string()),
                    22 => Some("SSH".to_string()),
                    23 => Some("Telnet".to_string()),
                    25 => Some("SMTP".to_string()),
                    53 => Some("DNS".to_string()),
                    80 => Some("HTTP".to_string()),
                    110 => Some("POP3".to_string()),
                    143 => Some("IMAP".to_string()),
                    443 => Some("HTTPS".to_string()),
                    445 => Some("SMB".to_string()),
                    587 => Some("SMTP Submission".to_string()),
                    993 => Some("IMAPS".to_string()),
                    995 => Some("POP3S".to_string()),
                    1433 => Some("MSSQL".to_string()),
                    3306 => Some("MySQL".to_string()),
                    3389 => Some("RDP".to_string()),
                    5432 => Some("PostgreSQL".to_string()),
                    5900 => Some("VNC".to_string()),
                    6379 => Some("Redis".to_string()),
                    8080 => Some("HTTP Alt".to_string()),
                    27017 => Some("MongoDB".to_string()),
                    _ => None,
                };

                match result {
                    Ok(Ok(_stream)) => PortScanResult {
                        port,
                        open: true,
                        service,
                        connect_time_ms: Some(
                            start.elapsed().as_secs_f64() * 1000.0,
                        ),
                    },
                    _ => PortScanResult {
                        port,
                        open: false,
                        service: None,
                        connect_time_ms: None,
                    },
                }
            }));
        }

        for handle in handles {
            let result = handle
                .await
                .map_err(|error| error.to_string())?;

            scanned += 1;

            if result.open {
                open_ports += 1;
            }

            results.push(result);

            let _ = app_handle.emit(
                "port-scan-progress",
                PortScanProgress {
                    scanned,
                    total,
                    open_ports,
                },
            );
        }
    }

    results.sort_by_key(|result| result.port);

    let _ = app_handle.emit(
        "port-scan-progress",
        PortScanProgress {
            scanned: total,
            total,
            open_ports,
        },
    );

    Ok(results)
}

#[tauri::command]
async fn dns_lookup(
    name: String,
    record_type: String,
    dns_server: Option<String>,
) -> Result<DnsLookupResult, String> {
    use hickory_resolver::config::{NameServerConfig, ResolverConfig};
    use hickory_resolver::proto::rr::RecordType;
    use hickory_resolver::TokioResolver;
    use std::net::IpAddr;
    use std::time::Instant;

    let record_type = match record_type.to_uppercase().as_str() {
        "A" => RecordType::A,
        "AAAA" => RecordType::AAAA,
        "CNAME" => RecordType::CNAME,
        "MX" => RecordType::MX,
        "NS" => RecordType::NS,
        "TXT" => RecordType::TXT,
        "SOA" => RecordType::SOA,
        _ => return Err("Unsupported DNS record type".to_string()),
    };

    let resolver = if let Some(dns_server) = dns_server {
        let ip: IpAddr = dns_server
            .trim()
            .parse()
            .map_err(|error| format!("Invalid DNS server: {error}"))?;

        let name_server = NameServerConfig::udp(ip);

        let config = ResolverConfig::from_parts(
            None,
            Vec::new(),
            vec![name_server],
        );

        TokioResolver::builder_with_config(config, Default::default())
            .build()
            .map_err(|error| error.to_string())?
    } else {
        TokioResolver::builder_tokio()
            .map_err(|error| error.to_string())?
            .build()
            .map_err(|error| error.to_string())?
    };

    let start = Instant::now();

    let response = resolver
        .lookup(name.as_str(), record_type)
        .await
        .map_err(|error| error.to_string())?;

    let response_time_ms = start.elapsed().as_secs_f64() * 1000.0;

    let records = response
        .answers()
        .iter()
        .map(|record| record.to_string())
        .collect();

    Ok(DnsLookupResult {
        name,
        record_type: record_type.to_string(),
        records,
        response_time_ms,
    })
}

#[tauri::command]
async fn dns_compare(
    name: String,
    record_type: String,
    dns_servers: Vec<String>,
) -> Result<DnsComparisonResult, String> {
    use hickory_resolver::config::{NameServerConfig, ResolverConfig};
    use hickory_resolver::proto::rr::RecordType;
    use hickory_resolver::TokioResolver;
    use std::net::IpAddr;
    use std::time::Instant;

    let record_type = match record_type.to_uppercase().as_str() {
        "A" => RecordType::A,
        "AAAA" => RecordType::AAAA,
        "CNAME" => RecordType::CNAME,
        "MX" => RecordType::MX,
        "NS" => RecordType::NS,
        "TXT" => RecordType::TXT,
        "SOA" => RecordType::SOA,
        _ => return Err("Unsupported DNS record type".to_string()),
    };

    if dns_servers.is_empty() {
        return Err("No DNS servers provided".to_string());
    }

    let mut results = Vec::new();

    for dns_server in dns_servers {
        let ip: IpAddr = match dns_server.trim().parse() {
            Ok(ip) => ip,
            Err(error) => {
                results.push(DnsComparisonServerResult {
                    server: dns_server,
                    response_time_ms: None,
                    records: Vec::new(),
                    error: Some(format!("Invalid DNS server: {error}")),
                    records_match: None,
                });

                continue;
            }
        };

        let name_server = NameServerConfig::udp(ip);

        let config = ResolverConfig::from_parts(
            None,
            Vec::new(),
            vec![name_server],
        );

        let resolver = match TokioResolver::builder_with_config(config, Default::default())
            .build()
        {
            Ok(resolver) => resolver,
            Err(error) => {
                results.push(DnsComparisonServerResult {
                    server: ip.to_string(),
                    response_time_ms: None,
                    records: Vec::new(),
                    error: Some(error.to_string()),
                    records_match: None,
                });

                continue;
            }
        };

        let start = Instant::now();

        match resolver.lookup(name.as_str(), record_type).await {
            Ok(response) => {
                let response_time_ms = start.elapsed().as_secs_f64() * 1000.0;

                let records = response
                    .answers()
                    .iter()
                    .map(|record| {
                        record
                            .data
                            .to_string()
                    })
                .collect::<Vec<_>>();

                results.push(DnsComparisonServerResult {
                    server: ip.to_string(),
                    response_time_ms: Some(response_time_ms),
                    records,
                    error: None,
                    records_match: None,
                });
            }
            Err(error) => {
                results.push(DnsComparisonServerResult {
                    server: ip.to_string(),
                    response_time_ms: None,
                    records: Vec::new(),
                    error: Some(error.to_string()),
                    records_match: None,
                });
            }
        }
    }

    let successful_records = results
        .iter()
        .filter(|result| result.error.is_none())
        .map(|result| result.records.clone())
        .collect::<Vec<_>>();

    let reference_records = successful_records.first();

    if let Some(reference_records) = reference_records {
        for result in &mut results {
            if result.error.is_none() {
                let mut current_records = result.records.clone();
                let mut reference = reference_records.clone();

                current_records.sort();
                reference.sort();

                result.records_match = Some(current_records == reference);
            }
        }
    }

    Ok(DnsComparisonResult {
        name,
        record_type: record_type.to_string(),
        results,
    })
}

#[derive(Debug, Serialize)]
struct ReverseDnsResult {
    ip_address: String,
    hostnames: Vec<String>,
}

#[tauri::command]
async fn reverse_dns_lookup(ip_address: String) -> Result<ReverseDnsResult, String> {
    use std::net::IpAddr;

    use hickory_resolver::TokioResolver;

    let ip: IpAddr = ip_address
        .trim()
        .parse()
        .map_err(|error| format!("Invalid IP address: {error}"))?;

    let resolver = TokioResolver::builder_tokio()
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;

    let response = resolver
        .reverse_lookup(ip)
        .await
        .map_err(|error| error.to_string())?;

    let hostnames = response
        .answers()
        .iter()
        .filter_map(|record| match &record.data {
            hickory_resolver::proto::rr::RData::PTR(name) => Some(name.to_utf8()),
            _ => None,
        })
        .collect::<Vec<_>>();

    Ok(ReverseDnsResult {
        ip_address,
        hostnames,
    })
}

#[tauri::command]
fn traceroute_host(target: String) -> Result<Vec<TracerouteHop>, String> {
    #[cfg(target_os = "windows")]
    let output = std::process::Command::new("tracert")
        .args(["-d", "-h", "20", "-w", "2000", &target])
        .output()
        .map_err(|error| format!("Impossible de lancer tracert : {error}"))?;

    #[cfg(not(target_os = "windows"))]
    let output = std::process::Command::new("traceroute")
        .args(["-n", "-m", "20", "-w", "2", &target])
        .output()
        .map_err(|error| format!("Impossible de lancer traceroute : {error}"))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() && stdout.trim().is_empty() {
        return Err(if stderr.trim().is_empty() {
            format!("Traceroute a échoué avec le code {}", output.status)
        } else {
            stderr.trim().to_string()
        });
    }

    let mut hops = Vec::new();

    for line in stdout.lines() {
        let line = line.trim();

        #[cfg(target_os = "windows")]
        let parsed = {
            // Windows format: jump number, latencies, and IP address or hostname.
            let mut parts = line.split_whitespace();
            let hop = parts.next().and_then(|value| value.parse::<u32>().ok());

            hop.map(|hop| {
                let remaining: Vec<&str> = parts.collect();

                if remaining.is_empty() || remaining.iter().all(|part| *part == "*") {
                    return TracerouteHop {
                        hop,
                        address: None,
                        latency_ms: None,
                    };
                }

                let latency_ms = remaining.iter().find_map(|part| {
                    let value = part.trim_end_matches("ms");
                    value.parse::<f64>().ok()
                });

                let address = remaining
                    .iter()
                    .rev()
                    .find(|part| {
                        part.starts_with('[')
                            || part.starts_with("10.")
                            || part.starts_with("192.168.")
                            || part.starts_with("172.")
                            || part.contains(':')
                            || part.chars().filter(|character| *character == '.').count() == 3
                    })
                    .map(|part| part.trim_matches(&['[', ']'][..]).to_string());

                TracerouteHop {
                    hop,
                    address,
                    latency_ms,
                }
            })
        };

        #[cfg(not(target_os = "windows"))]
        let parsed = {
            let mut parts = line.split_whitespace();

            parts.next()
                .and_then(|value| value.parse::<u32>().ok())
                .map(|hop| {
                    let remaining: Vec<&str> = parts.collect();

                    if remaining.is_empty() || remaining[0] == "*" {
                        return TracerouteHop {
                            hop,
                            address: None,
                            latency_ms: None,
                        };
                    }

                    let address = remaining.first().map(|value| (*value).to_string());

                    let latency_ms = remaining.iter().skip(1).find_map(|value| {
                        value.trim_end_matches("ms").parse::<f64>().ok()
                    });

                    TracerouteHop {
                        hop,
                        address,
                        latency_ms,
                    }
                })
        };

        if let Some(hop) = parsed {
            hops.push(hop);
        }
    }

    if hops.is_empty() && !output.status.success() {
        return Err(if stderr.trim().is_empty() {
            "Traceroute n'a retourné aucun saut réseau.".to_string()
        } else {
            stderr.trim().to_string()
        });
    }

    Ok(hops)
}

#[cfg(target_os = "linux")]
fn is_interface_up(name: &str) -> bool {
    std::fs::read_to_string(format!("/sys/class/net/{name}/operstate"))
        .map(|state| state.trim() == "up")
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
static INTERFACE_STATES_CACHE: std::sync::OnceLock<
    std::sync::Mutex<Option<(std::time::Instant, BTreeMap<String, bool>)>>,
> = std::sync::OnceLock::new();

#[cfg(target_os = "windows")]
static INTERFACE_STATES_REFRESH_LOCK: std::sync::OnceLock<std::sync::Mutex<()>> =
    std::sync::OnceLock::new();

#[cfg(target_os = "windows")]
fn get_cached_interface_states() -> Option<BTreeMap<String, bool>> {
    let cache = INTERFACE_STATES_CACHE
        .get_or_init(|| std::sync::Mutex::new(None));

    let guard = cache.lock().ok()?;

    guard
        .as_ref()
        .map(|(_, states)| states.clone())
}

#[cfg(target_os = "windows")]
fn get_interface_states() -> BTreeMap<String, bool> {
    let refresh_lock = INTERFACE_STATES_REFRESH_LOCK
        .get_or_init(|| std::sync::Mutex::new(()));

    let _refresh_guard = match refresh_lock.lock() {
        Ok(guard) => guard,
        Err(_) => {
            return BTreeMap::new();
        }
    };

    let cache = INTERFACE_STATES_CACHE
        .get_or_init(|| std::sync::Mutex::new(None));

    if let Ok(guard) = cache.lock() {
        if let Some((timestamp, states)) = guard.as_ref() {
            if timestamp.elapsed() < std::time::Duration::from_secs(10) {
                return states.clone();
            }
        }
    }

    let script =
        "Get-NetAdapter | Select-Object -Property Name, Status | ConvertTo-Json -Compress";

    let output = match hidden_powershell_command()
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            script,
        ])
        .output()
    {
        Ok(output) => output,
        Err(_) => return BTreeMap::new(),
    };

    if !output.status.success() {
        return BTreeMap::new();
    }

    let text = String::from_utf8_lossy(&output.stdout);

    let value = match serde_json::from_str::<serde_json::Value>(&text) {
        Ok(value) => value,
        Err(_) => return BTreeMap::new(),
    };

    let mut states = BTreeMap::new();

    let adapters = match value {
        serde_json::Value::Array(adapters) => adapters,
        serde_json::Value::Object(_) => vec![value],
        _ => return states,
    };

    for adapter in adapters {
        let Some(name) = adapter.get("Name").and_then(|value| value.as_str()) else {
            continue;
        };

        let is_up = adapter
            .get("Status")
            .and_then(|value| value.as_str())
            .is_some_and(|status| status == "Up");

        states.insert(name.to_string(), is_up);
    }

    if let Ok(mut guard) = cache.lock() {
        *guard = Some((std::time::Instant::now(), states.clone()));
    }

    states
}

fn parse_wifi_bitrate(value: &str) -> Option<f64> {
    value
        .split_whitespace()
        .next()
        .and_then(|number| number.parse::<f64>().ok())
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn refresh_interface_states() -> Result<(), String> {

    tokio::task::spawn_blocking(|| {
        get_interface_states();
    })
    .await
    .map_err(|error| error.to_string())?;

    Ok(())
}

#[tauri::command]
fn network_interfaces() -> Result<Vec<NetworkInterfaceInfo>, String> {

#[cfg(target_os = "windows")]
let interface_states = get_cached_interface_states()
    .unwrap_or_else(get_interface_states);

let interfaces = if_addrs::get_if_addrs().map_err(|error| {
    error.to_string()
})?;

    let mut interfaces_by_name = BTreeMap::<String, NetworkInterfaceInfo>::new();

    for interface in interfaces {
        let is_loopback = interface.is_loopback();

        let entry = interfaces_by_name
            .entry(interface.name.clone())
            .or_insert_with(|| {

            let wifi_output = std::process::Command::new("iw")
                .args(["dev", &interface.name, "link"])
                .output();

            let wifi_info = wifi_output
                .ok()
                .filter(|output| output.status.success())
                .map(|output| {
                    let text = String::from_utf8_lossy(&output.stdout);

                    let wifi_ssid = text.lines().find_map(|line| {
                        line.trim()
                            .strip_prefix("SSID:")
                            .map(str::trim)
                            .map(str::to_string)
                    });

                    let wifi_rx_bitrate_mbps = text.lines().find_map(|line| {
                        let line = line.trim();
                        line.strip_prefix("rx bitrate:")
                            .and_then(parse_wifi_bitrate)
                    });

                    let wifi_tx_bitrate_mbps = text.lines().find_map(|line| {
                        let line = line.trim();
                        line.strip_prefix("tx bitrate:")
                            .and_then(parse_wifi_bitrate)
                    });

                    (
                        wifi_ssid,
                        wifi_rx_bitrate_mbps,
                        wifi_tx_bitrate_mbps,
                    )
                })
                .unwrap_or((None, None, None));

                #[cfg(target_os = "windows")]
                let interface_is_up = interface_states
                    .get(&interface.name)
                    .copied()
                    .unwrap_or(false);

                #[cfg(target_os = "linux")]
                let interface_is_up = is_interface_up(&interface.name);

                NetworkInterfaceInfo {
                    name: interface.name.clone(),
                    ipv4_addresses: Vec::new(),
                    ipv6_addresses: Vec::new(),
                    is_up: interface_is_up,
                    is_loopback,
                    wifi_ssid: wifi_info.0,
                    wifi_rx_bitrate_mbps: wifi_info.1,
                    wifi_tx_bitrate_mbps: wifi_info.2,
                }
            });

                match interface.addr.ip() {
                    IpAddr::V4(address) => {
                        entry.ipv4_addresses.push(address.to_string());
                    }
                    IpAddr::V6(_) => {}
                }

                if entry.ipv6_addresses.is_empty() {

                    let ipv6_result = std::process::Command::new("ip")
                        .args(["-6", "addr", "show", "dev", &interface.name])
                        .output();

                    let ipv6_output = ipv6_result
                        .ok()
                        .filter(|output| output.status.success());

                    if let Some(output) = ipv6_output {
                        let text = String::from_utf8_lossy(&output.stdout);

                        for line in text.lines() {
                            let Some(value) = line
                                .trim_start()
                                .strip_prefix("inet6 ")
                                .and_then(|value| value.split_whitespace().next())
                            else {
                                continue;
                            };

                            let Some(address_part) = value.split('/').next() else {
                                continue;
                            };

                            let Ok(address) = address_part.parse::<std::net::Ipv6Addr>() else {
                                continue;
                            };

                            entry.ipv6_addresses.push(Ipv6AddressInfo {
                                address: address_part.to_string(),
                                is_temporary: line.contains("temporary"),
                                is_link_local: address.is_unicast_link_local(),
                            });
                        }
                    }
                }
    }

    Ok(interfaces_by_name.into_values().collect())
}

#[cfg(target_os = "linux")]
#[tauri::command]
async fn network_routes() -> Result<Vec<NetworkRouteInfo>, String> {
    let (connection, handle, _) =
        new_connection().map_err(|error| error.to_string())?;

    tokio::spawn(connection);

    let route = rtnetlink::packet_route::route::RouteMessage::default();
    let mut routes = handle.route().get(route).execute();

    let mut result = Vec::new();

    while let Some(route) = routes
        .try_next()
        .await
        .map_err(|error| error.to_string())?
    {
        let mut destination = match route.header.address_family {
            rtnetlink::packet_route::AddressFamily::Inet => "0.0.0.0".to_string(),
            rtnetlink::packet_route::AddressFamily::Inet6 => "::".to_string(),
            _ => continue,
        };

        let prefix = route.header.destination_prefix_length;

        let mut gateway = None;
        let mut interface_index = None;
        let mut metric = None;

        for attribute in route.attributes {
            match attribute {
                RouteAttribute::Destination(address) => {
                    destination = match address {
                        rtnetlink::packet_route::route::RouteAddress::Inet(address) => {
                            address.to_string()
                        }
                        rtnetlink::packet_route::route::RouteAddress::Inet6(address) => {
                            address.to_string()
                        }
                        _ => continue,
                    };
                }
                RouteAttribute::Gateway(address) => {
                    gateway = Some(match address {
                        rtnetlink::packet_route::route::RouteAddress::Inet(address) => {
                            address.to_string()
                        }
                        rtnetlink::packet_route::route::RouteAddress::Inet6(address) => {
                            address.to_string()
                        }
                        _ => continue,
                    });
                }
                RouteAttribute::Oif(index) => {
                    interface_index = Some(index);
                }
                RouteAttribute::Priority(value) => {
                    metric = Some(value);
                }
                _ => {}
            }
        }

        let interface_name = if let Some(index) = interface_index {
            std::fs::read_dir("/sys/class/net")
                .ok()
                .and_then(|entries| {
                    entries.flatten().find_map(|entry| {
                        let name = entry.file_name().to_string_lossy().to_string();

                        let index_path = entry.path().join("ifindex");

                        let value = std::fs::read_to_string(index_path).ok()?;

                        if value.trim().parse::<u32>().ok()? == index {
                            Some(name)
                        } else {
                            None
                        }
                    })
                })
        } else {
            None
        };

        result.push(NetworkRouteInfo {
            destination: format!("{destination}/{prefix}"),
            gateway,
            interface_name,
            metric,
        });
    }

    Ok(result)
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn network_routes() -> Result<Vec<NetworkRouteInfo>, String> {
    let script = r#"
        Get-NetRoute |
        Select-Object DestinationPrefix, NextHop, InterfaceAlias, RouteMetric |
        ConvertTo-Json -Compress
    "#;

    let output = tokio::task::spawn_blocking(move || {
        hidden_powershell_command()
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
    })
    .await
    .map_err(|error| format!("Windows routes task failed: {error}"))?
    .map_err(|error| format!("Unable to query Windows routes: {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| format!("Invalid route data: {error}"))?;

    let entries = match value {
        serde_json::Value::Array(entries) => entries,
        serde_json::Value::Object(_) => vec![value],
        _ => Vec::new(),
    };

    let mut routes = Vec::new();

    for entry in entries {
        let destination = entry["DestinationPrefix"].as_str().unwrap_or("").to_string();
        if destination.is_empty() {
            continue;
        }

        let next_hop = entry["NextHop"].as_str().unwrap_or("");
        let interface_alias = entry["InterfaceAlias"].as_str().unwrap_or("");

        routes.push(NetworkRouteInfo {
            destination,
            gateway: if next_hop.is_empty() || next_hop == "0.0.0.0" || next_hop == "::" {
                None
            } else {
                Some(next_hop.to_string())
            },
            interface_name: if interface_alias.is_empty() {
                None
            } else {
                Some(interface_alias.to_string())
            },
            metric: entry["RouteMetric"].as_u64().map(|value| value as u32),
        });
    }

    Ok(routes)
}

#[cfg(target_os = "linux")]
#[tauri::command]
async fn route_lookup(target: String) -> Result<RouteLookupResult, String> {
    let target_ip: IpAddr = target
        .trim()
        .parse()
        .map_err(|error| format!("Invalid IP address: {error}"))?;

    let (connection, handle, _) =
        new_connection().map_err(|error| error.to_string())?;

    tokio::spawn(connection);

    let routes = handle.route().get(rtnetlink::packet_route::route::RouteMessage::default());

    let mut routes = routes.execute();

    let mut best_match: Option<RouteLookupResult> = None;
    let mut best_prefix = 0u8;

    while let Some(route) = routes
        .try_next()
        .await
        .map_err(|error| error.to_string())?
    {
        let family_matches = match target_ip {
            IpAddr::V4(_) => {
                route.header.address_family
                    == rtnetlink::packet_route::AddressFamily::Inet
            }
            IpAddr::V6(_) => {
                route.header.address_family
                    == rtnetlink::packet_route::AddressFamily::Inet6
            }
        };

        if !family_matches {
            continue;
        }

        let prefix = route.header.destination_prefix_length;

        let mut destination = match target_ip {
            IpAddr::V4(_) => "0.0.0.0".to_string(),
            IpAddr::V6(_) => "::".to_string(),
        };

        let mut gateway = None;
        let mut interface_index = None;
        let mut metric = None;

        for attribute in route.attributes {
            match attribute {
                RouteAttribute::Destination(address) => {
                    destination = match address {
                        rtnetlink::packet_route::route::RouteAddress::Inet(address) => {
                            address.to_string()
                        }
                        rtnetlink::packet_route::route::RouteAddress::Inet6(address) => {
                            address.to_string()
                        }
                        _ => continue,
                    };
                }
                RouteAttribute::Gateway(address) => {
                    gateway = Some(match address {
                        rtnetlink::packet_route::route::RouteAddress::Inet(address) => {
                            address.to_string()
                        }
                        rtnetlink::packet_route::route::RouteAddress::Inet6(address) => {
                            address.to_string()
                        }
                        _ => continue,
                    });
                }
                RouteAttribute::Oif(index) => {
                    interface_index = Some(index);
                }
                RouteAttribute::Priority(value) => {
                    metric = Some(value);
                }
                _ => {}
            }
        }

        let destination_ip: IpAddr = destination
            .parse()
            .map_err(|error| format!("Invalid route destination: {error}"))?;

        let matches = match (target_ip, destination_ip) {
            (IpAddr::V4(target), IpAddr::V4(network)) => {
                if prefix == 0 {
                    true
                } else {
                    let mask = u32::MAX << (32 - prefix);
                    (u32::from(target) & mask) == (u32::from(network) & mask)
                }
            }
            (IpAddr::V6(target), IpAddr::V6(network)) => {
                if prefix == 0 {
                    true
                } else {
                    let target = u128::from(target);
                    let network = u128::from(network);
                    let mask = u128::MAX << (128 - prefix);

                    (target & mask) == (network & mask)
                }
            }
            _ => false,
        };

        if !matches || prefix < best_prefix {
            continue;
        }

        let interface_name = if let Some(index) = interface_index {
            std::fs::read_dir("/sys/class/net")
                .ok()
                .and_then(|entries| {
                    entries.flatten().find_map(|entry| {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let index_path = entry.path().join("ifindex");
                        let value = std::fs::read_to_string(index_path).ok()?;

                        if value.trim().parse::<u32>().ok()? == index {
                            Some(name)
                        } else {
                            None
                        }
                    })
                })
        } else {
            None
        };

        best_prefix = prefix;

        best_match = Some(RouteLookupResult {
            target: target_ip.to_string(),
            destination: format!("{destination}/{prefix}"),
            gateway,
            interface_name,
            metric,
        });
    }

    best_match.ok_or_else(|| format!("No route found for {target}"))
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn route_lookup(target: String) -> Result<RouteLookupResult, String> {
    let target_ip: IpAddr = target
        .trim()
        .parse()
        .map_err(|error| format!("Adresse IP invalide : {error}"))?;

    let script = format!(
        "Find-NetRoute -RemoteIPAddress '{}' | \
         Where-Object {{ $_.CimClass.CimClassName -eq 'MSFT_NetRoute' }} | \
         Select-Object -First 1 DestinationPrefix, NextHop, InterfaceAlias, RouteMetric | \
         ConvertTo-Json -Compress",
        target_ip
    );

    let output = hidden_powershell_command()
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .output()
        .map_err(|error| format!("Impossible de rechercher la route : {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let value: serde_json::Value =
        serde_json::from_slice(&output.stdout)
            .map_err(|error| format!("Réponse de routage invalide : {error}"))?;

    let destination = value["DestinationPrefix"]
        .as_str()
        .unwrap_or("")
        .to_string();

    if destination.is_empty() {
        return Err(format!("Aucune route trouvée pour {target}"));
    }

    let next_hop = value["NextHop"].as_str().unwrap_or("");
    let interface_alias = value["InterfaceAlias"].as_str().unwrap_or("");

    Ok(RouteLookupResult {
        target: target_ip.to_string(),
        destination,
        gateway: if next_hop.is_empty() || next_hop == "0.0.0.0" || next_hop == "::" {
            None
        } else {
            Some(next_hop.to_string())
        },
        interface_name: if interface_alias.is_empty() {
            None
        } else {
            Some(interface_alias.to_string())
        },
        metric: value["RouteMetric"].as_u64().map(|metric| metric as u32),
    })
}

#[tauri::command]
async fn global_connectivity_test() -> Result<GlobalConnectivityResult, String> {
    let routes = network_routes().await?;

    let gateway = routes
        .iter()
        .find(|route| route.destination == "0.0.0.0/0")
        .and_then(|route| route.gateway.clone());

    let mut checks = Vec::new();

    // 1. Gateway
    let gateway_check = if let Some(gateway) = gateway {
        match ping_host(gateway.clone()) {
            Ok(result) => ConnectivityCheck {
                name: "Gateway".to_string(),
                status: if result.packet_loss < 100.0 {
                    "online".to_string()
                } else {
                    "offline".to_string()
                },
                latency_ms: result.avg_ms,
                detail: Some(gateway),
            },
            Err(error) => ConnectivityCheck {
                name: "Gateway".to_string(),
                status: "offline".to_string(),
                latency_ms: None,
                detail: Some(error),
            },
        }
    } else {
        ConnectivityCheck {
            name: "Gateway".to_string(),
            status: "offline".to_string(),
            latency_ms: None,
            detail: Some("No default gateway found".to_string()),
        }
    };

    checks.push(gateway_check);

    // 2. DNS
    let dns_check = match dns_lookup(
        "example.com".to_string(),
        "A".to_string(),
        None,
    )
    .await
    {
        Ok(result) => ConnectivityCheck {
            name: "DNS".to_string(),
            status: "online".to_string(),
            latency_ms: Some(result.response_time_ms),
            detail: result.records.first().cloned(),
        },
        Err(error) => ConnectivityCheck {
            name: "DNS".to_string(),
            status: "offline".to_string(),
            latency_ms: None,
            detail: Some(error),
        },
    };

    checks.push(dns_check);

    // 3. Internet
    let internet_targets = ["1.1.1.1", "8.8.8.8", "9.9.9.9"];

    let mut internet_results = Vec::new();

    for target in internet_targets {
        match ping_host(target.to_string()) {
            Ok(result) => {
                internet_results.push(result);
            }
            Err(_) => {}
        }
    }

    let reachable_count = internet_results
        .iter()
        .filter(|result| result.packet_loss < 100.0)
        .count();

    let internet_status = match reachable_count {
        0 => "offline",
        1 => "degraded",
        _ => "online",
    };

    let internet_latency = internet_results
        .iter()
        .filter_map(|result| result.avg_ms)
        .min_by(|a, b| a.total_cmp(b));

    let internet_detail = Some(
        internet_results
            .iter()
            .map(|result| {
                format!(
                    "{}: {}",
                    result.target,
                    if result.packet_loss < 100.0 {
                        "reachable"
                    } else {
                        "unreachable"
                    }
                )
            })
            .collect::<Vec<_>>()
            .join(" · "),
    );

    let internet_check = ConnectivityCheck {
        name: "Internet".to_string(),
        status: internet_status.to_string(),
        latency_ms: internet_latency,
        detail: internet_detail,
    };

    checks.push(internet_check);

    // 4. HTTPS
    let https_check = match http_diagnostic("https://example.com".to_string()).await {
        Ok(result) => ConnectivityCheck {
            name: "HTTPS".to_string(),
            status: if (200..400).contains(&result.status_code) {
                "online".to_string()
            } else {
                "offline".to_string()
            },
            latency_ms: Some(result.response_time_ms),
            detail: Some(format!("HTTP {}", result.status_code)),
        },
        Err(error) => ConnectivityCheck {
            name: "HTTPS".to_string(),
            status: "offline".to_string(),
            latency_ms: None,
            detail: Some(error),
        },
    };

    checks.push(https_check);

    let online_count = checks
        .iter()
        .filter(|check| check.status == "online")
        .count();

    let status = if online_count == checks.len() {
        "online"
    } else if online_count == 0 {
        "offline"
    } else {
        "degraded"
    };

    Ok(GlobalConnectivityResult {
        status: status.to_string(),
        checks,
    })
}

#[cfg(target_os = "linux")]
#[tauri::command]
async fn network_neighbors() -> Result<Vec<NetworkNeighborInfo>, String> {
    let (connection, handle, _) =
        new_connection().map_err(|error| error.to_string())?;

    tokio::spawn(connection);

    let mut neighbors = handle.neighbours().get().execute();
    let mut result = Vec::new();

    while let Some(neighbor) = neighbors
        .try_next()
        .await
        .map_err(|error| error.to_string())?
    {

        let mut ip_address = None;
        let mut mac_address = None;

        for attribute in neighbor.attributes {
            match attribute {
                rtnetlink::packet_route::neighbour::NeighbourAttribute::Destination(address) => {
                    ip_address = Some(match address {
                rtnetlink::packet_route::neighbour::NeighbourAddress::Inet(address) => {
                    address.to_string()
                }
                rtnetlink::packet_route::neighbour::NeighbourAddress::Inet6(address) => {
                    address.to_string()
                }
                _ => continue,
            });
                }
                rtnetlink::packet_route::neighbour::NeighbourAttribute::LinkLayerAddress(address) => {
                    mac_address = Some(
                        address
                            .iter()
                            .map(|byte| format!("{byte:02x}"))
                            .collect::<Vec<_>>()
                            .join(":"),
                    );
                }
                _ => {}
            }
        }

        let Some(ip_address) = ip_address else {
            continue;
        };

        let interface_name = std::fs::read_dir("/sys/class/net")
            .ok()
            .and_then(|entries| {
                entries.flatten().find_map(|entry| {
                    let name = entry.file_name().to_string_lossy().to_string();
                    let index_path = entry.path().join("ifindex");
                    let value = std::fs::read_to_string(index_path).ok()?;

                    if value.trim().parse::<u32>().ok()? == neighbor.header.ifindex {
                        Some(name)
                    } else {
                        None
                    }
                })
            })
            .unwrap_or_else(|| "—".to_string());

        let state = format!("{:?}", neighbor.header.state);

        result.push(NetworkNeighborInfo {
            ip_address,
            mac_address,
            interface_name,
            state,
        });
    }

    Ok(result)
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn network_neighbors() -> Result<Vec<NetworkNeighborInfo>, String> {
    let script = r#"
        Get-NetNeighbor |
        Select-Object IPAddress, LinkLayerAddress, InterfaceAlias, State |
        ConvertTo-Json -Compress
    "#;

    let output = tokio::task::spawn_blocking(move || {
        hidden_powershell_command()
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
    })
    .await
    .map_err(|error| format!("Windows neighbors task failed: {error}"))?
    .map_err(|error| format!("Unable to query Windows neighbors: {error}"))?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);
    let value: serde_json::Value =
        serde_json::from_str(&text).map_err(|error| format!("Invalid neighbor data: {error}"))?;

    let entries = match value {
        serde_json::Value::Array(entries) => entries,
        serde_json::Value::Object(_) => vec![value],
        _ => Vec::new(),
    };

    let mut neighbors = Vec::new();

    for entry in entries {
        let ip_address = entry["IPAddress"].as_str().unwrap_or("").to_string();
        if ip_address.is_empty() {
            continue;
        }

        let mac = entry["LinkLayerAddress"].as_str().unwrap_or("");
        let interface = entry["InterfaceAlias"].as_str().unwrap_or("—");
        let state = entry["State"].as_str().unwrap_or("Unknown");

        neighbors.push(NetworkNeighborInfo {
            ip_address,
            mac_address: if mac.is_empty() || mac == "00-00-00-00-00-00" {
                None
            } else {
                Some(mac.replace('-', ":").to_lowercase())
            },
            interface_name: interface.to_string(),
            state: state.to_string(),
        });
    }

    Ok(neighbors)
}

#[tauri::command]
async fn network_discovery(
    app_handle: tauri::AppHandle,
) -> Result<Vec<NetworkDiscoveryDevice>, String> {
    let interfaces = network_interfaces()?;
    let routes = network_routes().await?;

    // Search for active interfaces with an IPv4 and a connected route corresponding to their subnet.
    let mut candidates = interfaces
        .iter()
        .filter(|interface| {
            interface.is_up
                && !interface.is_loopback
                && interface
                    .ipv4_addresses
                    .iter()
                    .any(|address| address.parse::<Ipv4Addr>().is_ok())
        })
        .filter_map(|interface| {
            let local_ipv4 = interface
                .ipv4_addresses
                .iter()
                .find_map(|address| address.parse::<Ipv4Addr>().ok())?;

            let local_ipv4_u32 = u32::from(local_ipv4);

            let connected_route = routes
                .iter()
                .filter(|route| {
                    route.interface_name.as_deref() == Some(interface.name.as_str())
                        && route.destination.contains('/')
                        && route.gateway.is_none()
                })
                .filter_map(|route| {
                    let (address, prefix) = route.destination.split_once('/')?;
                    let network = address.parse::<Ipv4Addr>().ok()?;
                    let prefix_length = prefix.parse::<u32>().ok()?;

                    if !(1..=30).contains(&prefix_length) {
                        return None;
                    }

                    let mask = u32::MAX << (32 - prefix_length);
                    let network_u32 = u32::from(network);

                    if (local_ipv4_u32 & mask) != (network_u32 & mask) {
                        return None;
                    }

                    Some((route, prefix_length))
                })
                .max_by_key(|(_, prefix_length)| *prefix_length)?;

            Some((interface, local_ipv4, connected_route.0))
        })
        .collect::<Vec<_>>();

    if candidates.is_empty() {
        return Err(
            "No suitable connected IPv4 subnet found for network discovery".to_string()
        );
    }

    // Identify the interface associated with the default IPv4 route.
    let default_route_interface = routes
        .iter()
        .find(|route| {
            route.destination == "0.0.0.0/0"
                || route.destination == "0.0.0.0/0.0.0.0"
        })
        .and_then(|route| route.interface_name.as_deref());

    // Favor this interface if it has a directly connected subnet; otherwise use the first candidate.
    let selected_index = default_route_interface
        .and_then(|name| {
            candidates
                .iter()
                .position(|(interface, _, _)| interface.name == name)
        })
        .unwrap_or(0);

    let (local_interface, local_ipv4, local_route) =
        candidates.swap_remove(selected_index);

    let local_ipv4_u32 = u32::from(local_ipv4);

    let (network_address, prefix_length) = local_route
        .destination
        .split_once('/')
        .ok_or_else(|| "Invalid local network route".to_string())?;

    let network_ip = network_address
        .parse::<Ipv4Addr>()
        .map_err(|error| error.to_string())?;

    let prefix_length = prefix_length
        .parse::<u32>()
        .map_err(|error| error.to_string())?;

    if !(1..=30).contains(&prefix_length) {
        return Err("Network prefix must be between /1 and /30".to_string());
    }

    let host_count = (1u64 << (32 - prefix_length)) - 2;

    const MAX_DISCOVERY_TARGETS: u64 = 4094;

    if host_count > MAX_DISCOVERY_TARGETS {
        return Err(format!(
            "Network is too large for discovery ({host_count} possible hosts). Maximum: {MAX_DISCOVERY_TARGETS}."
        ));
    }

    let mask = u32::MAX << (32 - prefix_length);
    let network_u32 = u32::from(network_ip) & mask;

    let broadcast_u32 = network_u32 | !mask;

    let first_host = network_u32.saturating_add(1);
    let last_host = broadcast_u32.saturating_sub(1);

    let mut targets = Vec::new();

    for value in first_host..=last_host {
        if value == local_ipv4_u32 {
            continue;
        }

        targets.push(Ipv4Addr::from(value));
    }

    let total = targets.len();

    let concurrency = 32usize;
    let mut discovered = Vec::new();
    let mut scanned = 0usize;

    let _ = app_handle.emit(
        "network-discovery-progress",
        NetworkDiscoveryProgress {
            scanned: 0,
            total,
            discovered: 0,
        },
    );

    for chunk in targets.chunks(concurrency) {
        let mut handles = Vec::new();

        for address in chunk {
            let address = address.to_string();

            handles.push(tokio::task::spawn_blocking(move || {
                #[cfg(target_os = "linux")]
                    let output = std::process::Command::new("ping")
                        .args(["-c", "1", "-W", "1", &address])
                        .output()
                        .ok()?;

                    #[cfg(target_os = "windows")]
                    let output = std::process::Command::new("ping")
                        .args(["-n", "1", "-w", "1000", &address])
                        .output()
                        .ok()?;

                #[cfg(target_os = "windows")]

                if !output.status.success() {
                    return None;
                }

                let stdout = String::from_utf8_lossy(&output.stdout);

                let latency_ms = stdout.lines().find_map(|line| {
                    let lower = line.to_lowercase();

                    if let Some(index) = lower.find("time=").or_else(|| lower.find("temps=")) {
                        let prefix_length = if lower[index..].starts_with("temps=") {
                            6
                        } else {
                            5
                        };

                        line[index + prefix_length..]
                            .split_whitespace()
                            .next()
                            .and_then(|value| value.trim_end_matches("ms").parse::<f64>().ok())
                    } else if let Some(index) = lower.find("time<").or_else(|| lower.find("temps<")) {
                        let prefix_length = if lower[index..].starts_with("temps<") {
                            6
                        } else {
                            5
                        };

                        line[index + prefix_length..]
                            .split_whitespace()
                            .next()
                            .and_then(|value| value.trim_end_matches("ms").parse::<f64>().ok())
                            .map(|value| value / 2.0)
                    } else {
                        None
                    }
                });

                Some((address, latency_ms))
            }));
        }

        for handle in handles {
            scanned += 1;

            if let Ok(Some((address, latency_ms))) = handle.await {
                discovered.push((address, latency_ms));
            }

            let _ = app_handle.emit(
                "network-discovery-progress",
                NetworkDiscoveryProgress {
                    scanned,
                    total,
                    discovered: discovered.len(),
                },
            );
        }
    }

    let neighbors = network_neighbors().await?;

    // Keep the devices detected by ping and their latency.
    let mut discovered_map = std::collections::HashMap::new();

    for (ip_address, latency_ms) in discovered {
        discovered_map.insert(ip_address, latency_ms);
    }

    // Add known neighbors to the selected subnet, even if they are not ping.
    for neighbor in &neighbors {
        let Ok(neighbor_ip) = neighbor.ip_address.parse::<Ipv4Addr>() else {
            continue;
        };

        let neighbor_ip_u32 = u32::from(neighbor_ip);

        // Ignore local address and addresses outside the subnet.
        if neighbor_ip_u32 == local_ipv4_u32
            || (neighbor_ip_u32 & mask) != network_u32
        {
            continue;
        }

        // Do not add entries without a MAC address that are incomplete or failing.
        let state = neighbor.state.to_lowercase();
        if neighbor.mac_address.is_none()
            && (state.contains("incomplete")
                || state.contains("failed")
                || state.contains("unreachable"))
        {
            continue;
        }

        discovered_map
            .entry(neighbor.ip_address.clone())
            .or_insert(None);
    }

    let mut result = Vec::new();

    for (ip_address, latency_ms) in discovered_map {
        let neighbor = neighbors
            .iter()
            .find(|neighbor| neighbor.ip_address == ip_address);

        let hostname = match reverse_dns_lookup(ip_address.clone()).await {
            Ok(reverse_dns) => reverse_dns.hostnames.first().cloned(),
            Err(_) => None,
        };

        result.push(NetworkDiscoveryDevice {
            ip_address,
            mac_address: neighbor.and_then(|neighbor| neighbor.mac_address.clone()),
            hostname,
            vendor: neighbor
                .and_then(|neighbor| neighbor.mac_address.as_deref())
                .and_then(lookup_mac_vendor),
            interface_name: neighbor
                .map(|neighbor| neighbor.interface_name.clone())
                .unwrap_or_else(|| local_interface.name.clone()),
            state: neighbor
                .map(|neighbor| neighbor.state.clone())
                .unwrap_or_else(|| "REACHABLE".to_string()),
            latency_ms,
        });
    }

    result.sort_by(|a, b| {
        let a_ip = a.ip_address.parse::<Ipv4Addr>().ok();
        let b_ip = b.ip_address.parse::<Ipv4Addr>().ok();

        a_ip.cmp(&b_ip)
    });

    let _ = app_handle.emit(
        "network-discovery-progress",
        NetworkDiscoveryProgress {
            scanned: total,
            total,
            discovered: result.len(),
        },
    );

    Ok(result)
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn dns_info() -> Result<DnsInfo, String> {
    let output = std::process::Command::new("resolvectl")
        .arg("status")
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let text = String::from_utf8_lossy(&output.stdout);

    let mut interface_name = None;
    let mut current_server = None;
    let mut servers = Vec::new();
    let mut current_interface = None;
    let mut dns_scope_active = false;

    for line in text.lines() {
        let trimmed = line.trim();

        if trimmed.starts_with("Link ") {
            current_interface = line
                .split_once('(')
                .and_then(|(_, value)| value.split_once(')'))
                .map(|(name, _)| name.trim().to_string());

            dns_scope_active = false;
            continue;
        }

        if trimmed.starts_with("Current Scopes:") {
            dns_scope_active = trimmed.contains("DNS");

            if dns_scope_active && interface_name.is_none() {
                interface_name = current_interface.clone();
            }

            continue;
        }

        if dns_scope_active && trimmed.starts_with("Current DNS Server:") {
            current_server = trimmed
                .split_once(':')
                .map(|(_, value)| value.trim().to_string());
            continue;
        }

        if dns_scope_active && trimmed.starts_with("DNS Servers:") {
            if let Some((_, value)) = trimmed.split_once(':') {
                servers.extend(value.split_whitespace().map(str::to_string));
            }
        }
    }

    Ok(DnsInfo {
        interface_name,
        current_server,
        servers,
    })
}

#[cfg(target_os = "windows")]
#[tauri::command]
async fn dns_info() -> Result<DnsInfo, String> {

    let script = r#"
        Get-DnsClientServerAddress |
        Where-Object { $_.ServerAddresses.Count -gt 0 } |
        Select-Object InterfaceAlias, ServerAddresses |
        ConvertTo-Json -Compress
    "#;

    let output = tokio::task::spawn_blocking(move || {
        hidden_powershell_command()
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
    })
    .await
    .map_err(|error| format!("Tâche DNS Windows échouée : {error}"))?
    .map_err(|error| format!("Impossible de récupérer les DNS : {error}"))?;

    if !output.status.success() {
        return Err(
            String::from_utf8_lossy(&output.stderr)
                .trim()
                .to_string(),
        );
    }

    let text = String::from_utf8_lossy(&output.stdout);

    let value: serde_json::Value = serde_json::from_str(&text)
        .map_err(|error| format!("Réponse DNS Windows invalide : {error}"))?;

    let entries = match value {
        serde_json::Value::Array(entries) => entries,
        serde_json::Value::Object(_) => vec![value],
        _ => Vec::new(),
    };

    let mut interface_name = None;
    let mut servers = Vec::new();

    for entry in entries {
        let alias = entry["InterfaceAlias"]
            .as_str()
            .unwrap_or("")
            .to_string();

        if interface_name.is_none() && !alias.is_empty() {
            interface_name = Some(alias);
        }

        if let Some(addresses) = entry["ServerAddresses"].as_array() {
            for address in addresses {
                if let Some(address) = address.as_str() {
                    if !address.is_empty() && !servers.contains(&address.to_string()) {
                        servers.push(address.to_string());
                    }
                }
            }
        }
    }

    let current_server = servers.first().cloned();

    Ok(DnsInfo {
        interface_name,
        current_server,
        servers,
    })
}

#[cfg(target_os = "windows")]
static NET_TOOLBOX_INITIAL_DATA_CACHE: std::sync::OnceLock<
    std::sync::Mutex<Option<(std::time::Instant, NetToolBoxInitialData)>>,
> = std::sync::OnceLock::new();

#[cfg(target_os = "windows")]
static NET_TOOLBOX_INITIAL_DATA_LOCK: std::sync::OnceLock<tokio::sync::Mutex<()>> =
    std::sync::OnceLock::new();

#[cfg(target_os = "windows")]
#[tauri::command]
async fn net_toolbox_initial_data() -> Result<NetToolBoxInitialData, String> {

let _initial_data_guard = NET_TOOLBOX_INITIAL_DATA_LOCK
    .get_or_init(|| tokio::sync::Mutex::new(()))
    .lock()
    .await;

let cache = NET_TOOLBOX_INITIAL_DATA_CACHE
    .get_or_init(|| std::sync::Mutex::new(None));

if let Ok(guard) = cache.lock() {
    if let Some((timestamp, data)) = guard.as_ref() {
        if timestamp.elapsed() < std::time::Duration::from_secs(5) {

            return Ok(data.clone());
        }
    }
}

    let script = r#"
    $ErrorActionPreference = 'Stop'

    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [Console]::OutputEncoding = $utf8NoBom
    $OutputEncoding = $utf8NoBom

    $timer = [System.Diagnostics.Stopwatch]::StartNew()
    $routes = @(
        Get-NetRoute |
        Select-Object DestinationPrefix, NextHop, InterfaceAlias, RouteMetric
    )
    [Console]::Error.WriteLine("[NetToolBox timing] Get-NetRoute: $($timer.ElapsedMilliseconds) ms")

    $timer.Restart()
    $neighbors = @(
        Get-NetNeighbor |
        Select-Object IPAddress, LinkLayerAddress, InterfaceAlias, State
    )
    [Console]::Error.WriteLine("[NetToolBox timing] Get-NetNeighbor: $($timer.ElapsedMilliseconds) ms")

    $timer.Restart()
    $dns = @(
        Get-DnsClientServerAddress |
        Where-Object { $_.ServerAddresses.Count -gt 0 } |
        Select-Object InterfaceAlias, ServerAddresses
    )
    [Console]::Error.WriteLine("[NetToolBox timing] Get-DnsClientServerAddress: $($timer.ElapsedMilliseconds) ms")

    $timer.Restart()
    $adapters = @(
        Get-NetAdapter |
        Select-Object Name, Status
    )
    [Console]::Error.WriteLine("[NetToolBox timing] Get-NetAdapter: $($timer.ElapsedMilliseconds) ms")

    @{
        routes = $routes
        neighbors = $neighbors
        dns = $dns
        adapters = $adapters
    } | ConvertTo-Json -Depth 5 -Compress
    "#;

    let output = tokio::task::spawn_blocking(move || {
        hidden_powershell_command()
            .args(["-NoProfile", "-NonInteractive", "-Command", script])
            .output()
    })
    .await
    .map_err(|error| format!("Échec de la tâche réseau initiale : {error}"))?
    .map_err(|error| format!("Impossible de récupérer les données réseau : {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "PowerShell a échoué : {}",
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("Réponse réseau JSON invalide : {error}"))?;

    let as_array = |value: &serde_json::Value| -> Vec<serde_json::Value> {
        match value {
            serde_json::Value::Array(items) => items.clone(),
            serde_json::Value::Object(_) => vec![value.clone()],
            _ => Vec::new(),
        }
    };

    let routes = as_array(&json["routes"])
        .into_iter()
        .filter_map(|item| {
            let destination = item["DestinationPrefix"].as_str()?.to_string();

            if destination.is_empty() {
                return None;
            }

            let next_hop = item["NextHop"].as_str().unwrap_or_default().to_string();
            let interface_alias = item["InterfaceAlias"].as_str().unwrap_or_default().to_string();

            Some(NetworkRouteInfo {
                destination,
                gateway: if next_hop.is_empty() || next_hop == "0.0.0.0" || next_hop == "::" {
                    None
                } else {
                    Some(next_hop)
                },
                interface_name: if interface_alias.is_empty() {
                    None
                } else {
                    Some(interface_alias)
                },
                metric: item["RouteMetric"]
                    .as_u64()
                    .and_then(|value| u32::try_from(value).ok()),
            })
        })
        .collect();

    let neighbors = as_array(&json["neighbors"])
        .into_iter()
        .filter_map(|item| {
            let ip_address = item["IPAddress"].as_str()?.to_string();

            if ip_address.is_empty() {
                return None;
            }

            let raw_mac = item["LinkLayerAddress"].as_str().unwrap_or_default().to_string();
            let interface_alias = item["InterfaceAlias"].as_str().unwrap_or_default().to_string();
            let state = item["State"].as_str().unwrap_or("Unknown").to_string();

            Some(NetworkNeighborInfo {
                ip_address,
                mac_address: if raw_mac.is_empty() || raw_mac == "00-00-00-00-00-00" {
                    None
                } else {
                    Some(raw_mac.replace('-', ":").to_lowercase())
                },
                interface_name: if interface_alias.is_empty() {
                    "—".to_string()
                } else {
                    interface_alias
                },
                state,
            })
        })
        .collect();

    let dns_items = as_array(&json["dns"]);
    let mut dns_servers = Vec::new();
    let mut dns_interface = None;

    for item in dns_items {
        let alias = item["InterfaceAlias"].as_str().unwrap_or_default().to_string();

        if dns_interface.is_none() && !alias.is_empty() {
            dns_interface = Some(alias);
        }

        for server in as_array(&item["ServerAddresses"]) {
            if let Some(server) = server.as_str() {
                if !server.is_empty() && !dns_servers.iter().any(|existing| existing == server) {
                    dns_servers.push(server.to_string());
                }
            }
        }
    }

    let dns_info = DnsInfo {
        interface_name: dns_interface,
        current_server: dns_servers.first().cloned(),
        servers: dns_servers,
    };

    let mut interface_states = BTreeMap::new();

    for item in as_array(&json["adapters"]) {
        let name = item["Name"].as_str().unwrap_or_default().to_string();
        let status = item["Status"].as_str().unwrap_or_default();

        if !name.is_empty() {
            interface_states.insert(name, status.eq_ignore_ascii_case("Up"));
        }
    }

        let interface_cache = INTERFACE_STATES_CACHE
        .get_or_init(|| std::sync::Mutex::new(None));

    if let Ok(mut guard) = interface_cache.lock() {
        *guard = Some((std::time::Instant::now(), interface_states));
    }

    let data = NetToolBoxInitialData {
        routes,
        neighbors,
        dns_info,
    };

    let initial_data_cache = NET_TOOLBOX_INITIAL_DATA_CACHE
        .get_or_init(|| std::sync::Mutex::new(None));

    if let Ok(mut guard) = initial_data_cache.lock() {
        *guard = Some((std::time::Instant::now(), data.clone()));
    }

    Ok(data)
}

fn ssh_credential_entry(server_id: &str) -> Result<Entry, String> {
    let server_id = server_id.trim();

    if server_id.is_empty() {
        return Err("Server ID cannot be empty".to_string());
    }

    Entry::new("nexus-ssh", server_id)
        .map_err(|error| format!("Failed to access secure credential storage: {error}"))
}

#[tauri::command]
fn save_ssh_password(server_id: String, password: String) -> Result<(), String> {
    if password.is_empty() {
        return Err("Password cannot be empty".to_string());
    }

    let entry = ssh_credential_entry(&server_id)?;

    entry
        .set_password(&password)
        .map_err(|error| format!("Failed to save SSH credential securely: {error}"))
}

#[tauri::command]
fn get_ssh_password(server_id: String) -> Result<Option<String>, String> {
    let entry = ssh_credential_entry(&server_id)?;

    match entry.get_password() {
        Ok(password) => Ok(Some(password)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(format!(
            "Failed to read SSH credential securely: {error}"
        )),
    }
}

#[tauri::command]
fn delete_ssh_password(server_id: String) -> Result<(), String> {
    let entry = ssh_credential_entry(&server_id)?;

    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Failed to delete SSH credential securely: {error}"
        )),
    }
}

fn init_database(app_handle: &tauri::AppHandle) -> Result<Connection, String> {
    let app_data_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to resolve app data directory: {error}"))?;

    std::fs::create_dir_all(&app_data_dir)
        .map_err(|error| format!("Failed to create app data directory: {error}"))?;

    let database_path: PathBuf = app_data_dir.join("nexus.db");

    let connection = Connection::open(&database_path)
        .map_err(|error| format!("Failed to open NEXUS database: {error}"))?;

    connection
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS ssh_servers (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                username TEXT NOT NULL,
                port INTEGER NOT NULL,
                authentication_method TEXT NOT NULL,
                private_key_path TEXT,
                group_name TEXT,
                favorite INTEGER NOT NULL DEFAULT 0,
                remember_password INTEGER NOT NULL DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS ssh_connection_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                server_id TEXT NOT NULL,
                server_name TEXT NOT NULL,
                host TEXT NOT NULL,
                authentication_method TEXT NOT NULL,
                status TEXT NOT NULL,
                message TEXT NOT NULL,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );

            "#,
        )
        .map_err(|error| format!("Failed to initialize NEXUS database: {error}"))?;

        connection
            .execute(
                "ALTER TABLE ssh_servers ADD COLUMN host_key_fingerprint TEXT",
                [],
            )
            .or_else(|error| {
                if error.to_string().contains("duplicate column name") {
                    Ok(0)
                } else {
                    Err(error)
                }
            })
            .map_err(|error| format!("Failed to migrate NEXUS database: {error}"))?;

    Ok(connection)
}

#[derive(Debug, Serialize)]
struct SshKeyInfo {
    name: String,
    path: String,
    key_type: String,
    public_key_path: Option<String>,
    fingerprint: Option<String>,
}

#[tauri::command]
fn list_ssh_keys() -> Result<Vec<SshKeyInfo>, String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Unable to determine home directory".to_string())?;

    let ssh_dir = home_dir.join(".ssh");

    if !ssh_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = std::fs::read_dir(&ssh_dir)
        .map_err(|error| format!("Failed to read ~/.ssh: {error}"))?;

    let mut keys = Vec::new();

    for entry in entries {
        let entry = entry
            .map_err(|error| format!("Failed to read SSH directory entry: {error}"))?;

        let path = entry.path();

        if !path.is_file() {
            continue;
        }

        let file_name = match path.file_name().and_then(|name| name.to_str()) {
            Some(name) => name,
            None => continue,
        };

        if file_name.ends_with(".pub") {
            continue;
        }

        let key_type = if file_name.contains("ed25519") {
            "ED25519"
        } else if file_name.contains("rsa") {
            "RSA"
        } else if file_name.contains("ecdsa") {
            "ECDSA"
        } else if file_name.contains("dsa") {
            "DSA"
        } else {
            continue;
        };

        let public_key_path = path.with_file_name(format!("{file_name}.pub"));

        let fingerprint = if public_key_path.exists() {
            match std::fs::read_to_string(&public_key_path) {
                Ok(public_key) => match ssh_key::PublicKey::from_openssh(public_key.trim()) {
                    Ok(key) => Some(key.fingerprint(Default::default()).to_string()),
                    Err(_) => None,
                },
                Err(_) => None,
            }
        } else {
            None
        };

        keys.push(SshKeyInfo {
            name: file_name.to_string(),
            path: path.to_string_lossy().to_string(),
            key_type: key_type.to_string(),
            public_key_path: if public_key_path.exists() {
                Some(public_key_path.to_string_lossy().to_string())
            } else {
                None
            },
            fingerprint,
        });
    }

    keys.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(keys)
}

#[tauri::command]
fn generate_ssh_key(
    name: String,
    passphrase: Option<String>,
) -> Result<SshKeyInfo, String> {
    use std::fs::OpenOptions;
    use std::io::Write;

    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Unable to determine home directory".to_string())?;

    let ssh_dir = home_dir.join(".ssh");

    std::fs::create_dir_all(&ssh_dir)
        .map_err(|error| format!("Failed to create ~/.ssh: {error}"))?;

    let file_name = name.trim();

    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || file_name == "."
        || file_name == ".."
        || file_name.contains('\0')
    {
        return Err("Invalid SSH key name".to_string());
    }

    let private_key_path = ssh_dir.join(file_name);
    let public_key_path = ssh_dir.join(format!("{file_name}.pub"));

    if private_key_path.exists() || public_key_path.exists() {
        return Err(format!(
            "SSH key already exists: {}",
            private_key_path.display()
        ));
    }

    let private_key = ssh_key::PrivateKey::random(
        &mut OsRng,
        ssh_key::Algorithm::Ed25519,
    )
    .map_err(|error| format!("Failed to generate ED25519 key: {error}"))?;

    let private_key = match passphrase {
        Some(passphrase) if !passphrase.is_empty() => private_key
            .encrypt(&mut OsRng, passphrase.as_bytes())
            .map_err(|error| format!("Failed to encrypt private key: {error}"))?,
        _ => private_key,
    };

    let private_key_openssh = private_key
        .to_openssh(ssh_key::LineEnding::LF)
        .map_err(|error| format!("Failed to encode private key: {error}"))?;

    let public_key = private_key
        .public_key()
        .to_openssh()
        .map_err(|error| format!("Failed to encode public key: {error}"))?;

    let mut private_options = OpenOptions::new();
    private_options.write(true).create_new(true);

    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        private_options.mode(0o600);
    }

    let mut private_file = private_options
        .open(&private_key_path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                "SSH key already exists".to_string()
            } else {
                format!("Failed to create private key: {error}")
            }
        })?;

    if let Err(error) = private_file.write_all(private_key_openssh.as_bytes()) {
        drop(private_file);
        let _ = std::fs::remove_file(&private_key_path);
        return Err(format!("Failed to write private key: {error}"));
    }

    drop(private_file);

    let mut public_options = OpenOptions::new();
    public_options.write(true).create_new(true);

    let mut public_file = match public_options.open(&public_key_path) {
        Ok(file) => file,
        Err(error) => {
            let _ = std::fs::remove_file(&private_key_path);
            return Err(if error.kind() == std::io::ErrorKind::AlreadyExists {
                "SSH public key already exists".to_string()
            } else {
                format!("Failed to create public key: {error}")
            });
        }
    };

    if let Err(error) = writeln!(public_file, "{public_key}") {
        drop(public_file);
        let _ = std::fs::remove_file(&public_key_path);
        let _ = std::fs::remove_file(&private_key_path);
        return Err(format!("Failed to write public key: {error}"));
    }

    drop(public_file);

    let fingerprint = private_key
        .public_key()
        .fingerprint(Default::default())
        .to_string();

    Ok(SshKeyInfo {
        name: file_name.to_string(),
        path: private_key_path.to_string_lossy().to_string(),
        key_type: "ED25519".to_string(),
        public_key_path: Some(public_key_path.to_string_lossy().to_string()),
        fingerprint: Some(fingerprint),
    })
}

#[tauri::command]
fn delete_ssh_key(path: String) -> Result<(), String> {
    use std::path::{Component, Path, PathBuf};

    let home_dir = dirs::home_dir()
        .ok_or_else(|| "Unable to determine home directory".to_string())?;

    let ssh_dir = home_dir.join(".ssh");

    let private_key_path = PathBuf::from(&path);

    // Require an absolute path directly inside ~/.ssh.
    if !private_key_path.is_absolute() {
        return Err("Invalid SSH key path".to_string());
    }

    let parent = private_key_path
        .parent()
        .ok_or_else(|| "Invalid SSH key path".to_string())?;

    if parent != Path::new(&ssh_dir) {
        return Err("SSH key must be directly inside ~/.ssh".to_string());
    }

    // Reject unusual path components and files with extensions.
    if private_key_path.components().any(|component| {
        matches!(component, Component::CurDir | Component::ParentDir)
    }) {
        return Err("Invalid SSH key path".to_string());
    }

    if private_key_path.extension().is_some() {
        return Err("Invalid SSH private key path".to_string());
    }

    let metadata = std::fs::symlink_metadata(&private_key_path)
        .map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                "SSH private key not found".to_string()
            } else {
                format!("Failed to inspect private key: {error}")
            }
        })?;

    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("SSH private key must be a regular file".to_string());
    }

    let file_name = private_key_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "Invalid SSH key filename".to_string())?;

    let public_key_path = ssh_dir.join(format!("{file_name}.pub"));

    // Inspect the public key without following symbolic links.
    match std::fs::symlink_metadata(&public_key_path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err("SSH public key must be a regular file".to_string());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!("Failed to inspect public key: {error}"));
        }
    }

    std::fs::remove_file(&private_key_path)
        .map_err(|error| format!("Failed to delete private key: {error}"))?;

    match std::fs::remove_file(&public_key_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Private key deleted, but failed to delete public key: {error}"
            ));
        }
    }

    Ok(())
}

#[derive(Debug, Serialize, serde::Deserialize)]
struct SshServerRecord {
    id: String,
    name: String,
    host: String,
    username: String,
    port: u16,
    authentication_method: String,
    private_key_path: Option<String>,
    group_name: Option<String>,
    favorite: bool,
    remember_password: bool,
    host_key_fingerprint: Option<String>,
}

#[derive(Debug, Clone)]
struct SshConnectionConfig {
    host: String,
    username: String,
    port: u16,
    authentication_method: String,
    private_key_path: Option<String>,
}

#[derive(Debug, Serialize)]
struct SshTestConnectionResult {
    status: String,
    message: String,
    host_key_fingerprint: Option<String>,
}

fn ssh_connection_config(server: &SshServerRecord) -> SshConnectionConfig {
    SshConnectionConfig {
        host: server.host.clone(),
        username: server.username.clone(),
        port: server.port,
        authentication_method: server.authentication_method.clone(),
        private_key_path: server.private_key_path.clone(),
    }
}

struct NexusSshHandler {
    expected_host_key_fingerprint: Option<String>,
    presented_host_key_fingerprint: std::sync::Arc<
        std::sync::Mutex<Option<String>>,
    >,
}

impl NexusSshHandler {
    fn new(expected_host_key_fingerprint: Option<String>) -> Self {
        Self {
            expected_host_key_fingerprint,
            presented_host_key_fingerprint: std::sync::Arc::new(
                std::sync::Mutex::new(None),
            ),
        }
    }

    fn presented_host_key_fingerprint(
        &self,
    ) -> std::sync::Arc<std::sync::Mutex<Option<String>>> {
        std::sync::Arc::clone(&self.presented_host_key_fingerprint)
    }
}

impl client::Handler for NexusSshHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        server_public_key: &russh::keys::PublicKeyOrCertificate,
    ) -> Result<bool, Self::Error> {
        let actual_fingerprint = server_public_key
            .public_key()
            .fingerprint(russh::keys::ssh_key::HashAlg::Sha256)
            .to_string();

        if let Ok(mut fingerprint) = self.presented_host_key_fingerprint.lock() {
            *fingerprint = Some(actual_fingerprint.clone());
        }

        let Some(expected_fingerprint) = self.expected_host_key_fingerprint.as_deref() else {
            return Ok(false);
        };

        Ok(actual_fingerprint == expected_fingerprint)
    }
}

async fn connect_ssh_server(
    config: &SshConnectionConfig,
    expected_host_key_fingerprint: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    let ssh_config = std::sync::Arc::new(russh::client::Config::default());

    let handler = NexusSshHandler::new(expected_host_key_fingerprint.clone());
    let presented_host_key_fingerprint = handler.presented_host_key_fingerprint();

    let address = format!("{}:{}", config.host, config.port);

    let mut handle = match russh::client::connect(ssh_config, address, handler).await {
        Ok(handle) => handle,
        Err(error) => {
            let presented_fingerprint = presented_host_key_fingerprint
                .lock()
                .ok()
                .and_then(|fingerprint| fingerprint.clone());

            if let Some(fingerprint) = presented_fingerprint {
                if expected_host_key_fingerprint.is_some() {
                    return Err(format!(
                        "SSH host key mismatch: {fingerprint}"
                    ));
                }

                return Err(format!(
                    "SSH host key not trusted yet: {fingerprint}"
                ));
            }

            return Err(format!("SSH connection failed: {error}"));
        }
    };

    match config.authentication_method.as_str() {
        "password" => {
            let password = password.ok_or_else(|| {
                "No SSH password is available for this server".to_string()
            })?;

            let result = handle
                .authenticate_password(&config.username, password)
                .await
                .map_err(|error| format!("SSH authentication failed: {error}"))?;

            if !result.success() {
                return Err("SSH authentication was rejected by the server".to_string());
            }
        }

                "ssh-agent" => {
            let provider = crate::ssh_auth::SshAgentProvider::new();

            let result = provider
                .authenticate(&mut handle, &config.username)
                .await?;

            if !result.success() {
                return Err(
                    "SSH Agent authentication was rejected by the server"
                        .to_string(),
                );
            }
        }

                "private-key" => {
            let key_path = config
                .private_key_path
                .clone()
                .ok_or_else(|| {
                    "No SSH private key is configured for this server"
                        .to_string()
                })?;

            let provider =
                crate::ssh_auth::PrivateKeyProvider::new(key_path);

            let result = provider
                .authenticate(
                    &mut handle,
                    &config.username,
                    None,
                )
                .await?;

            if !result.success() {
                return Err(
                    "SSH private key authentication was rejected by the server"
                        .to_string(),
                );
            }
        }

        method => {
            return Err(format!(
                "SSH authentication method is not implemented yet: {method}"
            ));
        }
    }

    Ok(())
}

async fn connect_sftp_server(
    config: &SshConnectionConfig,
    expected_host_key_fingerprint: Option<String>,
    password: Option<String>,
) -> Result<russh_sftp::client::SftpSession, String> {
    let ssh_config = std::sync::Arc::new(russh::client::Config::default());

    let handler = NexusSshHandler::new(expected_host_key_fingerprint.clone());
    let presented_host_key_fingerprint = handler.presented_host_key_fingerprint();

    let address = format!("{}:{}", config.host, config.port);

    let mut handle = match russh::client::connect(ssh_config, address, handler).await {
        Ok(handle) => handle,
        Err(error) => {
            let presented_fingerprint = presented_host_key_fingerprint
                .lock()
                .ok()
                .and_then(|fingerprint| fingerprint.clone());

            if let Some(fingerprint) = presented_fingerprint {
                if expected_host_key_fingerprint.is_some() {
                    return Err(format!(
                        "SSH host key mismatch: {fingerprint}"
                    ));
                }

                return Err(format!(
                    "SSH host key not trusted yet: {fingerprint}"
                ));
            }

            return Err(format!("SSH connection failed: {error}"));
        }
    };

    match config.authentication_method.as_str() {
        "password" => {
            let password = password.ok_or_else(|| {
                "No SSH password is available for this server".to_string()
            })?;

            let result = handle
                .authenticate_password(&config.username, password)
                .await
                .map_err(|error| format!("SSH authentication failed: {error}"))?;

            if !result.success() {
                return Err(
                    "SSH authentication was rejected by the server"
                        .to_string(),
                );
            }
        }

        "ssh-agent" => {
            let provider = crate::ssh_auth::SshAgentProvider::new();

            let result = provider
                .authenticate(&mut handle, &config.username)
                .await?;

            if !result.success() {
                return Err(
                    "SSH Agent authentication was rejected by the server"
                        .to_string(),
                );
            }
        }

        "private-key" => {
            let key_path = config
                .private_key_path
                .clone()
                .ok_or_else(|| {
                    "No SSH private key is configured for this server"
                        .to_string()
                })?;

            let provider =
                crate::ssh_auth::PrivateKeyProvider::new(key_path);

            let result = provider
                .authenticate(
                    &mut handle,
                    &config.username,
                    None,
                )
                .await?;

            if !result.success() {
                return Err(
                    "SSH private key authentication was rejected by the server"
                        .to_string(),
                );
            }
        }

        method => {
            return Err(format!(
                "SSH authentication method is not implemented yet: {method}"
            ));
        }
    }

    let channel = handle
        .channel_open_session()
        .await
        .map_err(|error| {
            format!("Failed to open SFTP SSH channel: {error}")
        })?;

    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|error| {
            format!("Failed to request SFTP subsystem: {error}")
        })?;

    let sftp = russh_sftp::client::SftpSession::new(channel.into_stream())
        .await
        .map_err(|error| {
            format!("Failed to initialize SFTP session: {error}")
        })?;

    Ok(sftp)
}

#[derive(Debug, Serialize)]
struct SftpTestConnectionResult {
    status: String,
    message: String,
    host_key_fingerprint: Option<String>,
}

#[tauri::command]
async fn sftp_test_connection(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<SftpTestConnectionResult, String> {
    let connection = init_database(&app_handle)?;

    let server = connection
        .query_row(
            r#"
            SELECT
                id,
                name,
                host,
                username,
                port,
                authentication_method,
                private_key_path,
                group_name,
                favorite,
                remember_password,
                host_key_fingerprint
            FROM ssh_servers
            WHERE id = ?1
            "#,
            params![server_id],
            |row| {
                Ok(SshServerRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    username: row.get(3)?,
                    port: row.get(4)?,
                    authentication_method: row.get(5)?,
                    private_key_path: row.get(6)?,
                    group_name: row.get(7)?,
                    favorite: row.get::<_, i64>(8)? != 0,
                    remember_password: row.get::<_, i64>(9)? != 0,
                    host_key_fingerprint: row.get(10)?,
                })
            },
        )
        .map_err(|error| format!("Failed to load SSH server: {error}"))?;

    let config = ssh_connection_config(&server);

    let password = if server.authentication_method == "password" {
        get_ssh_password(server.id.clone())?
    } else {
        None
    };

    match connect_sftp_server(
        &config,
        server.host_key_fingerprint.clone(),
        password,
    )
    .await
    {
        Ok(_sftp) => Ok(SftpTestConnectionResult {
            status: "connected".to_string(),
            message: "SFTP connection successful".to_string(),
            host_key_fingerprint: server.host_key_fingerprint,
        }),

        Err(error) if error.starts_with("SSH host key not trusted yet: ") => {
            let fingerprint = error
                .strip_prefix("SSH host key not trusted yet: ")
                .map(str::to_string);

            Ok(SftpTestConnectionResult {
                status: "host-key-required".to_string(),
                message: "This SSH host key has not been trusted yet"
                    .to_string(),
                host_key_fingerprint: fingerprint,
            })
        }

        Err(error) if error.starts_with("SSH host key mismatch: ") => {
            let fingerprint = error
                .strip_prefix("SSH host key mismatch: ")
                .map(str::to_string);

            Ok(SftpTestConnectionResult {
                status: "host-key-mismatch".to_string(),
                message: "The SSH host key does not match the trusted key"
                    .to_string(),
                host_key_fingerprint: fingerprint,
            })
        }

        Err(error) => Ok(SftpTestConnectionResult {
            status: "error".to_string(),
            message: error,
            host_key_fingerprint: None,
        }),
    }
}

#[derive(Debug, Serialize)]
struct SftpDirectoryEntry {
    name: String,
    entry_type: String,
    size: u64,
}

#[derive(Debug, Serialize)]
struct SftpDirectoryResult {
    path: String,
    entries: Vec<SftpDirectoryEntry>,
}

#[tauri::command]
async fn sftp_list_directory(
    app_handle: tauri::AppHandle,
    server_id: String,
    path: String,
) -> Result<SftpDirectoryResult, String> {
    let connection = init_database(&app_handle)?;

    let server = connection
        .query_row(
            r#"
            SELECT
                id,
                name,
                host,
                username,
                port,
                authentication_method,
                private_key_path,
                group_name,
                favorite,
                remember_password,
                host_key_fingerprint
            FROM ssh_servers
            WHERE id = ?1
            "#,
            params![server_id],
            |row| {
                Ok(SshServerRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    username: row.get(3)?,
                    port: row.get(4)?,
                    authentication_method: row.get(5)?,
                    private_key_path: row.get(6)?,
                    group_name: row.get(7)?,
                    favorite: row.get(8)?,
                    remember_password: row.get(9)?,
                    host_key_fingerprint: row.get(10)?,
                })
            },
        )
        .map_err(|error| format!("Failed to load SSH server: {error}"))?;

    let config = ssh_connection_config(&server);

    let password = if server.authentication_method == "password" {
        get_ssh_password(server.id.clone())?
    } else {
        None
    };

    let sftp = connect_sftp_server(
        &config,
        server.host_key_fingerprint.clone(),
        password,
    )
    .await?;

    let resolved_path = sftp
        .canonicalize(path)
        .await
        .map_err(|error| {
            format!("Failed to resolve SFTP path: {error}")
        })?;

    let directory = sftp
        .read_dir(resolved_path.clone())
        .await
        .map_err(|error| {
            format!("Failed to read SFTP directory: {error}")
        })?;

    let mut entries = Vec::new();

    for entry in directory {
        let metadata = entry.metadata();

        let entry_type = if metadata.is_dir() {
            "directory"
        } else if metadata.is_regular() {
            "file"
        } else {
            "other"
        };

        entries.push(SftpDirectoryEntry {
            name: entry.file_name(),
            entry_type: entry_type.to_string(),
            size: metadata.len(),
        });
    }

    entries.sort_by(|left, right| {
        left.entry_type
            .cmp(&right.entry_type)
            .then_with(|| {
                left.name
                    .to_lowercase()
                    .cmp(&right.name.to_lowercase())
            })
    });

    Ok(SftpDirectoryResult {
        path: resolved_path,
        entries,
    })
}

#[tauri::command]
async fn sftp_create_directory(
    app_handle: tauri::AppHandle,
    server_id: String,
    path: String,
    name: String,
) -> Result<(), String> {
    let name = name.trim();

    if name.is_empty() {
        return Err("Directory name cannot be empty".to_string());
    }

    if name == "." || name == ".." || name.contains('/') || name.contains('\\') {
        return Err("Invalid directory name".to_string());
    }

    let connection = init_database(&app_handle)?;

    let server = connection
        .query_row(
            r#"
            SELECT
                id,
                name,
                host,
                username,
                port,
                authentication_method,
                private_key_path,
                group_name,
                favorite,
                remember_password,
                host_key_fingerprint
            FROM ssh_servers
            WHERE id = ?1
            "#,
            params![server_id],
            |row| {
                Ok(SshServerRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    username: row.get(3)?,
                    port: row.get(4)?,
                    authentication_method: row.get(5)?,
                    private_key_path: row.get(6)?,
                    group_name: row.get(7)?,
                    favorite: row.get(8)?,
                    remember_password: row.get(9)?,
                    host_key_fingerprint: row.get(10)?,
                })
            },
        )
        .map_err(|error| format!("Failed to load SSH server: {error}"))?;

    let config = ssh_connection_config(&server);

    let password = if server.authentication_method == "password" {
        get_ssh_password(server.id.clone())?
    } else {
        None
    };

    let sftp = connect_sftp_server(
        &config,
        server.host_key_fingerprint.clone(),
        password,
    )
    .await?;

    let current_path = sftp
        .canonicalize(path)
        .await
        .map_err(|error| {
            format!("Failed to resolve SFTP path: {error}")
        })?;

    let new_directory = format!("{}/{}", current_path.trim_end_matches('/'), name);

    sftp.create_dir(new_directory)
        .await
        .map_err(|error| {
            format!("Failed to create SFTP directory: {error}")
        })?;

    Ok(())
}

#[tauri::command]
async fn sftp_upload_file(
    app_handle: tauri::AppHandle,
    server_id: String,
    local_path: String,
    remote_path: String,
) -> Result<(), String> {
    use tokio::io::AsyncReadExt;

    // Open the local file without loading it fully into memory.
    let mut local_file = tokio::fs::File::open(&local_path)
        .await
        .map_err(|error| {
            format!("Failed to open local file '{local_path}': {error}")
        })?;

    // 2. Retrieve the SSH server configuration.
    let connection = init_database(&app_handle)?;

    let server = connection
        .query_row(
            r#"
            SELECT
                id,
                name,
                host,
                username,
                port,
                authentication_method,
                private_key_path,
                group_name,
                favorite,
                remember_password,
                host_key_fingerprint
            FROM ssh_servers
            WHERE id = ?1
            "#,
            params![server_id],
            |row| {
                Ok(SshServerRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    username: row.get(3)?,
                    port: row.get(4)?,
                    authentication_method: row.get(5)?,
                    private_key_path: row.get(6)?,
                    group_name: row.get(7)?,
                    favorite: row.get(8)?,
                    remember_password: row.get(9)?,
                    host_key_fingerprint: row.get(10)?,
                })
            },
        )
        .map_err(|error| format!("Failed to load SSH server: {error}"))?;

    let config = ssh_connection_config(&server);

    // 3. Retrieve the password if necessary.
    let password = if server.authentication_method == "password" {
        get_ssh_password(server.id.clone())?
    } else {
        None
    };

    // 4. Establish the SFTP session.
    let sftp = connect_sftp_server(
        &config,
        server.host_key_fingerprint.clone(),
        password,
    )
    .await?;

    // 5. Check the remote path and send the file.
    let resolved_path = sftp
        .canonicalize(remote_path.clone())
        .await
        .map_err(|error| {
            format!("Failed to resolve remote path '{remote_path}': {error}")
        })?;

    let mut remote_file = sftp
        .create(resolved_path.clone())
        .await
        .map_err(|error| {
            format!("Failed to create remote file '{resolved_path}': {error}")
        })?;

    let mut buffer = vec![0u8; 64 * 1024];

    loop {
        let bytes_read = local_file
            .read(&mut buffer)
            .await
            .map_err(|error| {
                format!("Failed to read local file '{local_path}': {error}")
            })?;

        if bytes_read == 0 {
            break;
        }

        remote_file
            .write_all(&buffer[..bytes_read])
            .await
            .map_err(|error| {
                format!("Failed to write remote file '{resolved_path}': {error}")
            })?;
    }

    remote_file
        .shutdown()
        .await
        .map_err(|error| {
            format!("Failed to finalize remote file '{resolved_path}': {error}")
        })?;

    Ok(())
}

#[tauri::command]
async fn sftp_upload_multiple(
    app_handle: tauri::AppHandle,
    server_id: String,
    local_paths: Vec<String>,
    remote_directory: String,
) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;
    use tokio::io::AsyncReadExt;

    if local_paths.is_empty() {
        return Err("Aucun fichier ou dossier sélectionné.".to_string());
    }

    let transfer_id = uuid::Uuid::new_v4().to_string();
    let cancel_flag = Arc::new(AtomicBool::new(false));

    {
        let registry = app_handle.state::<SftpTransferRegistry>();
        let mut active = registry
            .active
            .lock()
            .map_err(|_| "Impossible d'accéder au registre des transferts.".to_string())?;

        active.insert(transfer_id.clone(), Arc::clone(&cancel_flag));
    }

    let _transfer_guard = SftpTransferGuard {
        app_handle: app_handle.clone(),
        transfer_id: transfer_id.clone(),
    };

    let connection = init_database(&app_handle)?;

    let server = connection
        .query_row(
            r#"
            SELECT
                id, name, host, username, port, authentication_method,
                private_key_path, group_name, favorite, remember_password,
                host_key_fingerprint
            FROM ssh_servers
            WHERE id = ?1
            "#,
            params![server_id],
            |row| {
                Ok(SshServerRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    username: row.get(3)?,
                    port: row.get(4)?,
                    authentication_method: row.get(5)?,
                    private_key_path: row.get(6)?,
                    group_name: row.get(7)?,
                    favorite: row.get(8)?,
                    remember_password: row.get(9)?,
                    host_key_fingerprint: row.get(10)?,
                })
            },
        )
        .map_err(|error| format!("Failed to load SSH server: {error}"))?;

    let config = ssh_connection_config(&server);

    let password = if server.authentication_method == "password" {
        get_ssh_password(server.id.clone())?
    } else {
        None
    };

    let sftp = connect_sftp_server(
        &config,
        server.host_key_fingerprint.clone(),
        password,
    )
    .await?;

    let remote_directory = sftp
        .canonicalize(remote_directory.clone())
        .await
        .map_err(|error| {
            format!("Impossible d'accéder au dossier distant : {error}")
        })?;

    // Collects the files to be transferred and the necessary folders. Each folder selected is created under its name in the destination.
    let mut files_to_upload: Vec<(PathBuf, String)> = Vec::new();
    let mut directories_to_create: Vec<String> = Vec::new();
    let mut total_bytes = 0u64;

    fn remote_join(parent: &str, name: &str) -> String {
        format!("{}/{}", parent.trim_end_matches('/'), name)
    }

    fn collect_local_entries(
        local_path: &Path,
        remote_path: &str,
        files: &mut Vec<(PathBuf, String)>,
        directories: &mut Vec<String>,
        total_bytes: &mut u64,
    ) -> Result<(), String> {
        let metadata = std::fs::metadata(local_path)
            .map_err(|error| {
                format!("Impossible de lire '{}': {error}", local_path.display())
            })?;

        if metadata.is_file() {
            files.push((local_path.to_path_buf(), remote_path.to_string()));
            *total_bytes = total_bytes.saturating_add(metadata.len());
            return Ok(());
        }

        if !metadata.is_dir() {
            return Err(format!(
                "'{}' n'est ni un fichier ordinaire ni un dossier.",
                local_path.display()
            ));
        }

        directories.push(remote_path.to_string());

        let entries = std::fs::read_dir(local_path)
            .map_err(|error| {
                format!(
                    "Impossible de lire le dossier '{}': {error}",
                    local_path.display()
                )
            })?;

        for entry in entries {
            let entry = entry.map_err(|error| {
                format!(
                    "Impossible de parcourir le dossier '{}': {error}",
                    local_path.display()
                )
            })?;

            let child_path = entry.path();
            let child_name = entry
                .file_name()
                .into_string()
                .map_err(|_| {
                    format!(
                        "Un nom de fichier n'est pas valide en UTF-8 dans '{}'.",
                        local_path.display()
                    )
                })?;

            let child_remote_path = remote_join(remote_path, &child_name);

            collect_local_entries(
                &child_path,
                &child_remote_path,
                files,
                directories,
                total_bytes,
            )?;
        }

        Ok(())
    }

    for local_path in &local_paths {
        let path = Path::new(local_path);

        let name = path
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| {
                format!("Impossible de déterminer le nom de '{local_path}'")
            })?;

        let metadata = std::fs::metadata(path)
            .map_err(|error| format!("Impossible de lire '{local_path}': {error}"))?;

        let target_path = if metadata.is_dir() {
            remote_join(&remote_directory, name)
        } else {
            remote_join(&remote_directory, name)
        };

        collect_local_entries(
            path,
            &target_path,
            &mut files_to_upload,
            &mut directories_to_create,
            &mut total_bytes,
        )?;
    }

    // Create the folders first, from parents to children.
    let created_paths: Arc<Mutex<Vec<(String, bool)>>> =
        Arc::new(Mutex::new(Vec::new()));

    let transfer_result: Result<(), String> = async {
        for directory in &directories_to_create {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err("Transfert annulé.".to_string());
            }

            sftp.create_dir(directory.clone())
                .await
                .map_err(|error| {
                    format!(
                        "Impossible de créer le dossier distant '{directory}' (il existe peut-être déjà): {error}"
                    )
                })?;

            created_paths
                .lock()
                .map_err(|_| "Impossible d'accéder aux éléments créés.".to_string())?
                .push((directory.clone(), true));
        }

        let transferred_bytes = Arc::new(AtomicU64::new(0));

        for (local_path, remote_path) in &files_to_upload {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err("Transfert annulé.".to_string());
            }

            let file_name = local_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("file")
                .to_string();

            let mut local_file = tokio::fs::File::open(local_path)
                .await
                .map_err(|error| {
                    format!(
                        "Impossible d'ouvrir '{}': {error}",
                        local_path.display()
                    )
                })?;

            let mut remote_file = sftp
                .open_with_flags(
                    remote_path.clone(),
                    OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE,
                )
                .await
                .map_err(|error| {
                    format!(
                        "Impossible de créer '{remote_path}' (le fichier existe peut-être déjà): {error}"
                    )
                })?;

            created_paths
                .lock()
                .map_err(|_| "Impossible d'accéder aux éléments créés.".to_string())?
                .push((remote_path.clone(), false));

            let mut buffer = vec![0u8; 64 * 1024];

            loop {
                if cancel_flag.load(Ordering::Relaxed) {
                    return Err("Transfert annulé.".to_string());
                }

                let bytes_read = local_file
                    .read(&mut buffer)
                    .await
                    .map_err(|error| {
                        format!(
                            "Erreur de lecture de '{}': {error}",
                            local_path.display()
                        )
                    })?;

                if bytes_read == 0 {
                    break;
                }

                remote_file
                    .write_all(&buffer[..bytes_read])
                    .await
                    .map_err(|error| {
                        format!("Erreur d'écriture de '{remote_path}': {error}")
                    })?;

                let current_bytes = transferred_bytes
                    .fetch_add(bytes_read as u64, Ordering::Relaxed)
                    + bytes_read as u64;

                app_handle
                    .emit(
                        "sftp-transfer-progress",
                        SftpTransferProgress {
                            transfer_id: transfer_id.clone(),
                            transferred_bytes: current_bytes,
                            total_bytes,
                            file_name: file_name.clone(),
                            completed: false,
                        },
                    )
                    .map_err(|error| {
                        format!("Impossible d'envoyer la progression: {error}")
                    })?;
            }

            remote_file
                .shutdown()
                .await
                .map_err(|error| {
                    format!("Impossible de finaliser '{remote_path}': {error}")
                })?;
        }

        Ok(())
    }
    .await;

    if let Err(error) = transfer_result {
        let paths = created_paths
            .lock()
            .map(|paths| paths.clone())
            .unwrap_or_default();

        // The items were saved in the order they were created. We delete them in reverse to remove the files before the folders.
        for (path, is_directory) in paths.iter().rev() {
            if *is_directory {
                let _ = sftp.remove_dir(path.clone()).await;
            } else {
                let _ = sftp.remove_file(path.clone()).await;
            }
        }

        return Err(error);
    }

    app_handle
        .emit(
            "sftp-transfer-progress",
            SftpTransferProgress {
                transfer_id,
                transferred_bytes: total_bytes,
                total_bytes,
                file_name: String::new(),
                completed: true,
            },
        )
        .map_err(|error| format!("Impossible de finaliser la progression: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn sftp_delete_entry(
    app_handle: tauri::AppHandle,
    server_id: String,
    remote_path: String,
    recursive: bool,
) -> Result<(), String> {
    if remote_path.trim().is_empty() {
        return Err("Le chemin distant est vide.".to_string());
    }

    let connection = init_database(&app_handle)?;

    let server = connection
        .query_row(
            r#"
            SELECT
                id, name, host, username, port, authentication_method,
                private_key_path, group_name, favorite, remember_password,
                host_key_fingerprint
            FROM ssh_servers
            WHERE id = ?1
            "#,
            params![server_id],
            |row| {
                Ok(SshServerRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    username: row.get(3)?,
                    port: row.get(4)?,
                    authentication_method: row.get(5)?,
                    private_key_path: row.get(6)?,
                    group_name: row.get(7)?,
                    favorite: row.get(8)?,
                    remember_password: row.get(9)?,
                    host_key_fingerprint: row.get(10)?,
                })
            },
        )
        .map_err(|error| format!("Failed to load SSH server: {error}"))?;

    let config = ssh_connection_config(&server);

    let password = if server.authentication_method == "password" {
        get_ssh_password(server.id.clone())?
    } else {
        None
    };

    let sftp = connect_sftp_server(
        &config,
        server.host_key_fingerprint.clone(),
        password,
    )
    .await?;

    let canonical_path = sftp
        .canonicalize(remote_path.clone())
        .await
        .map_err(|error| {
            format!("Impossible de résoudre le chemin distant : {error}")
        })?;

    if canonical_path == "/" {
        return Err("La suppression de la racine distante est interdite.".to_string());
    }

    let metadata = sftp
        .metadata(canonical_path.clone())
        .await
        .map_err(|error| {
            format!("Impossible de lire les informations du chemin distant : {error}")
        })?;

    if metadata.is_dir() {
        if !recursive {
            return Err(
                "Ce chemin est un dossier. La suppression récursive n'est pas autorisée."
                    .to_string(),
            );
        }

        async fn delete_directory_contents(
            sftp: &russh_sftp::client::SftpSession,
            directory: &str,
        ) -> Result<(), String> {
            let entries = sftp
                .read_dir(directory.to_string())
                .await
                .map_err(|error| {
                    format!("Impossible de lire le dossier '{directory}': {error}")
                })?;

            for entry in entries {
                let name = entry.file_name();

                if name == "." || name == ".." {
                    continue;
                }

                let child_path = format!(
                    "{}/{}",
                    directory.trim_end_matches('/'),
                    name
                );

                let child_metadata = sftp
                    .metadata(child_path.clone())
                    .await
                    .map_err(|error| {
                        format!("Impossible de lire '{child_path}': {error}")
                    })?;

                if child_metadata.is_dir() {
                    Box::pin(delete_directory_contents(sftp, &child_path)).await?;

                    sftp.remove_dir(child_path.clone())
                        .await
                        .map_err(|error| {
                            format!("Impossible de supprimer le dossier '{child_path}': {error}")
                        })?;
                } else {
                    sftp.remove_file(child_path.clone())
                        .await
                        .map_err(|error| {
                            format!("Impossible de supprimer le fichier '{child_path}': {error}")
                        })?;
                }
            }

            Ok(())
        }

        delete_directory_contents(&sftp, &canonical_path).await?;

        sftp.remove_dir(canonical_path.clone())
            .await
            .map_err(|error| {
                format!("Impossible de supprimer le dossier '{canonical_path}': {error}")
            })?;
    } else {
        sftp.remove_file(canonical_path.clone())
            .await
            .map_err(|error| {
                format!("Impossible de supprimer le fichier '{canonical_path}': {error}")
            })?;
    }

    Ok(())
}

#[tauri::command]
async fn sftp_download_file(
    app_handle: tauri::AppHandle,
    server_id: String,
    remote_path: String,
    local_path: String,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;

    // 1. Retrieve the SSH server configuration.
    let connection = init_database(&app_handle)?;

    let server = connection
        .query_row(
            r#"
            SELECT
                id,
                name,
                host,
                username,
                port,
                authentication_method,
                private_key_path,
                group_name,
                favorite,
                remember_password,
                host_key_fingerprint
            FROM ssh_servers
            WHERE id = ?1
            "#,
            params![server_id],
            |row| {
                Ok(SshServerRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    username: row.get(3)?,
                    port: row.get(4)?,
                    authentication_method: row.get(5)?,
                    private_key_path: row.get(6)?,
                    group_name: row.get(7)?,
                    favorite: row.get(8)?,
                    remember_password: row.get(9)?,
                    host_key_fingerprint: row.get(10)?,
                })
            },
        )
        .map_err(|error| format!("Failed to load SSH server: {error}"))?;

    let config = ssh_connection_config(&server);

    // 2. Retrieve the password if necessary.
    let password = if server.authentication_method == "password" {
        get_ssh_password(server.id.clone())?
    } else {
        None
    };

    // 3. Establish the SFTP session.
    let sftp = connect_sftp_server(
        &config,
        server.host_key_fingerprint.clone(),
        password,
    )
    .await?;

    // 4. Open and read the remote file.
    let resolved_path = sftp
        .canonicalize(remote_path.clone())
        .await
        .map_err(|error| {
            format!("Failed to resolve remote path '{remote_path}': {error}")
        })?;

    let mut remote_file = sftp
        .open(resolved_path.clone())
        .await
        .map_err(|error| {
            format!("Failed to open remote file '{resolved_path}': {error}")
        })?;

    let mut local_file = tokio::fs::File::create(&local_path)
        .await
        .map_err(|error| {
            format!("Failed to create local file '{local_path}': {error}")
        })?;

    let mut buffer = vec![0u8; 64 * 1024]; // 64 Ko Blocks.

    loop {
        let bytes_read = remote_file
            .read(&mut buffer)
            .await
            .map_err(|error| {
                format!("Failed to read remote file '{resolved_path}': {error}")
            })?;

        if bytes_read == 0 {
            break;
        }

        local_file
            .write_all(&buffer[..bytes_read])
            .await
            .map_err(|error| {
                format!("Failed to write local file '{local_path}': {error}")
            })?;
    }

    local_file
        .flush()
        .await
        .map_err(|error| {
            format!("Failed to finalize local file '{local_path}': {error}")
        })?;

    Ok(())
}

#[tauri::command]
async fn sftp_download_multiple(
    app_handle: tauri::AppHandle,
    server_id: String,
    remote_paths: Vec<String>,
    local_directory: String,
) -> Result<(), String> {
    use std::sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    };
    use tokio::io::AsyncReadExt;

    if remote_paths.is_empty() {
        return Err("Aucun fichier ou dossier sélectionné.".to_string());
    }

    let transfer_id = uuid::Uuid::new_v4().to_string();

    let cancel_flag = Arc::new(AtomicBool::new(false));

{
    use tauri::Manager;

    let registry = app_handle.state::<SftpTransferRegistry>();

    let mut active = registry
        .active
        .lock()
        .map_err(|_| "Unable to access transfer log.".to_string())?;

    active.insert(transfer_id.clone(), Arc::clone(&cancel_flag));
}

    let _transfer_guard = SftpTransferGuard {
        app_handle: app_handle.clone(),
        transfer_id: transfer_id.clone(),
    };

    let connection = init_database(&app_handle)?;

    let server = connection
        .query_row(
            r#"
            SELECT
                id,
                name,
                host,
                username,
                port,
                authentication_method,
                private_key_path,
                group_name,
                favorite,
                remember_password,
                host_key_fingerprint
            FROM ssh_servers
            WHERE id = ?1
            "#,
            params![server_id],
            |row| {
                Ok(SshServerRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    username: row.get(3)?,
                    port: row.get(4)?,
                    authentication_method: row.get(5)?,
                    private_key_path: row.get(6)?,
                    group_name: row.get(7)?,
                    favorite: row.get(8)?,
                    remember_password: row.get(9)?,
                    host_key_fingerprint: row.get(10)?,
                })
            },
        )
        .map_err(|error| format!("Failed to load SSH server: {error}"))?;

    let config = ssh_connection_config(&server);

    let password = if server.authentication_method == "password" {
        get_ssh_password(server.id.clone())?
    } else {
        None
    };

    let sftp = connect_sftp_server(
        &config,
        server.host_key_fingerprint.clone(),
        password,
    )
    .await?;

    let local_root = PathBuf::from(&local_directory);

    tokio::fs::create_dir_all(&local_root)
        .await
        .map_err(|error| {
            format!(
                "Failed to create destination directory '{}': {error}",
                local_root.display()
            )
        })?;

    // Calculate the total size of files recursively.
    fn calculate_remote_size<'a>(
        sftp: &'a russh_sftp::client::SftpSession,
        remote_path: String,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<u64, String>> + Send + 'a>,
    > {
        Box::pin(async move {
            let metadata = sftp
                .metadata(remote_path.clone())
                .await
                .map_err(|error| {
                    format!(
                        "Failed to read metadata for '{remote_path}': {error}"
                    )
                })?;

            if metadata.is_dir() {
                let entries = sftp
                    .read_dir(remote_path.clone())
                    .await
                    .map_err(|error| {
                        format!(
                            "Failed to read remote directory '{remote_path}': {error}"
                        )
                    })?;

                let mut total_size = 0u64;

                for entry in entries {
                    let name = entry.file_name();

                    if name == "." || name == ".." {
                        continue;
                    }

                    let child_path = format!(
                        "{}/{}",
                        remote_path.trim_end_matches('/'),
                        name
                    );

                    total_size += calculate_remote_size(
                        sftp,
                        child_path,
                    )
                    .await?;
                }

                Ok(total_size)
            } else if metadata.is_regular() {
                Ok(metadata.size.unwrap_or(0))
            } else {
                Ok(0)
            }
        })
    }

    // Solve the paths and calculate the total size before transferring.
    let mut resolved_paths = Vec::new();
    let mut total_bytes = 0u64;

    for remote_path in remote_paths {
        let resolved_path = sftp
            .canonicalize(remote_path.clone())
            .await
            .map_err(|error| {
                format!(
                    "Failed to resolve remote path '{remote_path}': {error}"
                )
            })?;

        total_bytes += calculate_remote_size(
            &sftp,
            resolved_path.clone(),
        )
        .await?;

        resolved_paths.push(resolved_path);
    }

    let transferred_bytes = Arc::new(AtomicU64::new(0));

    let created_paths: Arc<Mutex<Vec<PathBuf>>> =
    Arc::new(Mutex::new(Vec::new()));

    // Download a file or folder recursively.
    fn download_entry<'a>(
        sftp: &'a russh_sftp::client::SftpSession,
        app_handle: tauri::AppHandle,
        transfer_id: String,
        remote_path: String,
        local_path: PathBuf,
        transferred_bytes: Arc<AtomicU64>,
        total_bytes: u64,
        cancel_flag: Arc<AtomicBool>,
        created_paths: Arc<Mutex<Vec<PathBuf>>>,
    ) -> std::pin::Pin<
        Box<dyn std::future::Future<Output = Result<(), String>> + Send + 'a>,
    > {
        Box::pin(async move {
            // Check if the transfer was canceled
            if cancel_flag.load(Ordering::Relaxed) {
                return Err("Transfert annulé.".to_string());
            }

            // Read metadata from the remote file or folder.
            let metadata = sftp
                .metadata(remote_path.clone())
                .await
                .map_err(|error| {
                    format!(
                        "Failed to read metadata for '{remote_path}': {error}"
                    )
                })?;

            if metadata.is_dir() {
                let directory_exists = tokio::fs::try_exists(&local_path)
                    .await
                    .map_err(|error| {
                        format!(
                            "Failed to check directory '{}': {error}",
                            local_path.display()
                        )
                    })?;

                if !directory_exists {
                    tokio::fs::create_dir(&local_path)
                        .await
                        .map_err(|error| {
                            format!(
                                "Failed to create directory '{}': {error}",
                                local_path.display()
                            )
                        })?;

                    created_paths
                        .lock()
                        .map_err(|_| {
                            "Impossible d'accéder aux chemins créés.".to_string()
                        })?
                        .push(local_path.clone());
                }

                let entries = sftp
                    .read_dir(remote_path.clone())
                    .await
                    .map_err(|error| {
                        format!(
                            "Failed to read remote directory '{remote_path}': {error}"
                        )
                    })?;

                for entry in entries {
                    let name = entry.file_name();

                    if name == "." || name == ".." {
                        continue;
                    }

                    let child_remote = format!(
                        "{}/{}",
                        remote_path.trim_end_matches('/'),
                        name
                    );

                    let child_local = local_path.join(&name);

                    download_entry(
                        sftp,
                        app_handle.clone(),
                        transfer_id.clone(),
                        child_remote,
                        child_local,
                        Arc::clone(&transferred_bytes),
                        total_bytes,
                        Arc::clone(&cancel_flag),
                        Arc::clone(&created_paths),
                    )
                    .await?;
                }

                Ok(())
            } else if metadata.is_regular() {
                if tokio::fs::try_exists(&local_path)
                    .await
                    .map_err(|error| {
                        format!(
                            "Failed to check '{}': {error}",
                            local_path.display()
                        )
                    })?
                {
                    return Err(format!(
                        "Le fichier existe déjà : {}",
                        local_path.display()
                    ));
                }

                if let Some(parent) = local_path.parent() {
                    tokio::fs::create_dir_all(parent)
                        .await
                        .map_err(|error| {
                            format!(
                                "Failed to create directory '{}': {error}",
                                parent.display()
                            )
                        })?;
                }

                let mut remote_file = sftp
                    .open(remote_path.clone())
                    .await
                    .map_err(|error| {
                        format!(
                            "Failed to open remote file '{remote_path}': {error}"
                        )
                    })?;

                let mut local_file = tokio::fs::OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&local_path)
                    .await
                    .map_err(|error| {
                        format!(
                            "Failed to create local file '{}': {error}",
                            local_path.display()
                        )
                    })?;

                created_paths
                    .lock()
                    .map_err(|_| {
                        "Impossible d'accéder aux chemins créés.".to_string()
                    })?
                    .push(local_path.clone());

                let file_name = local_path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or("")
                    .to_string();

                let mut buffer = vec![0u8; 64 * 1024];

                let transfer_result: Result<(), String> = async {
                    loop {
                        if cancel_flag.load(Ordering::Relaxed) {
                            return Err("Transfert annulé.".to_string());
                        }

                        let bytes_read = remote_file
                            .read(&mut buffer)
                            .await
                            .map_err(|error| {
                                format!(
                                    "Failed to read remote file '{remote_path}': {error}"
                                )
                            })?;

                        if bytes_read == 0 {
                            break;
                        }

                        local_file
                            .write_all(&buffer[..bytes_read])
                            .await
                            .map_err(|error| {
                                format!(
                                    "Failed to write local file '{}': {error}",
                                    local_path.display()
                                )
                            })?;

                        let current_bytes = transferred_bytes
                            .fetch_add(bytes_read as u64, Ordering::Relaxed)
                            + bytes_read as u64;

                        let progress = SftpTransferProgress {
                            transfer_id: transfer_id.clone(),
                            transferred_bytes: current_bytes,
                            total_bytes,
                            file_name: file_name.clone(),
                            completed: false,
                        };

                        app_handle
                            .emit("sftp-transfer-progress", progress)
                            .map_err(|error| {
                                format!("Failed to emit transfer progress: {error}")
                            })?;
                    }

                    local_file
                        .flush()
                        .await
                        .map_err(|error| {
                            format!(
                                "Failed to finalize local file '{}': {error}",
                                local_path.display()
                            )
                        })?;

                    Ok(())
                }
                .await;

                drop(local_file);

                if let Err(error) = transfer_result {
                    match tokio::fs::remove_file(&local_path).await {
                        Ok(()) => {
                        }
                        Err(_remove_error) => {
                        }
                    }

                    return Err(error);
                }

                Ok(())
            } else {
                Err(format!(
                    "Type de fichier non pris en charge : {remote_path}"
                ))
            }
        })
    }

    // Remove files and empty directories created by a failed or cancelled transfer.
    async fn cleanup_created_paths(created_paths: &Arc<Mutex<Vec<PathBuf>>>) {
        let paths = match created_paths.lock() {
            Ok(paths) => paths.clone(),
            Err(_error) => {
                return;
            }
        };

        // Remove children before their parent directories.
        for path in paths.iter().rev() {
            match tokio::fs::metadata(path).await {
                Ok(metadata) if metadata.is_dir() => {
                    if let Err(_error) = tokio::fs::remove_dir(path).await {
                    }
                }
                Ok(_) => {
                    if let Err(_error) = tokio::fs::remove_file(path).await {
                    }
                }
                Err(error)
                    if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(_error) => {
                }
            }
        }
    }

    // Download each selected entry.
    for resolved_path in resolved_paths {
        let file_name = match Path::new(&resolved_path)
            .file_name()
            .and_then(|name| name.to_str())
        {
            Some(name) => name,
            None => {
                let error = format!(
                    "Impossible de déterminer le nom de '{resolved_path}'"
                );

                cleanup_created_paths(&created_paths).await;
                return Err(error);
            }
        };

        let destination = local_root.join(file_name);

        if let Err(error) = download_entry(
            &sftp,
            app_handle.clone(),
            transfer_id.clone(),
            resolved_path,
            destination,
            Arc::clone(&transferred_bytes),
            total_bytes,
            Arc::clone(&cancel_flag),
            Arc::clone(&created_paths),
        )
        .await
        {
            cleanup_created_paths(&created_paths).await;
            return Err(error);
        }
    }

    // Report the end of the transfer.
    let final_progress = SftpTransferProgress {
        transfer_id,
        transferred_bytes: transferred_bytes.load(Ordering::Relaxed),
        total_bytes,
        file_name: String::new(),
        completed: true,
    };

    app_handle
        .emit("sftp-transfer-progress", final_progress)
        .map_err(|error| {
            format!("Failed to emit final transfer progress: {error}")
        })?;

    Ok(())
}

type SshSessionChannel = russh::ChannelWriteHalf<russh::client::Msg>;

static SSH_SESSIONS: OnceLock<
    Arc<Mutex<HashMap<String, SshSessionChannel>>>,
> = OnceLock::new();

static SSH_OUTPUT_BUFFERS: OnceLock<
    Arc<Mutex<HashMap<String, String>>>,
> = OnceLock::new();

fn ssh_output_buffers() -> &'static Arc<Mutex<HashMap<String, String>>> {
    SSH_OUTPUT_BUFFERS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

fn ssh_sessions() -> &'static Arc<Mutex<HashMap<String, SshSessionChannel>>> {
    SSH_SESSIONS.get_or_init(|| Arc::new(Mutex::new(HashMap::new())))
}

async fn open_ssh_shell(
    config: &SshConnectionConfig,
    expected_host_key_fingerprint: Option<String>,
    password: Option<String>,
    passphrase: Option<String>,
) -> Result<russh::Channel<russh::client::Msg>, String> {
    let mut ssh_config = russh::client::Config::default();

    ssh_config.keepalive_interval = Some(Duration::from_secs(10));
    ssh_config.keepalive_max = 3;

    let ssh_config = std::sync::Arc::new(ssh_config);

    let handler = NexusSshHandler::new(expected_host_key_fingerprint.clone());
    let presented_host_key_fingerprint = handler.presented_host_key_fingerprint();

    let address = format!("{}:{}", config.host, config.port);

    let mut handle = match russh::client::connect(
        ssh_config,
        address,
        handler,
    )
    .await
    {
        Ok(handle) => handle,
        Err(error) => {
            let presented_fingerprint = presented_host_key_fingerprint
                .lock()
                .ok()
                .and_then(|fingerprint| fingerprint.clone());

            if let Some(fingerprint) = presented_fingerprint {
                if expected_host_key_fingerprint.is_some() {
                    return Err(format!(
                        "SSH host key mismatch: {fingerprint}"
                    ));
                }

                return Err(format!(
                    "SSH host key not trusted yet: {fingerprint}"
                ));
            }

            return Err(format!("SSH connection failed: {error}"));
        }
    };

    match config.authentication_method.as_str() {
    "password" => {
        let password = password.ok_or_else(|| {
            "No SSH password is available for this server".to_string()
        })?;

        let result = handle
            .authenticate_password(&config.username, password)
            .await
            .map_err(|error| {
                format!("SSH authentication failed: {error}")
            })?;

        if !result.success() {
            return Err(
                "SSH authentication was rejected by the server"
                    .to_string(),
            );
        }
    }

    "ssh-agent" => {
        let provider = crate::ssh_auth::SshAgentProvider::new();

        let result = provider
            .authenticate(&mut handle, &config.username)
            .await?;

        if !result.success() {
            return Err(
                "SSH Agent authentication was rejected by the server"
                    .to_string(),
            );
        }
    }

    "private-key" => {
        let key_path = config
            .private_key_path
            .clone()
            .ok_or_else(|| {
                "No SSH private key is configured for this server"
                    .to_string()
            })?;

        let provider =
            crate::ssh_auth::PrivateKeyProvider::new(key_path);

        let result = provider
            .authenticate(
                &mut handle,
                &config.username,
                passphrase.as_deref(),
            )
            .await?;

        if !result.success() {
            return Err(
                "SSH private key authentication was rejected by the server"
                    .to_string(),
            );
        }
    }

    method => {
        return Err(format!(
            "SSH authentication method is not implemented yet: {method}"
        ));
    }
}

let channel = handle
    .channel_open_session()
    .await
    .map_err(|error| {

        format!(
            "Failed to open SSH session channel: {error}"
        )
    })?;

channel
    .request_pty(true, "xterm-256color", 120, 40, 0, 0, &[])
    .await
    .map_err(|error| {

        format!(
            "Failed to allocate SSH PTY: {error}"
        )
    })?;

channel
    .request_shell(true)
    .await
    .map_err(|error| {

        format!(
            "Failed to start remote shell: {error}"
        )
    })?;

    Ok(channel)
}

fn record_ssh_connection_history(
    connection: &Connection,
    server: &SshServerRecord,
    status: &str,
    message: &str,
) -> Result<(), String> {
    connection
        .execute(
            r#"
            INSERT INTO ssh_connection_history (
                server_id,
                server_name,
                host,
                authentication_method,
                status,
                message,
                created_at
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))
            "#,
            params![
                server.id,
                server.name,
                server.host,
                server.authentication_method,
                status,
                message,
            ],
        )
        .map_err(|error| {
            format!("Failed to record SSH connection history: {error}")
        })?;

    Ok(())
}

#[derive(Debug, Serialize)]
struct SshConnectionHistoryRecord {
    id: i64,
    server_id: String,
    server_name: String,
    host: String,
    authentication_method: String,
    status: String,
    message: String,
    created_at: String,
}

#[tauri::command]
fn ssh_connection_history(
    app_handle: tauri::AppHandle,
    server_id: Option<String>,
) -> Result<Vec<SshConnectionHistoryRecord>, String> {
    let connection = init_database(&app_handle)?;

    let mut statement = connection
        .prepare(
            r#"
            SELECT
                id,
                server_id,
                server_name,
                host,
                authentication_method,
                status,
                message,
                created_at
            FROM ssh_connection_history
            WHERE (?1 IS NULL OR server_id = ?1)
            ORDER BY id DESC
            LIMIT 100
            "#,
        )
        .map_err(|error| {
            format!("Failed to prepare SSH history query: {error}")
        })?;

    let rows = statement
        .query_map(params![server_id], |row| {
            Ok(SshConnectionHistoryRecord {
                id: row.get(0)?,
                server_id: row.get(1)?,
                server_name: row.get(2)?,
                host: row.get(3)?,
                authentication_method: row.get(4)?,
                status: row.get(5)?,
                message: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|error| {
            format!("Failed to query SSH connection history: {error}")
        })?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| {
            format!("Failed to read SSH connection history: {error}")
        })
}

#[tauri::command]
fn ssh_private_key_requires_passphrase(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<bool, String> {
    let connection = init_database(&app_handle)?;

    let server = connection
        .query_row(
            r#"
            SELECT
                id,
                name,
                host,
                username,
                port,
                authentication_method,
                private_key_path,
                group_name,
                favorite,
                remember_password,
                host_key_fingerprint
            FROM ssh_servers
            WHERE id = ?1
            "#,
            params![server_id],
            |row| {
                Ok(SshServerRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    username: row.get(3)?,
                    port: row.get(4)?,
                    authentication_method: row.get(5)?,
                    private_key_path: row.get(6)?,
                    group_name: row.get(7)?,
                    favorite: row.get::<_, i64>(8)? != 0,
                    remember_password: row.get::<_, i64>(9)? != 0,
                    host_key_fingerprint: row.get(10)?,
                })
            },
        )
        .map_err(|error| {
            format!("Failed to load SSH server: {error}")
        })?;

    if server.authentication_method != "private-key" {
        return Err(
            "SSH private key passphrase detection requires private-key authentication"
                .to_string(),
        );
    }

    let key_path = server
        .private_key_path
        .ok_or_else(|| {
            "No SSH private key is configured for this server"
                .to_string()
        })?;

    let provider =
        crate::ssh_auth::PrivateKeyProvider::new(key_path);

    provider.requires_passphrase()
}

#[tauri::command]
async fn ssh_connect(
    app_handle: tauri::AppHandle,
    server_id: String,
    passphrase: Option<String>,
) -> Result<String, String> {

    let connection = init_database(&app_handle)?;

    let connection_timeout_secs = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params!["connection_timeout"],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| (1..=300).contains(value))
        .unwrap_or(15);

    let server = connection
        .query_row(
            r#"
            SELECT
                id,
                name,
                host,
                username,
                port,
                authentication_method,
                private_key_path,
                group_name,
                favorite,
                remember_password,
                host_key_fingerprint
            FROM ssh_servers
            WHERE id = ?1
            "#,
            params![server_id],
            |row| {
                Ok(SshServerRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    username: row.get(3)?,
                    port: row.get(4)?,
                    authentication_method: row.get(5)?,
                    private_key_path: row.get(6)?,
                    group_name: row.get(7)?,
                    favorite: row.get::<_, i64>(8)? != 0,
                    remember_password: row.get::<_, i64>(9)? != 0,
                    host_key_fingerprint: row.get(10)?,
                })
            },
        )
        .map_err(|error| format!("Failed to load SSH server: {error}"))?;

    let config = ssh_connection_config(&server);

    let password = if server.authentication_method == "password" {
        get_ssh_password(server.id.clone())?
    } else {
        None
    };


    let channel = match tokio::time::timeout(
        Duration::from_secs(connection_timeout_secs),
        open_ssh_shell(
            &config,
            server.host_key_fingerprint.clone(),
            password,
            passphrase,
        ),
    )
    .await
    {
        Ok(Ok(channel)) => channel,
        Ok(Err(error)) => return Err(error),
        Err(_) => {
            return Err(format!(
                "SSH connection timed out after {connection_timeout_secs} seconds"
            ));
        }
    };

    let (mut reader, writer) = channel.split();

    let session_id = uuid::Uuid::new_v4().to_string();

{
    let sessions = ssh_sessions()
        .lock()
        .map_err(|_| "Failed to access SSH session manager".to_string())?;

    let mut sessions = sessions;
    sessions.insert(session_id.clone(), writer);
}

{
    let buffers = ssh_output_buffers()
        .lock()
        .map_err(|_| "Failed to access SSH output buffers".to_string())?;

    let mut buffers = buffers;
    buffers.insert(session_id.clone(), String::new());
}

    let event_name = format!("ssh-output-{session_id}");

    let output_session_id = session_id.clone();

    tauri::async_runtime::spawn(async move {
    while let Some(message) = reader.wait().await {
        let output = match message {
            russh::ChannelMsg::Data { data } => {
                String::from_utf8_lossy(&data).into_owned()
            }

            russh::ChannelMsg::ExtendedData { data, .. } => {
                String::from_utf8_lossy(&data).into_owned()
            }

            russh::ChannelMsg::Eof
            | russh::ChannelMsg::Close => {
                break;
            }

            _ => {
                continue;
            }
        };

        if let Ok(mut buffers) = ssh_output_buffers().lock() {
            if let Some(buffer) = buffers.get_mut(&output_session_id) {
                buffer.push_str(&output);

                const MAX_BUFFER_SIZE: usize = 64 * 1024;

                if buffer.len() > MAX_BUFFER_SIZE {
                    let excess = buffer.len() - MAX_BUFFER_SIZE;
                    buffer.drain(..excess);
                }
            }
        }

        if app_handle.emit(&event_name, output).is_err() {
            break;
        }
    }

    if let Ok(mut sessions) = ssh_sessions().lock() {
        sessions.remove(&output_session_id);
    }

    if let Ok(mut buffers) = ssh_output_buffers().lock() {
        buffers.remove(&output_session_id);
    }

    let closed_event_name =
        format!("ssh-session-closed-{output_session_id}");

    let _ = app_handle.emit(&closed_event_name, ());
});

    Ok(session_id)
}

#[tauri::command]
fn ssh_get_output(session_id: String) -> Result<String, String> {
    let buffers = ssh_output_buffers()
        .lock()
        .map_err(|_| "Failed to access SSH output buffers".to_string())?;

    Ok(buffers
        .get(&session_id)
        .cloned()
        .unwrap_or_default())
}

#[tauri::command]
fn ssh_disconnect(session_id: String) -> Result<(), String> {
    {
        let mut sessions = ssh_sessions()
            .lock()
            .map_err(|_| "Failed to access SSH session manager".to_string())?;

        sessions.remove(&session_id);
    }

    {
        let mut buffers = ssh_output_buffers()
            .lock()
            .map_err(|_| "Failed to access SSH output buffers".to_string())?;

        buffers.remove(&session_id);
    }

    Ok(())
}

#[tauri::command]
async fn ssh_resize(
    session_id: String,
    cols: u32,
    rows: u32,
) -> Result<(), String> {
    if cols == 0 || rows == 0 {
        return Err("SSH terminal size must be greater than zero".to_string());
    }

    let writer = {
        let mut sessions = ssh_sessions()
            .lock()
            .map_err(|_| "Failed to access SSH session manager".to_string())?;

        sessions
            .remove(&session_id)
            .ok_or_else(|| "SSH session not found".to_string())?
    };

    let resize_result = writer
        .window_change(cols, rows, 0, 0)
        .await
        .map_err(|error| {
            format!("Failed to resize SSH terminal: {error}")
        });

    {
        let mut sessions = ssh_sessions()
            .lock()
            .map_err(|_| "Failed to access SSH session manager".to_string())?;

        sessions.insert(session_id, writer);
    }

    resize_result
}

#[tauri::command]
async fn ssh_write(
    session_id: String,
    data: String,
) -> Result<(), String> {
    let writer = {
        let mut sessions = ssh_sessions()
            .lock()
            .map_err(|_| "Failed to access SSH session manager".to_string())?;

        sessions
            .remove(&session_id)
            .ok_or_else(|| "SSH session not found".to_string())?
    };

    let write_result = writer
        .data(Cursor::new(data.into_bytes()))
        .await
        .map_err(|error| format!("Failed to write to SSH session: {error}"));

    {
        let mut sessions = ssh_sessions()
            .lock()
            .map_err(|_| "Failed to access SSH session manager".to_string())?;

        sessions.insert(session_id, writer);
    }

    write_result
}

#[tauri::command]
async fn ssh_test_connection(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<SshTestConnectionResult, String> {
    let connection = init_database(&app_handle)?;

    let server = connection
        .query_row(
            r#"
            SELECT
                id,
                name,
                host,
                username,
                port,
                authentication_method,
                private_key_path,
                group_name,
                favorite,
                remember_password,
                host_key_fingerprint
            FROM ssh_servers
            WHERE id = ?1
            "#,
            params![server_id],
            |row| {
                Ok(SshServerRecord {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    host: row.get(2)?,
                    username: row.get(3)?,
                    port: row.get(4)?,
                    authentication_method: row.get(5)?,
                    private_key_path: row.get(6)?,
                    group_name: row.get(7)?,
                    favorite: row.get::<_, i64>(8)? != 0,
                    remember_password: row.get::<_, i64>(9)? != 0,
                    host_key_fingerprint: row.get(10)?,
                })
            },
        )
        .map_err(|error| format!("Failed to load SSH server: {error}"))?;

    let config = ssh_connection_config(&server);

    let expected_host_key_fingerprint =
        server.host_key_fingerprint.clone();

    let password = if server.authentication_method == "password" {
        get_ssh_password(server.id.clone())?
    } else {
        None
    };

    let connection_timeout_secs = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            params!["connection_timeout"],
            |row| row.get::<_, String>(0),
        )
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|value| (1..=300).contains(value))
        .unwrap_or(15);

    let connection_result = tokio::time::timeout(
        Duration::from_secs(connection_timeout_secs),
        connect_ssh_server(
            &config,
            expected_host_key_fingerprint,
            password,
        ),
    )
    .await;

    match connection_result {
        Ok(Ok(())) => {
            let status = "connected";
            let message = "SSH connection successful";

            record_ssh_connection_history(
                &connection,
                &server,
                status,
                message,
            )?;

            Ok(SshTestConnectionResult {
                status: status.to_string(),
                message: message.to_string(),
                host_key_fingerprint: server.host_key_fingerprint,
            })
        }

        Ok(Err(error))
            if error.starts_with("SSH host key not trusted yet: ") =>
        {
            let fingerprint = error
                .strip_prefix("SSH host key not trusted yet: ")
                .map(str::to_string);

            let status = "host-key-required";
            let message = "This SSH host key has not been trusted yet";

            record_ssh_connection_history(
                &connection,
                &server,
                status,
                message,
            )?;

            Ok(SshTestConnectionResult {
                status: status.to_string(),
                message: message.to_string(),
                host_key_fingerprint: fingerprint,
            })
        }

        Ok(Err(error))
            if error.starts_with("SSH host key mismatch: ") =>
        {
            let fingerprint = error
                .strip_prefix("SSH host key mismatch: ")
                .map(str::to_string);

            let status = "host-key-mismatch";
            let message = "The SSH host key does not match the trusted key";

            record_ssh_connection_history(
                &connection,
                &server,
                status,
                message,
            )?;

            Ok(SshTestConnectionResult {
                status: status.to_string(),
                message: message.to_string(),
                host_key_fingerprint: fingerprint,
            })
        }

        Ok(Err(error)) => {
            record_ssh_connection_history(
                &connection,
                &server,
                "error",
                &error,
            )?;

            Ok(SshTestConnectionResult {
                status: "error".to_string(),
                message: error,
                host_key_fingerprint: None,
            })
        }

        Err(_) => {
            let message = format!(
                "SSH connection timed out after {connection_timeout_secs} seconds"
            );

            record_ssh_connection_history(
                &connection,
                &server,
                "error",
                &message,
            )?;

            Ok(SshTestConnectionResult {
                status: "error".to_string(),
                message,
                host_key_fingerprint: None,
            })
        }
    }
}

#[tauri::command]
fn save_ssh_server(
    app_handle: tauri::AppHandle,
    server: SshServerRecord,
) -> Result<(), String> {
    let connection = init_database(&app_handle)?;

    connection
    .execute(
        r#"
        INSERT INTO ssh_servers (
            id,
            name,
            host,
            username,
            port,
            authentication_method,
            private_key_path,
            group_name,
            favorite,
            remember_password,
            host_key_fingerprint
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
        ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            host = excluded.host,
            username = excluded.username,
            port = excluded.port,
            authentication_method = excluded.authentication_method,
            private_key_path = excluded.private_key_path,
            group_name = excluded.group_name,
            favorite = excluded.favorite,
            remember_password = excluded.remember_password,
            host_key_fingerprint = excluded.host_key_fingerprint
        "#,
        params![
            server.id,
            server.name,
            server.host,
            server.username,
            server.port,
            server.authentication_method,
            server.private_key_path,
            server.group_name,
            server.favorite as i32,
            server.remember_password as i32,
            server.host_key_fingerprint,
        ],
    )
    .map_err(|error| format!("Failed to save SSH server: {error}"))?;

    Ok(())
}

#[tauri::command]
fn trust_ssh_host_key(
    app_handle: tauri::AppHandle,
    server_id: String,
    fingerprint: String,
) -> Result<(), String> {
    let server_id = server_id.trim();
    let fingerprint = fingerprint.trim();

    if server_id.is_empty() {
        return Err("Server ID cannot be empty".to_string());
    }

    if fingerprint.is_empty() {
        return Err("Host key fingerprint cannot be empty".to_string());
    }

    let connection = init_database(&app_handle)?;

    let updated_rows = connection
        .execute(
            r#"
            UPDATE ssh_servers
            SET host_key_fingerprint = ?1
            WHERE id = ?2
            "#,
            params![fingerprint, server_id],
        )
        .map_err(|error| {
            format!("Failed to trust SSH host key: {error}")
        })?;

    if updated_rows == 0 {
        return Err("SSH server not found".to_string());
    }

    Ok(())
}

#[tauri::command]
fn delete_ssh_server(
    app_handle: tauri::AppHandle,
    server_id: String,
) -> Result<(), String> {
    let connection = init_database(&app_handle)?;

    connection
        .execute(
            "DELETE FROM ssh_servers WHERE id = ?1",
            params![server_id],
        )
        .map_err(|error| format!("Failed to delete SSH server: {error}"))?;

    delete_ssh_password(server_id)?;

    Ok(())
}

#[tauri::command]
fn list_ssh_servers(app_handle: tauri::AppHandle) -> Result<Vec<SshServerRecord>, String> {
    let connection = init_database(&app_handle)?;

    let mut statement = connection
        .prepare(
            r#"
            SELECT
                id,
                name,
                host,
                username,
                port,
                authentication_method,
                private_key_path,
                group_name,
                favorite,
                remember_password,
                host_key_fingerprint
            FROM ssh_servers
            ORDER BY name COLLATE NOCASE ASC
            "#,
        )
        .map_err(|error| format!("Failed to prepare SSH server query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok(SshServerRecord {
                id: row.get(0)?,
                name: row.get(1)?,
                host: row.get(2)?,
                username: row.get(3)?,
                port: row.get(4)?,
                authentication_method: row.get(5)?,
                private_key_path: row.get(6)?,
                group_name: row.get(7)?,
                favorite: row.get::<_, i64>(8)? != 0,
                remember_password: row.get::<_, i64>(9)? != 0,
                host_key_fingerprint: row.get(10)?,
            })
        })
        .map_err(|error| format!("Failed to query SSH servers: {error}"))?;

    rows.map(|row| {
        row.map_err(|error| format!("Failed to read SSH server record: {error}"))
    })
    .collect()
}

#[tauri::command]
fn get_app_settings(
    app_handle: tauri::AppHandle,
) -> Result<std::collections::HashMap<String, String>, String> {
    let connection = init_database(&app_handle)?;

    let mut statement = connection
        .prepare("SELECT key, value FROM app_settings")
        .map_err(|error| format!("Failed to prepare app settings query: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("Failed to query app settings: {error}"))?;

    let mut settings = std::collections::HashMap::new();

    for row in rows {
        let (key, value) =
            row.map_err(|error| format!("Failed to read app setting: {error}"))?;

        settings.insert(key, value);
    }

    Ok(settings)
}

#[tauri::command]
fn save_app_setting(
    app_handle: tauri::AppHandle,
    key: String,
    value: String,
) -> Result<(), String> {
    let connection = init_database(&app_handle)?;

    connection
        .execute(
            r#"
            INSERT INTO app_settings (key, value)
            VALUES (?1, ?2)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            "#,
            rusqlite::params![key, value],
        )
        .map_err(|error| format!("Failed to save app setting: {error}"))?;

    Ok(())
}

#[tauri::command]
async fn ssh_agent_available() -> Result<bool, String> {
    use crate::ssh_auth::SshAgentProvider;

    let provider = SshAgentProvider::new();

    match provider.connect().await {
        Ok(_) => Ok(true),
        Err(_) => Ok(false),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(SftpTransferRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            init_database(app.handle())?;
            Ok(())
        })
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            network_interfaces,
            refresh_interface_states,
            network_routes,
            route_lookup,
            network_neighbors,
            network_discovery,
            dns_info,
            net_toolbox_initial_data,
            ping_host,
            tcp_check,
            port_scan,
            traceroute_host,
            dns_lookup,
            dns_compare,
            reverse_dns_lookup,
            http_diagnostic,
            global_connectivity_test,
            get_app_settings,
            save_app_setting,
            list_ssh_servers,
            save_ssh_server,
            trust_ssh_host_key,
            delete_ssh_server,
            ssh_test_connection,
            sftp_test_connection,
            sftp_list_directory,
            sftp_create_directory,
            sftp_upload_file,
            sftp_upload_multiple,
            sftp_delete_entry,
            sftp_download_file,
            sftp_download_multiple,
            ssh_connection_history,
            ssh_private_key_requires_passphrase,
            ssh_connect,
            ssh_get_output,
            ssh_disconnect,
            ssh_resize,
            ssh_write,
            ssh_agent_available,
            save_ssh_password,
            get_ssh_password,
            delete_ssh_password,
            list_ssh_keys,
            generate_ssh_key,
            delete_ssh_key,
            cancel_sftp_transfer,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ping_localhost() {
        let result = ping_host("127.0.0.1".to_string()).expect("ping failed");

        assert_eq!(result.target, "127.0.0.1");
        assert_eq!(result.sent, 4);
        assert_eq!(result.received, 4);
        assert_eq!(result.packet_loss, 0.0);

        assert!(result.min_ms.is_some());
        assert!(result.avg_ms.is_some());
        assert!(result.max_ms.is_some());
    }


#[test]
    fn tcp_check_local_open_port() {
        use std::net::TcpListener;
        use std::thread;
        use std::time::Duration;

        // Reserve a local port available.
        let listener =
            TcpListener::bind("127.0.0.1:0").expect("failed to bind local TCP listener");

        let port = listener
            .local_addr()
            .expect("failed to get local address")
            .port();

        // Verifies that the port is detected as open.
        let result =
            tcp_check("127.0.0.1".to_string(), port).expect("tcp check failed");

        assert_eq!(result.target, "127.0.0.1");
        assert_eq!(result.port, port);
        assert!(result.open);
        assert!(result.connect_time_ms.is_some());

        // Give a short delay before the test ends.
        thread::sleep(Duration::from_millis(10));
        drop(listener);
    }

#[test]
    fn tcp_check_local_closed_port() {
        let result = tcp_check("127.0.0.1".to_string(), 1).expect("tcp check failed");

        assert_eq!(result.target, "127.0.0.1");
        assert_eq!(result.port, 1);
        assert!(!result.open);
        assert!(result.connect_time_ms.is_none());
    }

#[tokio::test]
async fn dns_lookup_a_record() {
    let result = dns_lookup(
        "example.com".to_string(),
        "A".to_string(),
        None,
    )
    .await
    .expect("DNS lookup failed");

    assert_eq!(result.name, "example.com");
    assert_eq!(result.record_type, "A");
    assert!(!result.records.is_empty());
}


}