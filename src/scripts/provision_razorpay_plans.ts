import "dotenv/config"
import { BILLING_PLANS, type BillingInterval, type PaidPlan } from "../features/payments/billing_catalog"
import { getRazorpayClient } from "../features/payments/razorpay_config"

async function main() {
    const razorpay = getRazorpayClient()
    const created: Record<string, string> = {}

    for (const plan of Object.values(BILLING_PLANS)) {
        for (const interval of ["monthly", "annual"] as BillingInterval[]) {
            const amountInr = interval === "annual" ? plan.annual_amount_inr : plan.monthly_amount_inr
            const remote = await (razorpay.plans as any).create({
                period: interval === "annual" ? "yearly" : "monthly",
                interval: 1,
                item: {
                    name: `PromptPulse ${plan.name} ${interval === "annual" ? "Annual" : "Monthly"}`,
                    amount: amountInr * 100,
                    currency: "INR",
                    description: `${plan.monthly_credits.toLocaleString("en-IN")} credits released monthly`,
                },
                notes: {
                    product_plan: plan.id,
                    billing_interval: interval,
                    monthly_credits: String(plan.monthly_credits),
                },
            })
            created[`RAZORPAY_PLAN_${plan.id as PaidPlan}_${interval.toUpperCase()}`] = remote.id
        }
    }

    console.log("Add these values to the backend environment:")
    for (const [key, value] of Object.entries(created)) console.log(`${key}=${value}`)
}

main().catch(error => {
    console.error(error)
    process.exitCode = 1
})
