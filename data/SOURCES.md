# Data sources — Jal Drishti

Every numeric value in `/data` carries a `source` column pointing at one of the
documents below. Rule 1 of BUILD_SPEC.md: no value in this directory may be
invented, estimated or interpolated. If you add a row, add its citation.

---

## S1 — Mekonnen, M.M. & Hoekstra, A.Y. (2011)
**The green, blue and grey water footprint of crops and derived crop products.**
Value of Water Research Report Series No. 47, UNESCO-IHE, Delft.
Hydrology and Earth System Sciences 15(5): 1577–1600.

Used for: all crop footprints in `crop.csv` where `is_animal = 0`.
Values are the **global average** figures, in m³/tonne.

> **Unit note (BUILD_SPEC rule 2.2):** m³/tonne is numerically identical to L/kg.
> 1 m³ = 1000 L and 1 tonne = 1000 kg. Values are copied across with **no
> conversion**. Do not multiply or divide by 1000.

### Two tables, two confidence levels

The paper publishes crops two ways, and the `source` tag says which one a row used:

| Tag | Where it comes from | Confidence |
|---|---|---|
| `S1:table3` | **Table 3** — this crop is listed individually | high |
| `S1:table2-category` | **Table 2** — the published average for the crop's *category* | medium |
| `S1:approx` | Neither; a nearby crop's figure stands in | **must be checked** |

`table2-category` is a citeable methodological choice, not a guess. Urad and
moong are not broken out in Table 3, so they carry the published **pulses**
average (3180 / 141 / 734). The honest answer in Q&A is *"the source doesn't
list urad, so we use its published pulse-category average and mark the result
medium-confidence"* — which is a real answer, where a reconstructed number is
not.

The fourteen published category averages live in **`category_average.csv`**, and
`repo/validate.ts` **fails the build** if any `table2-category` crop does not
match one of those rows exactly. That is what stops a category average drifting
back into an invented number.

> Table 2 rounds each component independently, so five of the fourteen rows have
> parts that sum to 1 L/kg off the published total. That is the paper's
> rounding. The figures stay exactly as printed; the validator tolerates ±1 and
> fails on anything larger.

### Milling ratio — independently confirmed

`rice_raw` derives milled rice from paddy at a yield of 0.67, giving
1710 / 509 / 279 L/kg. Table 3 lists "Rice, broken" at **1710 / 509 / 278**
independently. The derivation was not tuned to match; the agreement is a check
on it.

## S2 — Mekonnen, M.M. & Hoekstra, A.Y. (2012) — ⚠ ALL ROWS NEEDS_SOURCE
**A global assessment of the water footprint of farm animal products.**
Ecosystems 15(3): 401–415. (Also Value of Water Report Series No. 48, 2010.)

Used for: all rows in `crop.csv` where `is_animal = 1`.
Per BUILD_SPEC rule 2.4 these are read directly and never derived from feed crops.

**Every animal row is tagged `S2:NEEDS_SOURCE`.** These figures are not in
M&H 2011 — they require Report No. 48, which has not been checked against.
They are deliberately NOT approximated: animal footprints are large enough that
a wrong value would be visibly wrong. Retained so the engine runs; not citeable
until someone reads Report 48.

## S3 — Central Ground Water Board (CGWB), Ministry of Jal Shakti
**Dynamic Ground Water Resources Assessment of India.**

Used for: `gw_stress.csv` — stage of groundwater extraction (SoE %) and the
CGWB category (Safe < 70%, Semi-Critical 70–90%, Critical 90–100%,
Over-Exploited > 100%).

The 70% threshold in `engine/stress.ts` is CGWB's own "Safe" ceiling, which is
why `stress_factor` uses it as the denominator.

### ⚠ CORRECTION — figures are STATE level, not district level

An earlier version of this dataset carried district rows such as
"Sangrur 164%". **No citeable district figure exists for this project**, and
those numbers were reconstructions. They have been removed entirely:

- `gw_stress.csv` now holds **one row per state/UT**, with `level = "state"`.
- The `district` column holds the **state name**, so no district can be printed.
- `production_share.rep_district` references the state row.
- `repo/validate.ts` **fails the build** on any district-level row without a
  citation, and on any state-level row whose `district` is not the state name.
- The UI labels every figure "state average" inline and reads
  *"Punjab · 156% of groundwater extracted"*.

### What is cited, and what stands in for the rest

**Seven states publish a figure we can cite:**

| State | SoE % | Year |
|---|---|---|
| Punjab | 156.36 | 2025 |
| Rajasthan | 147.11 | 2025 |
| Haryana | 136.75 | 2025 |
| Delhi | 92.10 | 2025 |
| Himachal Pradesh | 38.50 | 2025 |
| Andhra Pradesh | 29.83 | 2024 |
| Meghalaya | 4.60 | 2024 |
| **India (national)** | **60.63** | **2025** |

Of 6,762 assessment units: 730 over-exploited, 201 critical, 758 semi-critical,
4,946 safe, 127 saline.

**The other 29 states carry the national average, labelled as such.** An earlier
version of this file invented a plausible-looking number for each of them
(Maharashtra 55, Karnataka 64, Tamil Nadu 82 …). Those were 29 uncited claims.
They are gone. In their place stands one cited number — the published all-India
figure — at `level = "national"`, and the UI prints "national average" beside it
with the tooltip *"CGWB does not publish a citeable figure for this state, so the
all-India average stands in."*

That is a real number about India rather than a fake number about Maharashtra.

