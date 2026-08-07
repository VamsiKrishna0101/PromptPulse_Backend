import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"

const PREFIX = "enc:v1:"
const ALGORITHM = "aes-256-gcm"

function encryptionKey(): Buffer {
    const configured = process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY?.trim()
    if (!configured) {
        const fallbackSeed = process.env.JWT_ACCESS_SECRET || "promptpulse_whatsapp_dev_encryption_secret_key"
        const { createHash } = require("node:crypto")
        return createHash("sha256").update(fallbackSeed).digest()
    }

    const key = /^[A-Fa-f0-9]{64}$/.test(configured)
        ? Buffer.from(configured, "hex")
        : Buffer.from(configured, "base64")

    if (key.length !== 32) {
        throw new Error("WHATSAPP_TOKEN_ENCRYPTION_KEY must be a 32-byte hex or base64 value")
    }
    return key
}

export function isEncryptedWhatsAppToken(value: string): boolean {
    return value.startsWith(PREFIX)
}

export function encryptWhatsAppToken(plainText: string): string {
    if (!plainText.trim()) throw new Error("WhatsApp access token cannot be empty")
    if (isEncryptedWhatsAppToken(plainText)) return plainText

    const iv = randomBytes(12)
    const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv)
    const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()])
    const tag = cipher.getAuthTag()
    return `${PREFIX}${iv.toString("base64url")}.${tag.toString("base64url")}.${ciphertext.toString("base64url")}`
}

export function decryptWhatsAppToken(storedValue: string): string {
    // Legacy plaintext values are accepted so existing installations can be
    // migrated lazily when the account is next used.
    if (!isEncryptedWhatsAppToken(storedValue)) return storedValue

    const encoded = storedValue.slice(PREFIX.length).split(".")
    if (encoded.length !== 3) throw new Error("Invalid encrypted WhatsApp token format")

    const [ivEncoded, tagEncoded, ciphertextEncoded] = encoded
    const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(ivEncoded, "base64url"))
    decipher.setAuthTag(Buffer.from(tagEncoded, "base64url"))
    const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextEncoded, "base64url")),
        decipher.final(),
    ])
    return plaintext.toString("utf8")
}

export function getWhatsAppAccessToken(account: { access_token: string }): string {
    return decryptWhatsAppToken(account.access_token)
}

export function generateWhatsAppEncryptionKey(): string {
    return randomBytes(32).toString("base64")
}
