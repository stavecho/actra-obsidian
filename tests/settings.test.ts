import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "../src/settings/defaults";

describe("settings migration", () => {
  it("enables the 24-hour upload schedule by default", () => {
    expect(DEFAULT_SETTINGS.automaticUploadEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.schemaVersion).toBe(3);
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
