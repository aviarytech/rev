import { open } from 'node:fs/promises';
import { GateError } from './errors.js';
export const MAX_BYTES = 1024 * 1024;

export async function readText(path) {
  let file;
  try {
    file = await open(path, 'r');
    if (!(await file.stat()).isFile()) throw new Error();
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_BYTES) throw new GateError('evidence-too-large');
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
  } catch (error) {
    if (error instanceof GateError) throw error;
    throw new GateError('invalid-file');
  } finally { await file?.close(); }
}

export async function readJson(path) {
  const text = await readText(path);
  try { return JSON.parse(text); } catch { throw new GateError('invalid-file'); }
}
