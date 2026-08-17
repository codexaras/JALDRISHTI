/**
 * The five demo items, locked by name in BUILD_SPEC phase 1.
 *
 * Kept separate from `demo.ts` so the build script can read the list without
 * importing the payload bundle it is about to generate.
 */
export const DEMO_ITEMS = [
  "parle_g_biscuit",
  "okra_raw",
  "biryani_chicken",
  "dal_tadka",
  // cotton_raw replaced cotton_tshirt: the garment is out of scope (crops in,
  // textiles out), while cotton the CROP keeps the non-food clause covered
  // with real Table 3 figures.
  "cotton_raw",
] as const;
