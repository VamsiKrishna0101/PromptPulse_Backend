import prisma from "../lib/prisma"
import { grantDueAnnualSubscriptionCreditsForUser } from "../features/payments/razorpay_subscription_service"

async function main() {
    const due = await prisma.subscription.findMany({
        where: { billing_interval: "annual", status: "ACTIVE", next_credit_grant_at: { lte: new Date() } },
        select: { user_id: true },
        distinct: ["user_id"],
    })
    for (const subscription of due) {
        await grantDueAnnualSubscriptionCreditsForUser(subscription.user_id)
    }
    console.log(`Processed ${due.length} annual subscription wallet(s)`)
}

main()
    .catch(error => {
        console.error(error)
        process.exitCode = 1
    })
    .finally(() => prisma.$disconnect())
