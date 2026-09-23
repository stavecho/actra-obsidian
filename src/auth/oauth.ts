import { requestUrl } from "obsidian";
import { stavechoOAuthBaseUrl } from "../api/stavecho";
import { ActraError } from "../utils/errors";

export const OAUTH_CALLBACK_ACTION = "actra-connect-oauth";
export const OAUTH_CALLBACK_URI = `obsidian://${OAUTH_CALLBACK_ACTION}`;
export const ACTRA_OAUTH_CLIENT_ID = "obdisian-ngefXHKjmLer8GQWKhto";
export const OAUTH_REQUESTED_SCOPES = ["dailylog", "note", "recording", "upload"] as const;

export const OAUTH_SCOPE_DETAILS = [
  {
    scope: "dailylog",
    label: "Daily Log",
    direction: "ACTRA → Obsidian",
    description: "将 ACTRA 日常记录同步到当前 Obsidian Vault。"
  },
  {
    scope: "note",
    label: "Note",
    direction: "ACTRA → Obsidian",
    description: "将 ACTRA 笔记同步到当前 Obsidian Vault。"
  },
  {
    scope: "recording",
    label: "Recording",
    direction: "ACTRA → Obsidian",
    description: "将 ACTRA 录音记录、摘要和转写同步到当前 Obsidian Vault。"
  },
  {
    scope: "upload",
    label: "Upload",
    direction: "Obsidian → ACTRA",
    description: "允许插件上传你另行选择的 Markdown；授权后不会自动读取整个 Vault。"
  }
] as const;

export interface OAuthTokenResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresIn: number;
  refreshExpiresIn: number;
  scope: string;
}

interface OAuthWireTokenResponse {
  access_token?: unknown;
  refresh_token?: unknown;
  token_type?: unknown;
  expires_in?: unknown;
  refresh_expires_in?: unknown;
  scope?: unknown;
}

function serviceUrl(baseUrl: string, path: string): string {
  return `${stavechoOAuthBaseUrl(baseUrl)}${path}`;
}

function requiredClientId(clientId: string): string {
  const value = clientId.trim();
  if (!value) throw new ActraError("请先填写 ACTRA OAuth Client ID。", "INVALID_CONFIGURATION");
  return value;
}

export function createOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function buildOAuthAuthorizationUrl(
  baseUrl: string,
  clientId: string,
  state: string,
  redirectUri = OAUTH_CALLBACK_URI,
  scopes: readonly string[] = OAUTH_REQUESTED_SCOPES
): string {
  if (!state) throw new ActraError("OAuth state 不能为空。", "INVALID_CONFIGURATION");
  const url = new URL(serviceUrl(baseUrl, "/auth/v1/app/oauth/authorize"));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", requiredClientId(clientId));
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", scopes.join(" "));
  url.searchParams.set("state", state);
  return url.toString();
}

export function parseOAuthTokenResponse(value: unknown): OAuthTokenResponse {
  if (!value || typeof value !== "object") {
    throw new ActraError("ACTRA Token 响应格式无效。", "INVALID_RESPONSE");
  }
  const token = value as OAuthWireTokenResponse;
  if (
    typeof token.access_token !== "string" || !token.access_token
    || typeof token.refresh_token !== "string" || !token.refresh_token
    || typeof token.token_type !== "string" || token.token_type.toLowerCase() !== "bearer"
    || typeof token.expires_in !== "number" || !Number.isFinite(token.expires_in) || token.expires_in <= 0
    || typeof token.refresh_expires_in !== "number" || !Number.isFinite(token.refresh_expires_in) || token.refresh_expires_in <= 0
    || typeof token.scope !== "string"
  ) {
    throw new ActraError("ACTRA Token 响应缺少必要字段。", "INVALID_RESPONSE");
  }
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    tokenType: "Bearer",
    expiresIn: token.expires_in,
    refreshExpiresIn: token.refresh_expires_in,
    scope: token.scope
  };
}

export class HttpActraOAuthClient {
  constructor(private readonly baseUrl: string) {}

  exchangeAuthorizationCode(code: string, clientId: string, redirectUri = OAUTH_CALLBACK_URI): Promise<OAuthTokenResponse> {
    return this.requestToken({
      grant_type: "authorization_code",
      code,
      client_id: requiredClientId(clientId),
      redirect_uri: redirectUri
    });
  }

  refresh(refreshToken: string, clientId: string): Promise<OAuthTokenResponse> {
    if (!refreshToken) throw new ActraError("Refresh Token 不存在，请重新授权。", "REAUTH_REQUIRED");
    return this.requestToken({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: requiredClientId(clientId)
    });
  }

  private async requestToken(body: Record<string, string>): Promise<OAuthTokenResponse> {
    try {
      const response = await requestUrl({
        url: serviceUrl(this.baseUrl, "/auth/v1/app/oauth/token"),
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        throw: false
      });
      if (response.status < 200 || response.status >= 300) {
        const errorBody = response.json as { err_msg?: unknown } | null;
        const serverMessage = typeof errorBody?.err_msg === "string" ? errorBody.err_msg : "";
        const message = serverMessage ? `ACTRA 授权失败：${serverMessage}` : `ACTRA 授权服务返回 ${response.status}。`;
        throw new ActraError(
          message,
          response.status === 400 || response.status === 401 ? "OAUTH_TOKEN_REJECTED" : "SERVER_ERROR",
          response.status >= 500
        );
      }
      return parseOAuthTokenResponse(response.json);
    } catch (error) {
      if (error instanceof ActraError) throw error;
      throw new ActraError("无法连接 ACTRA OAuth 服务。", "NETWORK_ERROR", true);
    }
  }
}

export function expiresAt(expiresInSeconds: number, now = Date.now()): number {
  return now + expiresInSeconds * 1000;
}

export function isAccessTokenFresh(expiresAtMs: number, now = Date.now(), refreshBufferMs = 60_000): boolean {
  return expiresAtMs > now + refreshBufferMs;
}
