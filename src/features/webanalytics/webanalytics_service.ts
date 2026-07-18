import crypto from "crypto"
import type { Prisma, WebAnalyticsCustomEventType } from "@prisma/client"
import prisma from "../../lib/prisma"
import type {
    AnalyticsRange,
    CollectActionInput,
    CollectEventInput,
    CreateCustomEventInput,
    CreateSiteInput,
    UpdateCustomEventInput,
    UpdateSiteInput,
} from "./webanalytics_types"

type RequestMeta = { ip?: string; userAgent?: string }

const ACTIVE_VISITOR_WINDOW_MS = 5 * 60 * 1000

export function parseAnalyticsRange(daysInput: unknown): AnalyticsRange {
    const days = Math.min(Math.max(Number(daysInput ?? 30) || 30, 1), 365)
    const now = new Date()
    const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
    const from = new Date(to)
    from.setUTCDate(from.getUTCDate() - (days - 1))
    from.setUTCHours(0, 0, 0, 0)
    return { from, to, days }
}

export async function createAnalyticsSite(project_id: string, input: CreateSiteInput) {
    return prisma.webAnalyticsSite.create({
        data: {
            project_id,
            name: input.name.trim(),
            domain: normalizeDomain(input.domain),
            public_key: createPublicKey(),
        },
    })
}

export async function listAnalyticsSites(project_id: string) {
    return prisma.webAnalyticsSite.findMany({
        where: { project_id },
        orderBy: { created_at: "desc" },
        select: siteSelect,
    })
}

export async function updateAnalyticsSite(project_id: string, site_id: string, input: UpdateSiteInput) {
    await assertSiteAccess(project_id, site_id)
    return prisma.webAnalyticsSite.update({
        where: { id: site_id },
        data: {
            name: input.name?.trim(),
            domain: input.domain ? normalizeDomain(input.domain) : undefined,
            is_active: input.is_active,
        },
        select: siteSelect,
    })
}

export async function deleteAnalyticsSite(project_id: string, site_id: string) {
    await assertSiteAccess(project_id, site_id)
    await prisma.$transaction([
        prisma.webAnalyticsAction.deleteMany({ where: { custom_event: { site_id } } }),
        prisma.webAnalyticsCustomEvent.deleteMany({ where: { site_id } }),
        prisma.webAnalyticsEvent.deleteMany({ where: { site_id } }),
        prisma.webAnalyticsSession.deleteMany({ where: { site_id } }),
        prisma.webAnalyticsSite.delete({ where: { id: site_id } }),
    ])
    return { ok: true }
}

export async function regenerateAnalyticsSiteKey(project_id: string, site_id: string) {
    await assertSiteAccess(project_id, site_id)
    return prisma.webAnalyticsSite.update({
        where: { id: site_id },
        data: { public_key: createPublicKey() },
        select: siteSelect,
    })
}

export async function collectAnalyticsEvent(input: CollectEventInput, requestMeta: RequestMeta) {
    const site = await getActiveSiteByPublicKey(input.public_key)
    const session = await upsertAnalyticsSession(site.id, input, requestMeta)

    const event = await prisma.webAnalyticsEvent.create({
        data: {
            site_id: site.id,
            session_id: session.id,
            type: input.type,
            path: normalizePath(input.path),
            url: input.url,
            title: input.title,
            referrer: input.referrer ?? null,
            event_name: input.type === "CUSTOM" ? input.event_name : undefined,
            event_value: toPrismaJson(input.event_value),
            duration_ms: input.duration_ms,
            metadata: toPrismaJson(input.metadata),
        },
    })

    return { ok: true, site_id: site.id, session_id: session.id, event_id: event.id }
}

export async function collectAnalyticsAction(input: CollectActionInput, requestMeta: RequestMeta) {
    const site = await getActiveSiteByPublicKey(input.public_key)
    const customEvent = await prisma.webAnalyticsCustomEvent.findFirst({
        where: { id: input.event_id, site_id: site.id },
    })
    if (!customEvent) throw new Error("CUSTOM_EVENT_NOT_FOUND")

    const session = await upsertAnalyticsSession(site.id, {
        visitor_id: input.visitor_id,
        type: "CUSTOM",
        path: "/",
    } as CollectEventInput, requestMeta)

    const action = await prisma.webAnalyticsAction.create({
        data: {
            custom_event_id: customEvent.id,
            session_id: session.id,
            key: input.key,
            value: input.value,
            details: input.details,
        },
    })

    return { ok: true, action_id: action.id, event_id: customEvent.id, session_id: session.id }
}

