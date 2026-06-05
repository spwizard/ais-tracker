/**
 * Country/flag from an MMSI. The first three digits (the Maritime Identification
 * Digits, "MID") encode the vessel's flag state — so we can show a flag for
 * every vessel instantly, with no lookup, even "Unknown"-type ones.
 */

// MID → ISO 3166-1 alpha-2. Comprehensive for Europe + major maritime nations
// and flag states; unmapped MIDs simply show no flag.
const MID_TO_ISO2: Record<number, string> = {
  201: "AL", 202: "AD", 203: "AT", 204: "PT", 205: "BE", 206: "BY", 207: "BG",
  208: "VA", 209: "CY", 210: "CY", 211: "DE", 212: "CY", 213: "GE", 214: "MD",
  215: "MT", 216: "AM", 218: "DE", 219: "DK", 220: "DK", 224: "ES", 225: "ES",
  226: "FR", 227: "FR", 228: "FR", 229: "MT", 230: "FI", 231: "FO", 232: "GB",
  233: "GB", 234: "GB", 235: "GB", 236: "GI", 237: "GR", 238: "HR", 239: "GR",
  240: "GR", 241: "GR", 242: "MA", 243: "HU", 244: "NL", 245: "NL", 246: "NL",
  247: "IT", 248: "MT", 249: "MT", 250: "IE", 251: "IS", 252: "LI", 253: "LU",
  254: "MC", 255: "PT", 256: "MT", 257: "NO", 258: "NO", 259: "NO", 261: "PL",
  262: "ME", 263: "PT", 264: "RO", 265: "SE", 266: "SE", 267: "SK", 268: "SM",
  269: "CH", 270: "CZ", 271: "TR", 272: "UA", 273: "RU", 274: "MK", 275: "LV",
  276: "EE", 277: "LT", 278: "SI", 279: "RS",
  301: "AI", 303: "US", 304: "AG", 305: "AG", 306: "CW", 307: "AW", 308: "BS",
  309: "BS", 310: "BM", 311: "BS", 312: "BZ", 314: "BB", 316: "CA", 319: "KY",
  321: "CR", 323: "CU", 325: "DM", 327: "DO", 329: "GP", 330: "GD", 331: "GL",
  332: "GT", 334: "HN", 336: "HT", 338: "US", 339: "JM", 341: "KN", 343: "LC",
  345: "MX", 347: "MQ", 348: "MS", 350: "NI", 351: "PA", 352: "PA", 353: "PA",
  354: "PA", 355: "PA", 356: "PA", 357: "PA", 358: "PR", 359: "SV", 361: "PM",
  362: "TT", 364: "TC", 366: "US", 367: "US", 368: "US", 369: "US", 370: "PA",
  371: "PA", 372: "PA", 373: "PA", 374: "PA", 375: "VC", 376: "VC", 377: "VC",
  378: "VG", 379: "VI",
  401: "AF", 403: "SA", 405: "BD", 408: "BH", 410: "BT", 412: "CN", 413: "CN",
  414: "CN", 416: "TW", 417: "LK", 419: "IN", 422: "IR", 423: "AZ", 425: "IQ",
  428: "IL", 431: "JP", 432: "JP", 434: "TM", 436: "KZ", 437: "UZ", 438: "JO",
  440: "KR", 441: "KR", 443: "PS", 445: "KP", 447: "KW", 450: "LB", 451: "KG",
  453: "MO", 455: "MV", 457: "MN", 459: "NP", 461: "OM", 463: "PK", 466: "QA",
  468: "SY", 470: "AE", 471: "AE", 472: "TJ", 473: "YE", 475: "YE", 477: "HK",
  478: "BA",
  501: "TF", 503: "AU", 506: "MM", 508: "BN", 510: "FM", 511: "PW", 512: "NZ",
  514: "KH", 515: "KH", 516: "CX", 518: "CK", 520: "FJ", 523: "CC", 525: "ID",
  529: "KI", 531: "LA", 533: "MY", 536: "MP", 538: "MH", 540: "NC", 542: "NU",
  544: "NR", 546: "PF", 548: "PH", 553: "PG", 555: "PN", 557: "SB", 559: "AS",
  561: "WS", 563: "SG", 564: "SG", 565: "SG", 566: "SG", 567: "TH", 570: "TO",
  572: "TV", 574: "VN", 576: "VU", 577: "VU", 578: "WF",
  601: "ZA", 603: "AO", 605: "DZ", 607: "TF", 608: "SH", 609: "BI", 610: "BJ",
  611: "BW", 612: "CF", 613: "CM", 615: "CG", 616: "KM", 617: "CV", 618: "TF",
  619: "CI", 620: "KM", 621: "DJ", 622: "EG", 624: "ET", 625: "ER", 626: "GA",
  627: "GH", 629: "GM", 630: "GW", 631: "GQ", 632: "GN", 633: "BF", 634: "KE",
  635: "TF", 636: "LR", 637: "LR", 638: "SS", 642: "LY", 644: "LS", 645: "MU",
  647: "MG", 649: "ML", 650: "MZ", 654: "MR", 655: "MW", 656: "NE", 657: "NG",
  659: "NA", 660: "RE", 661: "RW", 662: "SD", 663: "SN", 664: "SC", 665: "SH",
  666: "SO", 667: "SL", 668: "ST", 669: "SZ", 670: "TD", 671: "TG", 672: "TN",
  674: "TZ", 675: "UG", 676: "CD", 677: "TZ", 678: "ZM", 679: "ZW",
};

function flagEmoji(iso2: string): string {
  return iso2
    .toUpperCase()
    .replace(/./g, (c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65));
}

