// ── /synergy/shared/[token] — public, unauthenticated strategy view ──
//
// Renders a read-only strategy doc behind an unguessable token. Lives
// outside /app/* on purpose: /app/layout.tsx redirects to /auth/login
// when there's no user, which would make share links useless for
// non-signed-in viewers. This page server-fetches via the public API,
// so anyone with the token sees the strategy.
//
// Visual differences from the owner's strategy view:
//   - No edit affordances anywhere
//   - "Shared by <display_name>" pill in the header
//   - Bottom CTA inviting the viewer to sign up
//   - 410 / 404 / 410 error states render plain "link unavailable" cards

import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CircleSlash,
  Compass,
  Lightbulb,
  Megaphone,
  Network,
  Package,
  ShieldCheck,
  Sparkles,
  Target,
  UserCircle2,
} from "lucide-react";
import { headers } from "next/headers";

interface PageProps {
  params: Promise<{ token: string }>;
}

interface SharedStrategyPayload {
  share: {
    label: string | null;
    created_at: string;
    expires_at: string | null;
  };
  strategy: {
    id: string;
    statement: string | null;
    pitch: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  };
  blocks: Array<{
    id: string;
    block_type: "plan_step" | "risk" | "hypothesis" | "evidence" | "note";
    body: string;
    sort_order: number;
    meta: Record<string, unknown>;
    created_at: string;
  }>;
  components: Array<{
    id: string;
    kind: "core_idea" | "upstream" | "downstream" | "polished_product";
    subkind: string | null;
    label_public: string;
    description_public: string;
    created_at: string;
  }>;
  owner: { display_name: string; avatar_url: string | null; bio: string | null } | null;
}

async function fetchShared(
  token: string,
): Promise<
  | { ok: true; data: SharedStrategyPayload }
  | { ok: false; status: number; message: string }
> {
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("host") ?? "localhost:3000";
  const base = `${proto}://${host}`;
  const res = await fetch(
    `${base}/api/synergy/shared/${encodeURIComponent(token)}`,
    {
      cache: "no-store",
    },
  );
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // ignore
    }
    return { ok: false, status: res.status, message: msg };
  }
  const data = (await res.json()) as SharedStrategyPayload;
  return { ok: true, data };
}

