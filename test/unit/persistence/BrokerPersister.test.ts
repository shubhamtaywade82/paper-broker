import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseManager } from '../../../src/persistence/db.js';
import { SQLiteBrokerPersister } from '../../../src/persistence/BrokerPersister.js';
import type { Fill } from '../../../src/broker/types.js';

function makeFill(overrides: Partial<Fill> = {}): Fill {
  return {
    id: `fill-${Math.random()}`,
    orderId: 'order-1',
    accountId: 'paper-main',
    symbol: 'BTCUSDT',
    side: 'SELL',
    quantity: 1,
    price: 90,
    notional: 90,
    fee: 10,
    feeAsset: 'USDT',
    liquidity: 'TAKER',
    realizedPnl: -500,
    positionQtyBefore: 1,
    positionQtyAfter: 0,
    fillTsUtc: new Date().toISOString(),
    ...overrides,
  };
}

describe('SQLiteBrokerPersister.resetAccountData', () => {
  let dataDir: string;
  let dbManager: DatabaseManager;

  afterEach(() => {
    dbManager?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function open() {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-broker-reset-test-'));
    dbManager = new DatabaseManager(dataDir);
    return new SQLiteBrokerPersister(dbManager.raw);
  }

  // Regression test: a real user reset their paper account, kept trading,
  // then the process restarted (deploy/crash/tsx-watch reload). PaperBroker's
  // constructor rehydrates walletBalance by replaying every persisted fill
  // for the account (src/broker/PaperBroker.ts:133-150). If resetAccountData
  // leaves old fills in the DB, that replay resurrects pre-reset losses and
  // silently undoes the reset — which is exactly what was observed (equity
  // ~6500 instead of the reset 10000).
  it('clears fills for the account, not just positions and orders', () => {
    const persister = open();
    persister.saveFill(makeFill({ id: 'pre-reset-loss', realizedPnl: -2295, fee: 1281 }));
    expect(persister.loadFills('paper-main')).toHaveLength(1);

    persister.resetAccountData('paper-main');

    expect(persister.loadFills('paper-main')).toHaveLength(0);
  });

  it('only clears the given account, leaving other accounts intact', () => {
    const persister = open();
    persister.saveFill(makeFill({ id: 'acct-a-fill', accountId: 'acct-a' }));
    persister.saveFill(makeFill({ id: 'acct-b-fill', accountId: 'acct-b' }));

    persister.resetAccountData('acct-a');

    expect(persister.loadFills('acct-a')).toHaveLength(0);
    expect(persister.loadFills('acct-b')).toHaveLength(1);
  });
});
