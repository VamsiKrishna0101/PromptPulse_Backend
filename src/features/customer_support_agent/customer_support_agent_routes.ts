import { Router } from "express"
import { chatCustomerSupportAgentController } from "./customer_support_agent_controller"

const router = Router()

router.post("/chat", chatCustomerSupportAgentController)

export default router
