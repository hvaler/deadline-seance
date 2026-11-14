/** The longest release name the screen keeps. */
export const MAX_RELEASE = 60;

/** A release name as the app keeps it: white space collapsed, at most 60 characters, and null when nothing is left. */
export function cleanRelease(name: string): string | null {
  const cleaned = name.replace(/\s+/g, ' ').trim().slice(0, MAX_RELEASE).trim();
  return cleaned === '' ? null : cleaned;
}

/** What a release is called by default for a file: its name without `.csv`, with runs of `_` and white space turned into one space. */
export function releaseFromFileName(fileName: string): string | null {
  return cleanRelease(fileName.replace(/\.csv$/i, '').replace(/[_\s]+/g, ' '));
}
