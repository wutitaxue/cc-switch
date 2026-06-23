import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * 跳转目标（chip 点击时由上层计算并传入）。对标 claude-inspector 的
 * highlightMechInJsonTree：定位到 JSON 树里的某个字符串节点，必要时展开长串，
 * 滚动过去并高亮命中行（或整节点）。
 */
export interface JumpTarget {
  /** 用于定位"哪个字符串节点"的子串 */
  nodeNeedle: string;
  /** 命中节点内"滚动到/高亮起始行"的子串；缺省则高亮整节点 */
  lineNeedle?: string;
  /** 若设置：从 lineNeedle 行起高亮至下一处含该子串的行（不含），用于 CLAUDE.md 分段 */
  sectionEndNeedle?: string;
  /** 每次点击自增，驱动重复点击也能再次跳转 */
  nonce: number;
}

interface JumpCtx {
  jump?: JumpTarget;
  /** 同一 nonce 只允许一个节点认领，避免多节点重复滚动 */
  claimRef: React.MutableRefObject<number>;
}

const JumpContext = createContext<JumpCtx | null>(null);

interface JsonTreeViewProps {
  data: unknown;
  /** 搜索词（命中文本高亮） */
  search?: string;
  /** 跳转目标 */
  jump?: JumpTarget;
}

const LONG_STRING = 300;
/** 每级缩进像素 */
const INDENT = 14;
/** 高亮保留时长（ms） */
const HL_DURATION = 2200;

/** 高亮命中片段 */
function Highlight({ text, search }: { text: string; search: string }) {
  if (!search) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = search.toLowerCase();
  const parts: Array<{ s: string; hit: boolean }> = [];
  let i = 0;
  while (i < text.length) {
    const idx = lower.indexOf(q, i);
    if (idx < 0) {
      parts.push({ s: text.slice(i), hit: false });
      break;
    }
    if (idx > i) parts.push({ s: text.slice(i, idx), hit: false });
    parts.push({ s: text.slice(idx, idx + q.length), hit: true });
    i = idx + q.length;
  }
  return (
    <>
      {parts.map((p, k) =>
        p.hit ? (
          <mark
            key={k}
            className="bg-amber-300/60 dark:bg-amber-500/40 rounded-sm"
          >
            {p.s}
          </mark>
        ) : (
          <span key={k}>{p.s}</span>
        ),
      )}
    </>
  );
}

/**
 * 固定左侧 gutter 的行号（对齐 claude-inspector）。
 * 绝对定位钉在容器最左侧，不随缩进右移；竖直方向落在所在行。
 */
function Ln({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="absolute left-0 w-9 text-right select-none text-[11px] text-muted-foreground/50 tabular-nums"
    >
      {n}
    </span>
  );
}

/**
 * 预计算每个节点的起始行号（DFS）。
 * 长字符串按展开后行数预占行号（与 claude-inspector 行为一致）。
 */
function assignLineNumbers(
  value: unknown,
  path: string,
  map: Map<string, number>,
  next: { n: number },
): void {
  next.n += 1;
  map.set(path, next.n);

  if (value === null || typeof value !== "object") {
    if (typeof value === "string" && value.length > LONG_STRING) {
      const extra = value.split("\n").length - 1;
      next.n += extra;
    }
    return;
  }
  const isArr = Array.isArray(value);
  const entries = isArr
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  for (const [k, v] of entries) {
    assignLineNumbers(v, `${path}/${k}`, map, next);
  }
}

/** 命中高亮的行 class */
const HL_LINE = "bg-amber-300/40 dark:bg-amber-500/30 rounded-sm";

/**
 * 字符串节点（长/短统一）。除渲染外，响应 JumpTarget：命中则展开长串、
 * 滚动到目标行并临时高亮。
 */
