import { Router } from "express"
import prisma from "../../lib/prisma"
import { requireAuth } from "../../middleware/auth"
import {
    getBalanceController,
    getCreditPacksController,
    getTransactionsController,
    createOrderController,
    verifyPaymentController,
    razorpayWebhookController,
    getBillingCatalogController,
    createSubscriptionController,
    verifySubscriptionController,
    checkOrderStatusController,
    cancelSubscriptionController,
    checkSubscriptionStatusController,
} from "./payments_controller"

const router = Router()

// Public (webhook — must use raw body, no auth)
router.post("/razorpay/webhook", razorpayWebhookController)

// Authenticated routes
router.get("/balance",             requireAuth, getBalanceController)
router.get("/packs",               requireAuth, getCreditPacksController)
router.get("/catalog",             requireAuth, getBillingCatalogController)
router.get("/transactions",        requireAuth, getTransactionsController)
router.get("/razorpay/check-order", requireAuth, checkOrderStatusController)
router.get("/razorpay/check-subscription", requireAuth, checkSubscriptionStatusController)
router.post("/razorpay/create-order", requireAuth, createOrderController)
router.post("/razorpay/verify",    requireAuth, verifyPaymentController)
router.post("/razorpay/create-subscription", requireAuth, createSubscriptionController)
router.post("/razorpay/verify-subscription", requireAuth, verifySubscriptionController)
router.post("/razorpay/cancel-subscription", requireAuth, cancelSubscriptionController)

export default router
