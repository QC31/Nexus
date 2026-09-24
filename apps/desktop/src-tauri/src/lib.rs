use serde::Serialize;
use std::collections::BTreeMap;
use std::net::IpAddr;
use futures_util::stream::TryStreamExt;
use rtnetlink::new_connection;
use rtnetlink::packet_route::route::RouteAttribute;

#[derive(Debug, Serialize)]
struct NetworkInterfaceInfo {
    name: String,
    ipv4_addresses: Vec<String>,
    ipv6_addresses: Vec<String>,
    is_up: bool,
    is_loopback: bool,
}

#[derive(Debug, Serialize)]
struct NetworkRouteInfo {
    destination: String,
    gateway: Option<String>,
    interface_name: Option<String>,
    metric: Option<u32>,
}

#[derive(Debug, Serialize)]
struct NetworkNeighborInfo {
    ip_address: String,
    mac_address: Option<String>,
    interface_name: String,
    state: String,
}

#[derive(Debug, Serialize)]
struct DnsInfo {
    interface_name: Option<String>,
    current_server: Option<String>,
    servers: Vec<String>,
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
}

#[derive(Debug, Serialize)]
struct TcpCheckResult {
    target: String,
    port: u16,
    open: bool,
    connect_time_ms: Option<f64>,
}

#[derive(Debug, Serialize)]
struct DnsLookupResult {
    name: String,
    record_type: String,
    records: Vec<String>,
    response_time_ms: f64,
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
    let output = std::process::Command::new("ping")
        .args(["-c", "4", "-W", "2", &target])
        .output()
        .map_err(|error| error.to_string())?;

    let stdout = String::from_utf8_lossy(&output.stdout);

    let summary = stdout
        .lines()
        .find(|line| line.contains("packets transmitted"))
        .ok_or_else(|| "Unable to parse ping packet statistics".to_string())?;

    let rtt = stdout
        .lines()
        .find(|line| line.contains("min/avg/max"));

    let sent = summary
        .split_whitespace()
        .next()
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| "Unable to parse packets sent".to_string())?;

    let received = summary
        .split_whitespace()
        .nth(3)
        .and_then(|value| value.parse::<u32>().ok())
        .ok_or_else(|| "Unable to parse packets received".to_string())?;

    let packet_loss = summary
        .split("% packet loss")
        .next()
        .and_then(|value| value.split_whitespace().last())
        .and_then(|value| value.parse::<f64>().ok())
        .ok_or_else(|| "Unable to parse packet loss".to_string())?;

        let (min_ms, avg_ms, max_ms) = if let Some(rtt) = rtt {
    let rtt_values = rtt
        .split('=')
        .nth(1)
        .and_then(|value| value.trim().split_whitespace().next());

    if let Some(rtt_values) = rtt_values {
        let mut values = rtt_values.split('/');

        let min_ms = values
            .next()
            .and_then(|value| value.parse::<f64>().ok());

        let avg_ms = values
            .next()
            .and_then(|value| value.parse::<f64>().ok());

        let max_ms = values
            .next()
            .and_then(|value| value.parse::<f64>().ok());

        (min_ms, avg_ms, max_ms)
    } else {
        (None, None, None)
    }
} else {
    (None, None, None)
};

    Ok(PingResult {
        target,
        sent,
        received,
        packet_loss,
        min_ms,
        avg_ms,
        max_ms,
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
async fn dns_lookup(
    name: String,
    record_type: String,
) -> Result<DnsLookupResult, String> {
    use hickory_resolver::proto::rr::RecordType;
    use hickory_resolver::TokioResolver;
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

    let resolver = TokioResolver::builder_tokio()
        .map_err(|error| error.to_string())?
        .build()
        .map_err(|error| error.to_string())?;

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
    let output = std::process::Command::new("traceroute")
        .args(["-n", "-m", "20", "-w", "2", &target])
        .output()
        .map_err(|error| error.to_string())?;

    if !output.status.success() && output.stdout.is_empty() {
        return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut hops = Vec::new();

    for line in stdout.lines().skip(1) {
        let mut parts = line.split_whitespace();

        let Some(hop) = parts.next().and_then(|value| value.parse::<u32>().ok()) else {
            continue;
        };

        let remaining: Vec<&str> = parts.collect();

        if remaining.is_empty() {
            continue;
        }

        if remaining[0] == "*" {
            hops.push(TracerouteHop {
                hop,
                address: None,
                latency_ms: None,
            });

            continue;
        }

        let address = remaining.first().map(|value| (*value).to_string());

        let latency_ms = remaining
            .iter()
            .skip(1)
            .find_map(|value| value.trim_end_matches("ms").parse::<f64>().ok());

        hops.push(TracerouteHop {
            hop,
            address,
            latency_ms,
        });
    }

    Ok(hops)
}

fn is_interface_up(name: &str) -> bool {
    std::fs::read_to_string(format!("/sys/class/net/{name}/operstate"))
        .map(|state| state.trim() == "up")
        .unwrap_or(false)
}

#[tauri::command]
fn network_interfaces() -> Result<Vec<NetworkInterfaceInfo>, String> {
    let interfaces = if_addrs::get_if_addrs().map_err(|error| error.to_string())?;

    let mut interfaces_by_name = BTreeMap::<String, NetworkInterfaceInfo>::new();

    for interface in interfaces {
        let is_loopback = interface.is_loopback();

        let entry = interfaces_by_name
            .entry(interface.name.clone())
            .or_insert_with(|| NetworkInterfaceInfo {
                name: interface.name.clone(),
                ipv4_addresses: Vec::new(),
                ipv6_addresses: Vec::new(),
                is_up: is_interface_up(&interface.name),
                is_loopback,
            });

        match interface.addr.ip() {
            IpAddr::V4(address) => {
                entry.ipv4_addresses.push(address.to_string());
            }
            IpAddr::V6(address) => {
                entry.ipv6_addresses.push(address.to_string());
            }
        }
    }

    Ok(interfaces_by_name.into_values().collect())
}

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            network_interfaces,
            network_routes,
            network_neighbors,
            dns_info,
            ping_host,
            tcp_check,
            traceroute_host,
            dns_lookup,
            reverse_dns_lookup,
            http_diagnostic
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
    fn tcp_check_local_ssh() {
        let result = tcp_check("127.0.0.1".to_string(), 22).expect("tcp check failed");

        assert_eq!(result.target, "127.0.0.1");
        assert_eq!(result.port, 22);
        assert!(result.open);
        assert!(result.connect_time_ms.is_some());
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
    let result = dns_lookup("example.com".to_string(), "A".to_string())
        .await
        .expect("DNS lookup failed");

    assert_eq!(result.name, "example.com");
    assert_eq!(result.record_type, "A");
    assert!(!result.records.is_empty());
}

}