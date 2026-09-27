import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  EUR_USD_FALLBACK,
  HKD_USD_FALLBACK,
  envRate,
  perYard,
  resolveUsdRate,
  usdPerYard,
} from "./fx-rate";

const METER_TO_YARD = 0.9144;
const savedEnv = {
  EUR_USD_RATE: process.env.EUR_USD_RATE,
  HKD_USD_RATE: process.env.HKD_USD_RATE,
};

function restoreEnv(name: "EUR_USD_RATE" | "HKD_USD_RATE") {
  const v = savedEnv[name];
  if (v === undefined) delete process.env[name];
  else process.env[name] = v;
}

beforeEach(() => {
  delete process.env.EUR_USD_RATE;
  delete process.env.HKD_USD_RATE;
});

afterEach(() => {
  restoreEnv("EUR_USD_RATE");
  restoreEnv("HKD_USD_RATE");
});

describe("FX fallback — same path as HKD, EUR added", () => {
  test("USD is identity and is not a fallback", () => {
    expect(resolveUsdRate("USD", null)).toEqual({ rate: 1, fallback: false });
    expect(resolveUsdRate("usd", 1.2)).toEqual({ rate: 1, fallback: false });
  });

  test("HKD still uses the documented peg fallback when Desk has no row", () => {
    expect(envRate("HKD")).toBe(HKD_USD_FALLBACK);
    expect(resolveUsdRate("hkd", null)).toEqual({ rate: 0.128, fallback: true });
  });

  test("EUR uses the documented ECB snapshot, flagged as a fallback — not a live rate", () => {
    expect(EUR_USD_FALLBACK).toBe(1.1403);
    expect(envRate("EUR")).toBe(1.1403);
    expect(resolveUsdRate("eur", null)).toEqual({ rate: 1.1403, fallback: true });
  });

  test("a Currency Exchange row wins and is not marked fallback", () => {
    expect(resolveUsdRate("EUR", 1.2)).toEqual({ rate: 1.2, fallback: false });
    expect(resolveUsdRate("HKD", 0.1282)).toEqual({ rate: 0.1282, fallback: false });
  });

  test("env overrides the static default and stays a fallback", () => {
    process.env.EUR_USD_RATE = "1.05";
    process.env.HKD_USD_RATE = "0.13";
    expect(resolveUsdRate("EUR", null)).toEqual({ rate: 1.05, fallback: true });
    expect(resolveUsdRate("HKD", null)).toEqual({ rate: 0.13, fallback: true });
    expect(resolveUsdRate("EUR", 1.18)).toEqual({ rate: 1.18, fallback: false });
  });

  test("blank or non-positive env is ignored", () => {
    process.env.EUR_USD_RATE = "0";
    expect(envRate("EUR")).toBe(EUR_USD_FALLBACK);
    process.env.EUR_USD_RATE = "nope";
    expect(envRate("EUR")).toBe(EUR_USD_FALLBACK);
  });

  test("a currency with no default still fails closed", () => {
    expect(envRate("GBP")).toBeNull();
    expect(resolveUsdRate("GBP", null)).toBeNull();
  });
});

describe("buying cost — FAB-CAC EUR/m, HKD/yd, USD unchanged", () => {
  // Desk sample: FAB-CAC-300401 is €79/Meter on Fabric Buying EUR.
  const caccioppoliEurPerMeter = 79;
  // Desk sample: FAB-DRP-313101 is HKD 890/Yard.
  const drapersHkdPerYard = 890;
  // Desk sample: FAB-FW26-N684001 is USD 341/Yard. FAB-DRA-106 is USD 223/Meter.
  const loroPianaUsdPerYard = 341;
  const dragoUsdPerMeter = 223;

  test("EUR per meter converts with the fallback rate and the existing meter factor", () => {
    const fx = resolveUsdRate("EUR", null)!;
    expect(fx.fallback).toBe(true);
    expect(usdPerYard(caccioppoliEurPerMeter, "Meter", fx.rate)).toBeCloseTo(
      caccioppoliEurPerMeter * METER_TO_YARD * EUR_USD_FALLBACK,
      6,
    );
  });

  test("HKD per yard still converts and does not apply the meter factor", () => {
    const fx = resolveUsdRate("HKD", null)!;
    expect(perYard(drapersHkdPerYard, "Yard")).toBe(drapersHkdPerYard);
    expect(usdPerYard(drapersHkdPerYard, "Yard", fx.rate)).toBeCloseTo(drapersHkdPerYard * HKD_USD_FALLBACK, 6);
  });

  test("USD per yard is unchanged", () => {
    const fx = resolveUsdRate("USD", null)!;
    expect(fx).toEqual({ rate: 1, fallback: false });
    expect(usdPerYard(loroPianaUsdPerYard, "Yard", fx.rate)).toBe(loroPianaUsdPerYard);
    expect(usdPerYard(118.1, null, fx.rate)).toBe(118.1);
  });

  test("USD per meter (Drago / Tallia) still uses the existing meter factor only", () => {
    const fx = resolveUsdRate("USD", null)!;
    expect(usdPerYard(dragoUsdPerMeter, "Meter", fx.rate)).toBeCloseTo(dragoUsdPerMeter * METER_TO_YARD, 6);
  });

  test("a live EUR row replaces the snapshot", () => {
    const live = 1.2;
    const fx = resolveUsdRate("EUR", live)!;
    expect(fx.fallback).toBe(false);
    expect(usdPerYard(caccioppoliEurPerMeter, "Meter", fx.rate)).toBeCloseTo(
      caccioppoliEurPerMeter * METER_TO_YARD * live,
      6,
    );
  });
});
