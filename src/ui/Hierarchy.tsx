import { useStore, ICON_ID } from "../state/store";
import {
  addLayer,
  addGroup,
  toggleHidden,
  renameMember,
} from "../model/document";
import { Group, Layer, IconDocument } from "../model/types";
import { useRef, useState } from "react";
import { Folder, FolderPlus, Plus, Minus, Eye, EyeOff } from "lucide-react";
import type { ChromePlatform } from "./WindowChrome";

const FolderIcon = ({ light }: { light?: boolean }) => (
  <Folder
    size={15}
    strokeWidth={2}
    className={`shrink-0 ${light ? "text-white" : "text-[#5aa0ff]"}`}
    fill="currentColor"
    fillOpacity={0.18}
  />
);
const AppIcon = ({ light }: { light?: boolean }) => (
  <div
    className={`w-[15px] h-[15px] rounded-[4px] shrink-0 ${light ? "bg-white/90" : "bg-gradient-to-br from-sky-400 to-blue-600"}`}
  />
);
const CHECKER = "repeating-conic-gradient(#d1d5db 0% 25%, #f8fafc 0% 50%) 0 / 8px 8px";
const Thumb = ({ src }: { src?: string }) => (
  <div
    className="w-[18px] h-[18px] rounded-[4px] shrink-0 overflow-hidden border border-[color:var(--line)]"
    style={{ background: CHECKER }}
  >
    {src && (
      <img
        src={src}
        className="w-full h-full object-contain"
        draggable={false}
      />
    )}
  </div>
);

type DragState = {
  dragId: number | null;
  over: { id: number; before: boolean } | null;
  start: (id: number, e: React.PointerEvent<HTMLDivElement>) => void;
  isClickSuppressed: () => boolean;
};
type Upd = (fn: (d: IconDocument) => IconDocument) => void;

// Top-level (stable) so rows are not remounted while pointer-based reorder is active.
function TreeRow(props: {
  id: number;
  name: string;
  depth: number;
  icon: React.ReactNode;
  visible?: boolean;
  dnd?: boolean;
  selectedId: number;
  select: (id: number) => void;
  update: Upd;
  drag: DragState;
}) {
  const {
    id,
    name,
    depth,
    icon,
    visible,
    dnd,
    selectedId,
    select,
    update,
    drag,
  } = props;
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(name);
  const sel = selectedId === id;
  const commit = () => {
    setEditing(false);
    update((d) => renameMember(d, id, text));
  };
  const showLine = !!dnd && drag.over?.id === id && drag.dragId !== id;
  return (
    <div
      draggable={false}
      data-hierarchy-row-id={id}
      data-hierarchy-dnd={dnd ? "true" : "false"}
      onPointerDown={(e) => {
        if (!dnd || editing || e.button !== 0) return;
        if (e.target instanceof Element && e.target.closest("button,input")) return;
        drag.start(id, e);
      }}
      onClick={(e) => {
        if (drag.isClickSuppressed()) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        select(id);
      }}
      onDoubleClick={() => {
        setText(name);
        setEditing(true);
      }}
      className={`group relative flex items-center h-[26px] rounded-[7px] ${dnd ? "cursor-grab active:cursor-grabbing" : "cursor-default"} ${sel ? "bg-accent text-white" : "hover:bg-[color:var(--hover)] text-[color:var(--tx)]"} ${drag.dragId === id ? "opacity-40" : ""}`}
      style={{ paddingLeft: 8 + depth * 17, touchAction: dnd ? "none" : undefined }}
    >
      {showLine && (
        <span
          className={`absolute left-2 right-2 h-[2px] bg-accent rounded-full ${drag.over!.before ? "-top-px" : "-bottom-px"}`}
        />
      )}
      <span className="mr-1.5 flex items-center">{icon}</span>
      {editing ? (
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") setEditing(false);
          }}
          className="flex-1 min-w-0 bg-[color:var(--popover)] text-[color:var(--tx)] rounded px-1 mr-1 text-[13px] outline-none"
        />
      ) : (
        <span className="flex-1 truncate text-[13px]">{name}</span>
      )}
      {visible != null && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            update((d) => toggleHidden(d, id));
          }}
          className={`mr-2 opacity-0 group-hover:opacity-100 ${visible ? "" : "opacity-100"} ${sel ? "text-white/80" : "text-[color:var(--tx-3)]"}`}
        >
          {visible ? <Eye size={14} /> : <EyeOff size={14} />}
        </button>
      )}
    </div>
  );
}

