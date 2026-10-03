/**
 * GHANA ADMINISTRATIVE GEOGRAPHY — the grounding for the Increment H demo dataset.
 *
 * This is REFERENCE DATA, not generated data: the 16 regions are Ghana's real regions (the 2018
 * re-organisation that split Brong Ahafo into Bono / Bono East / Ahafo, Northern into Northern /
 * Savannah / North East, Volta into Volta / Oti, and Western into Western / Western North), and the
 * districts are real MMDA names. It lives apart from `scripts/seed-demo-data.ts` so the generator is
 * all algorithm and this file is all fact — a wrong district name is fixed here without touching the
 * RNG, and the RNG is changed without touching the map.
 *
 * ⚠ DEMO SCAFFOLDING. Nothing in the ETL reads this file. It exists so that a demo shown to MoE/GES
 * before the real EMIS extract arrives is recognisable — a regional roll-up that says "Upper West"
 * and "Jirapa Municipal" reads as a real country; one that says "Region 7 / District 3" reads as a
 * mock-up, and the whole point of the slice is that the pipeline is real.
 *
 * `urbanShare` is the probability that a school generated in the district is URBAN. It is derived
 * from the MMDA class rather than invented per district: metropolitan assemblies are overwhelmingly
 * urban, municipal assemblies mixed, ordinary district assemblies largely rural. That single
 * parameter is what makes the generated WASH / power / ICT gradient look like Ghana's real one
 * (northern, rural districts materially worse served) instead of uniform noise.
 */

export interface DemoDistrict {
  name: string;
  /** P(school in this district is urban). Drives the facilities gradient. */
  urbanShare: number;
}

export interface DemoRegion {
  name: string;
  /** Short code used to build stable, readable EMIS ids (GH-AS-0007). */
  code: string;
  /**
   * A REGION-LEVEL urbanisation multiplier applied on top of the district's MMDA class.
   *
   * The MMDA class alone is not enough: it would make a "Municipal" assembly in Greater Accra and one
   * in Savannah equally urban, and the demo then shows Northern out-performing Accra on grid power —
   * the exact inversion of Ghana's real north–south service gradient, and the first thing anyone at
   * MoE would spot. So the south and the big metros are scaled up and the five northern/newer regions
   * down, giving a dataset whose regional ranking is recognisable.
   *
   * These are PLAUSIBILITY WEIGHTS for demo data, NOT measurements. They are not a claim about Ghana's
   * urbanisation rate and must not be cited as one; they exist so a dashboard built on dummy data shows
   * the kind of variation the real data will show, rather than uniform noise.
   */
  urbanisation: number;
  districts: DemoDistrict[];
}

/** Metropolitan → mostly urban, Municipal → mixed, District → mostly rural. */
function mmdaUrbanShare(name: string): number {
  if (/Metropolitan/.test(name)) return 0.85;
  if (/Municipal/.test(name)) return 0.45;
  return 0.12;
}

function districts(...names: string[]): DemoDistrict[] {
  return names.map((name) => ({ name, urbanShare: mmdaUrbanShare(name) }));
}

