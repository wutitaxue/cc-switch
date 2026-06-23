import { useMemo } from "react";
import { cn } from "@/lib/utils";
import {
  detectMechanisms,
  parseClaudeMdSections,
  type ClaudeMdSectionCls,
} from "./lib/detectMechanisms";
import type { JumpTarget } from "./JsonTreeView";

interface MechanismChipsProps {
  requestBody: unknown;
  /** 点击 chip 时回调（key 用于 active 高亮，target 用于跳转）；不传则 chip 不可点 */
  onJump?: (key: string, target: Omit<JumpTarget, "nonce">) => void;
  /** 当前激活的 chip key（高亮用） */
  activeKey?: string | null;
}

type ChipCls = "cm" | "st" | "sc" | "sk" | "sa" | "mc";

interface Chip {
  key: string;
  label: string;
  cls: ChipCls;
  /** 点击后定位用的 needle（不含 nonce） */
  target?: Omit<JumpTarget, "nonce">;
}

/** 各机制颜色（对齐 claude-inspector，亮/暗主题都生效） */
const CHIP_STYLE: Record<ChipCls, string> = {
  // CLAUDE.md global / memory / rule(global) → 绿
  cm: "border-emerald-500/35 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  // CLAUDE.md local / rule(local) → 青
  st: "border-cyan-500/35 bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
  // Slash → 黄
  sc: "border-yellow-500/35 bg-yellow-500/12 text-yellow-700 dark:text-yellow-300",
  // Skill → 紫
  sk: "border-purple-500/35 bg-purple-500/15 text-purple-700 dark:text-purple-300",
  // Sub-Agent → 橙
  sa: "border-orange-500/35 bg-orange-500/15 text-orange-700 dark:text-orange-300",
  // MCP → 蓝青
  mc: "border-cyan-400/30 bg-cyan-400/12 text-cyan-700 dark:text-[#4ec9dc]",
};

function sectionCls(c: ClaudeMdSectionCls): ChipCls {
  return c === "cyan" ? "st" : "cm";
}

export function MechanismChips({
  requestBody,
  onJump,
  activeKey,
}: MechanismChipsProps) {
  const chips = useMemo<Chip[]>(() => {
    const det = detectMechanisms(requestBody);
    const out: Chip[] = [];

    if (det.claudeMd) {
      const sections = parseClaudeMdSections(det.claudeMd);
      if (sections.length > 0) {
        sections.forEach((s, i) => {
          const marker = `Contents of ${s.path}`;
          out.push({
            key: `cm_${i}`,
            label: s.label,
            cls: sectionCls(s.cls),
            target: {
              nodeNeedle: marker,
              lineNeedle: marker,
              sectionEndNeedle: "Contents of ",
            },
          });
        });
      } else {
        out.push({
          key: "cm",
          label: "📋 CLAUDE.md",
          cls: "cm",
          target: { nodeNeedle: "<system-reminder>" },
        });
      }
    }

    det.slashCommands.forEach((c, i) => {
      const tagNeedle = `<command-message>${c.tag}</command-message>`;
      out.push({
        key: `sc_${i}`,
        label: `⌨ /${c.name}`,
        cls: "sc",
        target: { nodeNeedle: tagNeedle, lineNeedle: tagNeedle },
      });
    });

    det.skills.forEach((s, i) => {
      const input = (s.input ?? {}) as { skill?: string; command?: string };
      const skName = input.skill ?? input.command ?? `Skill ${i + 1}`;
      out.push({
        key: `sk_${i}`,
        label: `🔧 ${skName}`,
        cls: "sk",
        target: s.id ? { nodeNeedle: s.id } : undefined,
      });
    });

    if (det.subAgents.length > 0) {
      const sa = det.subAgents[0];
      out.push({
        key: "sa",
        label: "🤖 Sub-Agent",
        cls: "sa",
        target: sa.id ? { nodeNeedle: sa.id } : undefined,
      });
    }

    det.mcpTools.forEach((m, i) => {
      const parts = m.name.split("__");
      const toolName = parts.slice(2).join("__") || m.name;
      out.push({
        key: `mc_${i}`,
        label: `🔌 ${toolName}`,
        cls: "mc",
        target: m.id ? { nodeNeedle: m.id } : undefined,
      });
    });

    return out;
  }, [requestBody]);

  if (chips.length === 0) return null;

  const clickable = !!onJump;

  return (
    <div className="flex flex-wrap gap-1.5 px-3 py-2 border-b">
      {chips.map((c) => {
        const canJump = clickable && !!c.target;
        const active = activeKey === c.key;
        return (
          <span
            key={c.key}
            role={canJump ? "button" : undefined}
            tabIndex={canJump ? 0 : undefined}
            onClick={canJump ? () => onJump!(c.key, c.target!) : undefined}
            onKeyDown={
              canJump
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onJump!(c.key, c.target!);
                    }
                  }
                : undefined
            }
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-mono transition-colors",
              CHIP_STYLE[c.cls],
              canJump && "cursor-pointer hover:brightness-110",
              active && "ring-2 ring-offset-1 ring-current",
            )}
          >
            {c.label}
          </span>
        );
      })}
    </div>
  );
}
