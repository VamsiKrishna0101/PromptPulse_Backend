import "dotenv/config"
import bcrypt from "bcryptjs"
import prisma from "../lib/prisma"

async function main() {
    const email = process.env.SEED_USER_EMAIL?.trim()
    const password = process.env.SEED_USER_PASSWORD

    if (!email || !password) {
        throw new Error("SEED_USER_EMAIL and SEED_USER_PASSWORD are required")
    }

    const hashedPassword = await bcrypt.hash(password, 10)
    const user = await prisma.user.upsert({
        where: { email },
        update: {
            password: hashedPassword,
            is_verified: true,
            otp: null,
            otp_expires_at: null,
        },
        create: {
            email,
            password: hashedPassword,
            account_type: "SINGLE",
            is_verified: true,
            role: "USER",
            plan: "FREE",
        },
        select: {
            id: true,
            email: true,
            is_verified: true,
            account_type: true,
            role: true,
            plan: true,
        },
    })

    console.log(JSON.stringify(user, null, 2))
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(async () => {
        await prisma.$disconnect()
    })
