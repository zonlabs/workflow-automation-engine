import { describe, expect, it } from "vitest";
import {
  resolveExpression,
  resolveTemplateString,
  resolveVariables,
} from "../../src/application/workflow/template-resolution-service";

describe("template-resolution-service", () => {
  const params = {
    repo: { owner: "zonlabs", name: "workflow-engine" },
    title: "Daily sync",
  };

  const stepOutputs = {
    1: {
      stepId: "step-1",
      stepNumber: 1,
      stepName: "AI Summary",
      toolSlug: "ai_summarize",
      output: {
        parsed_output: {
          issueTitle: "Ship it",
        },
      },
      durationMs: 12,
    },
  };

  it("resolves param expressions", () => {
    expect(resolveExpression("params.repo.owner", params, stepOutputs)).toBe("zonlabs");
  });

  it("supports AI parsed_output shorthand", () => {
    expect(resolveExpression("steps.1.output.issueTitle", params, stepOutputs)).toBe("Ship it");
  });

  it("resolves exact template tokens to raw values", () => {
    expect(resolveTemplateString("{{ params.title }}", params, stepOutputs)).toBe("Daily sync");
  });

  it("resolves nested objects recursively", () => {
    expect(
      resolveVariables(
        {
          owner: "{{params.repo.owner}}",
          text: "Issue: {{steps.1.output.issueTitle}}",
        },
        params,
        stepOutputs
      )
    ).toEqual({
      owner: "zonlabs",
      text: "Issue: Ship it",
    });
  });
});
