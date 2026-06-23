import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  detectMechanisms,
  parseClaudeMdSections,
} from "./lib/detectMechanisms";
import { JsonTreeView } from "./JsonTreeView";

interface AnatomyViewProps {
  requestBody: unknown;
}

/** 分段卡片左边框颜色（对齐 inspector：CLAUDE.md/global=绿、local=蓝、Output Style=蓝、Slash=黄、Skill=紫、Sub-Agent=橙、MCP=青） */
const HL = {
  green: "border-l-emerald-500/60 bg-emerald-500/[0.06]",
  blue: "border-l-sky-500/60 bg-sky-500/[0.06]",
  yellow: "border-l-yellow-500/60 bg-yellow-500/[0.06]",
  purple: "border-l-purple-500/60 bg-purple-500/[0.06]",
  orange: "border-l-orange-500/60 bg-orange-500/[0.06]",
  cyan: "border-l-cyan-500/60 bg-cyan-500/[0.06]",
} as const;

const TITLE = {
  green: "text-emerald-600 dark:text-emerald-400",
  blue: "text-sky-600 dark:text-sky-400",
  yellow: "text-yellow-600 dark:text-yellow-400",
  purple: "text-purple-600 dark:text-purple-400",
  orange: "text-orange-600 dark:text-orange-400",
  cyan: "text-cyan-600 dark:text-cyan-400",
} as const;

type HlColor = keyof typeof HL;

function Block({
  color,
  children,
  mono = true,
}: {
  color: HlColor;
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div
      className={`mt-1 rounded-md border-l-[3px] px-3 py-2 text-xs whitespace-pre-wrap break-words ${HL[color]} ${mono ? "font-mono" : ""}`}
    >
      {children}
    </div>
  );
}

function Section({
  color,
  title,
  desc,
  children,
}: {
  color: HlColor;
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4">
      <div className={`text-xs font-bold tracking-wide ${TITLE[color]}`}>
        {title.toUpperCase()}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{desc}</div>
      <div className="mt-2">{children}</div>
    </div>
  );
}

function KV({ k, v }: { k: string; v: string | undefined }) {
  if (!v) return null;
  return (
    <div className="text-[11px] font-mono text-muted-foreground">
      <span className="opacity-70">{k}:</span> <span>{v}</span>
    </div>
  );
}

