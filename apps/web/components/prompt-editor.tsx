"use client";

import { useCallback, useEffect, useRef } from "react";
import { Editor } from "@tiptap/core";
import Mention from "@tiptap/extension-mention";
import type { JSONContent } from "@tiptap/core";
import type {
  SuggestionKeyDownProps,
  SuggestionProps,
} from "@tiptap/suggestion";
import StarterKit from "@tiptap/starter-kit";
import type { PromptPart } from "@super-canvas/core";
import type { AssetView } from "./types";

interface PromptEditorProps {
  parts: PromptPart[];
  assets: AssetView[];
  mentionAssets?: AssetView[];
  onChange: (parts: PromptPart[]) => void;
  ariaLabelledBy?: string;
  ariaLabel?: string;
}

function partsToDocument(
  parts: PromptPart[],
  assets: AssetView[],
): JSONContent {
  const content = parts.flatMap((part): JSONContent[] =>
    part.type === "text"
      ? part.text.split("\n").flatMap((text, index, all) => {
          const nodes: JSONContent[] = [];
          if (text.length > 0) nodes.push({ type: "text", text });
          if (index < all.length - 1) nodes.push({ type: "hardBreak" });
          return nodes;
        })
      : [
          {
            type: "mention",
            attrs: {
              id: part.assetId,
              label:
                assets.find((asset) => asset.id === part.assetId)?.name ??
                part.assetId,
              role: part.role,
            },
          },
        ],
  );
  return {
    type: "doc",
    content: [
      {
        type: "paragraph",
        ...(content.length > 0 ? { content } : {}),
      },
    ],
  };
}

function documentToParts(document: JSONContent): PromptPart[] {
  const parts: PromptPart[] = [];
  const appendText = (text: string) => {
    const previous = parts.at(-1);
    if (previous?.type === "text") previous.text += text;
    else parts.push({ type: "text", text });
  };
  const visit = (node: JSONContent, paragraphIndex = 0) => {
    if (node.type === "text" && node.text) appendText(node.text);
    if (node.type === "hardBreak") appendText("\n");
    if (node.type === "mention" && typeof node.attrs?.id === "string")
      parts.push({
        type: "asset",
        assetId: node.attrs.id,
        role:
          node.attrs.role === "firstFrame" || node.attrs.role === "lastFrame"
            ? node.attrs.role
            : "reference",
      });
    node.content?.forEach((child) => visit(child, paragraphIndex));
  };
  document.content?.forEach((node, index) => {
    if (index > 0) appendText("\n");
    visit(node, index);
  });
  return parts.length > 0 ? parts : [{ type: "text", text: "" }];
}

function suggestionRenderer() {
  let menu: HTMLDivElement | null = null;
  let selected = 0;
  let current: SuggestionProps<AssetView, AssetMentionAttributes> | null = null;

  const close = () => {
    menu?.remove();
    menu = null;
  };
  const draw = (props: SuggestionProps<AssetView, AssetMentionAttributes>) => {
    current = props;
    close();
    const items = props.items as AssetView[];
    if (!items.length) return;
    menu = document.createElement("div");
    menu.className = "mention-floating-menu";
    const rect = props.clientRect?.();
    if (rect) {
      menu.style.left = `${rect.left}px`;
      menu.style.top = `${rect.bottom + 7}px`;
    }
    items.forEach((asset, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = index === selected ? "active" : "";
      const chip = document.createElement("span");
      chip.className = "mention-chip";
      chip.textContent = "@";
      const label = document.createElement("span");
      label.textContent = asset.name;
      button.append(chip, label);
      button.onmousedown = (event) => {
        event.preventDefault();
        props.command({ id: asset.id, label: asset.name, role: "reference" });
        close();
      };
      menu?.appendChild(button);
    });
    document.body.appendChild(menu);
  };

  return {
    onStart: (props: SuggestionProps<AssetView, AssetMentionAttributes>) => {
      selected = 0;
      draw(props);
    },
    onUpdate: (props: SuggestionProps<AssetView, AssetMentionAttributes>) => {
      selected = 0;
      draw(props);
    },
    onKeyDown: ({ event }: SuggestionKeyDownProps) => {
      if (!menu || !current?.items?.length) return false;
      if (event.key === "Escape") {
        close();
        return true;
      }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        selected =
          (selected +
            (event.key === "ArrowDown" ? 1 : -1) +
            current.items.length) %
          current.items.length;
        draw(current);
        return true;
      }
      if (event.key === "Enter") {
        const asset = current.items[selected] as AssetView;
        current.command({ id: asset.id, label: asset.name, role: "reference" });
        close();
        return true;
      }
      return false;
    },
    onExit: close,
  };
}

