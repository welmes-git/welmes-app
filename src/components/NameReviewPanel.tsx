/**
 * NameReviewPanel — Task 7 admin English-name review UI.
 *
 * Shows the Japanese source, the AI candidate, deterministic extracted facts,
 * evidence URLs and warnings side by side, and lets an admin approve as-is,
 * approve after editing, regenerate, or hold. Human approvals stamp the
 * reviewer + time and set status to `human_approved` so the worker will not
 * overwrite them (enforced in the completion RPC).
 */
import { useEffect, useState } from 'react';
import { CheckCircle2, AlertTriangle, RefreshCw, PauseCircle, ExternalLink, ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import * as db from '../lib/db';
import { slugifyProductName, resolveApprovalSource, validateApprovalName } from '../lib/nameReview';
import type { Product, ProductNameSource } from '../store/useStore';

type ToastKind = 'success' | 'error' | 'info';

interface Props {
  product: Product;
  reviewerId: string;
  showToast: (message: string, kind: ToastKind) => void;
  /** Called after any DB mutation so the parent can refresh its product list. */
  onApplied: () => void;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pending',
  queued: 'Queued',
  auto_approved: 'Auto-approved',
  review_required: 'Review required',
  human_approved: 'Human-approved',
  failed: 'Failed',
};

function confidenceTone(c?: number): string {
  if (c == null) return 'bg-[#eee] text-[#666]';
  if (c >= 0.85) return 'bg-green-100 text-green-700';
  if (c >= 0.6) return 'bg-yellow-100 text-yellow-700';
  return 'bg-red-100 text-red-700';
}

export default function NameReviewPanel({ product, reviewerId, showToast, onApplied }: Props) {
  const [run, setRun] = useState<db.NameEnrichmentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  // Editable approval fields — seeded from the latest candidate, admin can edit.
  const [nameEn, setNameEn] = useState(product.nameEn);
  const [seoTitle, setSeoTitle] = useState(product.seoTitle ?? '');
  const [seoDescription, setSeoDescription] = useState(product.seoDescription ?? '');
  const [aliasesText, setAliasesText] = useState((product.searchAliases ?? []).join(', '));

  useEffect(() => {
    let cancelled = false;
    // Kick off the async load; the first state update happens after the await,
    // so we never call setState synchronously inside the effect body.
    (async () => {
      const r = await db.fetchLatestNameRun(product.id);
      if (cancelled) return;
      setRun(r);
      // When the product is queued for review, the latest run candidate is the
      // freshest proposal, so prefer it as the editable value; otherwise trust
      // the product's already-stored English name and fall back to the run.
      const reviewing = product.nameEnStatus === 'review_required';
      const candidate = reviewing
        ? (r?.candidateName || product.nameEn || '')
        : (product.nameEn || r?.candidateName || '');
      setNameEn(candidate);
      setSeoTitle((reviewing ? (r?.seoTitle ?? product.seoTitle) : (product.seoTitle ?? r?.seoTitle)) ?? '');
      setSeoDescription((reviewing ? (r?.seoDescription ?? product.seoDescription) : (product.seoDescription ?? r?.seoDescription)) ?? '');
      const aliasSource = reviewing
        ? (r?.searchAliases?.length ? r.searchAliases : product.searchAliases ?? [])
        : (product.searchAliases?.length ? product.searchAliases : r?.searchAliases ?? []);
      setAliasesText(aliasSource.join(', '));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [product.id, product.nameEn, product.nameEnStatus, product.seoTitle, product.seoDescription, product.searchAliases]);

  const aliases = () => aliasesText.split(',').map((s) => s.trim()).filter(Boolean);
  const edited = nameEn.trim() !== (run?.candidateName ?? product.nameEn).trim();
  // Snapshot of what the reviewer is approving against — enforced by the RPC's
  // optimistic-concurrency check so a stale candidate cannot be stamped over a
  // newer worker run.
  const concurrency = (): db.ApprovalConcurrency => ({
    expectedRunId: run?.id ?? null,
    expectedGeneratedAt: product.nameEnGeneratedAt ?? null,
  });

  async function doApprove(source: ProductNameSource) {
    const check = validateApprovalName(nameEn);
    if (!check.ok) { showToast(check.message, 'error'); return; }
    if (!reviewerId) { showToast('No reviewer identity found', 'error'); return; }
    setBusy(source === 'manual' ? 'edit' : 'approve');
    const { error } = await db.approveProductName(
      product.id,
      reviewerId,
      {
        nameEn: nameEn.trim(),
        seoTitle: seoTitle.trim() || undefined,
        seoDescription: seoDescription.trim() || undefined,
        searchAliases: aliases(),
        seoSlug: slugifyProductName(nameEn.trim(), product.id),
        source,
      },
      concurrency(),
    );
    setBusy(null);
    if (error) { showToast(`Approve failed: ${error.message}`, 'error'); return; }
    showToast('English name approved', 'success');
    onApplied();
  }

  async function doRegenerate() {
    setBusy('regen');
    const { error } = await db.regenerateProductName(product.id, concurrency());
    setBusy(null);
    if (error) { showToast(`Regenerate failed: ${error.message}`, 'error'); return; }
    showToast('A fresh enrichment job was queued for regeneration', 'success');
    onApplied();
  }

  async function doHold() {
    setBusy('hold');
    const { error } = await db.holdProductNameReview(product.id);
    setBusy(null);
    if (error) { showToast(`Hold failed: ${error.message}`, 'error'); return; }
    showToast('Kept in the review queue', 'info');
    onApplied();
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-[13px] text-[#888] py-6 justify-center">
        <Loader2 size={16} className="animate-spin" /> Loading review data…
      </div>
    );
  }

  const facts = (run?.extracted.facts ?? {}) as { source?: Array<{ type: string; raw: string }> };
  const sourceFacts = Array.isArray(facts.source) ? facts.source : [];

  return (
    <div className="border border-[#e5e5e5] rounded-lg overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 bg-[#f8f8fa] px-4 py-2.5 border-b border-[#eee]">
        <span className="text-[13px] font-semibold text-[#333]">English name review</span>
        <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${confidenceTone(product.nameEnConfidence)}`}>
          {STATUS_LABEL[product.nameEnStatus ?? 'pending'] ?? product.nameEnStatus}
        </span>
        {product.nameEnConfidence != null && (
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${confidenceTone(product.nameEnConfidence)}`}>
            {(product.nameEnConfidence * 100).toFixed(0)}% confidence
          </span>
        )}
        {product.nameEnSource && (
          <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#eef] text-[#446]">
            {product.nameEnSource}
          </span>
        )}
        {run && (
          <span className="ml-auto text-[11px] text-[#999]">{run.provider}/{run.model}</span>
        )}
      </div>

      <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Left: source + extracted facts */}
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-medium text-[#999] mb-1">Japanese source</p>
            <p className="text-[13px] text-[#333] leading-relaxed" lang="ja">{product.name}</p>
          </div>
          <div>
            <p className="text-[11px] font-medium text-[#999] mb-1">Extracted brand / facts</p>
            <div className="flex flex-wrap gap-1">
              {run?.extracted.brand && (
                <span className="px-2 py-0.5 rounded bg-[#f0f0f0] text-[11px] text-[#555]">brand: {run.extracted.brand}</span>
              )}
              {sourceFacts.map((f, i) => (
                <span key={i} className="px-2 py-0.5 rounded bg-[#f0f0f0] text-[11px] text-[#555]">{f.type}: {f.raw}</span>
              ))}
              {!run?.extracted.brand && sourceFacts.length === 0 && (
                <span className="text-[12px] text-[#bbb]">No deterministic facts extracted</span>
              )}
            </div>
          </div>
          {run?.candidateName && (
            <div>
              <p className="text-[11px] font-medium text-[#999] mb-1">AI candidate</p>
              <p className="text-[13px] text-[#333]">{run.candidateName}</p>
            </div>
          )}
        </div>

        {/* Right: evidence + warnings + errors */}
        <div className="space-y-3">
          <div>
            <p className="text-[11px] font-medium text-[#999] mb-1">Evidence URLs</p>
            {run && run.evidence.length > 0 ? (
              <ul className="space-y-1">
                {run.evidence.map((e, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[12px]">
                    {e.verified
                      ? <ShieldCheck size={14} className="text-green-600 mt-0.5 shrink-0" />
                      : <ShieldAlert size={14} className="text-[#c99a00] mt-0.5 shrink-0" />}
                    <a
                      href={e.resolvedUrl ?? e.citationUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-[#4a90e2] hover:underline break-all inline-flex items-center gap-1"
                    >
                      {(e.officialDomain ?? new URL(e.resolvedUrl ?? e.citationUrl).hostname)}
                      <ExternalLink size={11} className="shrink-0" />
                    </a>
                    {e.matchedBy.length > 0 && (
                      <span className="text-[#999]">({e.matchedBy.join(', ')})</span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[12px] text-[#bbb]">No verified evidence — treat as generated.</p>
            )}
          </div>

          {run && run.warnings.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-[#999] mb-1 flex items-center gap-1">
                <AlertTriangle size={12} className="text-[#c99a00]" /> Warnings
              </p>
              <ul className="list-disc list-inside space-y-0.5">
                {run.warnings.map((w, i) => (
                  <li key={i} className="text-[12px] text-[#8a6d00]">{w}</li>
                ))}
              </ul>
            </div>
          )}

          {run && run.errors.length > 0 && (
            <div>
              <p className="text-[11px] font-medium text-red-600 mb-1">Validation errors</p>
              <ul className="list-disc list-inside space-y-0.5">
                {run.errors.map((e, i) => (
                  <li key={i} className="text-[12px] text-red-600">{e.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Editable approval fields */}
      <div className="px-4 pb-4 space-y-3 border-t border-[#f0f0f0] pt-3">
        <div>
          <label className="text-[11px] font-medium text-[#999] mb-1 block">English name {edited && <span className="text-[#4a90e2]">(edited)</span>}</label>
          <input
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
            className="w-full h-9 px-3 border border-[#e5e5e5] rounded-lg text-[13px] focus:outline-none focus:border-[#333]"
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-medium text-[#999] mb-1 block">SEO title</label>
            <input
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              maxLength={160}
              className="w-full h-9 px-3 border border-[#e5e5e5] rounded-lg text-[13px] focus:outline-none focus:border-[#333]"
            />
          </div>
          <div>
            <label className="text-[11px] font-medium text-[#999] mb-1 block">Search aliases (comma-separated)</label>
            <input
              value={aliasesText}
              onChange={(e) => setAliasesText(e.target.value)}
              className="w-full h-9 px-3 border border-[#e5e5e5] rounded-lg text-[13px] focus:outline-none focus:border-[#333]"
            />
          </div>
        </div>
        <div>
          <label className="text-[11px] font-medium text-[#999] mb-1 block">SEO description</label>
          <textarea
            value={seoDescription}
            onChange={(e) => setSeoDescription(e.target.value)}
            maxLength={300}
            rows={2}
            className="w-full px-3 py-2 border border-[#e5e5e5] rounded-lg text-[13px] focus:outline-none focus:border-[#333] resize-none"
          />
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => doApprove(resolveApprovalSource(nameEn, run?.candidateName, product.nameEnSource))}
            disabled={busy != null}
            className="h-9 px-4 bg-green-600 text-white rounded-lg text-[13px] font-medium flex items-center gap-1.5 hover:bg-green-700 disabled:opacity-50"
          >
            {busy === 'approve' || busy === 'edit'
              ? <Loader2 size={15} className="animate-spin" />
              : <CheckCircle2 size={15} />}
            {edited ? 'Approve edited' : 'Approve'}
          </button>
          <button
            onClick={doRegenerate}
            disabled={busy != null}
            className="h-9 px-4 border border-[#ddd] text-[#333] rounded-lg text-[13px] font-medium flex items-center gap-1.5 hover:bg-[#f5f5f5] disabled:opacity-50"
          >
            {busy === 'regen' ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            Regenerate
          </button>
          <button
            onClick={doHold}
            disabled={busy != null}
            className="h-9 px-4 border border-[#ddd] text-[#666] rounded-lg text-[13px] font-medium flex items-center gap-1.5 hover:bg-[#f5f5f5] disabled:opacity-50"
          >
            {busy === 'hold' ? <Loader2 size={15} className="animate-spin" /> : <PauseCircle size={15} />}
            Hold
          </button>
        </div>
        {product.nameEnStatus === 'human_approved' && product.nameEnApprovedAt && (
          <p className="text-[11px] text-[#999]">
            Human-approved on {new Date(product.nameEnApprovedAt).toLocaleString()}
            {product.nameEnApprovedBy ? ` · reviewer ${product.nameEnApprovedBy.slice(0, 8)}` : ''}
          </p>
        )}
      </div>
    </div>
  );
}