export function AnatomyView({ requestBody }: AnatomyViewProps) {
  const { t } = useTranslation();
  const det = useMemo(() => detectMechanisms(requestBody), [requestBody]);
  const model = useMemo(() => {
    if (!requestBody || typeof requestBody !== "object") return null;
    const m = (requestBody as { model?: unknown }).model;
    return typeof m === "string" ? m : null;
  }, [requestBody]);

  const hasAny =
    det.claudeMd ||
    det.outputStyle ||
    det.slashCommands.length > 0 ||
    det.skills.length > 0 ||
    det.subAgents.length > 0 ||
    det.mcpTools.length > 0;

  if (!hasAny) {
    return (
      <div className="py-10 text-center text-sm text-muted-foreground">
        {t("inspector.anatomy.empty", { defaultValue: "未检测到特殊机制" })}
      </div>
    );
  }

  const slashSkillLinked =
    det.slashCommands.length > 0 && det.skills.length > 0;

  return (
    <div className="p-3">
      {model && (
        <div className="mb-4 text-xs font-mono text-muted-foreground">
          <span className="opacity-70">model</span> {model}
        </div>
      )}

      {/* CLAUDE.md */}
      {det.claudeMd &&
        (() => {
          const sections = parseClaudeMdSections(det.claudeMd);
          return (
            <Section
              color="green"
              title={t("inspector.anatomy.claudeMdTitle", {
                defaultValue: "CLAUDE.md — system-reminder injection",
              })}
              desc={t("inspector.anatomy.claudeMdDesc", {
                defaultValue:
                  "Claude Code 把项目/全局 CLAUDE.md 内容包在 <system-reminder> 标签里注入到 messages[]",
              })}
            >
              {sections.length > 0 ? (
                sections.map((s, i) => (
                  <div key={i} className="mb-3">
                    <div
                      className={`text-[11px] font-bold ${
                        s.scope === "global" ? TITLE.green : TITLE.blue
                      }`}
                    >
                      {s.label}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground break-all">
                      {s.path}
                    </div>
                    <Block color={s.scope === "global" ? "green" : "blue"}>
                      {s.content}
                    </Block>
                  </div>
                ))
              ) : (
                <Block color="green">{det.claudeMd}</Block>
              )}
            </Section>
          );
        })()}

      {/* Output Style */}
      {det.outputStyle && det.outputStyleExtras.length > 0 && (
        <Section
          color="blue"
          title={t("inspector.anatomy.outputStyleTitle", {
            defaultValue: "Output Style — system[] extra block",
          })}
          desc={t("inspector.anatomy.outputStyleDesc", {
            defaultValue:
              "Claude Code 在 system 数组里加了额外的块（控制模型回复风格）",
          })}
        >
          <Block color="blue">
            {det.outputStyleExtras.join("\n\n---\n\n")}
          </Block>
        </Section>
      )}

      {/* Slash Commands */}
      {det.slashCommands.map((cmd, i) => (
        <Section
          key={`sc_${i}`}
          color="yellow"
          title={t("inspector.anatomy.slashTitle", {
            defaultValue: "① Input — Slash Command",
          })}
          desc={t("inspector.anatomy.slashDesc", {
            cmd: cmd.name,
            defaultValue: `用户输入 /${cmd.name} 时，Claude Code 用 <command-message> 标签包裹后注入提示`,
          })}
        >
          <Block color="yellow">{cmd.full ?? cmd.tag}</Block>
        </Section>
      ))}

      {/* Skills */}
      {det.skills.map((sk, i) => (
        <Section
          key={`sk_${i}`}
          color="purple"
          title={t(
            slashSkillLinked
              ? "inspector.anatomy.skillLinkedTitle"
              : "inspector.anatomy.skillTitle",
            {
              defaultValue: slashSkillLinked
                ? "② Execute — Skill (tool_use → tool_result)"
                : "Skill (tool_use → tool_result)",
            },
          )}
          desc={t(
            slashSkillLinked
              ? "inspector.anatomy.skillLinkedDesc"
              : "inspector.anatomy.skillDesc",
            {
              defaultValue: slashSkillLinked
                ? "Claude 读取上面的斜杠命令，通过 tool_use 调用对应 Skill"
                : "Claude 通过 tool_use 调用 Skill 并通过 tool_result 接收结果",
            },
          )}
        >
          <KV k="id" v={sk.id} />
          {sk.input != null && (
            <div
              className={`mt-1 rounded-md border-l-[3px] px-3 py-2 ${HL.purple}`}
            >
              <JsonTreeView data={sk.input} />
            </div>
          )}
          {sk.result ? (
            <>
              <div className="mt-2 text-[11px] font-mono text-muted-foreground opacity-70">
                result (tool_result)
              </div>
              <Block color="purple">{sk.result}</Block>
            </>
          ) : (
            <div className="mt-2 text-[11px] text-muted-foreground/70">
              {t("inspector.anatomy.noToolResult", {
                defaultValue: "无 tool_result（在下条消息或尚未返回）",
              })}
            </div>
          )}
        </Section>
      ))}

      {/* Sub-Agents */}
      {det.subAgents.map((sa, i) => {
        const input =
          sa.input && typeof sa.input === "object"
            ? (sa.input as Record<string, unknown>)
            : null;
        const subType =
          (input?.subagent_type as string | undefined) ??
          (input?.type as string | undefined);
        const isJson = input != null;
        return (
          <Section
            key={`sa_${i}`}
            color="orange"
            title={`${sa.name ?? "Task"} — Sub-Agent`}
            desc={t("inspector.anatomy.subAgentDesc", {
              defaultValue:
                "Claude 通过 Task 工具创建独立子代理 API 请求（运行在隔离的上下文中）",
            })}
          >
            <KV k="subagent_type" v={subType} />
            {isJson ? (
              <div
                className={`mt-1 rounded-md border-l-[3px] px-3 py-2 ${HL.orange}`}
              >
                <JsonTreeView data={input} />
              </div>
            ) : (
              <Block color="orange">
                {String((sa.input as { prompt?: string })?.prompt ?? "")}
              </Block>
            )}
          </Section>
        );
      })}

      {/* MCP Tools */}
      {det.mcpTools.map((mc, i) => {
        const parts = mc.name.split("__");
        const serverName = parts[1] ?? "?";
        const toolName = parts.slice(2).join("__") || mc.name;
        const isJson = mc.input != null && typeof mc.input === "object";
        return (
          <Section
            key={`mc_${i}`}
            color="cyan"
            title={`🔌 ${toolName}  (${serverName})`}
            desc={t("inspector.anatomy.mcpDesc", {
              defaultValue: "通过 tool_use 调用 Model Context Protocol 工具",
            })}
          >
            <KV k="id" v={mc.id} />
            {isJson ? (
              <div
                className={`mt-1 rounded-md border-l-[3px] px-3 py-2 ${HL.cyan}`}
              >
                <JsonTreeView data={mc.input} />
              </div>
            ) : (
              <Block color="cyan">{JSON.stringify(mc.input, null, 2)}</Block>
            )}
            {mc.result && (
              <>
                <div className="mt-2 text-[11px] font-mono text-muted-foreground opacity-70">
                  result (tool_result)
                </div>
                <Block color="cyan">{mc.result}</Block>
              </>
            )}
          </Section>
        );
      })}
    </div>
  );
}