export default async function SharedStrategyPage({ params }: PageProps) {
  const { token } = await params;
  const result = await fetchShared(token);

  if (!result.ok) {
    return <UnavailableCard status={result.status} message={result.message} />;
  }

  const { strategy, blocks, components, owner, share } = result.data;
  const planSteps = blocks.filter((b) => b.block_type === "plan_step");
  const risks = blocks.filter((b) => b.block_type === "risk");
  const hypotheses = blocks.filter((b) => b.block_type === "hypothesis");
  const evidence = blocks.filter((b) => b.block_type === "evidence");
  const notes = blocks.filter((b) => b.block_type === "note");

  const grouped = new Map<string, typeof components>();
  for (const c of components) {
    const arr = grouped.get(c.kind) ?? [];
    arr.push(c);
    grouped.set(c.kind, arr);
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 via-white to-gray-50">
      <div className="mx-auto max-w-3xl px-4 py-12">
        <header className="mb-8 flex items-center justify-between gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm font-semibold text-gray-700 transition hover:text-gray-900"
            aria-label="InterAxis home"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-blue-600 text-[10px] font-bold text-white">
              IA
            </span>
            InterAxis
          </Link>
          <div className="inline-flex items-center gap-2 rounded-full border border-gray-200 bg-white px-3 py-1 text-[11px] font-medium text-gray-700">
            <ShieldCheck className="h-3 w-3 text-emerald-600" />
            Shared strategy · read-only
          </div>
        </header>

        {/* ── Owner attribution ── */}
        {owner && (
          <div className="mb-6 flex items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4">
            <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full bg-blue-100 text-blue-700 ring-1 ring-blue-200">
              {owner.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={owner.avatar_url}
                  alt={`${owner.display_name} avatar`}
                  className="h-full w-full object-cover"
                />
              ) : (
                <UserCircle2 className="h-6 w-6" />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-mono uppercase tracking-wider text-gray-500">
                Shared by
              </div>
              <div className="text-[14px] font-semibold text-gray-900">
                {owner.display_name}
              </div>
              {owner.bio && (
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-gray-600">
                  {owner.bio}
                </p>
              )}
            </div>
            {share.label && (
              <span className="rounded-full bg-blue-50 px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-blue-700">
                {share.label}
              </span>
            )}
          </div>
        )}

        {/* ── Strategy doc ── */}
        <article className="rounded-2xl border border-gray-200 bg-white p-8 shadow-sm">
          <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-gray-500">
            <Target className="h-3 w-3 text-blue-600" />
            Strategy
          </div>
          {strategy.statement && (
            <h1 className="mt-3 text-3xl font-semibold leading-tight tracking-tight text-gray-900">
              {strategy.statement}
            </h1>
          )}
          {strategy.pitch && (
            <p className="mt-4 text-[15px] leading-relaxed text-gray-700">
              {strategy.pitch}
            </p>
          )}

          {planSteps.length > 0 && (
            <Section icon={Sparkles} label="The plan">
              <ol className="space-y-3">
                {planSteps.map((b, i) => (
                  <PlanCard key={b.id} index={i + 1} block={b} />
                ))}
              </ol>
            </Section>
          )}

          {(grouped.get("upstream") ?? []).length > 0 && (
            <Section icon={Compass} label="Upstream — what this needs">
              <ComponentList items={grouped.get("upstream") ?? []} />
            </Section>
          )}

          {(grouped.get("downstream") ?? []).length > 0 && (
            <Section icon={Package} label="Downstream — what this produces">
              <ComponentList items={grouped.get("downstream") ?? []} />
            </Section>
          )}

          {(grouped.get("polished_product") ?? []).length > 0 && (
            <Section icon={Megaphone} label="Polished products">
              <ComponentList items={grouped.get("polished_product") ?? []} />
            </Section>
          )}

          {risks.length > 0 && (
            <Section icon={AlertTriangle} label="Risks">
              <div className="space-y-3">
                {risks.map((b) => (
                  <RiskCard key={b.id} block={b} />
                ))}
              </div>
            </Section>
          )}

          {hypotheses.length > 0 && (
            <Section icon={Lightbulb} label="Hypotheses">
              <div className="space-y-3">
                {hypotheses.map((b) => (
                  <HypothesisCard key={b.id} block={b} />
                ))}
              </div>
            </Section>
          )}

          {evidence.length > 0 && (
            <Section icon={ShieldCheck} label="Evidence">
              <div className="space-y-3">
                {evidence.map((b) => (
                  <EvidenceCard key={b.id} block={b} />
                ))}
              </div>
            </Section>
          )}

          {notes.length > 0 && (
            <Section icon={Network} label="Notes">
              <div className="space-y-3">
                {notes.map((b) => (
                  <NoteCard key={b.id} block={b} />
                ))}
              </div>
            </Section>
          )}
        </article>

        {/* ── Sign-up CTA ── */}
        <div className="mt-8 rounded-2xl border border-blue-200 bg-gradient-to-br from-blue-50 to-white p-6 text-center shadow-sm">
          <Sparkles className="mx-auto h-5 w-5 text-blue-600" />
          <h3 className="mt-2 text-lg font-semibold text-gray-900">
            Build your own living strategy
          </h3>
          <p className="mx-auto mt-1 max-w-md text-[13px] leading-relaxed text-gray-600">
            InterAxis turns scattered brainstorms into structured plans, then
            matches you with collaborators whose components complement yours.
          </p>
          <Link
            href="/auth/login"
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
          >
            Try it free
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>

        <p className="mt-6 text-center text-[11px] text-gray-500">
          This is a read-only snapshot. The owner can revoke this link at any
          time.
        </p>
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8 border-t border-gray-100 pt-6">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
        <Icon className="h-3.5 w-3.5 text-blue-600" />
        {label}
      </div>
      {children}
    </section>
  );
}

function PlanCard({
  index,
  block,
}: {
  index: number;
  block: SharedStrategyPayload["blocks"][number];
}) {
  const meta = block.meta as {
    title?: string;
    detail?: string;
    sub_steps?: Array<{ title?: string; detail?: string }>;
  };
  return (
    <li className="rounded-xl border border-blue-100 bg-blue-50/30 p-4">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] font-semibold tracking-wide text-blue-700">
          {String(index).padStart(2, "0")}
        </span>
        <div className="min-w-0 flex-1">
          <h4 className="text-[14px] font-semibold text-gray-900">
            {meta.title || block.body}
          </h4>
          {meta.detail && (
            <p className="mt-1 text-[12.5px] leading-relaxed text-gray-700">
              {meta.detail}
            </p>
          )}
          {Array.isArray(meta.sub_steps) && meta.sub_steps.length > 0 && (
            <ul className="mt-2 space-y-1.5 border-l border-blue-200 pl-3">
              {meta.sub_steps.map((s, i) => (
                <li key={i} className="text-[12px] text-gray-700">
                  <span className="font-semibold text-gray-900">
                    {s.title ?? `Step ${i + 1}`}
                  </span>
                  {s.detail ? <> — {s.detail}</> : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </li>
  );
}

function RiskCard({ block }: { block: SharedStrategyPayload["blocks"][number] }) {
  const meta = block.meta as {
    title?: string;
    detail?: string;
    severity?: "high" | "medium" | "low";
    mitigations?: Array<{ title?: string; detail?: string }>;
  };
  const tone = {
    high: "border-rose-200 bg-rose-50/40 text-rose-900",
    medium: "border-amber-200 bg-amber-50/40 text-amber-900",
    low: "border-gray-200 bg-gray-50/40 text-gray-900",
  }[meta.severity ?? "medium"];
  return (
    <div className={`rounded-xl border p-4 ${tone}`}>
      <div className="flex items-center gap-2">
        <AlertTriangle className="h-3.5 w-3.5" />
        <h4 className="text-[14px] font-semibold">{meta.title || block.body}</h4>
        {meta.severity && (
          <span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider">
            {meta.severity}
          </span>
        )}
      </div>
      {meta.detail && (
        <p className="mt-1.5 text-[12.5px] leading-relaxed">{meta.detail}</p>
      )}
      {Array.isArray(meta.mitigations) && meta.mitigations.length > 0 && (
        <div className="mt-2 rounded-lg bg-white/60 p-2.5">
          <div className="font-mono text-[9px] uppercase tracking-wider text-gray-600">
            mitigations
          </div>
          <ul className="mt-1 space-y-1">
            {meta.mitigations.map((m, i) => (
              <li key={i} className="text-[12px] text-gray-700">
                <span className="font-semibold">
                  {m.title ?? `Mitigation ${i + 1}`}
                </span>
                {m.detail ? <> — {m.detail}</> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function HypothesisCard({
  block,
}: {
  block: SharedStrategyPayload["blocks"][number];
}) {
  const meta = block.meta as {
    claim?: string;
    rationale?: string;
    evidence_status?: string;
  };
  return (
    <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-4">
      <div className="flex items-center gap-2">
        <Lightbulb className="h-3.5 w-3.5 text-purple-600" />
        <h4 className="text-[14px] font-semibold text-gray-900">
          {meta.claim || block.body}
        </h4>
        {meta.evidence_status && (
          <span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-purple-700">
            {meta.evidence_status}
          </span>
        )}
      </div>
      {meta.rationale && (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-700">
          {meta.rationale}
        </p>
      )}
    </div>
  );
}

function EvidenceCard({
  block,
}: {
  block: SharedStrategyPayload["blocks"][number];
}) {
  const meta = block.meta as {
    source_title?: string;
    url?: string;
    summary?: string;
  };
  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-700" />
        {meta.url ? (
          <a
            href={meta.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[14px] font-semibold text-emerald-900 underline-offset-2 hover:underline"
          >
            {meta.source_title || block.body}
          </a>
        ) : (
          <h4 className="text-[14px] font-semibold text-emerald-900">
            {meta.source_title || block.body}
          </h4>
        )}
      </div>
      {meta.summary && (
        <p className="mt-1.5 text-[12.5px] leading-relaxed text-gray-700">
          {meta.summary}
        </p>
      )}
    </div>
  );
}

function NoteCard({ block }: { block: SharedStrategyPayload["blocks"][number] }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4">
      <p className="text-[12.5px] leading-relaxed text-gray-700">{block.body}</p>
    </div>
  );
}

function ComponentList({
  items,
}: {
  items: SharedStrategyPayload["components"];
}) {
  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <li
          key={c.id}
          className="rounded-xl border border-gray-200 bg-white p-3"
        >
          <div className="flex items-center gap-2">
            <h5 className="text-[13px] font-semibold text-gray-900">
              {c.label_public}
            </h5>
            {c.subkind && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gray-600">
                {c.subkind}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12px] leading-relaxed text-gray-700">
            {c.description_public}
          </p>
        </li>
      ))}
    </ul>
  );
}

function UnavailableCard({
  status,
  message,
}: {
  status: number;
  message: string;
}) {
  const kind =
    status === 410
      ? { title: "This link is no longer active", detail: message }
      : status === 404
        ? {
            title: "Link not found",
            detail:
              "The strategy link you followed is invalid or the owner deleted it.",
          }
        : {
            title: "Couldn't load this strategy",
            detail: "Try again in a moment.",
          };
  return (
    <div className="mx-auto max-w-md py-20">
      <div className="rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <CircleSlash className="mx-auto h-7 w-7 text-gray-400" />
        <h1 className="mt-3 text-lg font-semibold text-gray-900">
          {kind.title}
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-gray-600">{kind.detail}</p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:scale-[1.02]"
        >
          Back to InterAxis
        </Link>
      </div>
    </div>
  );
}
