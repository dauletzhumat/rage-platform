import type { Metadata } from 'next';
import { Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Container } from '@/components/ui/container';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { SampleDataBadge } from '@/components/ui/sample-data-badge';
import { Skeleton, TableSkeleton } from '@/components/ui/skeleton';
import { StatusPill, matchStatusTone, tournamentStatusTone } from '@/components/ui/status-pill';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MATCH_STATUSES, TOURNAMENT_STATUSES } from '@/lib/api/types';

export const metadata: Metadata = {
  title: 'Design system',
  robots: { index: false, follow: false },
};

const colorTokens = [
  'background',
  'surface',
  'raised',
  'overlay',
  'border',
  'border-strong',
  'foreground',
  'muted',
  'accent',
  'accent-strong',
  'accent-text',
  'live',
  'success',
  'warning',
  'danger',
  'info',
] as const;

const humanize = (value: string) => value.toLowerCase().replace(/_/g, ' ');

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="space-y-4">
      <h2 id={id} className="border-b border-border pb-2 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * Internal component showcase (developer reference). Not linked from navigation,
 * excluded from indexing. Labels are illustrative and intentionally untranslated.
 */
export default function DesignSystemPage() {
  return (
    <Container className="space-y-12 py-8">
      <PageHeader
        eyebrow="Internal"
        title="RAGE design system"
        description="Tokens and components for the RAGE web app. Dark-first, AA-contrast status colours, red focus rings."
      />

      <Section id="ds-colors" title="Colour tokens">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
          {colorTokens.map((token) => (
            <li key={token} className="space-y-1.5">
              <div
                className="h-14 rounded-md border border-border"
                style={{ background: `var(--color-${token})` }}
              />
              <p className="font-mono text-xs">--color-{token}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="ds-type" title="Typography">
        <div className="space-y-2">
          <p className="text-4xl font-black tracking-tight">Geist Sans Black 36</p>
          <p className="text-2xl font-bold">Geist Sans Bold 24</p>
          <p className="text-sm text-muted">Geist Sans Regular 14 — muted body copy.</p>
          <p className="font-mono text-sm tabular">Geist Mono 0123456789 · 76561198000000000</p>
        </div>
      </Section>

      <Section id="ds-buttons" title="Buttons">
        <div className="flex flex-wrap items-center gap-3">
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="destructive">
            <Trash2 aria-hidden="true" />
            Destructive
          </Button>
          <Button variant="link">Link</Button>
          <Button disabled>Disabled</Button>
          <Button size="sm">Small</Button>
          <Button size="lg">Large</Button>
          <Button size="icon" variant="secondary" aria-label="Add">
            <Plus aria-hidden="true" />
          </Button>
          <Button asChild variant="secondary">
            <a href="#ds-buttons">asChild anchor</a>
          </Button>
        </div>
      </Section>

      <Section id="ds-badges" title="Badges, status pills, sample data">
        <div className="flex flex-wrap gap-2">
          {(
            [
              'neutral',
              'accent',
              'live',
              'success',
              'warning',
              'danger',
              'info',
              'outline',
            ] as const
          ).map((tone) => (
            <Badge key={tone} tone={tone}>
              {tone}
            </Badge>
          ))}
          <SampleDataBadge />
        </div>
        <div className="flex flex-wrap gap-2">
          {MATCH_STATUSES.map((status) => (
            <StatusPill
              key={status}
              tone={matchStatusTone(status)}
              label={humanize(status)}
              pulse={status === 'LIVE'}
            />
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {TOURNAMENT_STATUSES.map((status) => (
            <StatusPill key={status} tone={tournamentStatusTone(status)} label={humanize(status)} />
          ))}
        </div>
      </Section>

      <Section id="ds-cards" title="Card">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Card title</CardTitle>
            <Badge tone="info">Info</Badge>
          </CardHeader>
          <CardContent>
            <CardDescription>Cards group related content on surface colour.</CardDescription>
          </CardContent>
          <CardFooter>
            <Button size="sm">Action</Button>
          </CardFooter>
        </Card>
      </Section>

      <Section id="ds-table" title="Table (dense, sticky header)">
        <Table stickyHeader containerClassName="max-h-60">
          <TableCaption>Illustrative table — placeholder rows, not real data.</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>#</TableHead>
              <TableHead>Column A</TableHead>
              <TableHead className="text-right">Column B</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {Array.from({ length: 10 }, (_, i) => (
              <TableRow key={i}>
                <TableCell className="text-muted">{i + 1}</TableCell>
                <TableCell>Row {i + 1}</TableCell>
                <TableCell className="text-right">—</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Section>

      <Section id="ds-interactive" title="Tabs, tooltip, dropdown menu, pagination">
        <Tabs defaultValue="one">
          <TabsList>
            <TabsTrigger value="one">First</TabsTrigger>
            <TabsTrigger value="two">Second</TabsTrigger>
          </TabsList>
          <TabsContent value="one">
            <p className="text-sm text-muted">First tab panel.</p>
          </TabsContent>
          <TabsContent value="two">
            <p className="text-sm text-muted">Second tab panel.</p>
          </TabsContent>
        </Tabs>
        <div className="flex flex-wrap items-center gap-3">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="secondary">Hover or focus me</Button>
            </TooltipTrigger>
            <TooltipContent>Tooltip content</TooltipContent>
          </Tooltip>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="secondary">Open menu</Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuLabel>Actions</DropdownMenuLabel>
              <DropdownMenuItem>First item</DropdownMenuItem>
              <DropdownMenuItem>Second item</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>Disabled item</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <Pagination
          page={2}
          totalPages={5}
          previousHref="/design-system?page=1"
          nextHref="/design-system?page=3"
          labels={{ nav: 'Pagination', previous: 'Previous', next: 'Next', status: 'Page 2 of 5' }}
        />
      </Section>

      <Section id="ds-states" title="Loading, empty and error states">
        <div className="grid gap-4 lg:grid-cols-2">
          <EmptyState
            title="No teams yet"
            description="Empty state with honest copy."
            headingLevel="h3"
          />
          <ErrorState
            title="API unavailable"
            description="Error state with retry action."
            headingLevel="h3"
            action={
              <Button variant="secondary" size="sm">
                Try again
              </Button>
            }
          />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <TableSkeleton rows={3} />
        </div>
      </Section>
    </Container>
  );
}
