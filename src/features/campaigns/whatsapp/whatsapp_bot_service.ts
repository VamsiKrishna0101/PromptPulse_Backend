import prisma from "../../../lib/prisma"
import {
    sendWhatsAppTextMessage,
    sendWhatsAppInteractiveButtons,
    sendWhatsAppInteractiveList,
} from "./whatsapp_meta_api"
import { GoogleGenerativeAI } from "@google/generative-ai"
import { accessTokenForAccount } from "./whatsapp_service"

// ─── Default Data for Hospitals & Clinics ─────────────────────────────────────

export const DEFAULT_SERVICES_CATALOG = [
    {
        id: "cardiology",
        name: "Cardiology & Heart Care",
        desc: "Senior Cardiologists, ECG, 2D Echo & Angiography consultation",
        fee: "₹800",
        timing: "Mon-Sat: 10:00 AM - 2:00 PM",
        doctors: [
            { id: "dr_priya", name: "Dr. Priya Sharma", title: "MD, DM (Cardiology) - Senior Interventional Cardiologist", timing: "Mon, Wed, Fri 10 AM - 1 PM", fee: "₹800" },
            { id: "dr_rahul", name: "Dr. Rahul Deshmukh", title: "MD (Cardiology) - Consultant Heart Specialist", timing: "Tue, Thu, Sat 11 AM - 3 PM", fee: "₹700" },
        ],
    },
    {
        id: "orthopedics",
        name: "Orthopedics & Joint Care",
        desc: "Joint replacement, fracture treatment, sports injuries & spine care",
        fee: "₹700",
        timing: "Mon-Sat: 9:00 AM - 5:00 PM",
        doctors: [
            { id: "dr_vikram", name: "Dr. Vikram Sethi", title: "MS (Ortho), M.Ch - Joint Replacement Specialist", timing: "Mon-Sat 10 AM - 2 PM", fee: "₹750" },
            { id: "dr_sneha", name: "Dr. Sneha Patil", title: "D.Ortho - Spine & Fracture Consultant", timing: "Mon-Fri 2 PM - 6 PM", fee: "₹650" },
        ],
    },
    {
        id: "pediatrics",
        name: "Pediatrics & Child Health",
        desc: "Newborn care, vaccinations, child nutrition & general pediatrics",
        fee: "₹600",
        timing: "Daily: 9:00 AM - 8:00 PM",
        doctors: [
            { id: "dr_ananya", name: "Dr. Ananya Roy", title: "MD (Pediatrics), DNB - Senior Pediatrician", timing: "Daily 9 AM - 1 PM & 5 PM - 8 PM", fee: "₹600" },
        ],
    },
    {
        id: "general_medicine",
        name: "General Medicine & Health Check",
        desc: "Fever, diabetes, hypertension, infection treatment & wellness checks",
        fee: "₹500",
        timing: "Daily: 8:00 AM - 9:00 PM",
        doctors: [
            { id: "dr_amit", name: "Dr. Amit Verma", title: "MD (Internal Medicine) - Physician", timing: "Daily 8 AM - 2 PM", fee: "₹500" },
        ],
    },
    {
        id: "diagnostics",
        name: "Diagnostics & Pathology Lab",
        desc: "NABL Accredited Lab, Digital X-Ray, Ultrasound, CT Scan & Blood Tests",
        fee: "From ₹250",
        timing: "24x7 Diagnostic Services",
        doctors: [],
    },
    {
        id: "emergency",
        name: "24x7 Emergency & Trauma",
        desc: "Immediate emergency doctor, ICU admission, ambulance assistance",
        fee: "Emergency OPD",
        timing: "24 Hours Open (365 Days)",
        doctors: [],
    },
]

export const DEFAULT_FAQS = [
    {
        question: "Do you accept insurance / cashless mediclaim?",
        answer: "Yes! We accept all major health insurance providers including Star Health, HDFC ERGO, Care Health, Bajaj Allianz, Niva Bupa, ICICI Lombard, and Ayushman Bharat / PMJAY.",
        category: "Insurance & Billing",
    },
    {
        question: "What are OPD consultation hours and emergency timings?",
        answer: "Our OPD consultation is open from 8:00 AM to 8:00 PM (Monday to Saturday). Emergency, Trauma, ICU, and Ambulance services are open 24x7 all 365 days.",
        category: "Timings & Hours",
    },
    {
        question: "Where is the hospital located?",
        answer: "We are located at Plot 42, Main Ring Road, Landmark: Opposite Apollo Pharmacy / Metro Pillar 120. Valet parking and ambulance ramp available.",
        category: "Location & Directions",
    },
    {
        question: "How do I book an appointment?",
        answer: "You can book an appointment right here on WhatsApp! Just click 'Book Appointment' or reply with your name, preferred doctor, and time slot. Our team will call you back within 10 minutes to confirm.",
        category: "Appointments",
    },
]

