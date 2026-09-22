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
            dns_info
])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}