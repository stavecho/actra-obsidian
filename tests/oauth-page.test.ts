import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(process.cwd(), "docs/oauth-authorize-page.html"), "utf8");

describe("ACTRA OAuth authorization page", () => {
  it("explains the two synchronization directions", () => {
    expect(page).toContain("连接 Actra 与 Obsidian");
    expect(page).toContain("从 Actra 同步至 Obsidian");
    expect(page).toContain("从 Obsidian 同步至 Actra");
    expect(page).toContain("不会自动读取整个 Vault");
  });

  it("identifies the account and verification code as Actra credentials", () => {
    expect(page).toContain("使用 Actra 账号登录");
    expect(page).toContain("Actra 登录邮箱");
    expect(page).toContain("验证码只用于验证你的 Actra 账号");
    expect(page).toContain("登录 Actra 并连接");
  });

  it("preserves the existing OAuth and verification endpoints", () => {
    expect(page).toContain('fetch("captcha"');
    expect(page).toContain('fetch("send_code"');
    expect(page).toContain('fetch("", {');
    expect(page).toContain('window.location.assign(payload.redirect_uri)');
  });

  it("carries OAuth request parameters without injecting HTML", () => {
    for (const parameter of ["client_id", "redirect_uri", "response_type", "state", "scope"]) {
      expect(page).toContain(`params.get("${parameter}")`);
    }
    expect(page).not.toContain("innerHTML");
    expect(page).not.toContain("insertAdjacentHTML");
  });

  it("hides permission groups that were not requested", () => {
    expect(page).toContain('group.hidden = !group.querySelector("[data-scope-item]:not([hidden])")');
  });

  it("offers status announcements and keyboard focus styles", () => {
    expect(page).toContain('role="status"');
    expect(page).toContain('aria-live="polite"');
    expect(page).toContain(":focus-visible");
    expect(page).toContain("prefers-reduced-motion");
    expect(page).toContain('for="email"');
    expect(page).toContain('for="captchaCode"');
    expect(page).toContain('for="emailCode"');
  });
});