// ─── Conversational Session Memory ────────────────────────────────────────────

interface BookingSession {
    step: "COLLECTING_NAME" | "COLLECTING_SERVICE" | "COLLECTING_SLOT" | "COLLECTING_SYMPTOMS"
    patientName?: string
    serviceRequested?: string
    doctorRequested?: string
    preferredTime?: string
    symptoms?: string
    updatedAt: number
}

// In-memory session store (keyed by accountId:phone, expires after 30 mins)
const sessions = new Map<string, BookingSession>()

function getSessionKey(accountId: string, phone: string): string {
    return `${accountId}:${phone.replace(/\+/g, "").trim()}`
}

export function getSession(accountId: string, phone: string): BookingSession | undefined {
    const key = getSessionKey(accountId, phone)
    const s = sessions.get(key)
    if (!s) return undefined
    // expire after 30 mins
    if (Date.now() - s.updatedAt > 30 * 60 * 1000) {
        sessions.delete(key)
        return undefined
    }
    return s
}

export function setSession(accountId: string, phone: string, data: Partial<BookingSession>) {
    const key = getSessionKey(accountId, phone)
    const existing = getSession(accountId, phone) ?? { step: "COLLECTING_NAME", updatedAt: Date.now() }
    sessions.set(key, { ...existing, ...data, updatedAt: Date.now() })
}

export function clearSession(accountId: string, phone: string) {
    sessions.delete(getSessionKey(accountId, phone))
}

// ─── Bot Config DB Management ─────────────────────────────────────────────────

export async function getOrCreateBotConfig(accountId: string) {
    let config = await prisma.whatsAppBotConfig.findUnique({
        where: { account_id: accountId },
    })

    if (!config) {
        const account = await prisma.whatsAppAccount.findUnique({
            where: { id: accountId },
        })
        const businessName = account?.display_name || "My Business"

        config = await prisma.whatsAppBotConfig.create({
            data: {
                account_id: accountId,
                is_enabled: true,
                business_name: businessName,
                business_type: "GENERAL",
                greeting_message: `Namaste! 🙏 Welcome to *${businessName}*.\nHow can we assist you today?`,
                services_catalog: DEFAULT_SERVICES_CATALOG as any,
                faq_knowledge_base: DEFAULT_FAQS as any,
                required_fields: ["name", "phone", "service", "slot"] as any,
                escalation_phones: account?.display_phone ? [account.display_phone] : [],
                escalation_message: `🚨 *NEW CUSTOMER INQUIRY / BOOKING*\n\n👤 *Customer:* {{name}}\n📞 *Phone:* {{phone}}\n💼 *Service:* {{service}}\n⏰ *Preferred Slot:* {{slot}}\n\n👉 *Action:* Please follow up with the customer promptly!`,
                confirmation_message: `✅ *Inquiry & Booking Received!*\n\nNamaste {{name}}, we have registered your request for *{{service}}* on *{{slot}}*.\n\nOur team will reach out shortly on {{phone}} to confirm.\n\n🏢 *{{business_name}}*`,
                ai_fallback_enabled: true,
            },
        })
    }

    return config
}

export async function updateBotConfig(
    accountId: string,
    data: {
        is_enabled?: boolean
        business_name?: string
        business_type?: string
        greeting_message?: string
        services_catalog?: any
        faq_knowledge_base?: any
        required_fields?: any
        escalation_phones?: string[]
        escalation_message?: string
        confirmation_message?: string
        ai_fallback_enabled?: boolean
    },
) {
    await getOrCreateBotConfig(accountId)
    return prisma.whatsAppBotConfig.update({
        where: { account_id: accountId },
        data: {
            is_enabled: data.is_enabled,
            business_name: data.business_name,
            business_type: data.business_type,
            greeting_message: data.greeting_message,
            services_catalog: data.services_catalog,
            faq_knowledge_base: data.faq_knowledge_base,
            required_fields: data.required_fields,
            escalation_phones: data.escalation_phones,
            escalation_message: data.escalation_message,
            confirmation_message: data.confirmation_message,
            ai_fallback_enabled: data.ai_fallback_enabled,
        },
    })
}

// ─── Leads Management ─────────────────────────────────────────────────────────

