export const RESEND_MAX_EMAIL_SIZE_BYTES = 40 * 1024 * 1024;

const RESEND_UNSUPPORTED_ATTACHMENT_EXTENSIONS = new Set([
  '.adp', '.app', '.asp', '.bas', '.bat',
  '.cer', '.chm', '.cmd', '.com', '.cpl',
  '.crt', '.csh', '.der', '.exe', '.fxp',
  '.gadget', '.hlp', '.hta', '.inf', '.ins',
  '.isp', '.its', '.js', '.jse', '.ksh',
  '.lib', '.lnk', '.mad', '.maf', '.mag',
  '.mam', '.maq', '.mar', '.mas', '.mat',
  '.mau', '.mav', '.maw', '.mda', '.mdb',
  '.mde', '.mdt', '.mdw', '.mdz', '.msc',
  '.msh', '.msh1', '.msh2', '.mshxml', '.msh1xml',
  '.msh2xml', '.msi', '.msp', '.mst', '.ops',
  '.pcd', '.pif', '.plg', '.prf', '.prg',
  '.reg', '.scf', '.scr', '.sct', '.shb',
  '.shs', '.sys', '.ps1', '.ps1xml', '.ps2',
  '.ps2xml', '.psc1', '.psc2', '.tmp', '.url',
  '.vb', '.vbe', '.vbs', '.vps', '.vsmacros',
  '.vss', '.vst', '.vsw', '.vxd', '.ws',
  '.wsc', '.wsf', '.wsh', '.xnk',
]);

export type AttachmentLike = {
  name: string;
  size: number;
  type?: string | null;
};

export type AttachmentValidationResult = {
  ok: boolean;
  error?: string;
  totalBytes: number;
  estimatedEncodedBytes: number;
};

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let idx = 0;

  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }

  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function estimateBase64Size(bytes: number): number {
  const normalized = Math.max(0, Math.floor(bytes));
  return Math.ceil(normalized / 3) * 4;
}

export function getAttachmentExtension(filename: string): string {
  const normalized = String(filename || '').trim().toLowerCase();
  const basename = normalized.split(/[\\/]/).pop() || '';
  const lastDot = basename.lastIndexOf('.');

  if (lastDot <= 0 || lastDot === basename.length - 1) {
    return '';
  }

  return basename.slice(lastDot);
}

export function sanitizeAttachmentFilename(filename: string): string {
  const raw = String(filename || '').trim();
  const basename = raw.split(/[\\/]/).pop() || 'attachment';
  const extension = getAttachmentExtension(basename);
  const stem = extension ? basename.slice(0, -extension.length) : basename;
  const normalizedStem = stem
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 120);
  const safeStem = normalizedStem || 'attachment';
  const safeExtension = extension
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^a-zA-Z0-9.]+/g, '')
    .toLowerCase();

  return `${safeStem}${safeExtension}`;
}

export function validateResendAttachments(files: AttachmentLike[]): AttachmentValidationResult {
  let totalBytes = 0;
  let estimatedEncodedBytes = 0;

  for (const file of files) {
    const filename = String(file?.name || '').trim();
    const size = Number(file?.size || 0);

    if (!filename) {
      return {
        ok: false,
        error: 'Every attachment must have a filename.',
        totalBytes,
        estimatedEncodedBytes,
      };
    }

    if (!Number.isFinite(size) || size <= 0) {
      return {
        ok: false,
        error: `${filename} is empty or unreadable.`,
        totalBytes,
        estimatedEncodedBytes,
      };
    }

    const extension = getAttachmentExtension(filename);
    if (extension && RESEND_UNSUPPORTED_ATTACHMENT_EXTENSIONS.has(extension)) {
      return {
        ok: false,
        error: `${filename} uses the ${extension} extension, which Resend does not allow as an attachment.`,
        totalBytes,
        estimatedEncodedBytes,
      };
    }

    totalBytes += size;
    estimatedEncodedBytes += estimateBase64Size(size);
  }

  if (estimatedEncodedBytes > RESEND_MAX_EMAIL_SIZE_BYTES) {
    return {
      ok: false,
      error: `Attachments are too large for Resend. Estimated encoded size is ${formatBytes(estimatedEncodedBytes)} and the limit is ${formatBytes(RESEND_MAX_EMAIL_SIZE_BYTES)} per email.`,
      totalBytes,
      estimatedEncodedBytes,
    };
  }

  return {
    ok: true,
    totalBytes,
    estimatedEncodedBytes,
  };
}
