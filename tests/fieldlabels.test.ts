import { describe, expect, it } from "vitest";
import { labelFor, type TextBox } from "../src/fieldlabels";

const t = (str: string, x: number, y: number, h = 8): TextBox => ({ str, x, y, w: str.length * h * 0.5, h });

describe("labelFor", () => {
  it("uses the whole label paragraph printed above a text field", () => {
    const items = [t("1 Name of entity/individual. An entry is", 50, 720), t("required for every filer.", 50, 711), t("Unrelated footer", 50, 600)];
    expect(labelFor([50, 690, 400, 705], items, "text")).toBe("1 Name of entity/individual. An entry is required for every filer.");
  });
  it("prefers a label just before the field on the same line", () => {
    const items = [t("Heading far above", 100, 740), t("tax year beginning", 50, 722)];
    expect(labelFor([130, 719, 200, 731], items, "text")).toBe("tax year beginning");
  });
  it("labels checkboxes from the text to their right", () => {
    const items = [t("Single", 62, 500), t("Married filing jointly", 160, 500), t("Filing Status", 62, 520)];
    expect(labelFor([50, 498, 58, 506], items, "check")).toBe("Single");
  });
  it("gives up rather than inventing a label", () => {
    expect(labelFor([50, 100, 150, 115], [t("far away", 400, 700)], "text")).toBeNull();
  });
});