export async function listLeads(accountId: string, options?: { status?: string; limit?: number }) {
    const where: any = { account_id: accountId }
    if (options?.status && options.status !== "ALL") {
        where.status = options.status
    }
    return prisma.whatsAppAppointmentLead.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: options?.limit ?? 100,
    })
}

export async function updateLeadStatus(
    leadId: string,
    accountId: string,
    data: { status?: any; staff_notes?: string },
) {
    return prisma.whatsAppAppointmentLead.updateMany({
        where: { id: leadId, account_id: accountId },
        data,
    })
}

export async function deleteLead(leadId: string, accountId: string) {
    return prisma.whatsAppAppointmentLead.deleteMany({
        where: { id: leadId, account_id: accountId },
    })
}

// ─── Inbound Message & Flow Processor ─────────────────────────────────────────

export interface InboundMessageInput {
    fromPhone: string
    text?: string
    interactiveType?: string // "button_reply" | "list_reply"
    interactiveId?: string
    interactiveTitle?: string
}

export async function processInboundWhatsAppMessage(
    phoneNumberId: string,
    input: InboundMessageInput,
) {
    const account = await prisma.whatsAppAccount.findUnique({
        where: { phone_number_id: phoneNumberId },
        include: { bot_config: true },
    })

    if (!account) return { status: "ignored_no_account" }

    const config = account.bot_config ?? (await getOrCreateBotConfig(account.id))
    if (!config.is_enabled) return { status: "ignored_bot_disabled" }

    const fromPhone = input.fromPhone.trim()
    const textRaw = (input.text || input.interactiveTitle || "").trim()
    const textLower = textRaw.toLowerCase()
    const interactiveId = (input.interactiveId || "").trim().toLowerCase()

    const session = getSession(account.id, fromPhone)

    // ─── 1. Reset / Greeting Triggers ─────────────────────────────────────────
    const isGreeting =
        textLower === "hi" ||
        textLower === "hello" ||
        textLower === "hey" ||
        textLower === "namaste" ||
        textLower === "start" ||
        textLower === "restart" ||
        textLower === "menu" ||
        interactiveId === "btn_menu" ||
        interactiveId === "btn_greeting"

    if (isGreeting || !session) {
        // If interactive button clicked for services:
        if (interactiveId === "btn_services" || textLower.includes("services") || textLower.includes("departments") || textLower.includes("doctors")) {
            await sendServicesList(account, config, fromPhone)
            return { status: "sent_services_list" }
        }

        // If interactive button clicked for booking:
        if (interactiveId === "btn_book" || interactiveId.startsWith("book_") || textLower.includes("book appointment") || textLower.includes("appointment")) {
            let preselectedService: string | undefined
            if (interactiveId.startsWith("book_")) {
                const svcId = interactiveId.replace("book_", "")
                const catalog = (config.services_catalog as any[]) || []
                const found = catalog.find((c) => c.id?.toLowerCase() === svcId)
                if (found) preselectedService = found.name
            }
            setSession(account.id, fromPhone, {
                step: "COLLECTING_NAME",
                serviceRequested: preselectedService,
            })
            await sendWhatsAppTextMessage(
                account.phone_number_id,
                accessTokenForAccount(account),
                fromPhone,
                `📝 *Inquiry & Booking*\n\nPlease reply with your *Full Name*:`,
            )
            return { status: "started_booking" }
        }

        // If support / emergency button:
        if (interactiveId === "btn_emergency" || textLower.includes("emergency") || textLower.includes("support")) {
            await sendWhatsAppTextMessage(
                account.phone_number_id,
                accessTokenForAccount(account),
                fromPhone,
                `📞 *${config.business_name} — Support Desk*\n\nOur team is available 24x7 to assist you.\n📍 Direct Hotline: ${account.display_phone || "+91 98765 43210"}\n\nType your question anytime or reply with *Menu* to return to the main menu!`,
            )
            return { status: "sent_emergency_info" }
        }

        // Send Welcome Greeting with Interactive Action Buttons
        const welcomeText = (config.greeting_message || `Namaste! Welcome to ${config.business_name}. How can we assist you today?`)
            .replace(/\{business_name\}/g, config.business_name)

        await sendWhatsAppInteractiveButtons(
            account.phone_number_id,
            accessTokenForAccount(account),
            fromPhone,
            welcomeText,
            [
                { id: "btn_services", title: "📋 View Services" },
                { id: "btn_book", title: "📅 Book / Inquire" },
                { id: "btn_emergency", title: "💬 Support Desk" },
            ],
            config.business_name,
            "Reply anytime to chat with our AI assistant",
        )
        return { status: "sent_welcome_menu" }
    }

    // ─── 2. Active Multi-Step Booking Flow ─────────────────────────────────────
    if (session) {
        if (interactiveId === "btn_cancel" || textLower === "cancel" || textLower === "exit" || textLower === "menu" || textLower === "restart") {
            clearSession(account.id, fromPhone)
            await sendWhatsAppTextMessage(
                account.phone_number_id,
                accessTokenForAccount(account),
                fromPhone,
                `Session ended. Type *Hello* anytime to start again. Have a wonderful day! 🙏`,
            )
            return { status: "cancelled_booking" }
        }

        if (session.step === "COLLECTING_NAME") {
            const customerName = textRaw
            if (session.serviceRequested) {
                // If service was already chosen from list:
                setSession(account.id, fromPhone, {
                    step: "COLLECTING_SLOT",
                    patientName: customerName,
                })
                await sendWhatsAppTextMessage(
                    account.phone_number_id,
                    accessTokenForAccount(account),
                    fromPhone,
                    `Thank you, *${customerName}*.\n\nWhat is your *preferred Date & Time slot* for *${session.serviceRequested}*?\n_(e.g. Today 5:00 PM, Tomorrow 11:30 AM, Monday morning)_`,
                )
            } else {
                setSession(account.id, fromPhone, {
                    step: "COLLECTING_SERVICE",
                    patientName: customerName,
                })
                await sendWhatsAppTextMessage(
                    account.phone_number_id,
                    accessTokenForAccount(account),
                    fromPhone,
                    `Thank you, *${customerName}*.\n\nWhich *Doctor, Department, or Service* would you like to consult?`,
                )
            }
            return { status: "collected_name" }
        }

        if (session.step === "COLLECTING_SERVICE") {
            const serviceRequested = textRaw
            setSession(account.id, fromPhone, {
                step: "COLLECTING_SLOT",
                serviceRequested,
            })
            await sendWhatsAppTextMessage(
                account.phone_number_id,
                accessTokenForAccount(account),
                fromPhone,
                `Noted! *${serviceRequested}*.\n\nWhat is your *preferred Date & Time slot*?\n_(e.g. Today evening, Tomorrow 10:30 AM, Friday morning)_`,
            )
            return { status: "collected_service" }
        }

        if (session.step === "COLLECTING_SLOT") {
            const preferredTime = textRaw
            const patientName = session.patientName || "Patient"
            const serviceRequested = session.serviceRequested || "General Consultation"

            // 1. Create Lead in Database
            const lead = await prisma.whatsAppAppointmentLead.create({
                data: {
                    account_id: account.id,
                    patient_name: patientName,
                    patient_phone: fromPhone.startsWith("+") ? fromPhone : `+${fromPhone}`,
                    service_requested: serviceRequested,
                    preferred_time: preferredTime,
                    status: "PENDING_CALL",
                    escalated_to_phone: config.escalation_phones?.[0] || null,
                },
            })

            // 2. Dispatch Instant Escalation Notification Alert to Staff Desk
            await dispatchEscalationAlerts(account, config, lead)

            // 3. Send Patient Confirmation Message
            let confirmText = (config.confirmation_message || `✅ *Appointment Request Received!*\n\nNamaste {{name}}, we have registered your appointment inquiry for *{{service}}* on *{{slot}}*.\n\nOur coordinator will call you shortly on {{phone}} to confirm your slot.\n\n🏢 *{{business_name}}*`)
                .replace(/\{\{name\}\}/g, patientName)
                .replace(/\{\{service\}\}/g, serviceRequested)
                .replace(/\{\{slot\}\}/g, preferredTime)
                .replace(/\{\{phone\}\}/g, fromPhone)
                .replace(/\{\{business_name\}\}/g, config.business_name)

            await sendWhatsAppTextMessage(
                account.phone_number_id,
                accessTokenForAccount(account),
                fromPhone,
                confirmText,
            )

            clearSession(account.id, fromPhone)
            return { status: "lead_created_and_escalated", leadId: lead.id }
        }
    }

    // ─── 3. Dynamic AI Fallback (Gemini 1.5 / 2.0 Flash) ────────────────────────
    if (config.ai_fallback_enabled) {
        const aiResponse = await generateAiBotReply(config, textRaw)
        await sendWhatsAppTextMessage(
            account.phone_number_id,
            accessTokenForAccount(account),
            fromPhone,
            aiResponse,
        )
        return { status: "ai_fallback_replied" }
    }

    return { status: "no_action" }
}

