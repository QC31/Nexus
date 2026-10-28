use std::env;
use std::fs;
use std::sync::Arc;

use russh::keys::agent::client::AgentClient;
use russh::keys::agent::AgentIdentity;
use russh::keys::decode_secret_key;
use russh::keys::{HashAlg, PrivateKeyWithHashAlg};

pub struct SshAgentProvider;

impl SshAgentProvider {
    pub fn new() -> Self {
        Self
    }

    pub async fn connect(&self) -> Result<SshAgentClient, String> {
        #[cfg(unix)]
        {
            AgentClient::connect_env()
                .await
                .map(SshAgentClient::Unix)
                .map_err(|error| {
                    format!("Failed to connect to SSH Agent: {error}")
                })
        }

        #[cfg(windows)]
        {
            AgentClient::connect_named_pipe(
                r"\\.\pipe\openssh-ssh-agent",
            )
            .await
            .map(SshAgentClient::NamedPipe)
            .map_err(|error| {
                format!(
                    "Failed to connect to Windows OpenSSH Agent: {error}"
                )
            })
        }

        #[cfg(not(any(unix, windows)))]
        {
            Err(
                "SSH Agent is not supported on this platform"
                    .to_string(),
            )
        }
    }

    pub async fn authenticate<H: russh::client::Handler>(
        &self,
        handle: &mut russh::client::Handle<H>,
        username: &str,
    ) -> Result<russh::client::AuthResult, String> {
        let mut agent = self.connect().await?;

        let identities = match &mut agent {
            #[cfg(unix)]
            SshAgentClient::Unix(agent) => agent
                .request_identities()
                .await
                .map_err(|error| {
                    format!(
                        "Failed to query SSH Agent identities: {error}"
                    )
                })?,

            #[cfg(windows)]
            SshAgentClient::NamedPipe(agent) => agent
                .request_identities()
                .await
                .map_err(|error| {
                    format!(
                        "Failed to query SSH Agent identities: {error}"
                    )
                })?,
        };

        if identities.is_empty() {
            return Err(
                "SSH Agent contains no identities".to_string(),
            );
        }

        for identity in identities {
            if !matches!(
                identity,
                AgentIdentity::PublicKey { .. }
            ) {
                continue;
            }

            let public_key = identity.public_key().into_owned();

            let result = match &mut agent {
                #[cfg(unix)]
                SshAgentClient::Unix(agent) => {
                    handle
                        .authenticate_publickey_with(
                            username,
                            public_key.clone(),
                            None,
                            agent,
                        )
                        .await
                }

                #[cfg(windows)]
                SshAgentClient::NamedPipe(agent) => {
                    handle
                        .authenticate_publickey_with(
                            username,
                            public_key,
                            None,
                            agent,
                        )
                        .await
                }
            };

            let result = result.map_err(|error| {
                format!("SSH Agent signing failed: {error}")
            })?;

            if result.success() {
                return Ok(result);
            }
        }

        Err(
            "SSH Agent authentication was rejected by the server"
                .to_string(),
        )
    }
}

pub struct PrivateKeyProvider {
    key_path: String,
}

impl PrivateKeyProvider {
    pub fn new(key_path: String) -> Self {
    let key_path = if let Some(relative_path) =
        key_path.strip_prefix("~/")
    {
        let home_dir = env::var("HOME")
            .or_else(|_| env::var("USERPROFILE"))
            .ok();

        if let Some(home_dir) = home_dir {
            std::path::PathBuf::from(home_dir)
                .join(relative_path)
                .to_string_lossy()
                .into_owned()
        } else {
            key_path
        }
    } else {
        key_path
    };

    Self { key_path }
}

    pub fn load_key(
        &self,
        passphrase: Option<&str>,
    ) -> Result<PrivateKeyWithHashAlg, String> {
        let secret = fs::read_to_string(&self.key_path)
            .map_err(|error| {
                format!(
                    "Failed to read SSH private key '{}': {error}",
                    self.key_path
                )
            })?;

        let key = decode_secret_key(
            &secret,
            passphrase,
        )
        .map_err(|error| {
            format!(
                "Failed to decode SSH private key: {error}"
            )
        })?;

        let hash_alg = if key.algorithm().is_rsa() {
            Some(HashAlg::Sha256)
        } else {
            None
        };

        Ok(PrivateKeyWithHashAlg::new(
            Arc::new(key),
            hash_alg,
        ))
    }

    pub fn requires_passphrase(&self) -> Result<bool, String> {
        let secret = fs::read_to_string(&self.key_path)
            .map_err(|error| {
                format!(
                    "Failed to read SSH private key '{}': {error}",
                    self.key_path
                )
            })?;

        match decode_secret_key(&secret, None) {
            Ok(_) => Ok(false),
            Err(russh::keys::Error::KeyIsEncrypted) => Ok(true),
            Err(error) => Err(format!(
                "Failed to inspect SSH private key: {error}"
            )),
        }
    }

    pub async fn authenticate<H: russh::client::Handler>(
        &self,
        handle: &mut russh::client::Handle<H>,
        username: &str,
        passphrase: Option<&str>,
    ) -> Result<russh::client::AuthResult, String> {
        let key = self.load_key(passphrase)?;

        handle
            .authenticate_publickey(
                username,
                key,
            )
            .await
            .map_err(|error| {
                format!(
                    "SSH private key authentication failed: {error}"
                )
            })
    }
}

pub enum SshAgentClient {
    #[cfg(unix)]
    Unix(AgentClient<tokio::net::UnixStream>),

    #[cfg(windows)]
    NamedPipe(
        AgentClient<
            tokio::net::windows::named_pipe::NamedPipeClient,
        >,
    ),
}