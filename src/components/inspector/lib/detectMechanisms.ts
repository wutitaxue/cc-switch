/**
 * 机制解剖：从请求体检测用到了哪些 Claude Code 机制。
 * 规则 1:1 移植自 claude-inspector(public/index.html detectMechanisms)。
 */

export type MechanismKey = "cm" | "os" | "sc" | "sk" | "sa" | "mc";

export interface DetectedMechanisms {
  /** CLAUDE.md 注入内容（合并） */
  claudeMd: string | null;
  /** Output Style：system[] 块数（≥2 视为启用） */
  outputStyle: number | null;
  /** Output Style：除首块外的额外 system 块文本（用于解剖卡片显示）*/
  outputStyleExtras: string[];
  /** Slash 命令 */
  slashCommands: Array<{ name: string; tag: string; full?: string }>;
  /** Skill 调用 */
  skills: Array<{ id?: string; input?: unknown; result?: string }>;
  /** Sub-Agent 调用 */
  subAgents: Array<{ id?: string; name?: string; input?: unknown }>;
  /** MCP 工具调用 */
  mcpTools: Array<{
    id?: string;
    name: string;
    input?: unknown;
    result?: string;
  }>;
}

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  id?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
}

interface RequestBodyShape {
  system?: unknown;
  messages?: Array<{ role?: string; content?: unknown }>;
}

/** 把 content 规整为 block 数组（content 可能是字符串或数组） */
function toBlocks(content: unknown): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (Array.isArray(content)) return content as ContentBlock[];
  return [];
}