/** The 16 regions of Ghana, with a representative set of real MMDAs in each. */
export const GHANA_REGIONS: readonly DemoRegion[] = Object.freeze([
  {
    name: "Greater Accra",
    urbanisation: 1.9,
    code: "GA",
    districts: districts(
      "Accra Metropolitan",
      "Tema Metropolitan",
      "Ga East Municipal",
      "Ga West Municipal",
      "Ledzokuku Municipal",
      "Adentan Municipal",
    ),
  },
  {
    name: "Ashanti",
    urbanisation: 1.45,
    code: "AS",
    districts: districts(
      "Kumasi Metropolitan",
      "Obuasi Municipal",
      "Ejisu Municipal",
      "Offinso Municipal",
      "Bekwai Municipal",
      "Asante Akim North",
    ),
  },
  {
    name: "Western",
    urbanisation: 1.05,
    code: "WR",
    districts: districts(
      "Sekondi-Takoradi Metropolitan",
      "Tarkwa-Nsuaem Municipal",
      "Ahanta West Municipal",
      "Nzema East Municipal",
      "Wassa Amenfi West",
    ),
  },
  {
    name: "Central",
    urbanisation: 1.1,
    code: "CR",
    districts: districts(
      "Cape Coast Metropolitan",
      "Mfantsiman Municipal",
      "Agona West Municipal",
      "Awutu Senya East Municipal",
      "Komenda-Edina-Eguafo-Abirem",
    ),
  },
  {
    name: "Eastern",
    urbanisation: 1.0,
    code: "ER",
    districts: districts(
      "New Juaben Municipal",
      "Kwahu West Municipal",
      "Birim Central Municipal",
      "Lower Manya Krobo Municipal",
      "Akuapem North",
    ),
  },
  {
    name: "Volta",
    urbanisation: 0.85,
    code: "VR",
    districts: districts(
      "Ho Municipal",
      "Hohoe Municipal",
      "Keta Municipal",
      "Ketu South Municipal",
      "South Tongu",
    ),
  },
  {
    name: "Northern",
    urbanisation: 0.7,
    code: "NR",
    districts: districts(
      "Tamale Metropolitan",
      "Sagnarigu Municipal",
      "Yendi Municipal",
      "Savelugu Municipal",
      "Kumbungu",
    ),
  },
  {
    name: "Upper East",
    urbanisation: 0.55,
    code: "UE",
    districts: districts(
      "Bolgatanga Municipal",
      "Bawku Municipal",
      "Kassena-Nankana Municipal",
      "Builsa North",
    ),
  },
  {
    name: "Upper West",
    urbanisation: 0.55,
    code: "UW",
    districts: districts(
      "Wa Municipal",
      "Jirapa Municipal",
      "Sissala East Municipal",
      "Nadowli-Kaleo",
    ),
  },
  {
    name: "Bono",
    urbanisation: 0.95,
    code: "BO",
    districts: districts(
      "Sunyani Municipal",
      "Dormaa Central Municipal",
      "Berekum East Municipal",
      "Wenchi Municipal",
    ),
  },
  {
    name: "Bono East",
    urbanisation: 0.75,
    code: "BE",
    districts: districts(
      "Techiman Municipal",
      "Kintampo North Municipal",
      "Nkoranza South Municipal",
      "Atebubu-Amantin Municipal",
    ),
  },
  {
    name: "Ahafo",
    urbanisation: 0.75,
    code: "AH",
    districts: districts(
      "Asunafo North Municipal",
      "Tano North Municipal",
      "Asunafo South",
      "Asutifi North",
    ),
  },
  {
    name: "Western North",
    urbanisation: 0.8,
    code: "WN",
    districts: districts(
      "Sefwi Wiawso Municipal",
      "Aowin Municipal",
      "Bia West",
      "Juaboso",
    ),
  },
  {
    name: "Oti",
    urbanisation: 0.6,
    code: "OT",
    districts: districts(
      "Nkwanta South Municipal",
      "Krachi East Municipal",
      "Kadjebi",
      "Biakoye",
    ),
  },
  {
    name: "Savannah",
    urbanisation: 0.5,
    code: "SV",
    districts: districts(
      "West Gonja Municipal",
      "East Gonja Municipal",
      "Bole",
      "Sawla-Tuna-Kalba",
    ),
  },
  {
    name: "North East",
    urbanisation: 0.5,
    code: "NE",
    districts: districts(
      "East Mamprusi Municipal",
      "West Mamprusi Municipal",
      "Chereponi",
      "Yunyoo-Nasuan",
    ),
  },
]);

/**
 * Community / eponym name stems used to build school names. Ghanaian place and person names, so a
 * generated register reads like a register. Names are combined with a type-appropriate suffix
 * ("Presby Primary", "Community JHS", "Senior High School") by the generator.
 */
export const SCHOOL_NAME_STEMS: readonly string[] = Object.freeze([
  "Adabraka",
  "Adjei Kojo",
  "Agbogba",
  "Ahinsan",
  "Akropong",
  "Amanfrom",
  "Anomabo",
  "Asawase",
  "Asokore",
  "Atonsu",
  "Ayeduase",
  "Bantama",
  "Bawjiase",
  "Bogoso",
  "Breman",
  "Buipe",
  "Dadieso",
  "Dambai",
  "Dunkwa",
  "Ejura",
  "Fumesua",
  "Gbewaa",
  "Gomoa",
  "Gushegu",
  "Half Assini",
  "Jamasi",
  "Kaleo",
  "Kasoa",
  "Kpandai",
  "Kpong",
  "Kwadaso",
  "Lawra",
  "Mampong",
  "Manhyia",
  "Mamobi",
  "Nandom",
  "Navrongo",
  "Nsawam",
  "Nungua",
  "Nyankpala",
  "Obomeng",
  "Oyibi",
  "Pokuase",
  "Saboba",
  "Salaga",
  "Sampa",
  "Sogakope",
  "Suhum",
  "Tafo",
  "Tanoso",
  "Teshie",
  "Tongo",
  "Tumu",
  "Walewale",
  "Weija",
  "Wulensi",
  "Yagaba",
  "Zebilla",
  "Zuarungu",
  "Abesim",
]);

/** Mission-school patrons, used only for MISSION ownership so the name matches the ownership. */
export const MISSION_PATRONS: readonly string[] = Object.freeze([
  "St. Augustine",
  "St. Monica",
  "St. Peter",
  "Holy Child",
  "Our Lady of Mercy",
  "Methodist",
  "Presby",
  "Anglican",
  "Ahmadiyya",
  "Islamic",
]);
