import { describe, test, expect } from "bun:test";

function parseCronField(
  field: string,
  min: number,
  max: number
): number[] | null {
  if (field === "*") {
    return Array.from({ length: max - min + 1 }, (_, i) => min + i);
  }

  // Handle */step
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2));
    if (isNaN(step) || step <= 0) return null;
    const values: number[] = [];
    for (let i = min; i <= max; i += step) {
      values.push(i);
    }
    return values;
  }

  // Handle range: 1-5
  if (field.includes("-") && !field.includes(",")) {
    const [startStr, endStr] = field.split("-");
    const start = parseInt(startStr);
    const end = parseInt(endStr);
    if (isNaN(start) || isNaN(end) || start < min || end > max || start > end)
      return null;
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }

  // Handle list: 1,3,5
  if (field.includes(",")) {
    const values = field.split(",").map(Number);
    if (values.some((v) => isNaN(v) || v < min || v > max)) return null;
    return values;
  }

  // Single value
  const val = parseInt(field);
  if (isNaN(val) || val < min || val > max) return null;
  return [val];
}

function isValidCronExpression(expr: string): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;

  const ranges = [
    [0, 59],  // minute
    [0, 23],  // hour
    [1, 31],  // day of month
    [1, 12],  // month
    [0, 6],   // day of week
  ];

  for (let i = 0; i < 5; i++) {
    const result = parseCronField(parts[i], ranges[i][0], ranges[i][1]);
    if (result === null) return false;
  }

  return true;
}

function shouldRunAt(cron: string, date: Date): boolean {
  const parts = cron.trim().split(/\s+/);
  const ranges = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ];

  const dateValues = [
    date.getMinutes(),
    date.getHours(),
    date.getDate(),
    date.getMonth() + 1,
    date.getDay(),
  ];

  for (let i = 0; i < 5; i++) {
    const allowed = parseCronField(parts[i], ranges[i][0], ranges[i][1]);
    if (!allowed || !allowed.includes(dateValues[i])) return false;
  }

  return true;
}

describe("Cron Field Parser", () => {
  test("should parse wildcard *", () => {
    const result = parseCronField("*", 0, 59);
    expect(result).toHaveLength(60);
    expect(result![0]).toBe(0);
    expect(result![59]).toBe(59);
  });

  test("should parse step */15 for minutes", () => {
    const result = parseCronField("*/15", 0, 59);
    expect(result).toEqual([0, 15, 30, 45]);
  });

  test("should parse step */6 for hours", () => {
    const result = parseCronField("*/6", 0, 23);
    expect(result).toEqual([0, 6, 12, 18]);
  });

  test("should parse range 1-5", () => {
    const result = parseCronField("1-5", 0, 6);
    expect(result).toEqual([1, 2, 3, 4, 5]);
  });

  test("should parse list 1,3,5", () => {
    const result = parseCronField("1,3,5", 0, 6);
    expect(result).toEqual([1, 3, 5]);
  });

  test("should parse single value", () => {
    const result = parseCronField("30", 0, 59);
    expect(result).toEqual([30]);
  });

  test("should return null for out-of-range value", () => {
    const result = parseCronField("60", 0, 59);
    expect(result).toBeNull();
  });

  test("should return null for invalid step", () => {
    const result = parseCronField("*/0", 0, 59);
    expect(result).toBeNull();
  });

  test("should return null for invalid range", () => {
    const result = parseCronField("5-3", 0, 6);
    expect(result).toBeNull();
  });
});

describe("Cron Expression Validation", () => {
  test("should validate '* * * * *' (every minute)", () => {
    expect(isValidCronExpression("* * * * *")).toBe(true);
  });

  test("should validate '0 */6 * * *' (every 6 hours)", () => {
    expect(isValidCronExpression("0 */6 * * *")).toBe(true);
  });

  test("should validate '30 2 * * 1-5' (weekdays at 2:30)", () => {
    expect(isValidCronExpression("30 2 * * 1-5")).toBe(true);
  });

  test("should validate '0 0 1 * *' (first of month)", () => {
    expect(isValidCronExpression("0 0 1 * *")).toBe(true);
  });

  test("should reject expression with too few fields", () => {
    expect(isValidCronExpression("* * *")).toBe(false);
  });

  test("should reject expression with too many fields", () => {
    expect(isValidCronExpression("* * * * * *")).toBe(false);
  });

  test("should reject invalid minute value", () => {
    expect(isValidCronExpression("60 * * * *")).toBe(false);
  });

  test("should reject invalid hour value", () => {
    expect(isValidCronExpression("* 25 * * *")).toBe(false);
  });

  test("should reject invalid day of month", () => {
    expect(isValidCronExpression("* * 32 * *")).toBe(false);
  });

  test("should reject invalid month", () => {
    expect(isValidCronExpression("* * * 13 *")).toBe(false);
  });

  test("should reject invalid day of week", () => {
    expect(isValidCronExpression("* * * * 7")).toBe(false);
  });
});

describe("Cron Schedule Matching", () => {
  test("should match every minute expression", () => {
    const date = new Date(2025, 0, 15, 10, 30, 0);
    expect(shouldRunAt("* * * * *", date)).toBe(true);
  });

  test("should match specific minute and hour", () => {
    const date = new Date(2025, 0, 15, 14, 30, 0); // 2:30 PM
    expect(shouldRunAt("30 14 * * *", date)).toBe(true);
  });

  test("should not match wrong minute", () => {
    const date = new Date(2025, 0, 15, 14, 31, 0);
    expect(shouldRunAt("30 14 * * *", date)).toBe(false);
  });

  test("should match day of week", () => {
    // Jan 13, 2025 is Monday (day 1)
    const monday = new Date(2025, 0, 13, 0, 0, 0);
    expect(shouldRunAt("0 0 * * 1", monday)).toBe(true);
    expect(shouldRunAt("0 0 * * 0", monday)).toBe(false); // Sunday
  });

  test("should match every 6 hours at minute 0", () => {
    const midnight = new Date(2025, 0, 15, 0, 0, 0);
    const sixAm = new Date(2025, 0, 15, 6, 0, 0);
    const noon = new Date(2025, 0, 15, 12, 0, 0);
    const threeAm = new Date(2025, 0, 15, 3, 0, 0);

    expect(shouldRunAt("0 */6 * * *", midnight)).toBe(true);
    expect(shouldRunAt("0 */6 * * *", sixAm)).toBe(true);
    expect(shouldRunAt("0 */6 * * *", noon)).toBe(true);
    expect(shouldRunAt("0 */6 * * *", threeAm)).toBe(false);
  });

  test("should match first day of month", () => {
    const firstDay = new Date(2025, 2, 1, 0, 0, 0);
    const secondDay = new Date(2025, 2, 2, 0, 0, 0);

    expect(shouldRunAt("0 0 1 * *", firstDay)).toBe(true);
    expect(shouldRunAt("0 0 1 * *", secondDay)).toBe(false);
  });
});