import { Link } from 'react-router';

import { Button } from '@/components/ui/button';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center gap-3 py-24 text-center">
      <p className="font-mono text-sm text-cyan">404</p>
      <h1 className="font-display text-2xl font-semibold">Page not found</h1>
      <p className="text-sm text-ink-muted">The page you requested does not exist.</p>
      <Button asChild variant="primary">
        <Link to="/">Back to command center</Link>
      </Button>
    </div>
  );
}
