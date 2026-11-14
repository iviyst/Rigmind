import { ReactNode, useEffect, useState } from "react";

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </label>
  );
}

export function Setting({ title, desc, children }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <div className="setting">
      <div>
        <h3>{title}</h3>
        {desc && <p>{desc}</p>}
      </div>
      {children}
    </div>
  );
}

/** Tiny markdown renderer for assistant replies: headings, lists, bold, italics, code. */
export function Markdown({ text }: { text: string }) {
  const inline = (s: string, k: string | number): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*|`[^`]+`|_[^_]+_)/g).map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) return <strong key={`${k}-${i}`}>{part.slice(2, -2)}</strong>;
      if (part.startsWith("`") && part.endsWith("`")) return <code key={`${k}-${i}`}>{part.slice(1, -1)}</code>;
      if (part.startsWith("_") && part.endsWith("_") && part.length > 2) return <em key={`${k}-${i}`}>{part.slice(1, -1)}</em>;
      return part;
    });
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const items = list.items.map((it, i) => <li key={i}>{inline(it, i)}</li>);
    blocks.push(list.ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const ul = line.match(/^\s*[-*]\s+(.*)/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)/);
    if (ul || ol) {
      const ordered = !!ol;
      if (!list || list.ordered !== ordered) {
        flush();
        list = { ordered, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    flush();
    if (!line.trim()) continue;
    const h = line.match(/^#{1,6}\s+(.*)/);
    if (h) blocks.push(<h4 key={blocks.length}>{inline(h[1], blocks.length)}</h4>);
    else blocks.push(<p key={blocks.length}>{inline(line, blocks.length)}</p>);
  }
  flush();
  return <div className="md">{blocks}</div>;
}

export function Thinking() {
  return (
    <span className="thinking" aria-label="Working">
      <i />
      <i />
      <i />
    </span>
  );
}

let pushToast: ((m: string) => void) | null = null;
export const toast = (m: string) => pushToast?.(m);
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    pushToast = (m) => {
      setMsg(m);
      clearTimeout(t);
      t = setTimeout(() => setMsg(null), 3500);
    };
    return () => {
      pushToast = null;
    };
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}
