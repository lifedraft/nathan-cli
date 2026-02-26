/**
 * OS keychain abstraction.
 *
 * Provides a unified interface over platform-specific keychain implementations:
 * - macOS: Keychain Access (via `security` CLI)
 * - Linux: libsecret (via `secret-tool` CLI)
 * - Windows: Credential Manager (via `cmdkey` CLI)
 *
 * All commands are invoked via execFile (no shell) to avoid injection.
 */

import { execFile } from "node:child_process";

const SERVICE_PREFIX = "nathan";

export interface KeychainEntry {
  service: string;
  account: string;
  password: string;
}

/**
 * Run a command with execFile and return { stdout, stderr, exitCode }.
 * Never rejects — returns exitCode for callers to inspect.
 */
function run(
  cmd: string,
  args: string[],
  input?: string,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = execFile(cmd, args, { encoding: "utf-8" }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        exitCode: err ? 1 : 0,
      });
    });
    if (input !== undefined && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

/**
 * Check if the OS keychain is available on this platform.
 */
export async function isKeychainAvailable(): Promise<boolean> {
  const platform = process.platform;
  try {
    if (platform === "darwin") {
      const { exitCode } = await run("security", ["help"]);
      // `security help` exits 0 on macOS even though it prints to stderr
      return exitCode === 0;
    }
    if (platform === "linux") {
      const { exitCode } = await run("secret-tool", ["--version"]);
      return exitCode === 0;
    }
    if (platform === "win32") {
      const { exitCode } = await run("cmdkey", ["/list"]);
      return exitCode === 0;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Store a secret in the OS keychain.
 */
export async function keychainSet(
  service: string,
  account: string,
  password: string,
): Promise<void> {
  const fullService = keychainServiceName(service);
  const platform = process.platform;

  if (platform === "darwin") {
    // -U flag updates if exists, -w sets password from argument
    const { exitCode, stderr } = await run("security", [
      "add-generic-password",
      "-s", fullService,
      "-a", account,
      "-w", password,
      "-U",
    ]);
    if (exitCode !== 0) {
      throw new Error(`macOS keychain set failed: ${stderr.trim()}`);
    }
    return;
  }

  if (platform === "linux") {
    // secret-tool reads the secret from stdin
    const { exitCode, stderr } = await run(
      "secret-tool",
      ["store", "--label", `${SERVICE_PREFIX} ${service}`, "service", fullService, "account", account],
      password,
    );
    if (exitCode !== 0) {
      throw new Error(`Linux keyring set failed: ${stderr.trim()}`);
    }
    return;
  }

  if (platform === "win32") {
    const target = `${fullService}:${account}`;
    const { exitCode, stderr } = await run("cmdkey", [
      `/add:${target}`,
      `/user:${account}`,
      `/pass:${password}`,
    ]);
    if (exitCode !== 0) {
      throw new Error(`Windows credential store set failed: ${stderr.trim()}`);
    }
    return;
  }

  throw new Error(`Unsupported platform: ${platform}`);
}

/**
 * Retrieve a secret from the OS keychain.
 */
export async function keychainGet(
  service: string,
  account: string,
): Promise<string | null> {
  const fullService = keychainServiceName(service);
  const platform = process.platform;

  if (platform === "darwin") {
    const { exitCode, stdout, stderr } = await run("security", [
      "find-generic-password",
      "-s", fullService,
      "-a", account,
      "-w", // output password only
    ]);
    if (exitCode !== 0) {
      // Not found or other error
      if (stderr.includes("could not be found") || stderr.includes("SecKeychainSearchCopyNext")) {
        return null;
      }
      return null;
    }
    return stdout.trim();
  }

  if (platform === "linux") {
    const { exitCode, stdout } = await run("secret-tool", [
      "lookup",
      "service", fullService,
      "account", account,
    ]);
    if (exitCode !== 0 || !stdout) {
      return null;
    }
    return stdout.trim();
  }

  if (platform === "win32") {
    // cmdkey /list doesn't output passwords; on Windows we recommend NATHAN_MASTER_KEY env var.
    // This is a best-effort stub.
    return null;
  }

  return null;
}

/**
 * Delete a secret from the OS keychain.
 */
export async function keychainDelete(
  service: string,
  account: string,
): Promise<boolean> {
  const fullService = keychainServiceName(service);
  const platform = process.platform;

  if (platform === "darwin") {
    const { exitCode } = await run("security", [
      "delete-generic-password",
      "-s", fullService,
      "-a", account,
    ]);
    return exitCode === 0;
  }

  if (platform === "linux") {
    const { exitCode } = await run("secret-tool", [
      "clear",
      "service", fullService,
      "account", account,
    ]);
    return exitCode === 0;
  }

  if (platform === "win32") {
    const target = `${fullService}:${account}`;
    const { exitCode } = await run("cmdkey", [`/delete:${target}`]);
    return exitCode === 0;
  }

  return false;
}

/**
 * Build the full keychain service name.
 */
export function keychainServiceName(service: string): string {
  return `${SERVICE_PREFIX}:${service}`;
}