function StringNode({
  value,
  search,
  startLn,
}: {
  value: string;
  search: string;
  startLn: number;
}) {
  const isLong = value.length > LONG_STRING;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const ctx = useContext(JumpContext);
  const jump = ctx?.jump;
  // 命中高亮：长串记录行号集合，短串/整节点记录布尔
  const [hlLines, setHlLines] = useState<Set<number> | null>(null);
  const [hlWhole, setHlWhole] = useState(false);

  const matchesNode = !!jump && value.includes(jump.nodeNeedle);

  useEffect(() => {
    if (!jump || !ctx) return;
    if (!matchesNode) return;
    if (ctx.claimRef.current === jump.nonce) return;
    // 长串且未展开：先展开，effect 会因 open 变化重跑
    if (isLong && !open) {
      setOpen(true);
      return;
    }
    ctx.claimRef.current = jump.nonce;

    const lines = value.split("\n");
    let scrollLine = -1;
    if (isLong && jump.lineNeedle) {
      const start = lines.findIndex((l) => l.includes(jump.lineNeedle!));
      if (start >= 0) {
        const set = new Set<number>([start]);
        if (jump.sectionEndNeedle) {
          for (let i = start + 1; i < lines.length; i++) {
            if (lines[i].includes(jump.sectionEndNeedle)) break;
            set.add(i);
          }
        }
        setHlLines(set);
        scrollLine = start;
      }
    } else {
      setHlWhole(true);
    }

    const raf = requestAnimationFrame(() => {
      const target =
        scrollLine >= 0
          ? rootRef.current?.querySelector(`[data-jl="${scrollLine}"]`)
          : rootRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    const timer = window.setTimeout(() => {
      setHlLines(null);
      setHlWhole(false);
    }, HL_DURATION);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.nonce, open, matchesNode]);

  if (!isLong) {
    return (
      <span
        ref={rootRef}
        className={cn(
          "text-emerald-600 dark:text-emerald-400",
          hlWhole && HL_LINE,
        )}
      >
        "<Highlight text={value} search={search} />"
      </span>
    );
  }

  const preview = value.slice(0, 80).replace(/\n/g, " ");
  const lines = open ? value.split("\n") : null;
  return (
    <span ref={rootRef} className="text-emerald-600 dark:text-emerald-400">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center align-top text-muted-foreground hover:text-foreground"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {open && lines ? (
        <span className="inline-block whitespace-pre-wrap break-words align-top">
          {lines.map((line, i) => (
            <span
              key={i}
              data-jl={i}
              className={cn("block", hlLines?.has(i) && HL_LINE)}
            >
              {i > 0 && <Ln n={startLn + i} />}
              {i === 0 ? '"' : ""}
              <Highlight text={line} search={search} />
              {i === lines.length - 1 ? '"' : ""}
            </span>
          ))}
        </span>
      ) : (
        <span className={cn("text-muted-foreground", hlWhole && HL_LINE)}>
          "{<Highlight text={preview} search={search} />}…" ({value.length})
        </span>
      )}
    </span>
  );
}

function Node({
  k,
  value,
  depth,
  search,
  path,
  lnMap,
}: {
  k?: string;
  value: unknown;
  depth: number;
  search: string;
  path: string;
  lnMap: Map<string, number>;
}) {
  // 默认全展开（claude-inspector 行为）
  const [open, setOpen] = useState(true);
  const ln = lnMap.get(path) ?? 0;
  const indent = { paddingLeft: depth * INDENT } as const;
  const keyLabel = k !== undefined && (
    <span className="text-sky-600 dark:text-sky-400">"{k}"</span>
  );

  if (value === null) {
    return (
      <div className="block break-words" style={indent}>
        <Ln n={ln} />
        {keyLabel}
        {k !== undefined && <span className="text-muted-foreground">: </span>}
        <span className="text-muted-foreground">null</span>
      </div>
    );
  }

  if (typeof value === "string") {
    return (
      <div className="block break-words" style={indent}>
        <Ln n={ln} />
        {keyLabel}
        {k !== undefined && <span className="text-muted-foreground">: </span>}
        <StringNode value={value} search={search} startLn={ln} />
      </div>
    );
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return (
      <div className="block" style={indent}>
        <Ln n={ln} />
        {keyLabel}
        {k !== undefined && <span className="text-muted-foreground">: </span>}
        <span className="text-amber-600 dark:text-amber-400">
          {String(value)}
        </span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const bracket = isArray ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div className="block" style={indent}>
      <div className="block">
        <Ln n={ln} />
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1 align-top text-muted-foreground hover:text-foreground"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          {keyLabel}
          {k !== undefined && <span>: </span>}
          <span className="text-muted-foreground">{bracket}</span>
        </button>
      </div>
      {open &&
        entries.map(([ck, cv]) => (
          <Node
            key={ck}
            k={ck}
            value={cv}
            depth={depth + 1}
            search={search}
            path={`${path}/${ck}`}
            lnMap={lnMap}
          />
        ))}
    </div>
  );
}

export function JsonTreeView({ data, search = "", jump }: JsonTreeViewProps) {
  const parsed = useMemo(() => {
    if (typeof data === "string") {
      try {
        return JSON.parse(data);
      } catch {
        return data;
      }
    }
    return data;
  }, [data]);

  const lnMap = useMemo(() => {
    const map = new Map<string, number>();
    assignLineNumbers(parsed, "", map, { n: 0 });
    return map;
  }, [parsed]);

  const claimRef = useRef(-1);
  const ctx = useMemo<JumpCtx>(() => ({ jump, claimRef }), [jump]);

  return (
    <JumpContext.Provider value={ctx}>
      <div className={cn("relative pl-11 font-mono text-xs leading-relaxed")}>
        <Node value={parsed} depth={0} search={search} path="" lnMap={lnMap} />
      </div>
    </JumpContext.Provider>
  );
}
