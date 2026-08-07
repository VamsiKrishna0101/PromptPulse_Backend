import assert from "node:assert/strict"
import { test } from "node:test"
import { decryptWhatsAppToken, encryptWhatsAppToken, generateWhatsAppEncryptionKey } from "./whatsapp_security"

process.env.WHATSAPP_TOKEN_ENCRYPTION_KEY = generateWhatsAppEncryptionKey()

test("WhatsApp access tokens round-trip through authenticated encryption", () => {
    const token = "EAAB-test-token-with-sensitive-value"
    const encrypted = encryptWhatsAppToken(token)
    assert.notEqual(encrypted, token)
    assert.equal(decryptWhatsAppToken(encrypted), token)
})

test("legacy plaintext tokens remain readable for migration", () => {
    assert.equal(decryptWhatsAppToken("legacy-token"), "legacy-token")
})
