const DEFAULT_REFRESH_TIMEZONE = "America/New_York"

function readTimeZone() {
    return process.env.REFRESH_TIMEZONE?.trim()
        || process.env.SCHEDULER_TIMEZONE?.trim()
        || DEFAULT_REFRESH_TIMEZONE
}

function datePartsInTimeZone(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
    }).formatToParts(date)

    const read = (type: string) => Number(parts.find(part => part.type === type)?.value)
    return {
        year: read("year"),
        month: read("month"),
        day: read("day"),
    }
}

function offsetMsAt(date: Date, timeZone: string) {
    const parts = new Intl.DateTimeFormat("en-US", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
    }).formatToParts(date)

    const read = (type: string) => Number(parts.find(part => part.type === type)?.value)
    const zonedAsUtc = Date.UTC(
        read("year"),
        read("month") - 1,
        read("day"),
        read("hour"),
        read("minute"),
        read("second"),
    )

    return zonedAsUtc - date.getTime()
}

function zonedStartOfDayUtc(date: Date, timeZone: string) {
    const parts = datePartsInTimeZone(date, timeZone)
    const utcGuess = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0, 0))
    const offset = offsetMsAt(utcGuess, timeZone)
    return new Date(utcGuess.getTime() - offset)
}

export function getRefreshTimezone() {
    return readTimeZone()
}

export function getRefreshWindowStart(now = new Date()) {
    return zonedStartOfDayUtc(now, getRefreshTimezone())
}
