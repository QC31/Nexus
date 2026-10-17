export type SshAuthenticationMethod =
  | 'ssh-agent'
  | 'private-key'
  | 'password';

export interface SshServer {
  id: string;
  name: string;
  host: string;
  username: string;
  port: number;
  authenticationMethod: SshAuthenticationMethod;
  privateKeyPath?: string;
  group?: string;
  favorite: boolean;
  rememberPassword: boolean;
}

export interface SshAuthenticationContext {
  serverId: string;
  username: string;
  host: string;
  port: number;
}

export interface SshAuthenticationProvider {
  readonly method: SshAuthenticationMethod;

  isAvailable(
    context: SshAuthenticationContext,
  ): Promise<boolean>;

  authenticate(
    context: SshAuthenticationContext,
  ): Promise<void>;
}