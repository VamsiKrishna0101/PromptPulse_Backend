import dotenv from "dotenv"
dotenv.config()
import fs from "fs"
import path from "path"
import Razorpay from "razorpay"
import https from "node:https"

const PLAN_ID = process.argv[2] || "plan_TM6f7hv3oFpOWX"
const KEY_ID = process.argv[3] || process.env.RAZORPAY_KEY_ID
const KEY_SECRET = process.argv[4] || process.env.RAZORPAY_KEY_SECRET

async function main() {
    console.log(`\n========================================`)
    console.log(`🔍 Checking Razorpay Plan: ${PLAN_ID}`)
    console.log(`========================================`)

    if (!KEY_ID || !KEY_SECRET) {
        console.error(`❌ RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required.`)
        console.log(`Usage: npx tsx src/scripts/verify_razorpay_plan.ts <PLAN_ID> [LIVE_KEY_ID] [LIVE_KEY_SECRET]`)
        process.exit(1)
    }

    console.log(`Using Key ID: ${KEY_ID.startsWith("rzp_live") ? "🟢 Live Mode (" + KEY_ID.slice(0, 12) + "...)" : "🟡 Test Mode (" + KEY_ID.slice(0, 12) + "..." + ")"}`)

    const razorpay = new Razorpay({ key_id: KEY_ID, key_secret: KEY_SECRET })
    if (process.env.NODE_ENV !== "production") {
        ; (razorpay.api as any).rq.defaults.httpsAgent = new https.Agent({ rejectUnauthorized: false })
    }

    // 1. Fetch Plan Details
    let plan: any
    try {
        plan = await razorpay.plans.fetch(PLAN_ID)
        console.log(`\n✅ Plan Fetched Successfully:`)
        console.log(`- Plan ID: ${plan.id}`)

        console.log(`- Name: ${plan.item?.name}`)
        console.log(`- Amount: ₹${(plan.item?.amount / 100).toFixed(2)} (${plan.item?.amount} paise)`)
        console.log(`- Currency: ${plan.item?.currency}`)
        console.log(`- Period: ${plan.period}`)
        console.log(`- Interval: ${plan.interval}`)
    } catch (err: any) {
        console.error(`❌ Failed to fetch plan:`, err?.error || err?.message || err)
        process.exit(1)
    }

    // 2. Create a Subscription to test
    console.log(`\n🔄 Creating test subscription for this plan...`)
    let subscription: any
    try {
        subscription = await razorpay.subscriptions.create({
            plan_id: PLAN_ID,
            total_count: 12,
            quantity: 1,
            customer_notify: 1,
            notes: {
                purpose: "Live ₹1 UPI Verification",
                created_by: "PromptPulse Tester",
            },
        })

        console.log(`\n✅ Subscription Created Successfully:`)
        console.log(`- Subscription ID: ${subscription.id}`)
        console.log(`- Status: ${subscription.status}`)
        console.log(`- Short URL: ${subscription.short_url || "N/A"}`)
    } catch (err: any) {
        console.error(`❌ Failed to create subscription:`, err?.error || err?.message || err)
        process.exit(1)
    }

    // 3. Generate a local standalone Checkout HTML for immediate browser payment
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Razorpay Live UPI Test (₹1)</title>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0f172a;
            color: #f8fafc;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .card {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 16px;
            padding: 32px;
            max-width: 440px;
            width: 100%;
            box-shadow: 0 20px 40px -15px rgba(0,0,0,0.5);
            text-align: center;
        }
        .badge {
            display: inline-block;
            background: #0284c7;
            color: #fff;
            padding: 4px 12px;
            border-radius: 999px;
            font-size: 12px;
            font-weight: 600;
            margin-bottom: 16px;
        }
        h1 {
            font-size: 22px;
            margin: 0 0 8px 0;
        }
        p {
            color: #94a3b8;
            font-size: 14px;
            margin: 0 0 24px 0;
        }
        .details {
            background: #0f172a;
            border-radius: 12px;
            padding: 16px;
            margin-bottom: 24px;
            text-align: left;
            font-size: 13px;
            border: 1px solid #334155;
        }
        .row {
            display: flex;
            justify-content: space-between;
            margin-bottom: 8px;
        }
        .row:last-child {
            margin-bottom: 0;
        }
        .label { color: #64748b; }
        .val { font-weight: 600; color: #e2e8f0; word-break: break-all; }
        .btn {
            background: #2563eb;
            color: white;
            border: none;
            border-radius: 10px;
            padding: 14px 24px;
            font-size: 15px;
            font-weight: 600;
            cursor: pointer;
            width: 100%;
            transition: all 0.2s;
        }
        .btn:hover {
            background: #1d4ed8;
            transform: translateY(-1px);
        }
        #result {
            margin-top: 16px;
            padding: 12px;
            border-radius: 8px;
            font-size: 13px;
            display: none;
        }
    </style>
</head>
<body>
    <div class="card">
        <span class="badge">Live Mode UPI Test</span>
        <h1>Razorpay Live Verification</h1>
        <p>Test ₹1 transaction with UPI / QR code</p>

        <div class="details">
            <div class="row">
                <span class="label">Plan ID:</span>
                <span class="val">${PLAN_ID}</span>
            </div>
            <div class="row">
                <span class="label">Plan Name:</span>
                <span class="val">${plan.item?.name}</span>
            </div>
            <div class="row">
                <span class="label">Amount:</span>
                <span class="val">₹${(plan.item?.amount / 100).toFixed(2)}</span>
            </div>
            <div class="row">
                <span class="label">Subscription ID:</span>
                <span class="val">${subscription.id}</span>
            </div>
        </div>

        <button class="btn" id="payBtn">Pay ₹${(plan.item?.amount / 100).toFixed(2)} with UPI</button>
        <div id="result"></div>
    </div>

    <script>
        document.getElementById('payBtn').onclick = function() {
            var options = {
                "key": "${KEY_ID}",
                "subscription_id": "${subscription.id}",
                "name": "PromptPulse Live Verification",
                "description": "Test ₹1 Payment via UPI",
                "image": "https://promptpulse.com/favicon.svg",
                "handler": function (response) {
                    var res = document.getElementById('result');
                    res.style.display = 'block';
                    res.style.background = '#064e3b';
                    res.style.color = '#34d399';
                    res.innerHTML = '<strong>Payment Successful!</strong><br>Payment ID: ' + response.razorpay_payment_id + '<br>Subscription ID: ' + response.razorpay_subscription_id + '<br>Signature: ' + response.razorpay_signature.slice(0, 16) + '...';
                },
                "theme": {
                    "color": "#0f172a"
                }
            };
            var rzp = new Razorpay(options);
            rzp.on('payment.failed', function (response){
                var res = document.getElementById('result');
                res.style.display = 'block';
                res.style.background = '#4c0519';
                res.style.color = '#fb7185';
                res.innerHTML = '<strong>Payment Failed:</strong> ' + response.error.description;
            });
            rzp.open();
        };
    </script>
</body>
</html>`

    const outPath = path.resolve(__dirname, "../../test_razorpay_checkout.html")
    fs.writeFileSync(outPath, htmlContent, "utf-8")
    console.log(`\n📄 Generated Checkout Test Page: ${outPath}`)
    console.log(`\nYou can open this file directly in your browser or run the checkout to pay ₹1 via UPI!`)
}

main().catch(console.error)
