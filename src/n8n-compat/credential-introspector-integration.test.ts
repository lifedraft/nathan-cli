/**
 * Integration test: validates that n8n credential introspection strategy
 * works when registered in core's credential-introspector.
 *
 * Moved from core/ because this test imports from n8n-compat/, making it
 * an integration test that crosses bounded context boundaries.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import {
  registerCredentialIntrospectionStrategy,
  registerCredentialExpressionResolver,
  loadCredentialType,
  resolveCredentialExpr,
} from "../core/credential-introspector.js";
import {
  loadCredentialTypeDefinition,
  resolveCredentialExpression,
} from "./credential-type-loader.js";

// Register the n8n strategy (same as index.ts does)
beforeAll(() => {
  registerCredentialIntrospectionStrategy(loadCredentialTypeDefinition);
  registerCredentialExpressionResolver(resolveCredentialExpression);
});

describe("loadCredentialType", () => {
  test("loads githubApi credential type", () => {
    const info = loadCredentialType("githubApi");
    expect(info).toBeTruthy();
    expect(info!.name).toBe("githubApi");
    expect(info!.properties.length).toBeGreaterThan(0);
    // Should have accessToken field
    const accessTokenField = info!.properties.find((p) => p.name === "accessToken");
    expect(accessTokenField).toBeTruthy();
    expect(accessTokenField!.isPassword).toBe(true);
  });

  test("returns null for unknown credential types", () => {
    expect(loadCredentialType("nonExistentApi")).toBeNull();
  });

  test("githubApi has test endpoint", () => {
    const info = loadCredentialType("githubApi");
    expect(info?.test).toBeTruthy();
    expect(info?.test?.request).toBeTruthy();
  });

  test("githubApi has authenticate config", () => {
    const info = loadCredentialType("githubApi");
    expect(info?.authenticate).toBeTruthy();
  });
});

describe("resolveCredentialExpr", () => {
  test("resolves credential expressions", () => {
    const result = resolveCredentialExpr(
      "=Bearer {{$credentials?.accessToken}}",
      { accessToken: "ghp_test123" },
    );
    expect(result).toBe("Bearer ghp_test123");
  });

  test("handles missing credentials gracefully", () => {
    const result = resolveCredentialExpr(
      "=Bearer {{$credentials?.accessToken}}",
      {},
    );
    expect(result).toBe("Bearer ");
  });
});
