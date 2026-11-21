import { fmt } from "../api";
import type { DirNode } from "../../shared/types";

interface Rect { x: number; y: number; w: number; h: number; node: DirNode }

/** Squarified treemap: lays out children as near-square tiles sized by bytes. */
function layout(nodes: DirNode[], x: number, y: number, w: number, h: number): Rect[] {
  const total = nodes.reduce((a, n) => a + n.bytes, 0);
  if (!total || w <= 0 || h <= 0) return [];
  const items = nodes.map((n) => ({ n, a: (n.bytes / total) * w * h }));
  const out: Rect[] = [];
  let row: typeof items = [];
  let rx = x, ry = y, rw = w, rh = h;
  const worst = (r: typeof items, side: number) => {
    const s = r.reduce((a, i) => a + i.a, 0);
    const max = Math.max(...r.map((i) => i.a));
    const min = Math.min(...r.map((i) => i.a));
    return Math.max((side * side * max) / (s * s), (s * s) / (side * side * min));
  };
  const flush = () => {
    const s = row.reduce((a, i) => a + i.a, 0);
    if (rw >= rh) {
      const cw = s / rh;
      let cy = ry;
      for (const i of row) {
        const ch = i.a / cw;
        out.push({ x: rx, y: cy, w: cw, h: ch, node: i.n });
        cy += ch;
      }
      rx += cw;
      rw -= cw;
    } else {
      const ch = s / rw;
      let cx = rx;
      for (const i of row) {
        const cw = i.a / ch;
        out.push({ x: cx, y: ry, w: cw, h: ch, node: i.n });
        cx += cw;
      }
      ry += ch;
      rh -= ch;
    }
    row = [];
  };
  for (const it of items) {
    const side = Math.min(rw, rh);
    if (!row.length || worst([...row, it], side) <= worst(row, side)) row.push(it);
    else {
      flush();
      row.push(it);
    }
  }
  if (row.length) flush();
  return out;
}

export function Treemap({ node, onOpen }: { node: DirNode; onOpen: (n: DirNode) => void }) {
  const kids = (node.children ?? []).filter((c) => c.bytes > 0);
  const W = 1000, H = 420;
  const rects = layout(kids, 0, 0, W, H);
  const max = kids[0]?.bytes ?? 1;
  return (
    <div className="treemap" role="list" aria-label={`Folders in ${node.path}`}>
      {rects.map((r) => {
        const share = r.node.bytes / max;
        const big = r.w > 56 && r.h > 30;
        return (
          <button
            key={r.node.path}
            role="listitem"
            className="tile"
            title={`${r.node.path}\n${fmt.bytes(r.node.bytes)} · ${r.node.files.toLocaleString()} files`}
            style={{ left: `${(r.x / W) * 100}%`, top: `${(r.y / H) * 100}%`, width: `${(r.w / W) * 100}%`, height: `${(r.h / H) * 100}%`, background: `color-mix(in srgb, var(--cpu) ${Math.round(18 + share * 52)}%, var(--panel))` }}
            onClick={() => r.node.children?.length && onOpen(r.node)}
            disabled={!r.node.children?.length}
          >
            {big && (
              <>
                <b>{r.node.name}</b>
                <span>{fmt.bytes(r.node.bytes)}</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}
