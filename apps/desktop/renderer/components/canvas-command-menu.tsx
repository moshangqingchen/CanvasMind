"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Command, CornerDownLeft, Search, Sparkles, X } from "lucide-react";
import { useDialogFocus } from "./use-dialog-focus";
import styles from "./canvas-command-menu.module.css";

export interface CanvasCommand {
  id: string;
  label: string;
  description?: string;
  shortcut?: string;
  group?: string;
  icon?: ReactNode;
  onSelect: () => void;
}

export interface CanvasCommandMenuProps {
  open: boolean;
  onClose: () => void;
  commands: CanvasCommand[];
}

function searchText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN");
}

function CommandMenuDialog({ onClose, commands }: Omit<CanvasCommandMenuProps, "open">) {
  const dialogRef = useDialogFocus(true, onClose);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const menuId = useId();
  const titleId = `${menuId}-title`;
  const listId = `${menuId}-list`;
  const hintId = `${menuId}-hint`;

  const groups = useMemo(() => {
    const tokens = searchText(query).trim().split(/\s+/).filter(Boolean);
    const grouped = new Map<string, CanvasCommand[]>();
    for (const command of commands) {
      const searchable = searchText([command.label, command.description, command.group].filter(Boolean).join(" "));
      if (!tokens.every(token => searchable.includes(token))) continue;
      const label = command.group?.trim() || "常用操作";
      const group = grouped.get(label);
      if (group) group.push(command);
      else grouped.set(label, [command]);
    }
    const result: Array<{ label: string; items: CanvasCommand[]; offset: number }> = [];
    let offset = 0;
    for (const [label, items] of grouped) {
      result.push({ label, items, offset });
      offset += items.length;
    }
    return result;
  }, [commands, query]);
  const visibleCommands = useMemo(() => groups.flatMap(group => group.items), [groups]);
  const selectedIndex = Math.min(activeIndex, visibleCommands.length - 1);

  useEffect(() => {
    optionRefs.current[selectedIndex]?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
  }, [selectedIndex, visibleCommands]);

  function selectCommand(command: CanvasCommand) {
    onClose();
    command.onSelect();
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (visibleCommands.length === 0) return;
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((selectedIndex + direction + visibleCommands.length) % visibleCommands.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const command = visibleCommands[selectedIndex];
      if (command) selectCommand(command);
    }
  }

  return (
    <div className={styles.backdrop} onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <section
        ref={dialogRef}
        className={styles.dialog}
        data-canvas-command-menu
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={event => event.stopPropagation()}
      >
        <header className={styles.header}>
          <div className={styles.title} id={titleId}><Command size={14} aria-hidden="true" />快捷操作</div>
          <span className={styles.headerNote}>让想法快一步</span>
        </header>
        <div className={styles.searchRow}>
          <Search className={styles.searchIcon} size={21} aria-hidden="true" />
          <input
            className={styles.searchInput}
            type="text"
            role="combobox"
            aria-label="搜索画布操作"
            aria-controls={listId}
            aria-expanded="true"
            aria-autocomplete="list"
            aria-activedescendant={selectedIndex >= 0 ? `${menuId}-option-${selectedIndex}` : undefined}
            aria-describedby={hintId}
            placeholder="搜索节点、提示词或操作…"
            value={query}
            autoComplete="off"
            spellCheck={false}
            onChange={event => { setQuery(event.target.value); setActiveIndex(0); }}
            onKeyDown={handleSearchKeyDown}
          />
          <button className={styles.closeButton} type="button" onClick={onClose} aria-label="关闭快捷操作" title="关闭（Esc）"><X size={17} aria-hidden="true" /></button>
        </div>
        <div className={styles.results} id={listId} role="listbox" aria-label="画布操作">
          {groups.map((group, groupIndex) => (
            <div className={styles.group} key={group.label} role="group" aria-labelledby={`${menuId}-group-${groupIndex}`}>
              <div className={styles.groupHeading} id={`${menuId}-group-${groupIndex}`}><span>{group.label}</span><span aria-hidden="true">{group.items.length}</span></div>
              {group.items.map((command, itemIndex) => {
                const index = group.offset + itemIndex;
                const active = index === selectedIndex;
                return (
                  <button
                    key={command.id}
                    id={`${menuId}-option-${index}`}
                    ref={element => { optionRefs.current[index] = element; }}
                    className={`${styles.command}${active ? ` ${styles.active}` : ""}`}
                    type="button"
                    role="option"
                    aria-selected={active}
                    tabIndex={-1}
                    onPointerMove={() => setActiveIndex(index)}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => selectCommand(command)}
                  >
                    <span className={styles.commandIcon} aria-hidden="true">{command.icon ?? <Sparkles size={17} />}</span>
                    <span className={styles.commandCopy}><span className={styles.commandLabel}>{command.label}</span>{command.description && <span className={styles.commandDescription}>{command.description}</span>}</span>
                    {command.shortcut && <kbd className={styles.shortcut}>{command.shortcut}</kbd>}
                    <CornerDownLeft className={styles.enterIcon} size={15} aria-hidden="true" />
                  </button>
                );
              })}
            </div>
          ))}
          {visibleCommands.length === 0 && <div className={styles.empty}><Search size={27} aria-hidden="true" /><strong>没有找到匹配操作</strong><span>试试节点名称、“图片”或更短的关键词</span></div>}
        </div>
        <footer className={styles.footer} id={hintId}>
          <div className={styles.keyHints}><span><kbd><ArrowUp size={11} /><ArrowDown size={11} /></kbd>选择</span><span><kbd><CornerDownLeft size={12} /></kbd>执行</span><span><kbd>esc</kbd>关闭</span></div>
          <span className={styles.resultCount} role="status" aria-live="polite">{visibleCommands.length} 项操作</span>
        </footer>
      </section>
    </div>
  );
}

export function CanvasCommandMenu({ open, onClose, commands }: CanvasCommandMenuProps) {
  if (!open || typeof document === "undefined") return null;
  return createPortal(<CommandMenuDialog onClose={onClose} commands={commands} />, document.body);
}
