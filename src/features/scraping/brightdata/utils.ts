import axios from "axios"

import type { BrightDataRecord } from "./types"

export function getBooleanEnv(defaultValue: boolean, ...names: string[]) {
    for (const name of names) {
        const value = process.env[name]?.trim().toLowerCase()
        if (value === "true") return true
        if (value === "false") return false
    }

    return defaultValue
}

export function buildBrightDataInputIndex() {
    return Math.floor(Date.now() % 2147483647)
}

export function isRecord(value: unknown): value is BrightDataRecord {
    return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

export function arrayFrom(value: unknown): unknown[] {
    return Array.isArray(value) ? value : []
}

export function readString(record: unknown, keys: string[]) {
    if (!isRecord(record)) return undefined
    for (const key of keys) {
        const value = record[key]
        if (typeof value === "string" && value.trim()) return value.trim()
        if (typeof value === "number" || typeof value === "boolean") return String(value)
    }
    return undefined
}

export function readNumber(record: unknown, keys: string[]) {
    if (!isRecord(record)) return undefined
    for (const key of keys) {
        const value = record[key]
        if (typeof value === "number" && Number.isFinite(value)) return value
        if (typeof value === "string" && value.trim()) {
            const parsed = Number(value)
            if (Number.isFinite(parsed)) return parsed
        }
    }
    return undefined
}

export function safeJsonStringify(value: unknown) {
    try {
        return JSON.stringify(value)
    } catch {
        return null
    }
}

export function normalizeErrorMessage(error: unknown) {
    if (axios.isAxiosError(error)) {
        const body = typeof error.response?.data === "string"
            ? error.response.data
            : error.response?.data
                ? safeJsonStringify(error.response.data)
                : ""

        return [
            error.message,
            error.response?.status ? `status=${error.response.status}` : null,
            body ? `body=${body.slice(0, 500)}` : null,
        ].filter(Boolean).join(" | ")
    }

    return error instanceof Error ? error.message : String(error)
}

export function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms))
}
