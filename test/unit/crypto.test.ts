import { beforeAll, describe, expect, it } from "vitest";
import { encryptSecret, decryptSecret, isEncrypted } from "@/lib/crypto";

// Use an explicit key so the test never touches the on-disk key file.
beforeAll(() => {
  process.env.RECALLMEM_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("secret encryption at rest", () => {
  it("round-trips a secret", () => {
    const secret = "sk-ant-api03-abcdef1234567890";
    const enc = encryptSecret(secret);
    expect(enc).not.toBe(secret);
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).toContain("enc:v1:");
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("does not leak the plaintext in the envelope", () => {
    const secret = "super-secret-value";
    expect(encryptSecret(secret)).not.toContain(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same-input");
    const b = encryptSecret("same-input");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("same-input");
    expect(decryptSecret(b)).toBe("same-input");
  });

  it("returns legacy plaintext values unchanged (backward compat)", () => {
    expect(isEncrypted("sk-plaintext-legacy")).toBe(false);
    expect(decryptSecret("sk-plaintext-legacy")).toBe("sk-plaintext-legacy");
  });

  it("fails to decrypt a tampered envelope", () => {
    const enc = encryptSecret("integrity-protected");
    const tampered = enc.slice(0, -4) + "AAAA";
    expect(() => decryptSecret(tampered)).toThrow();
  });
});
