#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { evaluateFixtureResults } from './evaluate-name-fixtures.mjs';
import {
  PROVIDER_NAMES,
  callProductNameProvider,
  getProviderConfig,
  loadLocalEnv,
} from './lib/product-name-providers.mjs';

function parseArgs(argv) {
  const args = {};
  for (const value of argv) {
    if (!value.startsWith('--')) continue;
    const [key, ...rest] = value.slice(2).split('=');
    args[key] = rest.length ? rest.join('=') : true;
  }
  return args;
}

function selectedProviders(value) {
  if (!value || value === 'all') return PROVIDER_NAMES;
  const selected = String(value).split(',').map((item) => item.trim()).filter(Boolean);
  const unknown = selected.filter((item) => !PROVIDER_NAMES.includes(item));
  if (unknown.length) throw new Error(`Unknown providers: ${unknown.join(', ')}`);
  return selected;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function printCheck(providers, env) {
  console.log('WELMES provider configuration (secrets are never printed)');
  for (const provider of providers) {
    const config = getProviderConfig(provider, env);
    const credential = env[config.envKey];
    const keyState = !credential
      ? `missing(${config.envKey})`
      : provider === 'gemini' && !String(credential).startsWith('AIza')
        ? 'invalid-type(expected AIza… Developer API key)'
        : 'available';
    console.log(`  ${provider.padEnd(10)} model=${config.model.padEnd(22)} key=${keyState} json=yes grounding=${config.supportsGrounding ? 'yes' : 'no'} price=${config.inputRate}/${config.outputRate} ${config.currency} per 1M`);
  }
}

function printReport(reports, failures) {
  console.log('\nProvider comparison');
  console.log('provider    done  quality  auto  mean-conf  similarity  p95-ms  est-cost');
  for (const [provider, report] of Object.entries(reports)) {
    const s = report.summary;
    const cost = s.totalEstimatedCostUsd == null ? 'n/a' : `$${s.totalEstimatedCostUsd}`;
    console.log(`${provider.padEnd(11)}${String(s.completed).padEnd(6)}${String(s.qualityPassed).padEnd(9)}${String(s.autoApproved).padEnd(6)}${String(s.meanConfidence ?? 'n/a').padEnd(11)}${String(s.meanReferenceSimilarity ?? 'n/a').padEnd(12)}${String(s.p95LatencyMs ?? 'n/a').padEnd(8)}${cost}`);
  }
  if (failures.length) {
    console.log(`\nFailures (${failures.length})`);
    for (const failure of failures.slice(0, 20)) console.log(`  ${failure.provider}/${failure.id}: ${failure.error}`);
    if (failures.length > 20) console.log(`  ... ${failures.length - 20} more`);
  }
}

export async function runProviderEvaluation({ fixtures, providers, env, grounding = false, delayMs = 250, fetchImpl } = {}) {
  const results = [];
  const failures = [];
  for (const provider of providers) {
    const config = getProviderConfig(provider, env);
    if (!env[config.envKey]) {
      failures.push({ provider, id: '*', error: `missing ${config.envKey}` });
      continue;
    }
    console.log(`\n[${provider}] ${config.model}${grounding && config.supportsGrounding ? ' + grounding' : ' generation-only'}`);
    for (const fixture of fixtures) {
      try {
        const result = await callProductNameProvider(provider, fixture, {
          env,
          grounding,
          fetchImpl,
        });
        results.push({ id: fixture.id, ...result });
        console.log(`  ✓ ${fixture.id}: ${result.candidateName}`);
      } catch (error) {
        failures.push({ provider, id: fixture.id, error: error.message });
        console.log(`  ✗ ${fixture.id}: ${error.message}`);
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }

  const reports = {};
  for (const provider of providers) {
    const providerResults = results.filter((result) => result.provider === provider);
    reports[provider] = evaluateFixtureResults(fixtures, providerResults);
  }
  return { results, failures, reports };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const env = loadLocalEnv();
  const providers = selectedProviders(args.providers);
  printCheck(providers, env);
  if (args.check) return;

  const fixturePath = args.fixtures || new URL('./fixtures/product-name-eval.json', import.meta.url);
  const allFixtures = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const limit = args.limit ? Number(args.limit) : allFixtures.length;
  if (!Number.isInteger(limit) || limit < 1) throw new Error('--limit must be a positive integer');
  const fixtures = allFixtures.slice(0, limit);
  const grounding = Boolean(args.grounding);
  const evaluation = await runProviderEvaluation({
    fixtures,
    providers,
    env,
    grounding,
    delayMs: args.delay == null ? 250 : Number(args.delay),
  });
  printReport(evaluation.reports, evaluation.failures);

  const artifact = {
    createdAt: new Date().toISOString(),
    mode: grounding ? 'grounded-where-supported' : 'generation-only',
    providers,
    fixtureCount: fixtures.length,
    models: Object.fromEntries(providers.map((provider) => [provider, getProviderConfig(provider, env).model])),
    ...evaluation,
  };
  if (args.output) {
    fs.writeFileSync(args.output, `${JSON.stringify(artifact, null, 2)}\n`);
    console.log(`\nSaved ${args.output}`);
  }
  if (evaluation.results.length === 0) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