export function Hierarchy({ chromePlatform }: { chromePlatform: ChromePlatform }) {
  const doc = useStore((s) => s.doc);
  const selectedId = useStore((s) => s.selectedId);
  const select = useStore((s) => s.select);
  const update = useStore((s) => s.update);
  const deleteSelected = useStore((s) => s.deleteSelected);
  const reorder = useStore((s) => s.reorder);
  const layerThumbs = useStore((s) => s.layerThumbs);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ id: number; before: boolean } | null>(
    null,
  );
  const overRef = useRef<{ id: number; before: boolean } | null>(null);
  const suppressClickUntil = useRef(0);
  const setDropTarget = (o: { id: number; before: boolean } | null) => {
    overRef.current = o;
    setOver(o);
  };
  const startPointerDrag = (id: number, e: React.PointerEvent<HTMLDivElement>) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const pointerId = e.pointerId;
    let active = false;

    const updateTarget = (clientX: number, clientY: number) => {
      const el = document
        .elementFromPoint(clientX, clientY)
        ?.closest<HTMLElement>("[data-hierarchy-row-id][data-hierarchy-dnd='true']");
      if (!el) {
        setDropTarget(null);
        return;
      }
      const targetId = Number(el.dataset.hierarchyRowId);
      if (!Number.isFinite(targetId) || targetId === id) {
        setDropTarget(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setDropTarget({ id: targetId, before: clientY < r.top + r.height / 2 });
    };

    const finish = (commit: boolean) => {
      document.removeEventListener("pointermove", onMove, true);
      document.removeEventListener("pointerup", onUp, true);
      document.removeEventListener("pointercancel", onCancel, true);
      if (active && commit) {
        const drop = overRef.current;
        if (drop && drop.id !== id) reorder(id, drop.id, drop.before);
        suppressClickUntil.current = Date.now() + 250;
      }
      setDragId(null);
      setDropTarget(null);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!active && Math.hypot(dx, dy) < 4) return;
      if (!active) {
        active = true;
        setDragId(id);
      }
      ev.preventDefault();
      updateTarget(ev.clientX, ev.clientY);
    };

    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      if (active) ev.preventDefault();
      finish(true);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      finish(false);
    };

    document.addEventListener("pointermove", onMove, true);
    document.addEventListener("pointerup", onUp, true);
    document.addEventListener("pointercancel", onCancel, true);
  };
  const drag: DragState = {
    dragId,
    over,
    start: startPointerDrag,
    isClickSuppressed: () => Date.now() < suppressClickUntil.current,
  };
  const common = { selectedId, select, update, drag };
  const isMac = chromePlatform === "mac";

  return (
    <div
      className="relative z-10 w-[230px] shrink-0 border-r
      border-[color:var(--line)] flex flex-col panel-surface"
    >
      {isMac && <div className="h-11 shrink-0" data-tauri-drag-region />}
      <div className="flex-1 overflow-y-auto px-2 pt-2.5">
        <TreeRow
          id={ICON_ID}
          name={doc.name}
          depth={0}
          icon={<AppIcon light={selectedId === ICON_ID} />}
          {...common}
        />
        {doc.composition.groups.map((g: Group) => (
          <div key={g.id}>
            <TreeRow
              id={g.id}
              name={g.name}
              depth={1}
              icon={<FolderIcon light={selectedId === g.id} />}
              visible={!g.isHidden}
              dnd
              {...common}
            />
            {g.layers.map((l: Layer) => (
              <TreeRow
                key={l.id}
                id={l.id}
                name={l.name}
                depth={2}
                icon={<Thumb src={layerThumbs[l.id]} />}
                visible={!l.isHidden}
                dnd
                {...common}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="h-11 border-t border-[color:var(--line)] flex items-center px-2 gap-0.5">
        <button
          aria-label="Add part"
          data-tooltip="Add part"
          data-tooltip-placement="top"
          onClick={() => update(addLayer)}
          className="w-7 h-7 rounded-md hover:bg-[color:var(--hover)] text-[color:var(--tx-2)]
          flex items-center justify-center"
        >
          <Plus size={16} />
        </button>
        <button
          aria-label="Delete"
          data-tooltip="Delete"
          data-tooltip-placement="top"
          disabled={selectedId === ICON_ID}
          onClick={deleteSelected}
          className="w-7 h-7 rounded-md hover:bg-[color:var(--hover)] text-[color:var(--tx-2)]
          flex items-center justify-center disabled:opacity-30"
        >
          <Minus size={16} />
        </button>
        <div className="flex-1" />
        <button
          aria-label="Add group"
          data-tooltip="Add group"
          data-tooltip-placement="top"
          onClick={() => update(addGroup)}
          className="w-7 h-7 rounded-md hover:bg-[color:var(--hover)] text-[color:var(--tx-2)]
          flex items-center justify-center"
        >
          <FolderPlus size={15} />
        </button>
      </div>
    </div>
  );
}