export async function getAnalyticsFacts(project_id: string, range: AnalyticsRange) {
    const siteIds = await getProjectSiteIds(project_id)
    if (siteIds.length === 0) return emptyFacts(range)

    const now = new Date()
    const activeSince = new Date(now.getTime() - ACTIVE_VISITOR_WINDOW_MS)
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
    const yearStart = new Date(now.getFullYear(), 0, 1)
    const todayStart = new Date(now)
    todayStart.setHours(0, 0, 0, 0)

    const [activeVisitors, viewsToday, viewsMonth, viewsYear, rangeEvents, durationAgg] = await Promise.all([
        prisma.webAnalyticsSession.count({
            where: { site_id: { in: siteIds }, last_seen_at: { gte: activeSince } },
        }),
        countPageViews(siteIds, todayStart, now),
        countPageViews(siteIds, monthStart, now),
        countPageViews(siteIds, yearStart, now),
        prisma.webAnalyticsEvent.findMany({
            where: { site_id: { in: siteIds }, type: "PAGE_VIEW", created_at: { gte: range.from, lte: range.to } },
            select: { session_id: true, created_at: true },
        }),
        prisma.webAnalyticsEvent.aggregate({
            where: { site_id: { in: siteIds }, duration_ms: { not: null }, created_at: { gte: range.from, lte: range.to } },
            _avg: { duration_ms: true },
        }),
    ])

    const dailyViews = createDayBuckets(range)
    for (const event of rangeEvents) {
        const bucket = dailyViews.find(item => item.date === dayKey(event.created_at))
        if (bucket) bucket.page_views += 1
    }

    return {
        range,
        active_visitors: activeVisitors,
        views_today: viewsToday,
        views_month: viewsMonth,
        views_year: viewsYear,
        average_daily_views: Math.round(dailyViews.reduce((sum, item) => sum + item.page_views, 0) / Math.max(range.days, 1)),
        average_duration_ms: Math.round(durationAgg._avg.duration_ms ?? 0),
        bounce_rate: calculateBounceRate(rangeEvents),
    }
}

export async function getAnalyticsSummary(project_id: string, range: AnalyticsRange) {
    const [facts, timeseries] = await Promise.all([
        getAnalyticsFacts(project_id, range),
        getAnalyticsTimeseries(project_id, range),
    ])

    const previousFromDate = previousFrom(range)
    const siteIds = await getProjectSiteIds(project_id)
    const previousPageViews = siteIds.length === 0 ? 0 : await countPageViews(siteIds, previousFromDate, range.from)
    const pageViews = timeseries.reduce((sum, item) => sum + item.page_views, 0)
    const visitors = timeseries.reduce((sum, item) => sum + item.visitors, 0)

    return {
        range,
        page_views: pageViews,
        visitors,
        bounce_rate: facts.bounce_rate,
        average_duration_ms: facts.average_duration_ms,
        active_visitors: facts.active_visitors,
        previous_page_views: previousPageViews,
        page_views_delta_pct: previousPageViews === 0 ? null : Math.round(((pageViews - previousPageViews) / previousPageViews) * 100),
    }
}

export async function getAnalyticsTimeseries(project_id: string, range: AnalyticsRange) {
    const siteIds = await getProjectSiteIds(project_id)
    const buckets = createDayBuckets(range)
    if (siteIds.length === 0) return buckets

    const events = await prisma.webAnalyticsEvent.findMany({
        where: { site_id: { in: siteIds }, type: "PAGE_VIEW", created_at: { gte: range.from, lte: range.to } },
        select: { created_at: true, session: { select: { visitor_id: true } } },
    })

    const byDay = new Map(buckets.map(b => [b.date, { page_views: 0, visitors: new Set<string>() }]))
    for (const event of events) {
        const bucket = byDay.get(dayKey(event.created_at))
        if (!bucket) continue
        bucket.page_views += 1
        if (event.session?.visitor_id) bucket.visitors.add(event.session.visitor_id)
    }

    return buckets.map(bucket => {
        const found = byDay.get(bucket.date)
        return { date: bucket.date, page_views: found?.page_views ?? 0, visitors: found?.visitors.size ?? 0 }
    })
}

