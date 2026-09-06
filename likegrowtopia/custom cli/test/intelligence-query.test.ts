import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IntentEngine } from '../src/intelligence/intent.js';
import { createEntityRegistry, SynonymEntityResolver } from '../src/intelligence/entities.js';
import { QueryUnderstanding, parseWhatIf } from '../src/intelligence/query.js';
import { makeRuntime } from './helpers.js';

function makeQuery(extraResolvers: Array<SynonymEntityResolver> = []) {
  const intents = new IntentEngine();
  const entities = createEntityRegistry();
  for (const r of extraResolvers) entities.register(r);
  return new QueryUnderstanding({ intents, entities });
}

const cryptoResolver = () =>
  new SynonymEntityResolver('crypto-symbols', [
    { id: 'BTCUSDT', label: 'Bitcoin', kind: 'asset', domain: 'crypto', aliases: ['BTC', 'Bitcoin', 'BTCUSD', 'BTC/USD'] },
    { id: 'ETHUSDT', label: 'Ethereum', kind: 'asset', domain: 'crypto', aliases: ['ETH', 'Ethereum'] },
    { id: 'XAUUSD', label: 'Gold', kind: 'asset', domain: 'finance', aliases: ['gold', 'emas', 'XAU'] },
  ]);

test('intent classification: diagnose "kenapa revenue turun?"', () => {
  const q = makeQuery().understand('kenapa revenue turun?');
  assert.equal(q.intent, 'diagnose');
  assert.equal(q.intentCategory, 'diagnose');
  assert.ok(q.analysisTypes.includes('causal'));
  assert.ok(q.analysisTypes.includes('anomaly'));
  assert.ok(q.metrics.includes('revenue'));
});

test('intent classification: compare "bandingkan NVIDIA dan AMD"', () => {
  const q = makeQuery().understand('bandingkan NVIDIA dan AMD');
  assert.equal(q.intent, 'compare');
  assert.equal(q.intentCategory, 'compare');
  assert.ok(q.analysisTypes.includes('comparison'));
  // Generic resolver catches ALL-CAPS tickers.
  assert.ok(q.entities.some((e) => e.id === 'NVIDIA'));
  assert.ok(q.entities.some((e) => e.id === 'AMD'));
});

test('intent classification: forecast "prediksi penjualan bulan depan"', () => {
  const q = makeQuery().understand('prediksi penjualan bulan depan');
  assert.equal(q.intent, 'forecast');
  assert.equal(q.intentCategory, 'predict');
  assert.ok(q.analysisTypes.includes('forecast'));
  assert.ok(q.metrics.includes('sales'));
});

test('intent classification: relationship "apa hubungan temperatur dengan konsumsi listrik?"', () => {
  const q = makeQuery().understand('apa hubungan temperatur dengan konsumsi listrik?');
  assert.equal(q.intentCategory, 'relationship');
  assert.ok(q.analysisTypes.includes('correlation'));
  assert.ok(q.metrics.includes('temperature'));
  assert.ok(q.metrics.includes('energy'));
});

test('intent classification: discover anomaly "cari anomali dataset ini"', () => {
  const q = makeQuery().understand('cari anomali dataset ini');
  assert.equal(q.intentCategory, 'discover');
  assert.ok(q.analysisTypes.includes('anomaly'));
});

test('whale query adds on-chain analysis types and resolves BTC', () => {
  const q = makeQuery([cryptoResolver()]).understand('analisis whale BTC hari ini');
  assert.equal(q.subject, 'BTCUSDT');
  assert.equal(q.domain, 'crypto');
  assert.ok(q.analysisTypes.includes('onchain'));
  assert.ok(q.analysisTypes.includes('accumulation_distribution'));
  assert.equal(q.timeRange?.kind, 'today');
});

test('entity resolution maps aliases to a canonical id', () => {
  const entities = createEntityRegistry();
  entities.register(cryptoResolver());
  const found = entities.resolveAll('bandingkan bitcoin dengan gold');
  const ids = found.map((e) => e.id);
  assert.ok(ids.includes('BTCUSDT'), JSON.stringify(ids));
  assert.ok(ids.includes('XAUUSD'), JSON.stringify(ids));
  // Canonical id wins over the raw mention.
  const btc = found.find((e) => e.id === 'BTCUSDT');
  assert.equal(btc?.label, 'Bitcoin');
});

test('what-if parsing: "if conversion increases 20%"', () => {
  const w = parseWhatIf('what happens if conversion rate increases 20%?');
  assert.ok(w);
  assert.equal(w.variable, 'conversion rate');
  assert.equal(w.changePct, 20);
  assert.equal(w.direction, 'increase');
});

test('what-if parsing: Indonesian decrease', () => {
  const w = parseWhatIf('bagaimana jika harga turun 15 persen?');
  assert.ok(w);
  assert.equal(w.changePct, -15);
});

test('intent taxonomy is extensible', () => {
  const engine = new IntentEngine();
  engine.register({ id: 'game-balance', category: 'evaluate', keywords: ['balance', 'keseimbangan'], analysisTypes: ['game-balance'] });
  const match = engine.top('check weapon balance');
  assert.equal(match.id, 'game-balance');
});

test('unknown query falls back to generic analyze intent', () => {
  const q = makeQuery().understand('lorem ipsum dolor');
  assert.equal(q.intent, 'analyze');
});

test('runtime exposes the intelligence layer registries', async () => {
  const rt = await makeRuntime();
  assert.ok(rt.intentEngine.list().length > 10);
  assert.ok(rt.analystRegistry.list().length >= 9);
  assert.ok(rt.dataSources.get('inline-data'));
  assert.ok(rt.planner);
  assert.ok(rt.intelligence);
  await rt.shutdown();
});
