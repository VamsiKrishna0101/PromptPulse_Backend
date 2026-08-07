import "dotenv/config"
import prisma from "../lib/prisma"
import { encryptWhatsAppToken, isEncryptedWhatsAppToken } from "../features/campaigns/whatsapp/whatsapp_security"

async function main() {
    const accounts = await prisma.whatsAppAccount.findMany({
        select: { id: true, access_token: true },
    })
    let migrated = 0
    for (const account of accounts) {
        if (isEncryptedWhatsAppToken(account.access_token)) continue
        await prisma.whatsAppAccount.update({
            where: { id: account.id },
            data: { access_token: encryptWhatsAppToken(account.access_token) },
        })
        migrated += 1
    }
    console.info(`[whatsapp] encrypted ${migrated} legacy access token(s)`)
}

main()
    .catch((error) => {
        console.error("[whatsapp] token migration failed", error)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
