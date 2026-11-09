import { Sparkles } from 'lucide-react';

import { errorMessage } from '@/api/client';
import { useAiStatus, useAiUsage, useSetAiFeatures } from '@/api/opportunities';
import { relativeTime } from '@/components/data/format';
import { ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { Alert } from '@/components/ui/alert';
import { SwitchField } from '@/components/ui/form';
import { Badge, Panel, type Tone } from '@/components/ui/surface';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';

const OUTCOME_TONE: Record<string, Tone | undefined> = {
  ok: 'success',
  error: 'danger',
  invalid_output: 'warning',
  disabled: 'neutral',
  not_consented: 'neutral',
  over_budget: 'warning',
};

/** Optional AI (ADR-023): provider status, monthly budget and per-feature consent. */
export function AiCard() {
  const workspace = useCurrentWorkspace();
  const status = useAiStatus(workspace?.id);
  const usage = useAiUsage(workspace?.id);
  const setFeatures = useSetAiFeatures(workspace?.id);
  const isAdmin = workspace?.role === 'owner' || workspace?.role === 'admin';

  return (
    <Panel title="AI assistance (optional)" icon={<Sparkles />}>
      {status.isPending ? (
        <LoadingState compact />
      ) : status.isError ? (
        <ErrorState compact error={status.error} onRetry={() => void status.refetch()} />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={status.data.available ? 'success' : 'neutral'} dot>
              {status.data.available
                ? `${status.data.provider} · ${status.data.model}`
                : 'disabled'}
            </Badge>
            <span className="text-ink-muted">
              {status.data.budget_used} / {status.data.budget_limit} requests this month
            </span>
          </div>
          {!status.data.available && (
            <p className="text-sm text-ink-muted">
              AI is off on this server, and everything works without it. To use a free local model,
              run Ollama and set <code className="font-mono text-xs">AI_PROVIDER=ollama</code> in
              the server environment. Paid cloud providers are not supported.
            </p>
          )}
          <div className="space-y-3">
            <p className="label-caps">Features allowed to use AI in {workspace?.name}</p>
            {status.data.features.map((feature) => (
              <div key={feature.key} className="rounded-md border border-line p-3">
                <SwitchField
                  label={feature.title}
                  checked={feature.enabled}
                  disabled={!isAdmin || setFeatures.isPending}
                  onCheckedChange={(on) =>
                    setFeatures.mutate(
                      status.data.features
                        .filter((f) => (f.key === feature.key ? on : f.enabled))
                        .map((f) => f.key),
                    )
                  }
                />
                <p className="mt-1.5 text-xs text-ink-muted">{feature.description}</p>
                <p className="mt-1 text-xs text-ink-dim">
                  Sent to the model: {feature.data_sent} Emails, IBANs, card and phone numbers are
                  removed first.
                </p>
              </div>
            ))}
            {!isAdmin && (
              <p className="text-xs text-ink-dim">Only owners and admins can change AI consent.</p>
            )}
          </div>
          {setFeatures.isError && <Alert tone="danger">{errorMessage(setFeatures.error)}</Alert>}
          {(usage.data ?? []).length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-ink-muted">Recent AI requests</summary>
              <ul className="mt-2 space-y-1">
                {(usage.data ?? []).slice(0, 10).map((u) => (
                  <li key={u.id} className="flex flex-wrap items-center gap-2 text-xs">
                    <Badge tone={OUTCOME_TONE[u.outcome] ?? 'neutral'}>
                      {u.outcome.replace('_', ' ')}
                    </Badge>
                    <span className="text-ink-muted">{u.feature}</span>
                    {u.outcome === 'ok' && (
                      <span className="font-mono text-ink-dim">
                        {u.input_tokens}+{u.output_tokens} tokens · {u.duration_ms} ms
                      </span>
                    )}
                    <span className="ml-auto text-ink-dim">{relativeTime(u.created_at)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </Panel>
  );
}