// ─── Services Catalog Interactive List Sender ─────────────────────────────────

async function sendServicesList(account: any, config: any, toPhone: string) {
    const catalog = (config.services_catalog as any[]) || DEFAULT_SERVICES_CATALOG

    const rows = catalog.slice(0, 10).map((cat) => ({
        id: `book_${cat.id}`,
        title: (cat.name || "Service").slice(0, 24),
        description: (cat.desc || cat.fee ? `${cat.fee ? cat.fee + " • " : ""}${cat.desc || ""}` : "").slice(0, 72),
    }))

    await sendWhatsAppInteractiveList(
        account.phone_number_id,
        accessTokenForAccount(account),
        toPhone,
        `🏥 *${config.business_name} — Services & Doctors*\n\nSelect any department below to view details or book an appointment instantly:`,
        "Select Department",
        [
            {
                title: "Specialties & Doctors",
                rows,
            },
        ],
        config.business_name,
        "Tap a department to book",
    )
}

// ─── Escalation Alert Dispatcher ─────────────────────────────────────────────

async function dispatchEscalationAlerts(account: any, config: any, lead: any) {
    const staffPhones = (config.escalation_phones as string[]) || []
    if (staffPhones.length === 0) return

    const alertMessage = (config.escalation_message || `🚨 *NEW APPOINTMENT INQUIRY*\n\n👤 *Patient:* {{name}}\n📞 *Phone:* {{phone}}\n🩺 *Service:* {{service}}\n⏰ *Preferred Slot:* {{slot}}\n\n👉 Please call the patient promptly to confirm!`)
        .replace(/\{\{name\}\}/g, lead.patient_name)
        .replace(/\{\{phone\}\}/g, lead.patient_phone)
        .replace(/\{\{service\}\}/g, lead.service_requested)
        .replace(/\{\{slot\}\}/g, lead.preferred_time || "Flexible")

    for (const staffPhone of staffPhones) {
        if (!staffPhone || staffPhone.length < 8) continue
        try {
            await sendWhatsAppTextMessage(
                account.phone_number_id,
                accessTokenForAccount(account),
                staffPhone,
                alertMessage,
            )
        } catch (err) {
            console.error(`[WhatsApp Bot] Failed to send escalation alert to staff phone ${staffPhone}:`, err)
        }
    }
}

