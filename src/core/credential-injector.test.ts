import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  buildCredentialObject,
  applyCredentialAuth,
  injectCredentials,
  validateUrlForCredentials,
} from "./credential-injector.js";
import type { ResolvedCredentials, CredentialAuthConfig } from "./plugin-interface.js";
import {
  registerCredentialExpressionResolver,
  clearCredentialExpressionResolver,
} from "./credential-introspector.js";

// ---------------------------------------------------------------------------
// Simple expression resolver for tests (mirrors n8n-compat behavior)
// ---------------------------------------------------------------------------

function testExpressionResolver(
  template: string,
  credentials: Record<string, unknown>,
): string {
  let expr = template.startsWith("=") ? template.slice(1) : template;
  expr = expr.replace(
    /\{\{\s*\$credentials\??\.\s*(\w+)\s*\}\}/g,
    (_match, key) => {
      const val = credentials[key];
      return val !== undefined ? String(val) : "";
    },
  );
  return expr;
}

// Register the test resolver before each test, reset after
beforeEach(() => {
  registerCredentialExpressionResolver(testExpressionResolver);
});

afterEach(() => {
  clearCredentialExpressionResolver();
});

// ---------------------------------------------------------------------------
// buildCredentialObject
// ---------------------------------------------------------------------------

describe("buildCredentialObject", () => {
  test("primarySecret maps to accessToken, token, and apiKey aliases", () => {
    const cred: ResolvedCredentials = {
      typeName: "githubApi",
      primarySecret: "ghp_secret123",
      fields: {},
    };
    const obj = buildCredentialObject(cred);
    expect(obj.accessToken).toBe("ghp_secret123");
    expect(obj.token).toBe("ghp_secret123");
    expect(obj.apiKey).toBe("ghp_secret123");
  });

  test("existing fields are not overwritten by alias", () => {
    const cred: ResolvedCredentials = {
      typeName: "customApi",
      primarySecret: "my-secret",
      fields: { accessToken: "explicit-value", apiKey: "my-api-key" },
    };
    const obj = buildCredentialObject(cred);
    expect(obj.accessToken).toBe("explicit-value");
    expect(obj.apiKey).toBe("my-api-key");
    // token was not in fields, so it gets the alias
    expect(obj.token).toBe("my-secret");
  });

  test("no primarySecret produces only fields", () => {
    const cred: ResolvedCredentials = {
      typeName: "basicApi",
      fields: { user: "admin", password: "hunter2" },
    };
    const obj = buildCredentialObject(cred);
    expect(obj.user).toBe("admin");
    expect(obj.password).toBe("hunter2");
    expect(obj.accessToken).toBeUndefined();
    expect(obj.token).toBeUndefined();
    expect(obj.apiKey).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// applyCredentialAuth
// ---------------------------------------------------------------------------

describe("applyCredentialAuth", () => {
  test("with CredentialAuthConfig containing headers", () => {
    const config: CredentialAuthConfig = {
      headers: {
        Authorization: "=Bearer {{$credentials?.accessToken}}",
      },
    };
    const credValues = { accessToken: "ghp_test123" };
    const result = applyCredentialAuth(credValues, config);
    expect(result.headers["Authorization"]).toBe("Bearer ghp_test123");
  });

  test("with CredentialAuthConfig containing queryParams", () => {
    const config: CredentialAuthConfig = {
      queryParams: {
        api_key: "={{$credentials?.apiKey}}",
      },
    };
    const credValues = { apiKey: "key-abc-123" };
    const result = applyCredentialAuth(credValues, config);
    expect(result.queryParams).toBeDefined();
    expect(result.queryParams!["api_key"]).toBe("key-abc-123");
  });

  test("with CredentialAuthConfig containing basicAuth", () => {
    const config: CredentialAuthConfig = {
      basicAuth: {
        username: "={{$credentials?.user}}",
        password: "={{$credentials?.password}}",
      },
    };
    const credValues = { user: "admin", password: "secret" };
    const result = applyCredentialAuth(credValues, config);
    const expectedEncoded = btoa("admin:secret");
    expect(result.headers["Authorization"]).toBe(`Basic ${expectedEncoded}`);
  });

  test("fallback: apiKey in header", () => {
    const credValues = { apiKey: "my-api-key-value" };
    const result = applyCredentialAuth(credValues);
    // Default header name is "Authorization" when no headerName is specified
    expect(result.headers["Authorization"]).toBe("my-api-key-value");
  });

  test("fallback: apiKey with custom headerName", () => {
    const credValues = { apiKey: "my-key", headerName: "X-Api-Key" };
    const result = applyCredentialAuth(credValues);
    expect(result.headers["X-Api-Key"]).toBe("my-key");
    expect(result.headers["Authorization"]).toBeUndefined();
  });

  test("fallback: apiKey with invalid headerName falls back to Authorization", () => {
    const credValues = { apiKey: "my-key", headerName: "Invalid Header!" };
    const result = applyCredentialAuth(credValues);
    expect(result.headers["Authorization"]).toBe("my-key");
  });

  test("fallback: accessToken as Bearer", () => {
    const credValues = { accessToken: "tok_bearer_123" };
    const result = applyCredentialAuth(credValues);
    expect(result.headers["Authorization"]).toBe("Bearer tok_bearer_123");
  });

  test("fallback: token as Bearer", () => {
    const credValues = { token: "tok_generic_456" };
    const result = applyCredentialAuth(credValues);
    expect(result.headers["Authorization"]).toBe("Bearer tok_generic_456");
  });

  test("fallback: user + password as Basic", () => {
    const credValues = { user: "bob", password: "p@ssw0rd" };
    const result = applyCredentialAuth(credValues);
    const expectedEncoded = btoa("bob:p@ssw0rd");
    expect(result.headers["Authorization"]).toBe(`Basic ${expectedEncoded}`);
  });

  test("no config and no known fields returns empty headers", () => {
    const credValues = { someRandomField: "value" };
    const result = applyCredentialAuth(credValues);
    expect(result.headers).toEqual({});
    expect(result.queryParams).toBeUndefined();
  });

  test("apiKey takes precedence over accessToken in fallback", () => {
    const credValues = { apiKey: "the-key", accessToken: "the-token" };
    const result = applyCredentialAuth(credValues);
    // apiKey sets Authorization first; accessToken checks !headers["Authorization"]
    expect(result.headers["Authorization"]).toBe("the-key");
  });

  test("null authConfig uses fallback path", () => {
    const credValues = { accessToken: "my-token" };
    const result = applyCredentialAuth(credValues, null);
    expect(result.headers["Authorization"]).toBe("Bearer my-token");
  });

  test("empty authConfig (no headers/queryParams/body/basicAuth) uses fallback", () => {
    const config: CredentialAuthConfig = {};
    const credValues = { accessToken: "my-token" };
    const result = applyCredentialAuth(credValues, config);
    expect(result.headers["Authorization"]).toBe("Bearer my-token");
  });
});

// ---------------------------------------------------------------------------
// injectCredentials
// ---------------------------------------------------------------------------

describe("injectCredentials", () => {
  test("empty credentials returns empty headers", () => {
    const result = injectCredentials([]);
    expect(result.headers).toEqual({});
    expect(result.queryParams).toBeUndefined();
  });

  test("picks first credential with data", () => {
    const creds: ResolvedCredentials[] = [
      { typeName: "emptyApi", fields: {} },
      { typeName: "githubApi", primarySecret: "ghp_winner", fields: {} },
      { typeName: "slackApi", primarySecret: "xoxb_loser", fields: {} },
    ];
    const result = injectCredentials(creds);
    // Should use githubApi (first one with primarySecret).
    // buildCredentialObject sets apiKey alias, and apiKey fallback puts raw value in header.
    expect(result.headers["Authorization"]).toBe("ghp_winner");
  });

  test("picks credential with fields even without primarySecret", () => {
    const creds: ResolvedCredentials[] = [
      { typeName: "emptyApi", fields: {} },
      { typeName: "basicApi", fields: { user: "admin", password: "secret" } },
    ];
    const result = injectCredentials(creds);
    const expectedEncoded = btoa("admin:secret");
    expect(result.headers["Authorization"]).toBe(`Basic ${expectedEncoded}`);
  });

  test("all credentials empty returns empty headers", () => {
    const creds: ResolvedCredentials[] = [
      { typeName: "emptyApi", fields: {} },
      { typeName: "alsoEmpty", fields: {} },
    ];
    const result = injectCredentials(creds);
    expect(result.headers).toEqual({});
  });

  test("passes authConfig through to applyCredentialAuth", () => {
    const creds: ResolvedCredentials[] = [
      { typeName: "githubApi", primarySecret: "ghp_test", fields: {} },
    ];
    const config: CredentialAuthConfig = {
      headers: {
        Authorization: "=token {{$credentials?.accessToken}}",
      },
    };
    const result = injectCredentials(creds, config);
    expect(result.headers["Authorization"]).toBe("token ghp_test");
  });
});

// ---------------------------------------------------------------------------
// validateUrlForCredentials
// ---------------------------------------------------------------------------

describe("validateUrlForCredentials", () => {
  test("HTTPS URL passes", () => {
    const result = validateUrlForCredentials("https://api.github.com/user");
    expect(result).toBeNull();
  });

  test("HTTP URL fails", () => {
    const result = validateUrlForCredentials("http://api.github.com/user");
    expect(result).not.toBeNull();
    expect(result).toContain("insecure transport");
  });

  test("localhost fails", () => {
    const result = validateUrlForCredentials("https://localhost:3000/api");
    expect(result).not.toBeNull();
    expect(result).toContain("localhost");
  });

  test("IPv6 loopback (::1) fails", () => {
    const result = validateUrlForCredentials("https://[::1]:3000/api");
    expect(result).not.toBeNull();
    expect(result).toContain("localhost");
  });

  test("private IP 192.168.x.x fails", () => {
    const result = validateUrlForCredentials("https://192.168.1.100/api");
    expect(result).not.toBeNull();
    expect(result).toContain("private IP");
  });

  test("private IP 10.x.x.x fails", () => {
    const result = validateUrlForCredentials("https://10.0.0.1/api");
    expect(result).not.toBeNull();
    expect(result).toContain("private IP");
  });

  test("private IP 172.16.x.x fails", () => {
    const result = validateUrlForCredentials("https://172.16.0.1/api");
    expect(result).not.toBeNull();
    expect(result).toContain("private IP");
  });

  test("link-local 169.254.x.x fails", () => {
    const result = validateUrlForCredentials("https://169.254.1.1/api");
    expect(result).not.toBeNull();
    expect(result).toContain("private IP");
  });

  test("127.0.0.1 fails", () => {
    const result = validateUrlForCredentials("https://127.0.0.1/api");
    expect(result).not.toBeNull();
    expect(result).toContain("private IP");
  });

  test("0.x.x.x fails", () => {
    const result = validateUrlForCredentials("https://0.0.0.0/api");
    expect(result).not.toBeNull();
    expect(result).toContain("private IP");
  });

  test("invalid URL returns error", () => {
    const result = validateUrlForCredentials("not-a-url");
    expect(result).not.toBeNull();
    expect(result).toContain("Invalid URL");
  });

  test("public IP over HTTPS passes", () => {
    const result = validateUrlForCredentials("https://8.8.8.8/dns");
    expect(result).toBeNull();
  });

  test("172.15.x.x passes (not in private range)", () => {
    const result = validateUrlForCredentials("https://172.15.0.1/api");
    expect(result).toBeNull();
  });

  test("172.32.x.x passes (not in private range)", () => {
    const result = validateUrlForCredentials("https://172.32.0.1/api");
    expect(result).toBeNull();
  });
});
