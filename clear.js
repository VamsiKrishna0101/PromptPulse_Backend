const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    await prisma.sourceUrlContent.deleteMany({});
    console.log("Cleared old contents");
}

main().finally(() => prisma.$disconnect());
