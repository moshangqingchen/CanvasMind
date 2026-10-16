"use client";
import { memo, useCallback } from "react";
import { X } from "lucide-react";
import { CanvasParameterDock } from "./canvas-parameter-dock";
import type { CanvasNodeData } from "./types";
import "./canvas-parameter-deck.css";

type Card = { id: string; data: CanvasNodeData };
type Actions = {
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  register: (id: string, element: HTMLElement | null) => void;
};
const ParameterCard = memo(function ParameterCard({ card, active, hidden, onClose, onFocus, register }: Actions & { card: Card; active: boolean; hidden: boolean }) {
  const close = useCallback(() => onClose(card.id), [card.id, onClose]);
  const focus = useCallback(() => onFocus(card.id), [card.id, onFocus]);
  const element = useCallback((value: HTMLElement | null) => register(card.id, value), [card.id, register]);
  return <CanvasParameterDock nodeId={card.id} data={card.data} active={active} hidden={hidden}
    onRequestClose={close} onRequestFocus={focus} registerPanelElement={element} />;
});

export const CanvasParameterDeck = memo(function CanvasParameterDeck({ cards, activeId, slots, hidden, alongsideAgent, onClose, onFocus, register }: Actions & {
  cards: Card[]; activeId: string | null; slots: 1 | 2; hidden: boolean; alongsideAgent: boolean;
}) {
  const visible = new Set(cards.slice(-slots).map(card => card.id));
  if (activeId && !visible.has(activeId)) { visible.delete(visible.values().next().value!); visible.add(activeId); }
  return <aside className="canvas-parameter-deck" hidden={hidden || cards.length === 0} inert={hidden || undefined}
    data-alongside-agent={alongsideAgent} data-slots={slots} aria-label="节点参数工作区">
    {cards.length > 1 ? <nav className="canvas-parameter-tabs" aria-label="已打开的节点参数" role="tablist" onKeyDown={event => {
      if (event.defaultPrevented || event.nativeEvent.isComposing || event.keyCode === 229) return;
      const offset = ({ ArrowRight: 1, ArrowLeft: -1 } as Record<string, number>)[event.key];
      if (!offset && event.key !== "Home" && event.key !== "End") return;
      const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
      if (current < 0 || !tabs.length) return;
      event.preventDefault();
      const index = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (current + offset + tabs.length) % tabs.length;
      tabs[index]?.focus(); tabs[index]?.click();
    }}>
      {cards.map(card => <div key={card.id} className="canvas-parameter-tab">
        <button type="button" role="tab" aria-selected={activeId === card.id} tabIndex={activeId === card.id ? 0 : -1} title={card.data.label}
          aria-controls={`canvas-parameters-${card.id}`}
          onClick={() => onFocus(card.id)}>{card.data.label}</button>
        <button type="button" title={`关闭 ${card.data.label} 参数`} aria-label={`关闭 ${card.data.label} 参数`} onClick={() => onClose(card.id)}><X size={12} /></button>
      </div>)}
    </nav> : null}
    <div className="canvas-parameter-cards">{cards.map(card => <ParameterCard key={card.id} card={card}
      active={!hidden && activeId === card.id} hidden={hidden || !visible.has(card.id)} onClose={onClose} onFocus={onFocus} register={register} />)}</div>
  </aside>;
});