`repo/validate.ts` enforces both directions: rows at `level = "national"` must
all carry the same value (two different "national averages" means one is really
a state figure mislabelled), and none of them may be `NEEDS_SOURCE`.

**To get real state or district data:** CGWB DGWRA 2025 state annexures, or the
INGRES portal at `ingres.iith.ac.in` for block-level figures.

## S4 — Directorate of Economics & Statistics, Ministry of Agriculture & Farmers Welfare
**Agricultural Statistics at a Glance** / **Area, Production and Yield statistics.**

Used for: `production_share.csv` — the share of national production by state,
and the representative district for each producing state.

## S5 — Derived structural values (not measurements)
`yield.csv` processing-yield fractions are engineering conversion ratios
(e.g. wheat → atta ≈ 0.80), not water measurements. Sources noted per row.
Also covers `off_ingredient_map.csv` (Open Food Facts tag → crop_id) and the
recipe rows in `product_ingredient.csv`.

### Jaggery — stated derivation

Jaggery (gur) is not in Table 3. It is built from **cane molasses**
(350 / 144 / 33, Table 3, FAO 156d) at a yield of 1.0, tagged
`S1:table3-molasses-derived` — both are concentrated cane juice at comparable
solids. The earlier route was sugarcane through an `:approx` yield guess of
0.11, which put a fabricated conversion factor between the source and the
answer. This way the derivation is one sentence and the input is published.

## S6 — Seasonal irrigation model (`season_factor.csv`) — A DECLARED MODEL
**This is the one place in the dataset that is a model, not a measurement, and
it is deliberately three rows so it can be audited at a glance.**

Mekonnen & Hoekstra publish annual national averages; they do not publish
kharif/rabi/zaid splits. Rather than fabricate thousands of `crop_state` rows,
the engine applies one multiplier to the **blue** component by season and
rebalances **green** so the published **total is exactly conserved**:

```
blue' = blue × factor
green' = green + (blue − blue')      ← total unchanged
grey' = grey                          ← pollution load is not seasonal
```

The direction is not in dispute — a monsoon-sown kharif crop meets much of its
water demand from rainfall, while a rabi or zaid crop is grown after the monsoon
and leans on irrigation. The *magnitudes* (0.75 / 1.35 / 1.60) are our
calibration, and every result that uses them records `season_model_applied` in
`lineage.fallbacks_used` so the screen can say so.

**What to say if challenged:** "The total is Mekonnen & Hoekstra's published
figure and does not move. The seasonal split between rainfall and irrigation is
our model, it is three numbers in one CSV, and we flag it on every result that
uses it."

## S7 — Human equivalence benchmarks (`equivalence.csv`)
- 55 litres per capita per day — **Jal Jeevan Mission** rural domestic supply norm
- 3 litres/day drinking water — ICMR daily intake guidance
- 15 L bucket, 45 L bucket bath, 12,000 L municipal tanker — standard service units

## S8 — Municipal water utilities (`city_water.csv`)
Reservoir storage as published by BMC (Mumbai), CMWSSB (Chennai), MWRD (Pune),
BWSSB (Bengaluru), HMWSSB (Hyderabad) and DJB (Delhi).

> ⚠ **These are a dated snapshot** (`updated_on` column), not a live feed. Refresh
> before the demo, or state plainly that the figures are as of that date.

---

## Category vocabulary

BUILD_SPEC enumerates `cereal|pulse|vegetable|fruit|oilseed|animal|fibre|beverage`.
Sugarcane fits none of them, so `sugar` is added as a ninth value. `is_food = 0`
marks non-food agricultural products (cotton, jute).

---

## ⚠ VERIFICATION STATUS — read before the demo

BUILD_SPEC section 9 requires five golden items **hand-verified against source
documents by a human**. The rows below are marked in each CSV's `source` column
with a confidence tag:

| Tag | Meaning | Action needed |
|---|---|---|
| `S1`, `S2` … | Headline published figure, high confidence | Spot-check the 5 golden items |
| `…:table3` | Listed individually in M&H Table 3 | none |
| `…:table2-category` | Published category average from M&H Table 2 | none — say so in Q&A |
| `S3:CGWB-2025-national` | National average standing in for an unpublished state | none — labelled in the UI |
| `…:approx` | Value believed correct but **not** line-verified | **Must be checked before demo** |
| `…:NEEDS_SOURCE` | No citation exists at all | Get the source document |

### Current standing (`npm run data:validate` prints this on every run)

- **57 crops** cite Table 3 individually
- **14 crops** use a published Table 2 category average
- **21 crops** remain `:approx` — down from 37
- **8 crops** remain `NEEDS_SOURCE`, all animal products (S2). These need
  Value of Water Research Report No. 48 and **must not be approximated** —
  animal footprints are large enough that a guess would be visibly wrong.
- **7 states** publish their own groundwater figure; **29** carry the cited
  national average, labelled

The remaining `:approx` crops are the ones where a nearby crop's figure stands
in: bajra, ragi, tur, masoor, brinjal, okra, chilli, capsicum, the leafy herbs
(which use spinach), and the two fibres.

Any row tagged `:approx` is a row you can be challenged on in Q&A. Replace it
with a line-verified figure from the source PDF, or drop the row and let the
engine fall back (the fallback is recorded in `lineage.fallbacks_used`, which is
an honest answer; a wrong number is not).

`crop_state.csv` is deliberately sparse. Where no state-level row exists the
engine falls back to the national/global default from `crop.csv` and downgrades
`confidence.quality` to `medium`. That is by design — an honest fallback beats a
fabricated state figure.
