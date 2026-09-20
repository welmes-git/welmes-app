#!/usr/bin/env node
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  evaluateNameContract,
  scoreReferenceSimilarity,
  validateEnglishProductName,
} from './lib/product-name-quality.mjs';

const DEFAULT_FIXTURE_URL = new URL('./fixtures/product-name-eval.json', import.meta.url);

function parseArgs(argv) {
  const args = {};
  for (const value of argv) {
    if (!value.startsWith('--')) continue;
    const [key, ...rest] = value.slice(2).split('=');
    args[key] = rest.length ? rest.join('=') : true;
  }
  return args;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
}

export function evaluateFixtureResults(fixtures, results, { threshold = 0.85 } = {}) {
  const byId = new Map(results.map((result) => [result.id, result]));
  const rows = fixtures.map((fixture) => {
    const result = byId.get(fixture.id);
    if (!result) return { id: fixture.id, missing: true };
    const validation = validateEnglishProductName({
      sourceName: fixture.sourceName,
      sourceDescription: fixture.sourceDescription,
      candidateName: result.candidateName,
      brand: fixture.brand,
      sourceType: result.sourceType ?? 'generated',
      evidenceUrls: result.evidenceUrls ?? [],
      autoApproveThreshold: threshold,
    });
    const contract = evaluateNameContract(result.candidateName, fixture);
    return {
      id: fixture.id,
      provider: result.provider,
      model: result.model,
      candidateName: result.candidateName,
      referenceName: fixture.referenceName,
      referenceSimilarity: scoreReferenceSimilarity(result.candidateName, fixture.referenceName),
      contract,
      latencyMs: result.latencyMs ?? null,
      estimatedCostUsd: result.estimatedCostUsd ?? null,
      validation,
      missing: false,
    };
  });

  const completed = rows.filter((row) => !row.missing);
  const latencies = completed.map((row) => row.latencyMs).filter(Number.isFinite);
  const costs = completed.map((row) => row.estimatedCostUsd).filter(Number.isFinite);
  const errorCounts = {};
  for (const row of completed) {
    for (const error of row.validation.errors) {
      errorCounts[error.code] = (errorCounts[error.code] ?? 0) + 1;
    }
  }

  const contractMissingCounts = {};
  for (const row of completed) {
    for (const token of row.contract?.missing || []) {
      contractMissingCounts[token] = (contractMissingCounts[token] ?? 0) + 1;
    }
  }
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  return {
    summary: {
      totalFixtures: fixtures.length,
      completed: completed.length,
      missing: rows.length - completed.length,
      autoApproved: completed.filter((row) => row.validation.status === 'auto_approved').length,
      qualityPassed: completed.filter((row) => row.validation.errors.length === 0 && row.contract?.ok !== false).length,
      contractPassed: completed.filter((row) => row.contract?.ok !== false).length,
      reviewRequired: completed.filter((row) => row.validation.status === 'review_required').length,
      meanConfidence: completed.length ? Number((sum(completed.map((row) => row.validation.confidence)) / completed.length).toFixed(3)) : null,
      meanReferenceSimilarity: completed.length ? Number((sum(completed.map((row) => row.referenceSimilarity)) / completed.length).toFixed(3)) : null,
      p50LatencyMs: percentile(latencies, 0.50),
      p95LatencyMs: percentile(latencies, 0.95),
      totalEstimatedCostUsd: costs.length ? Number(sum(costs).toFixed(6)) : null,
      errorCounts,
      contractMissingCounts,
    },
    rows,
  };
}

function loadJson(pathOrUrl) {
  return JSON.parse(fs.readFileSync(pathOrUrl, 'utf8'));
}

function printHuman(report) {
  const summary = report.summary;
  console.log('WELMES English product-name evaluation');
  console.log(`  completed: ${summary.completed}/${summary.totalFixtures} (missing ${summary.missing})`);
  console.log(`  quality-passed: ${summary.qualityPassed}, contract-passed: ${summary.contractPassed}, auto-approved: ${summary.autoApproved}, review-required: ${summary.reviewRequired}`);
  console.log(`  mean confidence: ${summary.meanConfidence ?? 'n/a'}`);
  console.log(`  mean reference similarity: ${summary.meanReferenceSimilarity ?? 'n/a'}`);
  console.log(`  latency p50/p95: ${summary.p50LatencyMs ?? 'n/a'} / ${summary.p95LatencyMs ?? 'n/a'} ms`);
  console.log(`  estimated cost: ${summary.totalEstimatedCostUsd == null ? 'n/a' : `$${summary.totalEstimatedCostUsd}`}`);
  const errors = Object.entries(summary.errorCounts).sort((a, b) => b[1] - a[1]);
  if (errors.length) console.log(`  errors: ${errors.map(([key, count]) => `${key}=${count}`).join(', ')}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixtures = loadJson(args.fixtures || DEFAULT_FIXTURE_URL);
  let results;
  if (args.results) {
    results = loadJson(args.results);
  } else {
    const baseline = args.baseline || 'reference';
    results = fixtures.map((fixture) => ({
      id: fixture.id,
      candidateName: baseline === 'japanese' ? fixture.sourceName : fixture.referenceName,
      sourceType: baseline === 'japanese' ? 'generated' : 'manual',
      provider: `baseline:${baseline}`,
      model: 'none',
    }));
  }
  const report = evaluateFixtureResults(fixtures, results, { threshold: Number(args.threshold || 0.85) });
  if (args.json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  if (args.output) fs.writeFileSync(args.output, `${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}
