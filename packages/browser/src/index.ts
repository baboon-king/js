import {
  fetchOidcConfig,
  generateCodeChallenge,
  generateCodeVerifier,
  generateSignInUri,
  generateSignOutUri,
  generateState,
  OidcConfigResponse,
  Requester,
  revoke,
  withReservedScopes,
} from '@logto/js';
import { conditional, Optional } from '@silverhand/essentials';
import { assert, Infer, string, type } from 'superstruct';

import { LogtoClientError } from './errors';
import { getDiscoveryEndpoint, getLogtoKey } from './utils';

export * from './errors';

export type LogtoConfig = {
  endpoint: string;
  clientId: string;
  scopes?: string[];
  resources?: string[];
  usingPersistStorage?: boolean;
  requester: Requester;
};

export type AccessToken = {
  token: string;
  scope: string;
  expiresAt: number; // Unix Timestamp in seconds
};

export const LogtoSignInSessionItemSchema = type({
  redirectUri: string(),
  codeVerifier: string(),
  state: string(),
});

export type LogtoSignInSessionItem = Infer<typeof LogtoSignInSessionItemSchema>;

export default class LogtoClient {
  protected accessTokenMap = new Map<string, AccessToken>();
  protected refreshToken?: string;
  protected idToken?: string;
  protected logtoConfig: LogtoConfig;
  protected oidcConfig?: OidcConfigResponse;
  protected logtoStorageKey: string;

  constructor(logtoConfig: LogtoConfig) {
    this.logtoConfig = logtoConfig;
    this.logtoStorageKey = getLogtoKey(logtoConfig.clientId);
    this.idToken = conditional(localStorage.getItem(`${this.logtoStorageKey}:idToken`));
    this.refreshToken = conditional(localStorage.getItem(`${this.logtoStorageKey}:refreshToken`));
  }

  public get isAuthenticated() {
    return Boolean(this.idToken);
  }

  protected get signInSession(): Optional<LogtoSignInSessionItem> {
    const jsonItem = sessionStorage.getItem(this.logtoStorageKey);

    if (!jsonItem) {
      return undefined;
    }

    try {
      const item: unknown = JSON.parse(jsonItem);
      assert(item, LogtoSignInSessionItemSchema);

      return item;
    } catch (error: unknown) {
      throw new LogtoClientError('sign_in_session.invalid', error);
    }
  }

  protected set signInSession(logtoSignInSessionItem: Optional<LogtoSignInSessionItem>) {
    if (!logtoSignInSessionItem) {
      sessionStorage.removeItem(this.logtoStorageKey);

      return;
    }

    const jsonItem = JSON.stringify(logtoSignInSessionItem);
    sessionStorage.setItem(this.logtoStorageKey, jsonItem);
  }

  public async signIn(redirectUri: string) {
    const { clientId, resources, scopes: customScopes } = this.logtoConfig;
    const { authorizationEndpoint } = await this.getOidcConfig();
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await generateCodeChallenge(codeVerifier);
    const state = generateState();
    const scopes = withReservedScopes(customScopes).split(' ');

    const signInUri = generateSignInUri({
      authorizationEndpoint,
      clientId,
      redirectUri,
      codeChallenge,
      state,
      scopes,
      resources,
    });

    this.signInSession = { redirectUri, codeVerifier, state };
    window.location.assign(signInUri);
  }

  public async signOut(postLogoutRedirectUri?: string) {
    if (!this.idToken) {
      return;
    }

    const { clientId, requester } = this.logtoConfig;
    const { endSessionEndpoint, revocationEndpoint } = await this.getOidcConfig();

    if (this.refreshToken) {
      try {
        await revoke(revocationEndpoint, clientId, this.refreshToken, requester);
      } catch {
        // Do nothing at this point, as we don't want to break the sign out flow even if the revocation is failed
      }
    }

    const url = generateSignOutUri({
      endSessionEndpoint,
      postLogoutRedirectUri,
      idToken: this.idToken,
    });

    localStorage.removeItem(`${this.logtoStorageKey}:idToken`);
    localStorage.removeItem(`${this.logtoStorageKey}:refreshToken`);

    this.accessTokenMap.clear();
    this.idToken = undefined;
    this.refreshToken = undefined;

    window.location.assign(url);
  }

  protected async getOidcConfig(): Promise<OidcConfigResponse> {
    if (!this.oidcConfig) {
      const { endpoint, requester } = this.logtoConfig;
      const discoveryEndpoint = getDiscoveryEndpoint(endpoint);
      this.oidcConfig = await fetchOidcConfig(discoveryEndpoint, requester);
    }

    return this.oidcConfig;
  }
}