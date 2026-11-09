import {
  Bookmark,
  Check,
  ExternalLink,
  Plus,
  RefreshCw,
  Rss,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useState } from 'react';

import { errorMessage } from '@/api/client';
import {
  useAddOpportunity,
  useAiStatus,
  useDeleteSource,
  useOpportunities,
  useOpportunityProfile,
  useOpportunitySources,
  usePollSource,
  useSaveFeed,
  useSaveOpportunityProfile,
  useSetOpportunityStatus,
  useSummarizeOpportunity,
  type Opportunity,
  type OpportunityProfile,
  type OpportunityStatus,
} from '@/api/opportunities';
import { relativeTime } from '@/components/data/format';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/StateViews';
import { PageHeader } from '@/components/layout/PageHeader';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, SwitchField, Textarea } from '@/components/ui/form';
import { Modal, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { Badge, Panel } from '@/components/ui/surface';
import { useCurrentWorkspace } from '@/hooks/useCurrentWorkspace';
import { cn } from '@/lib/cn';

const STATUS_VIEWS: { value: OpportunityStatus | 'active'; label: string }[] = [
  { value: 'active', label: 'Active' },
  { value: 'new', label: 'New' },
  { value: 'saved', label: 'Saved' },
  { value: 'applied', label: 'Applied' },
  { value: 'dismissed', label: 'Dismissed' },
];

function ScoreBadge({ score, excluded }: { score: number; excluded: boolean }) {
  const tone = excluded
    ? 'border-line-strong text-ink-dim'
    : score >= 70
      ? 'border-success/50 text-success'
      : score >= 40
        ? 'border-cyan/50 text-cyan'
        : 'border-line-strong text-ink-muted';
  return (
    <span
      className={cn(
        'flex size-12 shrink-0 flex-col items-center justify-center rounded-full border-2 font-mono',
        tone,
      )}
      title={excluded ? 'Excluded by your profile' : `Match score ${String(score)} of 100`}
    >
      <span className="text-sm leading-none font-semibold tabular-nums">{score}</span>
      <span className="text-[9px] tracking-wide text-ink-dim uppercase">match</span>
    </span>
  );
}

function OpportunityCard({
  item,
  canEdit,
  aiReady,
  aiHint,
  workspaceId,
}: {
  item: Opportunity;
  canEdit: boolean;
  aiReady: boolean;
  aiHint: string;
  workspaceId: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const setStatus = useSetOpportunityStatus(workspaceId);
  const summarize = useSummarizeOpportunity(workspaceId);
  const description = item.description;
  const long = description.length > 320;
  return (
    <li className="glass rounded-lg p-4">
      <div className="flex items-start gap-3">
        <ScoreBadge score={item.score} excluded={item.excluded} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {item.url ? (
              <a
                href={item.url}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="font-display font-semibold text-ink hover:underline"
              >
                {item.title}
                <ExternalLink className="ml-1 inline size-3.5 text-ink-dim" aria-hidden />
              </a>
            ) : (
              <span className="font-display font-semibold text-ink">{item.title}</span>
            )}
            {item.status !== 'new' && <Badge>{item.status}</Badge>}
          </div>
          <p className="text-xs text-ink-dim">
            {[item.company, item.budget_text, item.posted_at && relativeTime(item.posted_at)]
              .filter(Boolean)
              .join(' · ') || 'No details'}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.reasons.map((reason) => (
              <Badge
                key={reason}
                tone={/halved|Excluded/.test(reason) ? 'warning' : 'neutral'}
                className="normal-case"
              >
                {reason}
              </Badge>
            ))}
          </div>
          {description && (
            <p className="mt-2 text-sm whitespace-pre-line text-ink-muted">
              {expanded || !long ? description : `${description.slice(0, 320)}…`}
              {long && (
                <button
                  type="button"
                  className="ml-1 text-xs text-electric-soft hover:underline"
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded ? 'less' : 'more'}
                </button>
              )}
            </p>
          )}
          {item.ai_summary && (
            <div className="mt-3 rounded-md border border-violet/30 bg-violet/[0.05] p-3 text-sm">
              <p className="mb-1 flex items-center gap-1.5 text-xs text-violet">
                <Sparkles className="size-3.5" aria-hidden /> AI summary (may be wrong — check the
                listing)
              </p>
              {/* AI output is untrusted: rendered as plain text only (ADR-023). */}
              <p className="text-ink">{item.ai_summary.summary}</p>
              {(item.ai_summary.fit ?? []).length > 0 && (
                <ul className="mt-2 list-inside list-disc text-ink-muted">
                  {(item.ai_summary.fit ?? []).map((f) => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              )}
              {(item.ai_summary.concerns ?? []).length > 0 && (
                <ul className="mt-1 list-inside list-disc text-warning/90">
                  {(item.ai_summary.concerns ?? []).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {summarize.isError && (
            <Alert tone="warning" className="mt-2">
              {errorMessage(summarize.error)}
            </Alert>
          )}
        </div>
        {canEdit && (
          <div className="flex shrink-0 flex-col gap-1.5">
            {item.status !== 'saved' && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Save"
                title="Save"
                onClick={() => setStatus.mutate({ id: item.id, status: 'saved' })}
              >
                <Bookmark />
              </Button>
            )}
            {item.status !== 'applied' && (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Mark applied"
                title="Mark applied"
                onClick={() => setStatus.mutate({ id: item.id, status: 'applied' })}
              >
                <Check />
              </Button>
            )}
            {item.status !== 'dismissed' ? (
              <Button
                size="icon-sm"
                variant="ghost"
                aria-label="Dismiss"
                title="Dismiss"
                onClick={() => setStatus.mutate({ id: item.id, status: 'dismissed' })}
              >
                <X />
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setStatus.mutate({ id: item.id, status: 'new' })}
              >
                Restore
              </Button>
            )}
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="AI summary"
              title={aiReady ? 'AI summary' : aiHint}
              disabled={!aiReady}
              loading={summarize.isPending}
              onClick={() => summarize.mutate(item.id)}
            >
              <Sparkles />
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

function MatchesTab({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const [view, setView] = useState<OpportunityStatus | 'active'>('active');
  const [minScore, setMinScore] = useState(0);
  const [q, setQ] = useState('');
  const listings = useOpportunities(workspaceId, {
    ...(view === 'active' ? {} : { status: view }),
    minScore,
    ...(q.trim().length >= 2 ? { q: q.trim() } : {}),
  });
  const ai = useAiStatus(workspaceId);
  const aiFeature = ai.data?.features.find((f) => f.key === 'opportunities.summary');
  const aiReady = Boolean(ai.data?.available && aiFeature?.enabled);
  const aiHint = !ai.data?.available
    ? 'AI is disabled on this server (optional)'
    : 'Enable “Freelance listing summaries” in Settings → AI';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={view} onValueChange={(v) => setView(v as OpportunityStatus | 'active')}>
          <TabsList aria-label="Listing status">
            {STATUS_VIEWS.map((s) => (
              <TabsTrigger key={s.value} value={s.value}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Select
          aria-label="Minimum score"
          value={String(minScore)}
          className="w-auto min-w-36"
          onChange={(e) => setMinScore(Number(e.target.value))}
        >
          <option value="0">Any score</option>
          <option value="40">Score ≥ 40</option>
          <option value="60">Score ≥ 60</option>
          <option value="80">Score ≥ 80</option>
        </Select>
        <div className="relative min-w-48 flex-1">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-dim"
            aria-hidden
          />
          <Input
            aria-label="Search listings"
            placeholder="Search title or company"
            value={q}
            className="pl-9"
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </div>
      {listings.isPending ? (
        <LoadingState />
      ) : listings.isError ? (
        <ErrorState error={listings.error} onRetry={() => void listings.refetch()} />
      ) : listings.data.length === 0 ? (
        <Panel>
          <EmptyState
            title="No listings here"
            description="Add a feed in Sources or paste a listing manually. Set your skills in Profile so listings get scored."
          />
        </Panel>
      ) : (
        <ul className="space-y-3" aria-label="Opportunities">
          {listings.data.map((item) => (
            <OpportunityCard
              key={item.id}
              item={item}
              canEdit={canEdit}
              aiReady={aiReady}
              aiHint={aiHint}
              workspaceId={workspaceId}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ManualDialog({ workspaceId, onClose }: { workspaceId: string; onClose: () => void }) {
  const add = useAddOpportunity(workspaceId);
  const [form, setForm] = useState({
    title: '',
    url: '',
    company: '',
    budget_text: '',
    description: '',
  });
  const urlOk = !form.url || /^https?:\/\//.test(form.url);
  return (
    <Modal
      open
      onOpenChange={(open) => !open && onClose()}
      title="Add a listing"
      description="Paste a listing you found (an email, a forum post, a site). It is scored against your profile."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={add.isPending}
            disabled={!form.title.trim() || !urlOk}
            onClick={() =>
              add.mutate({ ...form, url: form.url.trim() || null }, { onSuccess: onClose })
            }
          >
            Add listing
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" required className="sm:col-span-2">
          {(p) => (
            <Input
              {...p}
              value={form.title}
              maxLength={300}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          )}
        </Field>
        <Field label="Link" error={urlOk ? null : 'Use an http(s) link.'}>
          {(p) => (
            <Input
              {...p}
              value={form.url}
              placeholder="https://"
              onChange={(e) => setForm({ ...form, url: e.target.value })}
            />
          )}
        </Field>
        <Field label="Company">
          {(p) => (
            <Input
              {...p}
              value={form.company}
              maxLength={200}
              onChange={(e) => setForm({ ...form, company: e.target.value })}
            />
          )}
        </Field>
        <Field label="Budget / rate" className="sm:col-span-2" help="e.g. $50-70/hr">
          {(p) => (
            <Input
              {...p}
              value={form.budget_text}
              maxLength={200}
              onChange={(e) => setForm({ ...form, budget_text: e.target.value })}
            />
          )}
        </Field>
        <Field label="Description" className="sm:col-span-2">
          {(p) => (
            <Textarea
              {...p}
              value={form.description}
              className="min-h-32"
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          )}
        </Field>
      </div>
      {add.isError && (
        <Alert tone="danger" className="mt-3">
          {errorMessage(add.error)}
        </Alert>
      )}
    </Modal>
  );
}

function SourcesTab({
  workspaceId,
  canEdit,
  isAdmin,
}: {
  workspaceId: string;
  canEdit: boolean;
  isAdmin: boolean;
}) {
  const sources = useOpportunitySources(workspaceId);
  const saveFeed = useSaveFeed(workspaceId);
  const remove = useDeleteSource(workspaceId);
  const poll = usePollSource(workspaceId);
  const [manualOpen, setManualOpen] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [pollEvery, setPollEvery] = useState('60');
  const error = saveFeed.error ?? remove.error ?? poll.error;

  return (
    <div className="space-y-4">
      <Panel title="Feeds" icon={<Rss />}>
        <p className="mb-3 text-sm text-ink-muted">
          RSS/Atom feeds that job boards publish for this purpose. Feeds are fetched over https
          only, at most every 30 minutes, and never from private network addresses. Pages are never
          scraped.
        </p>
        {error && (
          <Alert tone="danger" className="mb-3">
            {errorMessage(error)}
          </Alert>
        )}
        {poll.data && (
          <Alert tone={poll.data.status === 'error' ? 'warning' : 'success'} className="mb-3">
            {poll.data.status === 'error'
              ? `Poll failed: ${poll.data.error}`
              : poll.data.status === 'not_modified'
                ? 'No changes since the last poll.'
                : `Fetched ${String(poll.data.new)} new listing(s).`}
          </Alert>
        )}
        {sources.isPending ? (
          <LoadingState compact />
        ) : sources.isError ? (
          <ErrorState compact error={sources.error} />
        ) : (
          <ul className="space-y-2" aria-label="Sources">
            {sources.data.map((s) => (
              <li
                key={s.id}
                className="flex flex-wrap items-center gap-3 rounded-md border border-line p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    {s.name}
                    {s.kind === 'manual' && <Badge>manual</Badge>}
                    {s.kind === 'feed' && !s.enabled && <Badge>paused</Badge>}
                    {s.last_status === 'error' && <Badge tone="danger">error</Badge>}
                  </p>
                  {s.url && (
                    <p className="truncate font-mono text-xs text-ink-dim" title={s.url}>
                      {s.url}
                    </p>
                  )}
                  {s.kind === 'feed' && (
                    <p className="text-xs text-ink-dim">
                      every {s.poll_interval_minutes} min ·{' '}
                      {s.last_polled_at
                        ? `polled ${relativeTime(s.last_polled_at)}`
                        : 'not polled yet'}
                      {s.last_error ? ` · ${s.last_error}` : ''}
                    </p>
                  )}
                </div>
                {s.kind === 'feed' && canEdit && (
                  <Button
                    size="sm"
                    variant="secondary"
                    loading={poll.isPending && poll.variables === s.id}
                    onClick={() => poll.mutate(s.id)}
                  >
                    <RefreshCw /> Poll now
                  </Button>
                )}
                {s.kind === 'feed' && isAdmin && (
                  <SwitchField
                    label="Enabled"
                    checked={s.enabled}
                    onCheckedChange={(enabled) =>
                      saveFeed.mutate({
                        id: s.id,
                        body: {
                          name: s.name,
                          url: s.url ?? '',
                          enabled,
                          poll_interval_minutes: s.poll_interval_minutes,
                        },
                      })
                    }
                  />
                )}
                {isAdmin && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Delete ${s.name} and its listings`}
                    title="Delete source and its listings"
                    onClick={() => remove.mutate(s.id)}
                  >
                    <Trash2 />
                  </Button>
                )}
              </li>
            ))}
            {sources.data.length === 0 && <p className="text-sm text-ink-dim">No sources yet.</p>}
          </ul>
        )}
        {isAdmin && (
          <form
            className="mt-4 flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveFeed.mutate(
                {
                  body: {
                    name: name.trim(),
                    url: url.trim(),
                    enabled: true,
                    poll_interval_minutes: Number(pollEvery),
                  },
                },
                {
                  onSuccess: () => {
                    setName('');
                    setUrl('');
                  },
                },
              );
            }}
          >
            <Field label="Name" className="min-w-36">
              {(p) => (
                <Input
                  {...p}
                  value={name}
                  maxLength={100}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Field label="Feed URL (https)" className="min-w-64 flex-1">
              {(p) => (
                <Input
                  {...p}
                  value={url}
                  placeholder="https://example.com/jobs.rss"
                  onChange={(e) => setUrl(e.target.value)}
                />
              )}
            </Field>
            <Field label="Every">
              {(p) => (
                <Select {...p} value={pollEvery} onChange={(e) => setPollEvery(e.target.value)}>
                  <option value="30">30 min</option>
                  <option value="60">1 hour</option>
                  <option value="180">3 hours</option>
                  <option value="720">12 hours</option>
                  <option value="1440">1 day</option>
                </Select>
              )}
            </Field>
            <Button
              type="submit"
              variant="primary"
              disabled={!name.trim() || !url.trim()}
              loading={saveFeed.isPending && !saveFeed.variables.id}
            >
              <Plus /> Add feed
            </Button>
          </form>
        )}
      </Panel>
      {canEdit && (
        <Panel title="Add a listing manually" icon={<Plus />}>
          <p className="mb-3 text-sm text-ink-muted">
            Found something by email or on a site without a feed? Paste it and it is scored like any
            other listing.
          </p>
          <Button variant="secondary" onClick={() => setManualOpen(true)}>
            <Plus /> Add listing
          </Button>
        </Panel>
      )}
      {manualOpen && (
        <ManualDialog workspaceId={workspaceId} onClose={() => setManualOpen(false)} />
      )}
    </div>
  );
}

const splitTerms = (text: string) =>
  text
    .split(/[,\n]/)
    .map((t) => t.trim())
    .filter(Boolean);

function ProfileForm({
  workspaceId,
  profile,
  canEdit,
}: {
  workspaceId: string;
  profile: OpportunityProfile;
  canEdit: boolean;
}) {
  const save = useSaveOpportunityProfile(workspaceId);
  const [skills, setSkills] = useState(
    profile.skills.length ? profile.skills : [{ term: '', weight: 3 }],
  );
  const [include, setInclude] = useState(profile.include_keywords.join(', '));
  const [exclude, setExclude] = useState(profile.exclude_keywords.join(', '));
  const [rate, setRate] = useState(profile.min_hourly_rate ?? '');
  const [currency, setCurrency] = useState(profile.currency);
  const [remote, setRemote] = useState(profile.remote_only);
  const [threshold, setThreshold] = useState(String(profile.notify_threshold));
  const rateOk = rate === '' || /^\d+(\.\d{1,2})?$/.test(rate);

  return (
    <Panel title="Matching profile">
      <div className="space-y-5">
        <section className="space-y-2" aria-label="Skills">
          <p className="label-caps">Skills</p>
          <p className="text-xs text-ink-dim">
            Weight 1–5. A skill in the title counts double. Scores are deterministic and explained
            on every listing.
          </p>
          <ul className="space-y-2">
            {skills.map((skill, i) => (
              <li key={i} className="flex gap-2">
                <Input
                  aria-label={`Skill ${String(i + 1)}`}
                  value={skill.term}
                  maxLength={60}
                  placeholder="e.g. React"
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSkills(skills.map((s, j) => (j === i ? { ...s, term: e.target.value } : s)))
                  }
                />
                <Select
                  aria-label={`Weight of skill ${String(i + 1)}`}
                  value={String(skill.weight)}
                  className="w-28 shrink-0"
                  disabled={!canEdit}
                  onChange={(e) =>
                    setSkills(
                      skills.map((s, j) =>
                        j === i ? { ...s, weight: Number(e.target.value) } : s,
                      ),
                    )
                  }
                >
                  {[1, 2, 3, 4, 5].map((w) => (
                    <option key={w} value={w}>
                      weight {w}
                    </option>
                  ))}
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove skill ${String(i + 1)}`}
                  disabled={!canEdit}
                  onClick={() => setSkills(skills.filter((_, j) => j !== i))}
                >
                  <X />
                </Button>
              </li>
            ))}
          </ul>
          <Button
            size="sm"
            variant="outline"
            disabled={!canEdit || skills.length >= 60}
            onClick={() => setSkills([...skills, { term: '', weight: 3 }])}
          >
            <Plus /> Add skill
          </Button>
        </section>
        <div className="grid gap-3 md:grid-cols-2">
          <Field
            label="Bonus keywords"
            help="Comma separated, +1 each (e.g. full stack, contract)."
          >
            {(p) => (
              <Textarea
                {...p}
                value={include}
                disabled={!canEdit}
                onChange={(e) => setInclude(e.target.value)}
              />
            )}
          </Field>
          <Field label="Exclude if mentioned" help="Comma separated; an exclusion always wins.">
            {(p) => (
              <Textarea
                {...p}
                value={exclude}
                disabled={!canEdit}
                onChange={(e) => setExclude(e.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Minimum hourly rate" error={rateOk ? null : 'Use a number like 45'}>
            {(p) => (
              <Input
                {...p}
                value={rate}
                inputMode="decimal"
                disabled={!canEdit}
                onChange={(e) => setRate(e.target.value.replace(',', '.'))}
              />
            )}
          </Field>
          <Field label="Rate currency">
            {(p) => (
              <Input
                {...p}
                value={currency}
                maxLength={3}
                className="font-mono uppercase"
                disabled={!canEdit}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            )}
          </Field>
          <Field label="Notify from score" help="One notification per poll.">
            {(p) => (
              <Input
                {...p}
                type="number"
                min={0}
                max={100}
                value={threshold}
                disabled={!canEdit}
                onChange={(e) => setThreshold(e.target.value)}
              />
            )}
          </Field>
        </div>
        <SwitchField
          label="Remote only (on-site or hybrid listings get half the score)"
          checked={remote}
          disabled={!canEdit}
          onCheckedChange={setRemote}
        />
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        {save.isSuccess && <Alert tone="success">Saved — all listings were re-scored.</Alert>}
        {canEdit && (
          <Button
            variant="primary"
            loading={save.isPending}
            disabled={!rateOk || !/^[A-Z]{3}$/.test(currency)}
            onClick={() =>
              save.mutate({
                skills: skills.filter((s) => s.term.trim()),
                include_keywords: splitTerms(include),
                exclude_keywords: splitTerms(exclude),
                min_hourly_rate: rate || null,
                currency,
                remote_only: remote,
                notify_threshold: Math.max(0, Math.min(100, Number(threshold) || 0)),
              })
            }
          >
            Save and re-score
          </Button>
        )}
      </div>
    </Panel>
  );
}

function ProfileTab({ workspaceId, canEdit }: { workspaceId: string; canEdit: boolean }) {
  const profile = useOpportunityProfile(workspaceId);
  if (profile.isPending) return <LoadingState />;
  if (profile.isError)
    return <ErrorState error={profile.error} onRetry={() => void profile.refetch()} />;
  return <ProfileForm workspaceId={workspaceId} profile={profile.data} canEdit={canEdit} />;
}

export function OpportunitiesPage() {
  const workspace = useCurrentWorkspace();
  const profile = useOpportunityProfile(workspace?.id);
  const [tab, setTab] = useState('matches');
  const isAdmin = workspace?.role === 'owner' || workspace?.role === 'admin';
  const canEdit = isAdmin || workspace?.role === 'member';

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Domains"
        title="Freelance & Career"
        subtitle="Listings from feeds you trust and ones you paste, scored against your skills with clear reasons. AI summaries are optional and off by default."
      />
      {profile.data && !profile.data.configured && (
        <Alert
          action={
            <Button size="sm" variant="secondary" onClick={() => setTab('profile')}>
              Set up profile
            </Button>
          }
        >
          Add your skills so listings can be scored.
        </Alert>
      )}
      {!workspace ? (
        <EmptyState title="No workspace selected" />
      ) : (
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList aria-label="Freelance views">
            <TabsTrigger value="matches">Matches</TabsTrigger>
            <TabsTrigger value="sources">Sources</TabsTrigger>
            <TabsTrigger value="profile">Profile</TabsTrigger>
          </TabsList>
          <TabsContent value="matches" className="mt-4">
            <MatchesTab workspaceId={workspace.id} canEdit={canEdit} />
          </TabsContent>
          <TabsContent value="sources" className="mt-4">
            <SourcesTab workspaceId={workspace.id} canEdit={canEdit} isAdmin={isAdmin} />
          </TabsContent>
          <TabsContent value="profile" className="mt-4">
            <ProfileTab workspaceId={workspace.id} canEdit={canEdit} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
