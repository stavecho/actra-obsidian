import { describe, expect, it } from "vitest";
import {
  OAUTH_CALLBACK_URI,
  OAUTH_REQUESTED_SCOPES,
  OAUTH_SCOPE_DETAILS,
  buildOAuthAuthorizationUrl,
  createOAuthState,
  expiresAt,
  isAccessTokenFresh,
  parseOAuthTokenResponse
} from "../src/auth/oauth";

describe("ACTRA OAuth", () => {
  it("builds the authorization-code URL with the registered Obsidian callback", () => {
    const value = buildOAuthAuthorizationUrl("https://api.actra.example/", "actra_obsidian", "state_123");
    const url = new URL(value);

    expect(url.pathname).toBe("/auth/v1/app/oauth/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("actra_obsidian");
    expect(url.searchParams.get("redirect_uri")).toBe(OAUTH_CALLBACK_URI);
    expect(url.searchParams.get("scope")).toBe("dailylog note recording upload");
    expect(url.searchParams.get("state")).toBe("state_123");
  });

  it("explains every requested scope with the correct data direction", () => {
    expect(OAUTH_SCOPE_DETAILS.map(({ scope }) => scope)).toEqual([...OAUTH_REQUESTED_SCOPES]);
    expect(OAUTH_SCOPE_DETAILS.filter(({ direction }) => direction === "ACTRA → Obsidian").map(({ scope }) => scope))
      .toEqual(["dailylog", "note", "recording"]);
    expect(OAUTH_SCOPE_DETAILS.find(({ scope }) => scope === "upload")).toMatchObject({
      direction: "Obsidian → ACTRA",
      description: expect.stringContaining("另行选择")
    });
  });

  it("allows HTTP only for local development", () => {
    expect(() => buildOAuthAuthorizationUrl("http://api.actra.example", "client", "state"))
      .toThrow("必须使用 HTTPS");
    expect(() => buildOAuthAuthorizationUrl("http://127.0.0.1:8080", "client", "state"))
      .not.toThrow();
  });

  it("creates unpredictable state values and refreshes before expiry", () => {
    const first = createOAuthState();
    const second = createOAuthState();
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);

    const now = 1_000_000;
    const expiry = expiresAt(120, now);
    expect(isAccessTokenFresh(expiry, now)).toBe(true);
    expect(isAccessTokenFresh(expiry, now + 61_000)).toBe(false);
  });

  it("validates and normalizes token responses", () => {
    expect(parseOAuthTokenResponse({
      access_token: "access",
      refresh_token: "refresh",
      token_type: "bearer",
      expires_in: 2_592_000,
      refresh_expires_in: 31_536_000,
      scope: "dailylog note"
    })).toEqual({
      accessToken: "access",
      refreshToken: "refresh",
      tokenType: "Bearer",
      expiresIn: 2_592_000,
      refreshExpiresIn: 31_536_000,
      scope: "dailylog note"
    });
    expect(() => parseOAuthTokenResponse({ access_token: "access" })).toThrow("缺少必要字段");
  });
});
