import { SeoError } from "./seo_errors"

export type SeoMarket = {
    locationCode: number
    locationName: string
    countryIsoCode: string
    languageCode: string
    languageName: string
}

const MARKETS: SeoMarket[] = [
    { locationCode: 2356, locationName: "India", countryIsoCode: "IN", languageCode: "en", languageName: "English" },
    { locationCode: 2840, locationName: "United States", countryIsoCode: "US", languageCode: "en", languageName: "English" },
    { locationCode: 2826, locationName: "United Kingdom", countryIsoCode: "GB", languageCode: "en", languageName: "English" },
    { locationCode: 2036, locationName: "Australia", countryIsoCode: "AU", languageCode: "en", languageName: "English" },
    { locationCode: 2124, locationName: "Canada", countryIsoCode: "CA", languageCode: "en", languageName: "English" },
    { locationCode: 2276, locationName: "Germany", countryIsoCode: "DE", languageCode: "de", languageName: "German" },
    { locationCode: 2784, locationName: "United Arab Emirates", countryIsoCode: "AE", languageCode: "en", languageName: "English" },
    { locationCode: 2702, locationName: "Singapore", countryIsoCode: "SG", languageCode: "en", languageName: "English" },
]

const COUNTRY_ALIASES: Record<string, string> = {
    india: "IN",
    us: "US",
    usa: "US",
    "united states": "US",
    uk: "GB",
    "united kingdom": "GB",
    australia: "AU",
    canada: "CA",
    germany: "DE",
    uae: "AE",
    "united arab emirates": "AE",
    singapore: "SG",
}

export function listSeoMarkets() {
    return MARKETS.map(market => ({
        location_code: market.locationCode,
        location_name: market.locationName,
        country_iso_code: market.countryIsoCode,
        languages: [{
            language_code: market.languageCode,
            language_name: market.languageName,
        }],
    }))
}

export function resolveSeoMarket(country: string, languageCode?: string): SeoMarket {
    const normalized = country.trim().toLowerCase()
    const iso = COUNTRY_ALIASES[normalized] ?? country.trim().toUpperCase()
    const candidates = MARKETS.filter(market => market.countryIsoCode === iso)
    const market =
        candidates.find(item => item.languageCode === languageCode?.toLowerCase()) ??
        candidates[0]

    if (!market) {
        throw new SeoError(
            "SEO_VALIDATION_ERROR",
            "This country is not configured for SEO research yet",
            400,
            { country },
        )
    }

    return {
        ...market,
        languageCode: languageCode?.toLowerCase() || market.languageCode,
        languageName:
            languageCode?.toLowerCase() === market.languageCode
                ? market.languageName
                : languageCode?.toUpperCase() || market.languageName,
    }
}
