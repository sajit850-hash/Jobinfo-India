"use client";

import { useEffect, useMemo } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import { Extension } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyleKit } from "@tiptap/extension-text-style";
import Placeholder from "@tiptap/extension-placeholder";

const fonts = [
  ["Arial, sans-serif", "Arial"],
  ["Georgia, serif", "Georgia"],
  ["Tahoma, sans-serif", "Tahoma"],
  ["'Times New Roman', serif", "Times New Roman"],
  ["Verdana, sans-serif", "Verdana"],
];
const sizes = ["12px", "14px", "16px", "18px", "24px", "32px"];
const ParagraphIndent = Extension.create({
  name: "paragraphIndent",
  addGlobalAttributes() {
    return [{
      types: ["paragraph", "heading"],
      attributes: {
        indent: {
          default: 0,
          parseHTML: (element) => Math.max(0, Math.min(4, Math.round((Number.parseInt(element.style.marginLeft || "0", 10) || 0) / 24))),
          renderHTML: (attributes) => attributes.indent ? { style: `margin-left: ${attributes.indent * 24}px` } : {},
        },
      },
    }];
  },
});

export function JobDescriptionEditor({ value, onChange }: { value: string; onChange: (html: string) => void }) {
  const extensions = useMemo(() => [
    StarterKit.configure({ link: { openOnClick: false, autolink: true } }),
    TextAlign.configure({ types: ["paragraph", "heading"], alignments: ["left", "center", "right", "justify"] }),
    TextStyleKit,
    ParagraphIndent,
    Placeholder.configure({ placeholder: "Write or paste your complete job description here..." }),
  ], []);

  const editor = useEditor({
    extensions,
    content: value || "<p></p>",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "jobDescriptionEditorArea",
        "aria-label": "Complete job description",
        spellcheck: "true",
      },
    },
    onUpdate: ({ editor: current }) => onChange(current.getHTML()),
  });

  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    if (value && value !== current) editor.commands.setContent(value, { emitUpdate: false });
    else if (!value && current !== "<p></p>") editor.commands.clearContent(true);
  }, [editor, value]);

  if (!editor) return <div className="jobDescriptionEditor"><div className="jobDescriptionEditorLoading" /></div>;

  const commandButton = (label: string, action: () => void, active = false, disabled = false) => <button
    key={label}
    type="button"
    className={`editorToolButton${active ? " isActive" : ""}`}
    aria-label={label}
    aria-pressed={active}
    title={label}
    disabled={disabled}
    onMouseDown={(event) => event.preventDefault()}
    onClick={action}
  >{label}</button>;

  const addLink = () => {
    const existing = editor.getAttributes("link").href as string | undefined;
    const href = window.prompt("Enter a link URL", existing || "https://");
    if (href === null) return;
    if (!href.trim()) editor.chain().focus().extendMarkRange("link").unsetLink().run();
    else editor.chain().focus().extendMarkRange("link").setLink({ href: href.trim(), target: "_blank", rel: "noopener noreferrer" }).run();
  };
  const changeIndent = (change: -1 | 1) => {
    const node = editor.isActive("heading") ? "heading" : "paragraph";
    const current = Number(editor.getAttributes(node).indent || 0);
    editor.chain().focus().updateAttributes(node, { indent: Math.max(0, Math.min(4, current + change)) }).run();
  };

  return <div className="jobDescriptionEditor">
    <div className="jobDescriptionToolbar" role="toolbar" aria-label="Job description formatting">
      <div className="editorToolGroup">
        {commandButton("B", () => editor.chain().focus().toggleBold().run(), editor.isActive("bold"))}
        {commandButton("I", () => editor.chain().focus().toggleItalic().run(), editor.isActive("italic"))}
        {commandButton("U", () => editor.chain().focus().toggleUnderline().run(), editor.isActive("underline"))}
        {commandButton("S", () => editor.chain().focus().toggleStrike().run(), editor.isActive("strike"))}
      </div>
      <div className="editorToolGroup">
        {(["left", "center", "right", "justify"] as const).map((align) => commandButton(
          align === "left" ? "Left" : align === "center" ? "Center" : align === "right" ? "Right" : "Justify",
          () => editor.chain().focus().setTextAlign(align).run(), editor.isActive({ textAlign: align }),
        ))}
      </div>
      <div className="editorToolGroup">
        {commandButton("• List", () => editor.chain().focus().toggleBulletList().run(), editor.isActive("bulletList"))}
        {commandButton("1. List", () => editor.chain().focus().toggleOrderedList().run(), editor.isActive("orderedList"))}
        {commandButton("Indent", () => changeIndent(1), false, Number(editor.getAttributes(editor.isActive("heading") ? "heading" : "paragraph").indent || 0) >= 4)}
        {commandButton("Outdent", () => changeIndent(-1), false, Number(editor.getAttributes(editor.isActive("heading") ? "heading" : "paragraph").indent || 0) <= 0)}
      </div>
      <div className="editorToolGroup editorStyleGroup">
        <label className="editorSelectLabel">Font<select aria-label="Font family" value={editor.getAttributes("textStyle").fontFamily || fonts[0][0]} onChange={(event) => editor.chain().focus().setFontFamily(event.target.value).run()}>{fonts.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="editorSelectLabel">Size<select aria-label="Font size" value={editor.getAttributes("textStyle").fontSize || "16px"} onChange={(event) => editor.chain().focus().setFontSize(event.target.value).run()}>{sizes.map((size) => <option key={size} value={size}>{size}</option>)}</select></label>
        <label className="editorColorLabel" title="Text color">Text color<input aria-label="Text color" type="color" onChange={(event) => editor.chain().focus().setColor(event.target.value).run()} /></label>
        <label className="editorColorLabel" title="Highlight color">Highlight<input aria-label="Highlight color" type="color" onChange={(event) => editor.chain().focus().setBackgroundColor(event.target.value).run()} /></label>
      </div>
      <div className="editorToolGroup">
        {commandButton("Undo", () => editor.chain().focus().undo().run(), false, !editor.can().undo())}
        {commandButton("Redo", () => editor.chain().focus().redo().run(), false, !editor.can().redo())}
        {commandButton("Link", addLink, editor.isActive("link"))}
        {commandButton("Clear", () => editor.chain().focus().unsetAllMarks().clearNodes().run())}
      </div>
    </div>
    <EditorContent editor={editor} />
  </div>;
}
