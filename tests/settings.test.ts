import { describe, expect, it } from "vitest";
import { ACTRA_OAUTH_CLIENT_ID } from "../src/auth/oauth";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings/defaults";

describe("settings migration", () => {
  it("enables the 24-hour upload schedule by default", () => {
    expect(DEFAULT_SETTINGS.automaticUploadEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(3);
  });

  it("uses the production OAuth client ID by default", () => {
    expect(DEFAULT_SETTINGS.oauthClientId).toBe("obdisian-ngefXHKjmLer8GQWKhto");
    expect(DEFAULT_SETTINGS.oauthClientId).toBe(ACTRA_OAUTH_CLIENT_ID);
  });

  it("preserves an explicitly cleared API address for connection validation", () => {
    expect(mergeSettings({ apiBaseUrl: "" }).apiBaseUrl).toBe("");
    expect(mergeSettings({}).apiBaseUrl).toBe(DEFAULT_SETTINGS.apiBaseUrl);
  });

  it("migrates the legacy test client ID and preserves custom client IDs", () => {
    expect(mergeSettings({ oauthClientId: "obdisian2345677" }).oauthClientId).toBe(ACTRA_OAUTH_CLIENT_ID);
    expect(mergeSettings({ oauthClientId: "custom-client" }).oauthClientId).toBe("custom-client");
  });

  it("enables automatic upload for settings saved before schema 3", () => {
    const migrated = mergeSettings({
      schemaVersion: 2,
      permissions: { readAuthorizedNotes: true, cloudIndexSync: false, watchChanges: true }
    });

    expect(migrated.schemaVersion).toBe(3);
    expect(migrated.automaticUploadEnabled).toBe(true);
    expect(migrated.permissions.readAuthorizedNotes).toBe(true);
    expect(Object.keys(migrated.permissions).sort()).toEqual([
      "readAttachments",
      "readAuthorizedNotes",
      "taskWriteback",
      "writeAttachments"
    ]);
  });

  it("preserves an explicit automatic-upload preference", () => {
    expect(mergeSettings({ automaticUploadEnabled: false }).automaticUploadEnabled).toBe(false);
  });

  it("disables development mode in the production release", () => {
    expect(mergeSettings({ developerMode: true }).developerMode).toBe(false);
  });
});
