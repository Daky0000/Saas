import crypto from "crypto";

const rawKey = process.env.ENCRYPTION_KEY || "";

const getKey = () => {
  if (rawKey.startsWith("base64:")) {
    const key = Buffer.from(rawKey.replace("base64:", ""), "base64");
    if (key.length === 32) return key;
  }

  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, "hex");
  }

  if (rawKey.length >= 32) {
    return Buffer.from(rawKey.slice(0, 32));
  }

  throw new Error("ENCRYPTION_KEY must be at least 32 bytes");
};

export const encryptToken = (token: string): string => {
  const key = getKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), tag.toString("base64"), encrypted.toString("base64")].join(":");
};

export const decryptToken = (payload: string): string => {
  const key = getKey();
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted token format");
  }
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
  return decrypted.toString("utf8");
};
