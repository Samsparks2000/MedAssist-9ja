import { useRef } from 'react';
import { FileIcon, UploadIcon } from './Icons';

export interface Doc {
  id?: string;
  kind: string;
  filename: string;
  size: number;
  file?: File;
}

const fmtSize = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** File picker in the design's style: a dashed drop zone, then a green "Uploaded" chip with Replace. */
export function UploadField({
  label,
  hint,
  value,
  onPick,
  accept = '.pdf,.jpg,.jpeg,.png',
  compact = false,
}: {
  label: string;
  hint?: string;
  value: Doc | null;
  onPick: (f: File) => void;
  accept?: string;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const pick = (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      alert('Files must be 5 MB or smaller.');
      return;
    }
    onPick(f);
  };
  return (
    <div className="field">
      <div className="label">{label}</div>
      <input ref={input} type="file" accept={accept} hidden onChange={(e) => pick(e.target.files)} />
      {value ? (
        <div className="file-chip">
          <FileIcon />
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis' }}>{value.filename}</strong>
            <span className="small muted">{value.file ? 'Ready to upload' : 'Uploaded'} · {fmtSize(value.size)}</span>
          </div>
          <button type="button" className="btn link" onClick={() => input.current?.click()}>Replace</button>
        </div>
      ) : (
        <button
          type="button"
          className="dropzone"
          style={{ width: '100%', textAlign: compact ? 'left' : 'center' }}
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            pick(e.dataTransfer.files);
          }}
        >
          <span className="row" style={{ justifyContent: compact ? 'flex-start' : 'center' }}>
            <UploadIcon /> <strong>{compact ? 'Upload PDF or photo' : 'Choose a file or drag it here'}</strong>
          </span>
          {hint && !compact && <span className="small muted">{hint}</span>}
        </button>
      )}
    </div>
  );
}
