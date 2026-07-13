import prisma from "../../lib/prisma"
import { isWorkEmail } from "../../utils/email"
import type { DemoInput } from "./demo_types"

function normalizeDemoInput(input: DemoInput): DemoInput {
    return {
        ...input,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        company: input.company?.trim() || undefined,
        notes: input.notes?.trim() || undefined,
        timezone: input.timezone.trim(),
    }
}

export async function bookDemo(input: DemoInput) {
    const normalizedInput = normalizeDemoInput(input)

    if (!isWorkEmail(normalizedInput.email)) {
        throw new Error("Only work/business email addresses are allowed.")
    }

    if (normalizedInput.scheduledAt <= new Date()) {
        throw new Error("Demo time must be scheduled in the future")
    }

    const existingBooking = await prisma.bookDemo.findFirst({
        where: {
            email: normalizedInput.email,
            scheduledAt: normalizedInput.scheduledAt,
            status: {
                in: ["PENDING", "CONFIRMED"],
            },
        },
        select: { id: true },
    })

    if (existingBooking) {
        throw new Error("You have already booked a demo for this time")
    }

    return prisma.bookDemo.create({
        data: {
            name: normalizedInput.name,
            email: normalizedInput.email,
            company: normalizedInput.company,
            notes: normalizedInput.notes,
            scheduledAt: normalizedInput.scheduledAt,
            timezone: normalizedInput.timezone,
        },
    })
}

export async function getPendingDemos() {
    return prisma.bookDemo.findMany({
        where: {
            status: "PENDING",
        },
        orderBy: {
            scheduledAt: "asc",
        },
    })
}