export async function getAnalyticsPages(project_id: string, range: AnalyticsRange) {
    return getAnalyticsBreakdown(project_id, range, "pages")
}

export async function getAnalyticsReferrers(project_id: string, range: AnalyticsRange) {
    return getAnalyticsBreakdown(project_id, range, "referrers")
}

export async function getAnalyticsBreakdown(project_id: string, range: AnalyticsRange, dimension: string, limit = 25) {
    const siteIds = await getProjectSiteIds(project_id)
    if (siteIds.length === 0) return []

    if (["browsers", "devices", "systems", "languages", "screens"].includes(dimension)) {
        return getSessionBreakdown(siteIds, range, dimension, limit)
    }

    const events = await prisma.webAnalyticsEvent.findMany({
        where: { site_id: { in: siteIds }, type: "PAGE_VIEW", created_at: { gte: range.from, lte: range.to } },
        select: { path: true, referrer: true, session_id: true },
    })

    const values = new Map<string, { count: number; sessions: Set<string> }>()
    for (const event of events) {
        const key = dimension === "referrers"
            ? safeHostname(event.referrer ?? "") ?? "Direct"
            : event.path
        const row = values.get(key) ?? { count: 0, sessions: new Set<string>() }
        row.count += 1
        if (event.session_id) row.sessions.add(event.session_id)
        values.set(key, row)
    }

    return [...values.entries()]
        .map(([name, row]) => ({ name, count: row.count, sessions: row.sessions.size }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
}

export async function getAnalyticsDurations(project_id: string, range: AnalyticsRange) {
    const siteIds = await getProjectSiteIds(project_id)
    const buckets = createDayBuckets(range).map(item => ({ ...item, average_duration_ms: 0, samples: 0 }))
    if (siteIds.length === 0) return buckets

    const events = await prisma.webAnalyticsEvent.findMany({
        where: { site_id: { in: siteIds }, duration_ms: { not: null }, created_at: { gte: range.from, lte: range.to } },
        select: { created_at: true, duration_ms: true },
    })

    for (const event of events) {
        const bucket = buckets.find(item => item.date === dayKey(event.created_at))
        if (!bucket || event.duration_ms == null) continue
        bucket.average_duration_ms += event.duration_ms
        bucket.samples += 1
    }

    return buckets.map(bucket => ({
        date: bucket.date,
        average_duration_ms: bucket.samples === 0 ? 0 : Math.round(bucket.average_duration_ms / bucket.samples),
        samples: bucket.samples,
    }))
}

export async function getAnalyticsEvents(project_id: string, range: AnalyticsRange) {
    const siteIds = await getProjectSiteIds(project_id)
    if (siteIds.length === 0) return []

    return prisma.webAnalyticsEvent.findMany({
        where: { site_id: { in: siteIds }, created_at: { gte: range.from, lte: range.to } },
        orderBy: { created_at: "desc" },
        take: 100,
        select: {
            id: true,
            type: true,
            path: true,
            title: true,
            referrer: true,
            event_name: true,
            event_value: true,
            duration_ms: true,
            metadata: true,
            created_at: true,
        },
    })
}

export async function createCustomEvent(project_id: string, site_id: string, input: CreateCustomEventInput) {
    await assertSiteAccess(project_id, site_id)
    return prisma.webAnalyticsCustomEvent.create({
        data: {
            site_id,
            title: input.title.trim(),
            type: input.type as WebAnalyticsCustomEventType,
            key: input.key?.trim(),
        },
    })
}

export async function listCustomEvents(project_id: string, site_id: string) {
    await assertSiteAccess(project_id, site_id)
    return prisma.webAnalyticsCustomEvent.findMany({
        where: { site_id },
        orderBy: { created_at: "desc" },
        include: { _count: { select: { actions: true } } },
    })
}

export async function updateCustomEvent(project_id: string, site_id: string, event_id: string, input: UpdateCustomEventInput) {
    await assertCustomEventAccess(project_id, site_id, event_id)
    return prisma.webAnalyticsCustomEvent.update({
        where: { id: event_id },
        data: {
            title: input.title?.trim(),
            type: input.type as WebAnalyticsCustomEventType | undefined,
            key: input.key?.trim(),
        },
    })
}

export async function deleteCustomEvent(project_id: string, site_id: string, event_id: string) {
    await assertCustomEventAccess(project_id, site_id, event_id)
    await prisma.$transaction([
        prisma.webAnalyticsAction.deleteMany({ where: { custom_event_id: event_id } }),
        prisma.webAnalyticsCustomEvent.delete({ where: { id: event_id } }),
    ])
    return { ok: true }
}

export async function getCustomEventStats(project_id: string, site_id: string, event_id: string, range: AnalyticsRange) {
    const customEvent = await assertCustomEventAccess(project_id, site_id, event_id)
    const actions = await prisma.webAnalyticsAction.findMany({
        where: { custom_event_id: event_id, created_at: { gte: range.from, lte: range.to } },
        select: { key: true, value: true, created_at: true },
    })

    const buckets = createDayBuckets(range).map(item => ({ date: item.date, value: 0, count: 0 }))
    const list = new Map<string, { value: number; count: number }>()
    for (const action of actions) {
        const bucket = buckets.find(item => item.date === dayKey(action.created_at))
        if (bucket) {
            bucket.value += action.value
            bucket.count += 1
        }
        const key = action.key ?? "Action"
        const row = list.get(key) ?? { value: 0, count: 0 }
        row.value += action.value
        row.count += 1
        list.set(key, row)
    }

    const isAverage = customEvent.type === "AVERAGE_CHART" || customEvent.type === "AVERAGE_LIST"
    return {
        event: customEvent,
        total_actions: actions.length,
        chart: buckets.map(bucket => ({
            date: bucket.date,
            value: isAverage && bucket.count > 0 ? Number((bucket.value / bucket.count).toFixed(2)) : bucket.value,
            count: bucket.count,
        })),
        list: [...list.entries()].map(([key, row]) => ({
            key,
            value: isAverage && row.count > 0 ? Number((row.value / row.count).toFixed(2)) : row.value,
            count: row.count,
        })).sort((a, b) => b.count - a.count),
    }
}

export function getTrackerScript() {
    return `(() => {
  const script = document.currentScript;
  const key = script && script.getAttribute("data-promptpulse-key");
  const endpoint = (script && script.getAttribute("data-promptpulse-endpoint")) || "/api/webanalytics";
  if (!key) return;

  const visitorKey = "promptpulse_visitor";
  const visitor = sessionStorage.getItem(visitorKey) || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
  sessionStorage.setItem(visitorKey, visitor);

  const startedAt = Date.now();
  const payload = () => ({
    public_key: key,
    visitor_id: visitor,
    path: location.pathname + location.search,
    url: location.href,
    title: document.title,
    referrer: document.referrer || undefined,
    language: navigator.language,
    screen_width: screen.width,
    screen_height: screen.height,
    screen_color_depth: screen.colorDepth,
    browser_width: window.innerWidth,
    browser_height: window.innerHeight
  });

  const send = (path, body) => {
    const data = JSON.stringify(body);
    fetch(endpoint + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: data, keepalive: true }).catch(() => {});
  };

  send("/collect", payload());
  window.promptpulseAction = (eventId, data = {}) => send("/actions", { public_key: key, visitor_id: visitor, event_id: eventId, ...data });
  let lastPath = location.pathname + location.search;
  const trackRoute = () => {
    const nextPath = location.pathname + location.search;
    if (nextPath === lastPath) return;
    lastPath = nextPath;
    send("/collect", payload());
  };
  const pushState = history.pushState;
  const replaceState = history.replaceState;
  history.pushState = function () {
    pushState.apply(this, arguments);
    setTimeout(trackRoute, 0);
  };
  history.replaceState = function () {
    replaceState.apply(this, arguments);
    setTimeout(trackRoute, 0);
  };
  window.addEventListener("popstate", trackRoute);
  window.addEventListener("pagehide", () => send("/collect", { ...payload(), type: "CUSTOM", event_name: "duration", duration_ms: Date.now() - startedAt }));
})();`
}

async function getProjectSiteIds(project_id: string) {
    const sites = await prisma.webAnalyticsSite.findMany({ where: { project_id }, select: { id: true } })
    return sites.map(site => site.id)
}

async function assertSiteAccess(project_id: string, site_id: string) {
    const site = await prisma.webAnalyticsSite.findFirst({ where: { id: site_id, project_id } })
    if (!site) throw new Error("SITE_NOT_FOUND")
    return site
}

async function assertCustomEventAccess(project_id: string, site_id: string, event_id: string) {
    await assertSiteAccess(project_id, site_id)
    const event = await prisma.webAnalyticsCustomEvent.findFirst({ where: { id: event_id, site_id } })
    if (!event) throw new Error("CUSTOM_EVENT_NOT_FOUND")
    return event
}

async function getActiveSiteByPublicKey(public_key: string) {
    const site = await prisma.webAnalyticsSite.findUnique({ where: { public_key } })
    if (!site || !site.is_active) throw new Error("SITE_NOT_FOUND")
    return site
}

async function upsertAnalyticsSession(site_id: string, input: Pick<CollectEventInput, "visitor_id" | "referrer" | "path" | "source" | "language" | "screen_width" | "screen_height" | "screen_color_depth" | "browser_width" | "browser_height">, requestMeta: RequestMeta) {
    const now = new Date()
    const referrer = input.referrer ?? null
    const source = input.source ?? (referrer ? safeHostname(referrer) ?? undefined : undefined)
    const visitor_id = createVisitorId(site_id, input.visitor_id, requestMeta)
    const userAgent = requestMeta.userAgent

    return prisma.webAnalyticsSession.upsert({
        where: { site_id_visitor_id: { site_id, visitor_id } },
        create: {
            site_id,
            visitor_id,
            ip_hash: hashIp(requestMeta.ip),
            user_agent: userAgent,
            browser: detectBrowser(userAgent),
            browser_version: detectBrowserVersion(userAgent),
            browser_width: input.browser_width,
            browser_height: input.browser_height,
            os: detectOs(userAgent),
            os_version: detectOsVersion(userAgent),
            device: detectDevice(userAgent),
            language: input.language?.slice(0, 12),
            screen_width: input.screen_width,
            screen_height: input.screen_height,
            screen_color_depth: input.screen_color_depth,
            referrer,
            source,
            medium: source ? "referral" : "direct",
            landing_page: normalizePath(input.path),
            started_at: now,
            last_seen_at: now,
        },
        update: {
            last_seen_at: now,
            referrer: referrer ?? undefined,
            source,
            medium: source ? "referral" : undefined,
            browser_width: input.browser_width,
            browser_height: input.browser_height,
        },
    })
}

async function countPageViews(siteIds: string[], from: Date, to: Date) {
    return prisma.webAnalyticsEvent.count({
        where: { site_id: { in: siteIds }, type: "PAGE_VIEW", created_at: { gte: from, lt: to } },
    })
}

async function getSessionBreakdown(siteIds: string[], range: AnalyticsRange, dimension: string, limit: number) {
    const sessions = await prisma.webAnalyticsSession.findMany({
        where: { site_id: { in: siteIds }, started_at: { gte: range.from, lte: range.to } },
        select: {
            browser: true,
            device: true,
            os: true,
            language: true,
            screen_width: true,
            screen_height: true,
        },
    })

    const values = new Map<string, number>()
    for (const session of sessions) {
        const name = sessionBreakdownName(session, dimension)
        values.set(name, (values.get(name) ?? 0) + 1)
    }

    return [...values.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, limit)
}

function sessionBreakdownName(session: { browser: string | null; device: string | null; os: string | null; language: string | null; screen_width: number | null; screen_height: number | null }, dimension: string) {
    if (dimension === "browsers") return session.browser ?? "Other"
    if (dimension === "devices") return session.device ?? "Other"
    if (dimension === "systems") return session.os ?? "Other"
    if (dimension === "languages") return session.language ?? "Unknown"
    if (dimension === "screens") return session.screen_width && session.screen_height ? `${session.screen_width}x${session.screen_height}` : "Unknown"
    return "Unknown"
}

function createPublicKey() {
    return `wa_${crypto.randomBytes(18).toString("hex")}`
}

function createVisitorId(siteId: string, visitorId: string | undefined, meta: RequestMeta) {
    const raw = visitorId ?? `${meta.ip ?? "0.0.0.0"}:${meta.userAgent ?? "unknown"}`
    const daySalt = new Date().toISOString().slice(0, 10)
    return crypto.createHash("sha256").update(`${siteId}:${raw}:${daySalt}:${process.env.JWT_SECRET ?? "local"}`).digest("hex")
}

function normalizeDomain(domain: string) {
    const trimmed = domain.trim().toLowerCase()
    return trimmed.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]
}

function normalizePath(path: string) {
    return path.startsWith("/") ? path : `/${path}`
}

function hashIp(ip?: string) {
    if (!ip) return null
    const daySalt = new Date().toISOString().slice(0, 10)
    return crypto.createHash("sha256").update(`${ip}:${daySalt}:${process.env.JWT_SECRET ?? "local"}`).digest("hex")
}

function safeHostname(value: string) {
    try {
        return new URL(value).hostname.replace(/^www\./, "")
    } catch {
        return null
    }
}

function detectBrowser(ua = "") {
    if (/Edg\//i.test(ua)) return "Edge"
    if (/Chrome\//i.test(ua)) return "Chrome"
    if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari"
    if (/Firefox\//i.test(ua)) return "Firefox"
    return "Other"
}

function detectBrowserVersion(ua = "") {
    const match = ua.match(/(?:Edg|Chrome|Firefox|Version)\/([\d.]+)/i)
    return match?.[1]
}

function detectOs(ua = "") {
    if (/Windows/i.test(ua)) return "Windows"
    if (/Mac OS X/i.test(ua)) return "macOS"
    if (/Android/i.test(ua)) return "Android"
    if (/iPhone|iPad/i.test(ua)) return "iOS"
    if (/Linux/i.test(ua)) return "Linux"
    return "Other"
}

function detectOsVersion(ua = "") {
    const match = ua.match(/(?:Windows NT|Android|OS|Mac OS X)\s?([\d_\.]+)/i)
    return match?.[1]?.replace(/_/g, ".")
}

function detectDevice(ua = "") {
    if (/Mobile|Android|iPhone/i.test(ua)) return "Mobile"
    if (/iPad|Tablet/i.test(ua)) return "Tablet"
    return "Desktop"
}

function emptyFacts(range: AnalyticsRange) {
    return {
        range,
        active_visitors: 0,
        views_today: 0,
        views_month: 0,
        views_year: 0,
        average_daily_views: 0,
        average_duration_ms: 0,
        bounce_rate: 0,
    }
}

function previousFrom(range: AnalyticsRange) {
    const from = new Date(range.from)
    from.setDate(from.getDate() - range.days)
    return from
}

function dayKey(date: Date) {
    return date.toISOString().slice(0, 10)
}

function createDayBuckets(range: AnalyticsRange) {
    return Array.from({ length: range.days }, (_, index) => {
        const date = new Date(range.from)
        date.setUTCDate(date.getUTCDate() + index)
        return { date: dayKey(date), page_views: 0, visitors: 0 }
    })
}

function calculateBounceRate(events: Array<{ session_id: string | null }>) {
    if (events.length === 0) return 0
    const counts = new Map<string, number>()
    for (const event of events) {
        if (!event.session_id) continue
        counts.set(event.session_id, (counts.get(event.session_id) ?? 0) + 1)
    }
    const bounced = [...counts.values()].filter(count => count === 1).length
    return Math.round((bounced / Math.max(counts.size, 1)) * 100)
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue | undefined {
    if (value === undefined) return undefined
    return value as Prisma.InputJsonValue
}

const siteSelect = {
    id: true,
    name: true,
    domain: true,
    public_key: true,
    is_active: true,
    created_at: true,
    updated_at: true,
} satisfies Prisma.WebAnalyticsSiteSelect
