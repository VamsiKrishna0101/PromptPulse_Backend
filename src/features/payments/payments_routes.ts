import { Router } from "express"
import { requireAuth } from "../../middleware/auth"
import {
    getBalanceController,
    getCreditPacksController,
    getTransactionsController,
    createOrderController,
    verifyPaymentController,
    razorpayWebhookController,
} from "./payments_controller"

const router = Router()

// Public (webhook — must use raw body, no auth)
router.post("/razorpay/webhook", razorpayWebhookController)

// Authenticated routes
router.get("/balance",             requireAuth, getBalanceController)
router.get("/packs",               requireAuth, getCreditPacksController)
router.get("/transactions",        requireAuth, getTransactionsController)
router.post("/razorpay/create-order", requireAuth, createOrderController)
router.post("/razorpay/verify",    requireAuth, verifyPaymentController)

export default router
