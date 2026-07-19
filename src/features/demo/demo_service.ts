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
        countryCode: input.countryCode?.trim().toUpperCase() || undefined,
        countryName: input.countryName?.trim() || undefined,
        localTimeLabel: input.localTimeLabel?.trim() || undefined,
        istTimeLabel: input.istTimeLabel?.trim() || undefined,
    }
}

function getIstHourMinute(date: Date) {
    const parts = new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kolkata",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).formatToParts(date)

    const hour = Number(parts.find(part => part.type === "hour")?.value)
    const minute = Number(parts.find(part => part.type === "minute")?.value)

    return { hour, minute }
}

function assertValidTimezone(timezone: string) {
    try {
        new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date())
    } catch {
        throw new Error("Selected timezone is not valid")
    }
}

function isInsideIstDemoWindow(date: Date) {
    const { hour, minute } = getIstHourMinute(date)
    const minutes = hour * 60 + minute
    return minutes >= 7 * 60 && minutes < 23 * 60
}

export async function bookDemo(input: DemoInput) {
    const normalizedInput = normalizeDemoInput(input)

    if (!isWorkEmail(normalizedInput.email)) {
        throw new Error("Only work/business email addresses are allowed.")
    }

    assertValidTimezone(normalizedInput.timezone)

    if (normalizedInput.scheduledAt <= new Date()) {
        throw new Error("Demo time must be scheduled in the future")
    }

    if (!isInsideIstDemoWindow(normalizedInput.scheduledAt)) {
        throw new Error("Demo slots are available only between 7:00 AM and 11:00 PM IST")
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
            countryCode: normalizedInput.countryCode,
            countryName: normalizedInput.countryName,
            localTimeLabel: normalizedInput.localTimeLabel,
            istTimeLabel: normalizedInput.istTimeLabel,
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
