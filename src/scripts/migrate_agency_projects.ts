import prisma from "../lib/prisma"

async function run() {
    await prisma.$executeRawUnsafe(`
        ALTER TABLE "AgencyClientLink" ADD COLUMN IF NOT EXISTS "assigned_project_ids" text[] DEFAULT '{}';
    `)
    await prisma.$executeRawUnsafe(`
        ALTER TABLE "AgencyInvitation" ADD COLUMN IF NOT EXISTS "assigned_project_ids" text[] DEFAULT '{}';
    `)
    console.log("Successfully added assigned_project_ids columns to database!")
}

run()
    .catch(console.error)
    .finally(() => prisma.$disconnect())
