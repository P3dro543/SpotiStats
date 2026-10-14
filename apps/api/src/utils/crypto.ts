import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

function encryptionKey(): Buffer {
  const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY ?? "", "base64");
  if (key.byteLength !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a base64 encoded 32-byte key");
  return key;
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptSecret(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(".");
  if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("Unsupported encrypted token format");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
}

export function sha256(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }

export function sessionDigest(value: string): string {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is not configured");
  return createHmac("sha256", env.SESSION_SECRET).update(value).digest("hex");
}
