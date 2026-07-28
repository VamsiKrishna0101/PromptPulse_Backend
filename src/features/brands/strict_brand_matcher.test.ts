import assert from "node:assert/strict"
import {
    containsStrictBrandName,
    sameStrictBrandName,
} from "./strict_brand_matcher"

assert.equal(sameStrictBrandName("Bandla Hospital", "BANDLA HOSPITALS"), true)
assert.equal(sameStrictBrandName("Bandla Hospital", "bandla hospitals"), true)
assert.equal(sameStrictBrandName("Bandla Hospital", "Bandla-Hospitals"), true)
assert.equal(
    sameStrictBrandName(
        "Dr. Anji Reddy Multi-Specialty Hospital",
        "dr. anji reddy multi specialty hospitals",
    ),
    true,
)
assert.equal(
    containsStrictBrandName(
        "Top rated: BANDLA HOSPITALS — Piduguralla",
        "Bandla Hospital",
    ),
    true,
)

// Meaningful words remain strict; these are not silently treated as one entity.
assert.equal(
    sameStrictBrandName(
        "Dr. Anji Reddy Multi-Specialty Hospital",
        "Dr. Anji Reddy Super Speciality Hospital",
    ),
    false,
)
assert.equal(sameStrictBrandName("Bandla Hospital", "Palnadu Hospitals"), false)

console.log("Strict brand matcher regression checks passed.")
