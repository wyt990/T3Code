import { describe, expect, it } from "vitest";

import { parseDependencyAuditJson } from "./runDependencyAudit.ts";

describe("parseDependencyAuditJson", () => {
  it("returns empty array when vulnerabilities missing", () => {
    expect(parseDependencyAuditJson("{}")).toEqual([]);
  });

  it("maps npm audit v2 vulnerability entries", () => {
    const json = JSON.stringify({
      auditReportVersion: 2,
      vulnerabilities: {
        leftpad: {
          name: "leftpad",
          severity: "high",
          range: "< 1.0.0",
          via: [
            {
              title: "Prototype pollution",
              url: "https://example.com/advisory",
              severity: "high",
            },
          ],
        },
      },
      metadata: { vulnerabilities: { high: 1, total: 1 } },
    });
    const rows = parseDependencyAuditJson(json);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.packageName).toBe("leftpad");
    expect(rows[0]?.severity).toBe("high");
    expect(rows[0]?.title).toContain("Prototype");
    expect(rows[0]?.url).toBe("https://example.com/advisory");
    expect(rows[0]?.range).toBe("< 1.0.0");
  });

  it("handles root.error from npm", () => {
    const json = JSON.stringify({ error: { summary: "lockfile out of date" } });
    const rows = parseDependencyAuditJson(json);
    expect(rows[0]?.title).toBe("审计未执行");
    expect(rows[0]?.detail).toContain("lockfile");
  });
});
