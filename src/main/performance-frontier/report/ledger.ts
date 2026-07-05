import { mkdir, appendFile } from 'fs/promises';
import { dirname } from 'path';

export async function appendLedgerRecord(
  ledgerPath: string,
  record: Record<string, unknown>,
): Promise<void> {
  await mkdir(dirname(ledgerPath), { recursive: true });
  await appendFile(ledgerPath, `${JSON.stringify(record)}\n`, 'utf-8');
}
