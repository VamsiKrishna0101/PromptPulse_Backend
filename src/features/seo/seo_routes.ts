import { Router } from "express"
import domainResearchRoutes from "./domain_research/domain_research_routes"
import keywordResearchRoutes from "./keyword_research/keyword_research_routes"
import backlinksRoutes from "./backlinks/backlinks_routes"
import siteAuditRoutes from "./site_audit/site_audit_routes"
import onboardingRoutes from "./onboarding/onboarding_routes"

const router = Router()

router.use("/domain-research", domainResearchRoutes)
router.use("/keyword-research", keywordResearchRoutes)
router.use("/backlinks", backlinksRoutes)
router.use("/site-audit", siteAuditRoutes)
router.use("/onboarding", onboardingRoutes)

export default router
