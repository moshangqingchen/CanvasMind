"use client";

import { memo, useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { ArrowUpRight, Check, ChevronDown, CircleAlert } from "lucide-react";
import { activeIslandStatuses, failedIslandStatuses, islandElapsed, islandTaskLabels, islandTaskTransition, type IslandSaveState, type IslandTask } from "../lib/dynamic-island";
import styles from "./dynamic-island.module.css";

const saveLabels: Record<IslandSaveState, string> = {
  saved: "已保存", pending: "待保存", saving: "保存中…", error: "保存失败 · 查看", conflict: "保存冲突 · 查看",
};

/** Its clock and transient feedback stay local: elapsed time never rerenders the canvas. */
export const DynamicIsland = memo(function DynamicIsland({ tasks, ready, saveState, submitting, onTask, onTaskCenter, onSaveIssue }: {
  tasks: readonly IslandTask[];
  ready: boolean;
  saveState: IslandSaveState;
  submitting: boolean;
  onTask: (task: IslandTask) => void;
  onTaskCenter: () => void;
  onSaveIssue: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [visible, setVisible] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const manual = useRef(false);
  const previous = useRef(tasks);
  const initialized = useRef(false);
  const autoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const completedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const contentId = useId();
  const active = tasks.filter(task => activeIslandStatuses.has(task.status));
  const failed = tasks.filter(task => failedIslandStatuses.has(task.status));
  const displayTasks = [...active, ...failed];
  const running = active.length > 0 || submitting;
  const saveIssue = saveState === "error" || saveState === "conflict";
  const status = saveIssue ? "save-error" : running ? "running" : failed.length ? "failed" : completed ? "complete" : saveState === "saved" ? "saved" : "saving";
  const summary = saveIssue ? saveLabels[saveState] : running ? active.length ? `${active.length} 个任务生成中` : "任务提交中…" : failed.length ? `${failed.length} 个任务失败 · 查看` : completed ? "已完成" : saveLabels[saveState];
  const elapsed = running ? islandElapsed(active, now) : undefined;

  useEffect(() => {
    const changed = () => setVisible(!document.hidden);
    changed();
    document.addEventListener("visibilitychange", changed);
    return () => document.removeEventListener("visibilitychange", changed);
  }, []);
  useEffect(() => {
    if (!running || !visible) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, visible]);
  useEffect(() => {
    if (!ready) {
      initialized.current = false;
      previous.current = tasks;
      return;
    }
    // Loading an existing canvas is not a new task-start event.
    if (!initialized.current) {
      initialized.current = true;
      previous.current = tasks;
      return;
    }
    const transition = islandTaskTransition(previous.current, tasks);
    previous.current = tasks;
    if (!transition.started && !transition.completed) return;
    if (transition.completed) {
      clearTimeout(completedTimer.current);
      // Status transitions are external task events; this is bounded feedback, not derived canvas state.
      setCompleted(true);
      completedTimer.current = setTimeout(() => setCompleted(false), 2000);
    }
    if (!manual.current && !document.hidden) {
      clearTimeout(autoTimer.current);
      setOpen(true);
      autoTimer.current = setTimeout(() => {
        if (manual.current) return;
        // Keyboard users may enter an automatically opened task list. Never
        // hide the control they are operating when its feedback timeout ends.
        if (root.current?.contains(document.activeElement)) { manual.current = true; return; }
        setOpen(false);
      }, 1500);
    }
  }, [tasks, ready]);
  useEffect(() => () => { clearTimeout(autoTimer.current); clearTimeout(completedTimer.current); }, []);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        manual.current = false; clearTimeout(autoTimer.current); setOpen(false);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
      if ([...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]')].some(dialog => dialog.getClientRects().length)) return;
      event.preventDefault(); event.stopPropagation();
      manual.current = false; clearTimeout(autoTimer.current); setOpen(false);
      trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape, true); };
  }, [open]);
  const close = () => {
    manual.current = false; clearTimeout(autoTimer.current); setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  };
  return <div ref={root} className={styles.island} data-dynamic-island data-canvas-island="command" data-open={open} data-status={status} data-paused={!visible} style={{ "--island-expanded-height": `${Math.min(320, 84 + (displayTasks.length ? Math.min(displayTasks.length, 4) * 46 : 36) + (saveIssue ? 30 : 0))}px` } as CSSProperties}>
    <button ref={trigger} className={styles.summary} type="button" aria-label={`任务与保存状态：${summary}`} title="任务与保存状态 · 点击展开" aria-expanded={open} aria-controls={contentId} onClick={() => {
      clearTimeout(autoTimer.current);
      manual.current = !open; setOpen(!open);
    }}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.summaryText}>{summary}{completed && status === "complete" ? <Check size={14} aria-hidden="true" /> : null}</span>
      {elapsed ? <span className={styles.elapsed} aria-hidden="true">{elapsed}</span> : null}
      <ChevronDown className={styles.chevron} size={14} aria-hidden="true" />
    </button>
    <span className={styles.live} role="status" aria-live="polite" aria-atomic="true">{summary}</span>
    <div id={contentId} className={styles.content} hidden={!open}>
      {saveIssue ? <button className={styles.issue} type="button" onClick={() => { close(); onSaveIssue(); }}><CircleAlert size={14} />{saveState === "conflict" ? "处理保存冲突" : "重试保存"}<ArrowUpRight size={13} /></button> : null}
      {displayTasks.length ? <ul className={styles.tasks} aria-label="画布任务">{displayTasks.map(task => <li key={task.id}>
        <button type="button" className={styles.task} data-task-status={task.status} onClick={() => { close(); onTask(task); }} title={`${task.title} · ${islandTaskLabels[task.status] ?? task.status} · 定位节点`}>
          <span className={styles.taskName}>{task.title}</span><span className={styles.taskState}>{islandTaskLabels[task.status] ?? task.status}</span>
          {activeIslandStatuses.has(task.status) ? <span className={styles.progress} role="progressbar" aria-label={`${task.title}，${islandTaskLabels[task.status] ?? "进行中"}`}><i /></span> : null}
        </button>
      </li>)}</ul> : <p className={styles.empty}>{completed ? "这一轮创作已完成" : submitting ? "正在提交，请稍候" : saveIssue ? "修改仍保留在当前画布中" : "画布已就绪，开始下一次创作吧"}</p>}
      <button className={styles.centerLink} type="button" onClick={() => { close(); onTaskCenter(); }}>打开任务中心<ArrowUpRight size={12} /></button>
    </div>
  </div>;
});
