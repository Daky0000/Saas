import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { Bold, Italic, List, ListOrdered, Quote, Code, Image as ImageIcon, Heading1, Heading2, Heading3, Undo2, Redo2 } from 'lucide-react';

interface RichTextEditorProps {
  value: string;
  onChange: (content: string) => void;
}

const RichTextEditor: React.FC<RichTextEditorProps> = ({ value, onChange }) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3],
        },
      }),
      Image.configure({
        allowBase64: true,
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  if (!editor) {
    return null;
  }

  const handleImageUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          const url = event.target?.result as string;
          editor.chain().focus().setImage({ src: url }).run();
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  };

  const addButton = (
    onClick: () => void,
    isActive: boolean,
    icon: React.ReactNode,
    title: string
  ) => (
    <button
      onClick={onClick}
      className={`p-2 rounded transition ${
        isActive
          ? 'bg-blue-100 text-blue-600'
          : 'hover:bg-gray-100 text-gray-700'
      }`}
      title={title}
      type="button"
    >
      {icon}
    </button>
  );

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-1 p-2 bg-white border-b border-gray-200">
        <div className="flex items-center gap-1">
          {addButton(
            () => editor.chain().focus().toggleBold().run(),
            editor.isActive('bold'),
            <Bold size={18} />,
            'Bold'
          )}
          {addButton(
            () => editor.chain().focus().toggleItalic().run(),
            editor.isActive('italic'),
            <Italic size={18} />,
            'Italic'
          )}
          {addButton(
            () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
            editor.isActive('heading', { level: 1 }),
            <Heading1 size={18} />,
            'Heading 1'
          )}
          {addButton(
            () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
            editor.isActive('heading', { level: 2 }),
            <Heading2 size={18} />,
            'Heading 2'
          )}
          {addButton(
            () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
            editor.isActive('heading', { level: 3 }),
            <Heading3 size={18} />,
            'Heading 3'
          )}
        </div>

        <div className="w-px h-6 bg-gray-300"></div>

        <div className="flex items-center gap-1">
          {addButton(
            () => editor.chain().focus().toggleBulletList().run(),
            editor.isActive('bulletList'),
            <List size={18} />,
            'Bullet List'
          )}
          {addButton(
            () => editor.chain().focus().toggleOrderedList().run(),
            editor.isActive('orderedList'),
            <ListOrdered size={18} />,
            'Numbered List'
          )}
        </div>

        <div className="w-px h-6 bg-gray-300"></div>

        <div className="flex items-center gap-1">
          {addButton(
            () => editor.chain().focus().toggleBlockquote().run(),
            editor.isActive('blockquote'),
            <Quote size={18} />,
            'Quote'
          )}
          {addButton(
            () => editor.chain().focus().toggleCodeBlock().run(),
            editor.isActive('codeBlock'),
            <Code size={18} />,
            'Code Block'
          )}
        </div>

        <div className="w-px h-6 bg-gray-300"></div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleImageUpload}
            className="p-2 hover:bg-gray-100 rounded transition text-gray-700"
            title="Insert Image"
            type="button"
          >
            <ImageIcon size={18} />
          </button>
        </div>

        <div className="w-px h-6 bg-gray-300"></div>

        <div className="flex items-center gap-1">
          {addButton(
            () => editor.chain().focus().undo().run(),
            false,
            <Undo2 size={18} />,
            'Undo'
          )}
          {addButton(
            () => editor.chain().focus().redo().run(),
            false,
            <Redo2 size={18} />,
            'Redo'
          )}
        </div>
      </div>

      {/* Editor Content */}
      <div className="bg-white p-4">
        <style>{`
          .ProseMirror {
            outline: none;
          }
          .ProseMirror:focus {
            outline: none;
          }
          .ProseMirror p {
            margin: 0.75em 0;
            padding: 0;
          }
          .ProseMirror img {
            max-width: 100%;
            height: auto;
            margin: 1em 0;
          }
        `}</style>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
};

export default RichTextEditor;