export function detectMechanisms(body: unknown): DetectedMechanisms {
  const found: DetectedMechanisms = {
    claudeMd: null,
    outputStyle: null,
    outputStyleExtras: [],
    slashCommands: [],
    skills: [],
    subAgents: [],
    mcpTools: [],
  };
  if (!body || typeof body !== "object") return found;
  const b = body as RequestBodyShape;

  // Output Style：system 是数组且 ≥2 块
  if (Array.isArray(b.system) && b.system.length >= 2) {
    found.outputStyle = b.system.length;
    found.outputStyleExtras = (b.system as ContentBlock[])
      .slice(1)
      .map((blk) => (typeof blk?.text === "string" ? blk.text : ""))
      .filter((s) => s.length > 0);
  }

  // 收集所有待扫描的文本块：system[] + 各 message 的 content blocks
  const textBlocks: ContentBlock[] = [];
  if (Array.isArray(b.system)) {
    textBlocks.push(...(b.system as ContentBlock[]));
  } else if (typeof b.system === "string") {
    textBlocks.push({ type: "text", text: b.system });
  }
  const toolBlocks: ContentBlock[] = [];
  const toolResults: ContentBlock[] = [];
  for (const msg of b.messages ?? []) {
    for (const c of toBlocks(msg.content)) {
      if (c.type === "tool_use") toolBlocks.push(c);
      if (c.type === "tool_result") toolResults.push(c);
      if (typeof c.text === "string") textBlocks.push(c);
    }
  }

  // 文本块里检测 CLAUDE.md 与 Slash 命令
  for (const c of textBlocks) {
    const text = c.text;
    if (typeof text !== "string") continue;

    // CLAUDE.md：<system-reminder> 内含 "Contents of"
    for (const m of text.matchAll(
      /<system-reminder>([\s\S]*?)<\/system-reminder>/g,
    )) {
      const inner = m[1].trim();
      if (/Contents of /i.test(inner)) {
        found.claudeMd = found.claudeMd
          ? `${found.claudeMd}\n\n${inner}`
          : inner;
      }
    }

    // Slash 命令：仅当该 text block 本身就是命令块时才解析。
    // 真正的注入里，命令标签是某个独立 content 块的开头（块 trim 后以
    // <command-name> 或 <command-message> 起始）；散文里 <command-message>
    // 是埋在大段正文中间的，块开头是普通文字 —— 据此结构位置排除误报
    // （文本内容启发式无法区分"逐字讨论标签"的散文，结构位置可以）。
    const isCommandBlock = /^\s*<command-(name|message)>/.test(text);
    if (isCommandBlock) {
      for (const cmdMatch of text.matchAll(
        /<command-message>([\s\S]*?)<\/command-message>/g,
      )) {
        const tag = cmdMatch[1].trim();
        const matchStart = cmdMatch.index ?? 0;
        const matchEnd = matchStart + cmdMatch[0].length;
        // <command-name> 可能在 <command-message> 之前或之后，取就近的一个
        const region = text.slice(
          Math.max(0, matchStart - 200),
          matchEnd + 200,
        );
        const nameMatch = region.match(
          /<command-name>\s*\/?(\S+?)\s*<\/command-name>/,
        );
        // 名称回退链（对齐 claude-inspector）：
        // <command-name> → "# /commit" → "commit is running…" → 裸词 tag → Cmd N
        let name: string;
        if (nameMatch) {
          name = nameMatch[1];
        } else {
          const fromTag =
            tag.match(/^#\s*\/(\S+)/)?.[1] ??
            tag.match(/^(\S+)\s+is running/)?.[1];
          name =
            fromTag ??
            (/^\w[\w-]*$/.test(tag)
              ? tag
              : `Cmd ${found.slashCommands.length + 1}`);
        }
        // full = 命令本身 + 紧随其后的 <command-args>/<local-command-stdout> 等围绕标签
        const fullEnd = (() => {
          const tail = text.slice(matchEnd);
          const close = tail.match(/<\/(local-command-stdout|command-args)>/);
          if (close && close.index !== undefined) {
            return matchEnd + close.index + close[0].length;
          }
          return matchEnd;
        })();
        const full = text.slice(matchStart, fullEnd).trim();
        found.slashCommands.push({ name, tag, full });
      }
    }
  }

  // 工具块里检测 Skill / Sub-Agent / MCP
  for (const c of toolBlocks) {
    const name = c.name ?? "";
    if (name === "Skill") {
      found.skills.push({ id: c.id, input: c.input });
    } else if (name === "Task" || name === "Agent") {
      found.subAgents.push({ id: c.id, name, input: c.input });
    } else if (name.startsWith("mcp__")) {
      found.mcpTools.push({ id: c.id, name, input: c.input });
    }
  }

  // 把 tool_result 关联回 skill / mcp（按 tool_use_id）
  for (const r of toolResults) {
    const useId = r.tool_use_id;
    if (!useId) continue;
    const resultText =
      typeof r.content === "string"
        ? r.content
        : JSON.stringify(r.content, null, 2);
    const sk = found.skills.find((s) => s.id === useId);
    if (sk) sk.result = resultText;
    const mc = found.mcpTools.find((m) => m.id === useId);
    if (mc) mc.result = resultText;
  }

  return found;
}

/** 机制对应的徽标元数据（颜色对齐 cc-switch 设计 token，用 Tailwind class） */
export const MECHANISM_META: Record<
  MechanismKey,
  { labelKey: string; className: string }
> = {
  cm: {
    labelKey: "inspector.mech.claudeMd",
    className: "border-green-500 text-green-600 dark:text-green-400",
  },
  os: {
    labelKey: "inspector.mech.outputStyle",
    className: "border-blue-500 text-blue-600 dark:text-blue-400",
  },
  sc: {
    labelKey: "inspector.mech.slash",
    className: "border-amber-500 text-amber-600 dark:text-amber-400",
  },
  sk: {
    labelKey: "inspector.mech.skill",
    className: "border-purple-500 text-purple-600 dark:text-purple-400",
  },
  sa: {
    labelKey: "inspector.mech.subAgent",
    className: "border-orange-500 text-orange-600 dark:text-orange-400",
  },
  mc: {
    labelKey: "inspector.mech.mcp",
    className: "border-cyan-500 text-cyan-600 dark:text-cyan-400",
  },
};

export type ClaudeMdSectionCls = "green" | "cyan";

export interface ClaudeMdSection {
  /** 显示用前缀，例如 "📋 Global CLAUDE.md" / "🧠 Memory: foo.md" */
  label: string;
  /** 完整路径 */
  path: string;
  /** 分段正文 */
  content: string;
  /** 颜色类（cc-switch 用 green / cyan 两档） */
  cls: ClaudeMdSectionCls;
  /** 作用域：global / local */
  scope: "global" | "local";
}

/**
 * 把 system-reminder 内的合并 CLAUDE.md 文本拆成多段。
 * 1:1 移植自 claude-inspector(public/index.html parseClaudeMdSections)。
 */
export function parseClaudeMdSections(inner: string): ClaudeMdSection[] {
  const re =
    /Contents of (.+?) \((.+?)\):\n\n([\s\S]*?)(?=\n\nContents of |\s*$)/g;
  const sections: ClaudeMdSection[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) {
    const path = m[1];
    const desc = m[2];
    const content = m[3].trim();
    const fname = path.split("/").pop() ?? path;
    const isGlobal = /global|private global/i.test(desc);
    const isMemory = /memory/i.test(desc) || /\/memory\//.test(path);
    let label: string;
    let cls: ClaudeMdSectionCls;
    if (isMemory) {
      label = `🧠 Memory: ${fname}`;
      cls = "green";
    } else if (/\/rules\//.test(path)) {
      label = `${isGlobal ? "📜 Global Rule: " : "📜 Local Rule: "}${fname}`;
      cls = isGlobal ? "green" : "cyan";
    } else if (/CLAUDE\.md$/i.test(path)) {
      label = isGlobal ? "📋 Global CLAUDE.md" : "📋 Local CLAUDE.md";
      cls = isGlobal ? "green" : "cyan";
    } else {
      label = `📋 ${fname}`;
      cls = "green";
    }
    sections.push({
      label,
      path,
      content,
      cls,
      scope: isGlobal ? "global" : "local",
    });
  }
  return sections;
}
