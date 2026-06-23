import { describe, it, expect } from "vitest";
import {
  detectMechanisms,
  parseClaudeMdSections,
} from "@/components/inspector/lib/detectMechanisms";

describe("detectMechanisms", () => {
  it("returns empty for non-object", () => {
    const m = detectMechanisms(null);
    expect(m.claudeMd).toBeNull();
    expect(m.outputStyle).toBeNull();
    expect(m.slashCommands).toEqual([]);
  });

  it("detects output style when system[] has >=2 blocks", () => {
    const m = detectMechanisms({
      system: [
        { type: "text", text: "a" },
        { type: "text", text: "b" },
      ],
    });
    expect(m.outputStyle).toBe(2);
  });

  it("detects CLAUDE.md via system-reminder + Contents of", () => {
    const m = detectMechanisms({
      system: [
        {
          type: "text",
          text: "<system-reminder>Contents of /CLAUDE.md: hello</system-reminder>",
        },
      ],
    });
    expect(m.claudeMd).toContain("Contents of");
  });

  it("detects slash command and extracts name from command-name", () => {
    const m = detectMechanisms({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "<command-message>review is running</command-message><command-name>/review</command-name>",
            },
          ],
        },
      ],
    });
    expect(m.slashCommands).toHaveLength(1);
    expect(m.slashCommands[0].name).toBe("review");
  });

  it("extracts name when command-name precedes command-message (real CLI order)", () => {
    const m = detectMechanisms({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "<command-name>/clear</command-name> <command-message>clear</command-message> <command-args></command-args>",
            },
          ],
        },
      ],
    });
    expect(m.slashCommands).toHaveLength(1);
    expect(m.slashCommands[0].name).toBe("clear");
  });

  it("falls back to bare-word tag when no command-name but args present", () => {
    const m = detectMechanisms({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "<command-message>exit</command-message> <command-args></command-args>",
            },
          ],
        },
      ],
    });
    expect(m.slashCommands).toHaveLength(1);
    expect(m.slashCommands[0].name).toBe("exit");
  });

  it("ignores command-message buried mid-prose even with full closed tags", () => {
    const m = detectMechanisms({
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              // 散文：完整闭合标签逐字出现，但埋在正文中间（非块开头）
              text: "举个例子：<command-name>/clear</command-name> <command-message>clear</command-message> <command-args></command-args> 这就是真实格式。",
            },
          ],
        },
      ],
    });
    expect(m.slashCommands).toEqual([]);
  });

  it("detects skill / sub-agent / mcp tool_use", () => {
    const m = detectMechanisms({
      messages: [
        {
          role: "assistant",
          content: [
            { type: "tool_use", name: "Skill", id: "t1" },
            { type: "tool_use", name: "Task", id: "t2" },
            { type: "tool_use", name: "mcp__ctx__query", id: "t3" },
          ],
        },
      ],
    });
    expect(m.skills).toHaveLength(1);
    expect(m.subAgents).toHaveLength(1);
    expect(m.mcpTools).toHaveLength(1);
    expect(m.mcpTools[0].name).toBe("mcp__ctx__query");
  });

  it("handles string content", () => {
    const m = detectMechanisms({
      messages: [{ role: "user", content: "plain text" }],
    });
    expect(m.slashCommands).toEqual([]);
  });
});

describe("parseClaudeMdSections", () => {
  it("returns empty for blank text", () => {
    expect(parseClaudeMdSections("")).toEqual([]);
  });

  it("splits global vs local CLAUDE.md", () => {
    const text = [
      "Contents of /Users/me/.claude/CLAUDE.md (user's private global instructions for all projects):",
      "",
      "global body here",
      "",
      "Contents of /repo/CLAUDE.md (project instructions, checked into the codebase):",
      "",
      "local body here",
    ].join("\n");
    const out = parseClaudeMdSections(text);
    expect(out).toHaveLength(2);
    expect(out[0].label).toBe("📋 Global CLAUDE.md");
    expect(out[0].cls).toBe("green");
    expect(out[0].scope).toBe("global");
    expect(out[1].label).toBe("📋 Local CLAUDE.md");
    expect(out[1].cls).toBe("cyan");
    expect(out[1].scope).toBe("local");
  });

  it("recognises memory and rules", () => {
    const text = [
      "Contents of /home/u/.claude/memory/foo.md (memory file):",
      "",
      "remember me",
      "",
      "Contents of /home/u/.claude/rules/r1.md (global rules):",
      "",
      "rule body",
    ].join("\n");
    const out = parseClaudeMdSections(text);
    expect(out[0].label).toBe("🧠 Memory: foo.md");
    expect(out[1].label).toBe("📜 Global Rule: r1.md");
  });
});
