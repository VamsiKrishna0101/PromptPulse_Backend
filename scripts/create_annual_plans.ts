import Razorpay from "razorpay";
import dotenv from "dotenv";

dotenv.config({ path: ".env" });

const key_id = process.env.RAZORPAY_KEY_ID;
const key_secret = process.env.RAZORPAY_KEY_SECRET;

if (!key_id || !key_secret) {
    console.error("Missing Razorpay keys in .env");
    process.exit(1);
}

const razorpay = new Razorpay({ key_id, key_secret });

async function createPlan(name: string, description: string, amountPaise: number) {
    try {
        const plan = await razorpay.plans.create({
            period: "monthly",
            interval: 1,
            item: {
                name,
                amount: amountPaise,
                currency: "INR",
                description
            }
        });
        console.log(`Created plan for ${name}: ${plan.id} (${amountPaise / 100} INR/month)`);
        return plan.id;
    } catch (err) {
        console.error(`Failed to create plan for ${name}:`, err);
        return null;
    }
}

async function main() {
    console.log("Creating new Annual Contract (Billed Monthly) plans on Razorpay...\n");

    const starter = await createPlan("Starter Annual (Billed Monthly)", "Starter Plan - Annual Contract billed monthly", 224900);
    const growth = await createPlan("Growth Annual (Billed Monthly)", "Growth Plan - Annual Contract billed monthly", 449900);
    const pro = await createPlan("Pro Annual (Billed Monthly)", "Pro Plan - Annual Contract billed monthly", 899900);

    console.log("\n--- Update your .env file with these new IDs ---");
    console.log(`RAZORPAY_PLAN_STARTER_ANNUAL=${starter}`);
    console.log(`RAZORPAY_PLAN_GROWTH_ANNUAL=${growth}`);
    console.log(`RAZORPAY_PLAN_PRO_ANNUAL=${pro}`);
}

main().catch(console.error);
