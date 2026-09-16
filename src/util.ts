import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  type LucideIcon,
} from 'lucide-react';

export const FOLDER_COLORS = [
  { id: 'purple', hex: '#7860DD', soft: '#EFEBFC' },
  { id: 'blue', hex: '#3E8EDE', soft: '#E8F2FC' },
  { id: 'green', hex: '#3FA66B', soft: '#E8F6EE' },
  { id: 'orange', hex: '#E8863A', soft: '#FCF0E5' },
  { id: 'pink', hex: '#DE5C9C', soft: '#FCEBF4' },
  { id: 'amber', hex: '#C9930F', soft: '#FBF3DC' },
] as const;

export const DEFAULT_FOLDER_COLOR = FOLDER_COLORS[0];

export function folderColor(id: string) {
  return FOLDER_COLORS.find((c) => c.id === id) ?? DEFAULT_FOLDER_COLOR;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 100 || exponent === 0 ? Math.round(value) : value.toFixed(1)} ${units[exponent]}`;
}

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const sameYear = date.getFullYear() === now.getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

export type FileVisual = { Icon: LucideIcon; tile: string; fg: string };

export function fileVisual(mime: string, name: string): FileVisual {
  const m = (mime || '').toLowerCase();
  const ext = extensionOf(name);
  if (m === 'application/pdf' || ext === 'pdf') return { Icon: FileText, tile: '#FBE9E7', fg: '#C43D2B' };
  if (m.startsWith('image/')) return { Icon: FileImage, tile: '#E8F2FC', fg: '#2E77C8' };
  if (m.startsWith('video/')) return { Icon: FileVideo, tile: '#EFEBFC', fg: '#7860DD' };
  if (m.startsWith('audio/')) return { Icon: FileAudio, tile: '#FBF0DE', fg: '#B07A22' };
  if (['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz'].includes(ext) || m.includes('zip') || m.includes('compressed'))
    return { Icon: FileArchive, tile: '#E8F6EE', fg: '#2F8657' };
  if (['csv', 'xls', 'xlsx', 'tsv', 'ods'].includes(ext) || m === 'text/csv' || m.includes('spreadsheet') || m.includes('excel'))
    return { Icon: FileSpreadsheet, tile: '#E9F7EC', fg: '#2F8657' };
  if (
    ['js', 'ts', 'tsx', 'jsx', 'json', 'html', 'css', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'sh', 'yml', 'yaml', 'toml', 'xml', 'sql'].includes(ext) ||
    m.includes('javascript') ||
    m.includes('json') ||
    m.includes('xml')
  )
    return { Icon: FileCode, tile: '#2B2937', fg: '#A79BEB' };
  if (m.startsWith('text/') || ['md', 'txt', 'log', 'ini', 'cfg'].includes(ext)) return { Icon: FileText, tile: '#F2F1F7', fg: '#6E6A7F' };
  return { Icon: File, tile: '#F2F1F7', fg: '#6E6A7F' };
}

export type PreviewKind = 'image' | 'video' | 'audio' | 'pdf' | 'text' | null;

export function previewKind(mime: string): PreviewKind {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (m === 'application/pdf') return 'pdf';
  if (m.startsWith('text/') || m === 'application/json' || m === 'application/jsonl') return 'text';
  return null;
}

export function pluralize(count: number, singular: string, plural?: string) {
  return `${count} ${count === 1 ? singular : plural ?? `${singular}s`}`;
}
