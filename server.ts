import './src/lib/env'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import authRoutes from './src/features/auth/auth_routes'
import onboardingRoutes from './src/features/onboarding/onboarding_routes'
import dashboardRoutes from './src/features/dashboard/dashboard_route'
import sourcesRoutes from './src/features/sources/sources_routes'
import brandRoutes from './src/features/brands/brand_routes'
import scrapingRoutes from './src/features/scraping/scraping_routes'
import projectRoutes from './src/features/projects/projects_routes'
import promptRoutes from './src/features/prompts/prompt_routes'
import webAnalyticsRoutes from './src/features/webanalytics/webanalytics_routes'
import saraRoutes from './src/features/sara/sara_routes'
import subscriptionRoutes from './src/features/subscription/subscription_routes'
import profileRoutes from './src/features/profile/profile_routes'
import settingsRoutes from './src/features/settings/settings_routes'
import helpRoutes from './src/features/help/help_routes'
import exportRoutes from './src/features/exports/export_routes'
import opportunityRoutes from './src/features/opportunities/opportunity_routes'
import geoArticleRoutes from './src/features/geoartciles/geoarticle_routes'
import adminRoutes from './src/features/admin/admin_routes'
import demoRoutes from './src/features/demo/demo_routes'
import productTourRoutes from './src/features/product_tour/product_tour_routes'
import reportRoutes from './src/features/report/report_routes'
import artifactRoutes from './src/features/artifacts/artifact_routes'
import actionQueueRoutes from './src/features/action_queue/action_queue_routes'
import customerSupportAgentRoutes from './src/features/customer_support_agent/customer_support_agent_routes'
import redditIntelligenceRoutes from './src/features/reddit_intelligence/reddit_intelligence_routes'
import brandPreferenceRoutes from './src/features/brand_preferences/brand_preferences_routes'
import { stripeWebhookController } from './src/features/subscription/subscription_controller'
import { requireAdmin, requireAuth } from './src/middleware/auth'

if (process.env.ENABLE_DAILY_SCRAPE_SCHEDULER === "true") {
    void import("./src/scheduler/daily_scheduler")
}

process.on("uncaughtException", error => {
    console.error("Uncaught exception during startup/runtime", error)
})

process.on("unhandledRejection", reason => {
    console.error("Unhandled promise rejection during startup/runtime", reason)
})

const app = express()
const PORT = process.env.PORT || 3000

app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
}))
app.use(cors())
app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true })
})
app.post('/api/subscription/webhook', express.raw({ type: 'application/json' }), stripeWebhookController)
app.use(express.json())

app.use('/api/auth', authRoutes)
app.use('/api/onboarding', requireAuth, onboardingRoutes)
app.use('/api/dashboard', requireAuth, dashboardRoutes)
app.use('/api/sources', requireAuth, sourcesRoutes)
app.use('/api/brands', requireAuth, brandRoutes)
app.use('/api/scraping', requireAuth, scrapingRoutes)
app.use('/api/projects', requireAuth, projectRoutes)
app.use('/api/prompts', requireAuth, promptRoutes)
app.use('/api/sara', requireAuth, saraRoutes)
app.use('/api/subscription', requireAuth, subscriptionRoutes)
app.use('/api/profile', requireAuth, profileRoutes)
app.use('/api/settings', requireAuth, settingsRoutes)
app.use('/api/help', requireAuth, helpRoutes)
app.use('/api/exports', requireAuth, exportRoutes)
app.use('/api/opportunities', requireAuth, opportunityRoutes)
app.use('/api/geoarticles', requireAuth, geoArticleRoutes)
app.use('/api/product-tour', requireAuth, productTourRoutes)
app.use('/api/reports', requireAuth, reportRoutes)
app.use('/api/artifacts', requireAuth, artifactRoutes)
app.use('/api/action-queue', requireAuth, actionQueueRoutes)
app.use('/api/customer-support-agent', requireAuth, customerSupportAgentRoutes)
app.use('/api/reddit-intelligence', requireAuth, redditIntelligenceRoutes)
app.use('/api/brand-preferences', requireAuth, brandPreferenceRoutes)
app.use('/api/admin', requireAuth, requireAdmin, adminRoutes)
app.use('/api/webanalytics', webAnalyticsRoutes)
app.use('/api/demo', demoRoutes)

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`)
})