// ─── Google Gemini Flash AI Fallback ──────────────────────────────────────────

async function generateAiBotReply(config: any, userQuery: string): Promise<string> {
    const apiKey = process.env.GEMINI_API_KEY
    const catalogJson = JSON.stringify(config.services_catalog, null, 2)
    const faqJson = JSON.stringify(config.faq_knowledge_base, null, 2)

    const systemPrompt = `You are a warm, helpful, and professional AI receptionist for "${config.business_name}" (${config.business_type}).
Respond to the patient in a polite, concise, and empathetic tone in English, Hindi, Telugu, or Hinglish based on their language. Keep your reply concise (2-4 sentences max), clear, and formatted nicely for WhatsApp with emojis.

Here is the current verified knowledge base of the healthcare facility:
SERVICES & DOCTORS CATALOG:
${catalogJson}

FREQUENTLY ASKED QUESTIONS & POLICIES:
${faqJson}

Rules & Instructions:
1. Answer the patient's inquiry accurately using ONLY the knowledge base above.
2. If they ask about consultation fees, doctor timings, emergency, cashless insurance, or location, provide the exact details.
3. Conclude with a warm, friendly invitation to book an appointment (e.g. "Would you like to schedule an appointment? Reply with 'Book Appointment' to proceed!").
4. If you don't know the exact answer, politely ask them to reach our 24x7 desk or book a consultation.`

    if (!apiKey) {
        return `Namaste! Thank you for reaching out to *${config.business_name}*.\n\nOur team is available to assist you. To book an appointment or check doctor timings, please reply with *'Book Appointment'* or *'Services'* anytime!`
    }

    try {
        const genAI = new GoogleGenerativeAI(apiKey)
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" })
        const result = await model.generateContent([
            { text: systemPrompt },
            { text: `Patient Message: "${userQuery}"` },
        ])
        const text = result.response.text()
        return text.trim()
    } catch (err) {
        console.error("[WhatsApp Bot] Gemini fallback error:", err)
        return `Namaste! Thank you for contacting *${config.business_name}*.\n\nTo view our doctors or schedule a consultation, reply with *'Book Appointment'* or *'Services'* anytime!`
    }
}