let regionNames: Intl.DisplayNames | null = null;
try {
  regionNames = new Intl.DisplayNames(["en"], { type: "region" });
} catch {
  regionNames = null;
}

export interface FlagInfo {
  iso2: string;
  name: string;
  flag: string;
}

export function mmsiCountry(mmsi: number): FlagInfo | null {
  const iso2 = MID_TO_ISO2[Math.floor(mmsi / 1_000_000)];
  if (!iso2) return null;
  return { iso2, name: regionNames?.of(iso2) ?? iso2, flag: flagEmoji(iso2) };
}

// ISO 3166-1 alpha-3 → alpha-2, for Lloyd's country-of-control/domicile codes.
const ISO3_TO_ISO2: Record<string, string> = {
  AFG: "AF", ALB: "AL", DZA: "DZ", AND: "AD", AGO: "AO", ATG: "AG", ARG: "AR",
  ARM: "AM", ABW: "AW", AUS: "AU", AUT: "AT", AZE: "AZ", BHS: "BS", BHR: "BH",
  BGD: "BD", BRB: "BB", BLR: "BY", BEL: "BE", BLZ: "BZ", BEN: "BJ", BMU: "BM",
  BTN: "BT", BOL: "BO", BIH: "BA", BWA: "BW", BRA: "BR", BRN: "BN", BGR: "BG",
  BFA: "BF", BDI: "BI", CPV: "CV", KHM: "KH", CMR: "CM", CAN: "CA", CYM: "KY",
  CAF: "CF", TCD: "TD", CHL: "CL", CHN: "CN", COL: "CO", COM: "KM", COG: "CG",
  COD: "CD", COK: "CK", CRI: "CR", CIV: "CI", HRV: "HR", CUB: "CU", CUW: "CW",
  CYP: "CY", CZE: "CZ", DNK: "DK", DJI: "DJ", DMA: "DM", DOM: "DO", ECU: "EC",
  EGY: "EG", SLV: "SV", GNQ: "GQ", ERI: "ER", EST: "EE", ETH: "ET", FRO: "FO",
  FJI: "FJ", FIN: "FI", FRA: "FR", GAB: "GA", GMB: "GM", GEO: "GE", DEU: "DE",
  GHA: "GH", GIB: "GI", GRC: "GR", GRL: "GL", GRD: "GD", GLP: "GP", GTM: "GT",
  GIN: "GN", GNB: "GW", GUY: "GY", HTI: "HT", HND: "HN", HKG: "HK", HUN: "HU",
  ISL: "IS", IND: "IN", IDN: "ID", IRN: "IR", IRQ: "IQ", IRL: "IE", ISR: "IL",
  ITA: "IT", JAM: "JM", JPN: "JP", JOR: "JO", KAZ: "KZ", KEN: "KE", KIR: "KI",
  PRK: "KP", KOR: "KR", KWT: "KW", KGZ: "KG", LAO: "LA", LVA: "LV", LBN: "LB",
  LSO: "LS", LBR: "LR", LBY: "LY", LIE: "LI", LTU: "LT", LUX: "LU", MAC: "MO",
  MKD: "MK", MDG: "MG", MWI: "MW", MYS: "MY", MDV: "MV", MLI: "ML", MLT: "MT",
  MHL: "MH", MTQ: "MQ", MRT: "MR", MUS: "MU", MEX: "MX", FSM: "FM", MDA: "MD",
  MCO: "MC", MNG: "MN", MNE: "ME", MSR: "MS", MAR: "MA", MOZ: "MZ", MMR: "MM",
  NAM: "NA", NRU: "NR", NPL: "NP", NLD: "NL", NCL: "NC", NZL: "NZ", NIC: "NI",
  NER: "NE", NGA: "NG", NIU: "NU", NOR: "NO", OMN: "OM", PAK: "PK", PLW: "PW",
  PSE: "PS", PAN: "PA", PNG: "PG", PRY: "PY", PER: "PE", PHL: "PH", POL: "PL",
  PRT: "PT", PRI: "PR", QAT: "QA", REU: "RE", ROU: "RO", RUS: "RU", RWA: "RW",
  KNA: "KN", LCA: "LC", VCT: "VC", WSM: "WS", SMR: "SM", STP: "ST", SAU: "SA",
  SEN: "SN", SRB: "RS", SYC: "SC", SLE: "SL", SGP: "SG", SXM: "SX", SVK: "SK",
  SVN: "SI", SLB: "SB", SOM: "SO", ZAF: "ZA", SSD: "SS", ESP: "ES", LKA: "LK",
  SDN: "SD", SUR: "SR", SWE: "SE", CHE: "CH", SYR: "SY", TWN: "TW", TJK: "TJ",
  TZA: "TZ", THA: "TH", TGO: "TG", TON: "TO", TTO: "TT", TUN: "TN", TUR: "TR",
  TKM: "TM", TCA: "TC", TUV: "TV", UGA: "UG", UKR: "UA", ARE: "AE", GBR: "GB",
  USA: "US", URY: "UY", UZB: "UZ", VUT: "VU", VEN: "VE", VNM: "VN", VGB: "VG",
  VIR: "VI", WLF: "WF", YEM: "YE", ZMB: "ZM", ZWE: "ZW",
};

export function countryFromIso3(iso3: string | null | undefined): FlagInfo | null {
  if (!iso3) return null;
  const iso2 = ISO3_TO_ISO2[iso3.toUpperCase()];
  if (!iso2) return null;
  return { iso2, name: regionNames?.of(iso2) ?? iso3, flag: flagEmoji(iso2) };
}
