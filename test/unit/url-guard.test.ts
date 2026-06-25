import { describe, expect, it } from "vitest";
import {
  assertSafeUrl,
  isPrivateOrReservedIp,
  BlockedUrlError,
} from "@/lib/url-guard";

describe("isPrivateOrReservedIp", () => {
  it("flags loopback, private, link-local and metadata addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "::1",
      "::",
      "fe80::1", // link-local
      "fc00::1", // unique-local
      "::ffff:127.0.0.1", // IPv4-mapped loopback
    ]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const ip of ["1.1.1.1", "8.8.8.8", "140.82.112.3", "2606:4700:4700::1111"]) {
      expect(isPrivateOrReservedIp(ip), ip).toBe(false);
    }
  });
});

describe("assertSafeUrl", () => {
  it("rejects the cloud metadata endpoint", async () => {
    await expect(assertSafeUrl("http://169.254.169.254/latest/meta-data")).rejects.toBeInstanceOf(
      BlockedUrlError
    );
  });

  it("rejects loopback by IP and by name", async () => {
    await expect(assertSafeUrl("http://127.0.0.1:11434")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertSafeUrl("http://localhost:8080")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects private ranges", async () => {
    await expect(assertSafeUrl("https://192.168.0.5/v1")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertSafeUrl("https://10.0.0.1")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("rejects non-http(s) schemes", async () => {
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toBeInstanceOf(BlockedUrlError);
    await expect(assertSafeUrl("gopher://127.0.0.1")).rejects.toBeInstanceOf(BlockedUrlError);
  });

  it("allows loopback ONLY when allowLocalhost is set (Ollama path)", async () => {
    await expect(
      assertSafeUrl("http://127.0.0.1:11434", { allowLocalhost: true })
    ).resolves.toBeUndefined();
    await expect(
      assertSafeUrl("http://localhost:11434", { allowLocalhost: true })
    ).resolves.toBeUndefined();
  });

  it("allows public hosts", async () => {
    await expect(assertSafeUrl("https://api.openai.com")).resolves.toBeUndefined();
    await expect(assertSafeUrl("https://api.anthropic.com")).resolves.toBeUndefined();
  });
});