interface AssetMentionAttributes {
  id: string;
  label: string;
  role: "reference" | "firstFrame" | "lastFrame";
}

export function PromptEditor({
  parts,
  assets,
  mentionAssets = assets,
  onChange,
  ariaLabelledBy,
  ariaLabel,
}: PromptEditorProps) {
  const onChangeRef = useRef(onChange);
  const pendingPartsRef = useRef<PromptPart[] | null>(null);
  const mentionAssetsRef = useRef(mentionAssets);
  const editorRef = useRef<Editor | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const flushPendingParts = useCallback(() => {
    const pending = pendingPartsRef.current;
    if (!pending) return;
    pendingPartsRef.current = null;
    onChangeRef.current(pending);
  }, []);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);
  useEffect(() => {
    mentionAssetsRef.current = mentionAssets;
  }, [mentionAssets]);
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const editor = new Editor({
      extensions: [
        StarterKit.configure({
          heading: false,
          bulletList: false,
          orderedList: false,
          blockquote: false,
          codeBlock: false,
          horizontalRule: false,
        }),
        Mention.extend({
          addAttributes() {
            return { ...this.parent?.(), role: { default: "reference" } };
          },
        }).configure({
          HTMLAttributes: { class: "mention-chip" },
          renderText: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
          suggestion: {
            char: "@",
            // Chinese prompts commonly place @ directly after a phrase. The
            // default only accepts line-start/whitespace prefixes, which makes
            // a second mention such as "这个人@" silently stop working.
            allowedPrefixes: null,
            items: ({ query }) =>
              mentionAssetsRef.current
                .filter((asset) =>
                  asset.name.toLowerCase().includes(query.toLowerCase()),
                )
                .slice(0, 8),
            render: suggestionRenderer,
          },
        }),
      ],
      content: partsToDocument(parts, assets),
      editorProps: {
        attributes: {
          class: "tiptap-prompt",
          role: "textbox",
          "aria-multiline": "true",
          ...(ariaLabelledBy
            ? { "aria-labelledby": ariaLabelledBy }
            : { "aria-label": ariaLabel ?? "提示词" }),
        },
      },
      onUpdate: ({ editor: current }) => {
        pendingPartsRef.current = documentToParts(current.getJSON());
      },
    });
    editorRef.current = editor;
    editor.mount(container);
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
    // The editor is intentionally created once; refs keep callbacks current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return;
    // The editor's own transaction already contains the latest text. Replacing
    // content while focused resets the DOM selection and drops keyboard focus.
    if (editor.isFocused) return;
    const nextDocument = partsToDocument(parts, assets);
    if (JSON.stringify(editor.getJSON()) !== JSON.stringify(nextDocument)) {
      editor.commands.setContent(nextDocument, { emitUpdate: false });
    }
  }, [assets, parts]);

  return (
    <div
      className="mention-editor"
      ref={containerRef}
      onPointerDown={(event) => {
        event.stopPropagation();
        window.requestAnimationFrame(() => {
          const editor = editorRef.current;
          if (!editor || editor.isDestroyed) return;
          editor.commands.focus();
        });
      }}
      onClick={(event) => event.stopPropagation()}
      onBlur={flushPendingParts}
    />
  );
}
