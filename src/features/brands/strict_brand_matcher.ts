const SAFE_TOKEN_EQUIVALENTS: Readonly<Record<string, string>> = {
    hospitals: "hospital",
}

export function normalizeStrictBrandName(value: string) {
    return value
        .normalize("NFKC")
        .toLocaleLowerCase("en")
        .replace(/[^a-z0-9]+/g, " ")
        .split(/\s+/)
        .filter(Boolean)
        .map(token => SAFE_TOKEN_EQUIVALENTS[token] ?? token)
        .join("")
}

export function sameStrictBrandName(left: string, right: string) {
    const leftKey = normalizeStrictBrandName(left)
    const rightKey = normalizeStrictBrandName(right)
    return Boolean(leftKey && rightKey && leftKey === rightKey)
}

export function containsStrictBrandName(text: string, brandName: string) {
    const textKey = normalizeStrictBrandName(text)
    const brandKey = normalizeStrictBrandName(brandName)
    return Boolean(textKey && brandKey && textKey.includes(brandKey))
}
