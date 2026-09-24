'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Copy, Loader2, MapPin } from 'lucide-react';
import {
  addRestaurantFromForm,
  deleteRestaurant,
  generateMissingSlugs,
  setRestaurantPinFromForm,
} from './actions';
import { PartnerPinField } from '@/components/partner/partner-pin-field';
import {
  enrichAllRestaurants,
  enrichSingleRestaurant,
} from './actions-places';
import {
  searchRestaurantsFromGoogle,
  getRestaurantDetailsFromGoogle,
  importRestaurantFromGoogle,
} from './actions-import';
import { GOOGLE_IMPORT_PARTIAL_MESSAGE } from '@/lib/google-import-outcome';
import type { PlaceDetails } from '@/lib/google-places-import';
import { toast } from 'sonner';

function SetRestaurantPinForm({
  restaurantId,
  disabled,
}: {
  restaurantId: string;
  disabled?: boolean;
}) {
  const [state, formAction, pending] = useActionState(setRestaurantPinFromForm, null);

  useEffect(() => {
    if (!state?.ok) return;
    toast.success('Partner PIN saved.');
  }, [state]);

  return (
    <form action={formAction} className="flex flex-col gap-2">
      <input type="hidden" name="restaurantId" value={restaurantId} />
      <PartnerPinField
        id={`set-pin-${restaurantId}`}
        name="pin"
        disabled={pending || disabled}
        placeholder="Set 4–6 digit PIN"
        className="w-full rounded-md border border-input bg-background px-2 py-1 text-sm font-mono"
      />
      {state && !state.ok ? <p className="text-sm text-destructive">{state.error}</p> : null}
      {state?.ok ? <p className="text-sm">Partner PIN saved.</p> : null}
      <Button type="submit" variant="outline" size="sm" disabled={pending || disabled}>
        {pending ? 'Saving…' : 'Set PIN'}
      </Button>
    </form>
  );
}

type RestaurantRow = {
  id: string;
  name: string;
  slug: string | null;
  address: string | null;
  description: string | null;
  cuisine_tags: string[] | null;
  price_range: string | null;
  neighborhood: string | null;
  image_url: string | null;
  has_google_place: boolean;
  has_pin: boolean;
  status: string;
};

type UserRow = {
  id: string;
  email: string;
  full_name: string;
  username: string;
  subscription_status: string;
};

type AdminClientProps = {
  restaurants: RestaurantRow[];
  users: UserRow[];
  auditEntries: {
    id: number;
    actorEmail: string;
    action: string;
    target: string;
    createdAt: string;
  }[];
};

const PRICE_OPTIONS = ['$', '$$', '$$$', '$$$$'];

export function AdminClient({
  restaurants: initialRestaurants,
  users,
  auditEntries,
}: AdminClientProps) {
  const router = useRouter();
  const manualFormRef = useRef<HTMLFormElement>(null);
  const [restaurants, setRestaurants] = useState(initialRestaurants);
  const [addState, addAction, adding] = useActionState(addRestaurantFromForm, null);
  const [importState, importAction, importAdding] = useActionState(
    importRestaurantFromGoogle,
    null,
  );
  const [googleQuery, setGoogleQuery] = useState('');
  const [googleSearching, setGoogleSearching] = useState(false);
  const [googleSearchError, setGoogleSearchError] = useState<string | null>(null);
  const [googleSearchEmptyHint, setGoogleSearchEmptyHint] = useState(false);
  const [googleResults, setGoogleResults] = useState<
    { placeId: string; name: string; address: string }[]
  >([]);
  const [googleDetailsLoading, setGoogleDetailsLoading] = useState(false);
  const [googleImported, setGoogleImported] = useState<PlaceDetails | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [enrichingBulk, setEnrichingBulk] = useState(false);
  const [enrichingId, setEnrichingId] = useState<string | null>(null);
  const [partnerSuccessFullUrl, setPartnerSuccessFullUrl] = useState<string | null>(
    null
  );
  const [slugGenerating, setSlugGenerating] = useState(false);

  useEffect(() => {
    setRestaurants(initialRestaurants);
  }, [initialRestaurants]);

  useEffect(() => {
    if (!addState) return;
    if (!addState.ok) {
      toast.error(addState.error);
      return;
    }
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    setPartnerSuccessFullUrl(`${origin}${addState.partnerUrl}`);
    toast.success('Restaurant added.');
    manualFormRef.current?.reset();
    router.refresh();
  }, [addState, router]);

  useEffect(() => {
    if (!importState) return;
    if (importState.status === 'error') {
      toast.error(importState.error);
      return;
    }
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    setPartnerSuccessFullUrl(`${origin}${importState.partnerUrl}`);
    if (importState.status === 'partial') {
      toast.warning(GOOGLE_IMPORT_PARTIAL_MESSAGE, { description: importState.error });
    } else {
      toast.success('Restaurant added.');
    }
    setGoogleImported(null);
    setGoogleResults([]);
    setGoogleQuery('');
    router.refresh();
  }, [importState, router]);

  async function handleGoogleSearch() {
    const q = googleQuery.trim();
    if (!q) {
      toast.error('Enter a restaurant name to search.');
      return;
    }
    setGoogleSearching(true);
    setGoogleResults([]);
    setGoogleImported(null);
    setGoogleSearchError(null);
    setGoogleSearchEmptyHint(false);
    try {
      const result = await searchRestaurantsFromGoogle(q);
      if (!result.ok) {
        setGoogleResults([]);
        const noHits = result.error.startsWith(
          'No results found for that search'
        );
        if (noHits) {
          setGoogleSearchError(null);
          setGoogleSearchEmptyHint(true);
        } else {
          setGoogleSearchError(result.error);
          setGoogleSearchEmptyHint(false);
        }
        return;
      }
      setGoogleSearchError(null);
      setGoogleSearchEmptyHint(result.results.length === 0);
      setGoogleResults(result.results);
    } catch (e) {
      setGoogleResults([]);
      setGoogleSearchEmptyHint(false);
      setGoogleSearchError(
        e instanceof Error ? e.message : 'Google Places search failed.'
      );
    } finally {
      setGoogleSearching(false);
    }
  }

  async function handlePickGoogleResult(placeId: string) {
    setGoogleDetailsLoading(true);
    setGoogleImported(null);
    try {
      const details = await getRestaurantDetailsFromGoogle(placeId);
      if (!details) {
        toast.error('Could not load place details.');
        return;
      }
      setGoogleImported(details);
    } finally {
      setGoogleDetailsLoading(false);
    }
  }

  function clearGoogleImport() {
    setGoogleImported(null);
    setGoogleResults([]);
    setGoogleDetailsLoading(false);
    setGoogleSearchError(null);
    setGoogleSearchEmptyHint(false);
  }

  async function handleDelete(id: string) {
    setDeleteId(null);
    setDeleting(true);
    try {
      const result = await deleteRestaurant(id);
      if (result.ok) {
        setRestaurants((prev) => prev.filter((r) => r.id !== id));
        toast.success('Restaurant deleted.');
        router.refresh();
        return;
      }
      toast.error(result.error);
    } finally {
      setDeleting(false);
    }
  }

  async function handleGenerateMissingSlugs() {
    setSlugGenerating(true);
    try {
      const res = await generateMissingSlugs();
      if (res.ok) {
        toast.success(`Generated slugs for ${res.updated} restaurant(s).`);
        router.refresh();
        return;
      }
      toast.error(res.error ?? 'Could not generate slugs.');
    } finally {
      setSlugGenerating(false);
    }
  }

  async function handleEnrichAll() {
    setEnrichingBulk(true);
    try {
      const result = await enrichAllRestaurants();
      if (!result.ok) {
        toast.error(result.error ?? 'Could not enrich restaurants.');
        return;
      }
      toast.success(`Updated ${result.updated} restaurants, ${result.failed} failed`);
      router.refresh();
    } finally {
      setEnrichingBulk(false);
    }
  }

  async function handleRefreshPhoto(id: string) {
    setEnrichingId(id);
    try {
      const result = await enrichSingleRestaurant(id);
      if (result.ok) {
        setRestaurants((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, has_google_place: true } : r
          )
        );
        toast.success('Place linked.');
        router.refresh();
        return;
      }
      toast.error(result.error ?? 'Could not refresh photo.');
    } finally {
      setEnrichingId(null);
    }
  }

  return (
    <div className="space-y-10">
      {partnerSuccessFullUrl ? (
        <div className="rounded-lg border border-emerald-300 bg-emerald-50/90 px-4 py-4 text-emerald-950 shadow-sm">
          <p className="font-semibold text-emerald-900">
            ✅ Restaurant added! Partner login URL:
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              readOnly
              value={partnerSuccessFullUrl}
              className="min-w-0 flex-1 rounded-md border border-emerald-200 bg-white px-3 py-2 font-mono text-xs text-foreground"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0 gap-1.5 border-emerald-300"
              onClick={() => {
                void navigator.clipboard.writeText(partnerSuccessFullUrl);
                toast.success('URL copied');
              }}
            >
              <Copy className="size-4" aria-hidden />
              Copy URL
            </Button>
          </div>
          <p className="mt-2 text-xs text-emerald-900/80">
            Share this URL with your restaurant partner. They will use it with their PIN
            to log in.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 h-8 text-emerald-900 hover:bg-emerald-100"
            onClick={() => setPartnerSuccessFullUrl(null)}
          >
            Dismiss
          </Button>
        </div>
      ) : null}

      <Card
        className="border-[#86efac] shadow-sm"
        style={{ backgroundColor: '#f0fdf4' }}
      >
        <CardHeader className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <MapPin className="size-5 shrink-0 text-green-700" aria-hidden />
            <CardTitle className="text-lg text-green-900">
              Import from Google Places
            </CardTitle>
          </div>
          <p className="text-sm font-medium text-green-800">
            ⚡ Import from Google Places — fills in details automatically
          </p>
          <CardDescription className="text-green-900/70">
            Search Google, pick a place, then review and submit. Fields stay
            editable.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <div className="min-w-0 flex-1">
              <label
                htmlFor="google-search-query"
                className="mb-1 block text-sm font-medium text-green-950"
              >
                Search
              </label>
              <input
                id="google-search-query"
                value={googleQuery}
                onChange={(e) => setGoogleQuery(e.target.value)}
                placeholder="Search restaurant name e.g. Ricks Chophouse"
                className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm text-green-950 ring-offset-background placeholder:text-green-800/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleGoogleSearch();
                  }
                }}
              />
            </div>
            <Button
              type="button"
              variant="secondary"
              className="border-green-400 bg-white text-green-900 hover:bg-green-50"
              disabled={googleSearching}
              onClick={() => void handleGoogleSearch()}
            >
              {googleSearching ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Searching…
                </>
              ) : (
                'Search'
              )}
            </Button>
          </div>

          {googleSearchError ? (
            <p className="text-sm text-red-600">{googleSearchError}</p>
          ) : null}
          {!googleSearchError && googleSearchEmptyHint ? (
            <p className="text-sm text-muted-foreground">
              0 results found — try a different search term
            </p>
          ) : null}

          {googleResults.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-green-950">Results</p>
              <ul className="max-h-60 divide-y divide-green-200 overflow-auto rounded-lg border border-green-300 bg-white">
                {googleResults.map((r) => (
                  <li key={r.placeId}>
                    <button
                      type="button"
                      className="w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-green-50"
                      onClick={() => void handlePickGoogleResult(r.placeId)}
                      disabled={googleDetailsLoading}
                    >
                      <span className="font-medium text-green-950">{r.name}</span>
                      <span className="mt-0.5 block text-xs text-green-800/80">
                        {r.address}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {googleDetailsLoading && (
            <div className="flex items-center gap-2 text-sm text-green-800">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Fetching details…
            </div>
          )}

          {googleImported && !googleDetailsLoading && (
            <div className="space-y-3 border-t border-green-200 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center rounded-full border border-green-600/40 bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-900">
                  Imported from Google Places
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-green-900 hover:bg-green-100"
                  onClick={clearGoogleImport}
                >
                  Clear import
                </Button>
              </div>
              <form
                key={googleImported.googlePlaceId}
                action={importAction}
                className="grid gap-4 sm:grid-cols-2"
              >
                <input
                  type="hidden"
                  name="google_place_id"
                  value={googleImported.googlePlaceId}
                />
                <input type="hidden" name="lat" value={googleImported.lat ?? ''} />
                <input type="hidden" name="lon" value={googleImported.lon ?? ''} />
                <div className="sm:col-span-2">
                  <label htmlFor="import-name" className="mb-1 block text-sm font-medium">
                    Name *
                  </label>
                  <input
                    id="import-name"
                    name="name"
                    required
                    defaultValue={googleImported.name}
                    className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label
                    htmlFor="import-description"
                    className="mb-1 block text-sm font-medium"
                  >
                    Description
                  </label>
                  <textarea
                    id="import-description"
                    name="description"
                    rows={2}
                    defaultValue=""
                    className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label htmlFor="import-address" className="mb-1 block text-sm font-medium">
                    Address
                  </label>
                  <input
                    id="import-address"
                    name="address"
                    defaultValue={googleImported.address}
                    className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
                  />
                </div>
                <div>
                  <label htmlFor="import-cuisine" className="mb-1 block text-sm font-medium">
                    Cuisine (comma-separated)
                  </label>
                  <input
                    id="import-cuisine"
                    name="cuisine"
                    placeholder="bbq, american, casual"
                    defaultValue={googleImported.cuisineTags.join(', ')}
                    className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
                  />
                </div>
                <div>
                  <label
                    htmlFor="import-price_range"
                    className="mb-1 block text-sm font-medium"
                  >
                    Price Range
                  </label>
                  <select
                    id="import-price_range"
                    name="price_range"
                    defaultValue={googleImported.priceLevel ?? ''}
                    className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
                  >
                    <option value="">—</option>
                    {PRICE_OPTIONS.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    htmlFor="import-neighborhood"
                    className="mb-1 block text-sm font-medium"
                  >
                    Neighborhood
                  </label>
                  <input
                    id="import-neighborhood"
                    name="neighborhood"
                    defaultValue={googleImported.neighborhood ?? ''}
                    className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
                  />
                </div>
                <div>
                  <label htmlFor="import-image_url" className="mb-1 block text-sm font-medium">
                    Image path
                  </label>
                  <input
                    id="import-image_url"
                    name="image_url"
                    type="text"
                    placeholder="/images/..."
                    className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
                  />
                </div>
                <div>
                  <label
                    htmlFor="import-verification_code"
                    className="mb-1 block text-sm font-medium"
                  >
                    Verification Code (for partner redemption)
                  </label>
                  <input
                    id="import-verification_code"
                    name="verification_code"
                    placeholder="Optional"
                    defaultValue=""
                    className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
                  />
                </div>
                <div>
                  <label htmlFor="import-pin" className="mb-1 block text-sm font-medium">
                    Partner PIN (for /partner portal login)
                  </label>
                  <PartnerPinField
                    id="import-pin"
                    name="pin"
                    placeholder="e.g. 4–6 digits"
                    className="w-full rounded-lg border border-green-300 bg-white px-3 py-2 text-sm font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-600 focus-visible:ring-offset-2"
                  />
                </div>
                {importState?.status === 'error' ? (
                  <p className="text-sm text-destructive sm:col-span-2">{importState.error}</p>
                ) : null}
                {importState?.status === 'partial' ? (
                  <div className="space-y-1 text-sm sm:col-span-2" role="status">
                    <p>{GOOGLE_IMPORT_PARTIAL_MESSAGE}</p>
                    <p>{importState.error}</p>
                    <p>Partner link: {importState.partnerUrl}</p>
                  </div>
                ) : null}
                {importState?.status === 'success' ? (
                  <p className="text-sm sm:col-span-2" role="status">
                    Restaurant added. Partner link: {importState.partnerUrl}
                  </p>
                ) : null}
                <div className="sm:col-span-2">
                  <Button
                    type="submit"
                    disabled={importAdding}
                    className="bg-green-700 text-white hover:bg-green-800"
                  >
                    {importAdding ? 'Adding…' : 'Add Restaurant'}
                  </Button>
                </div>
              </form>
            </div>
          )}
        </CardContent>
      </Card>

      {importState?.status === 'partial' ? (
        <div className="space-y-1 text-sm" role="status">
          <p>{GOOGLE_IMPORT_PARTIAL_MESSAGE}</p>
          <p>{importState.error}</p>
          <p>Partner link: {importState.partnerUrl}</p>
        </div>
      ) : null}
      {importState?.status === 'success' ? (
        <p className="text-sm" role="status">
          Restaurant added. Partner link: {importState.partnerUrl}
        </p>
      ) : null}
      {importState?.status === 'error' ? (
        <p className="text-sm text-destructive" role="alert">
          {importState.error}
        </p>
      ) : null}

      <p className="text-center text-sm text-muted-foreground">— or add manually —</p>

      <Card className="border-violet-200">
        <CardHeader>
          <CardTitle className="text-primary">Add Restaurant</CardTitle>
          <CardDescription>Insert a new partner restaurant.</CardDescription>
        </CardHeader>
        <CardContent>
          <form ref={manualFormRef} action={addAction} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="name" className="mb-1 block text-sm font-medium">
                Name *
              </label>
              <input
                id="name"
                name="name"
                required
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="description" className="mb-1 block text-sm font-medium">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                rows={2}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="address" className="mb-1 block text-sm font-medium">
                Address
              </label>
              <input
                id="address"
                name="address"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="lat" className="mb-1 block text-sm font-medium">
                Latitude
              </label>
              <input
                id="lat"
                name="lat"
                inputMode="decimal"
                placeholder="33.1984"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="lon" className="mb-1 block text-sm font-medium">
                Longitude
              </label>
              <input
                id="lon"
                name="lon"
                inputMode="decimal"
                placeholder="-96.6397"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="cuisine" className="mb-1 block text-sm font-medium">
                Cuisine (comma-separated)
              </label>
              <input
                id="cuisine"
                name="cuisine"
                placeholder="bbq, american, casual"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="price_range" className="mb-1 block text-sm font-medium">
                Price Range
              </label>
              <select
                id="price_range"
                name="price_range"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <option value="">—</option>
                {PRICE_OPTIONS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="neighborhood" className="mb-1 block text-sm font-medium">
                Neighborhood
              </label>
              <input
                id="neighborhood"
                name="neighborhood"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="image_url" className="mb-1 block text-sm font-medium">
                Image path
              </label>
              <input
                id="image_url"
                name="image_url"
                type="text"
                placeholder="/images/..."
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="verification_code" className="mb-1 block text-sm font-medium">
                Verification Code (for partner redemption)
              </label>
              <input
                id="verification_code"
                name="verification_code"
                placeholder="Optional"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            <div>
              <label htmlFor="pin" className="mb-1 block text-sm font-medium">
                Partner PIN (for /partner portal login)
              </label>
              <PartnerPinField
                id="pin"
                name="pin"
                placeholder="e.g. 4–6 digits"
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm font-mono ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              />
            </div>
            {addState && !addState.ok ? (
              <p className="text-sm text-destructive sm:col-span-2">{addState.error}</p>
            ) : null}
            {addState?.ok ? (
              <p className="text-sm sm:col-span-2" role="status">
                Restaurant added. Partner link: {addState.partnerUrl}
              </p>
            ) : null}
            <div className="sm:col-span-2">
              <Button type="submit" disabled={adding}>
                {adding ? 'Adding…' : 'Add Restaurant'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-violet-200">
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle className="text-primary">Restaurant List</CardTitle>
            <CardDescription>
              All partner restaurants. PIN used for Partner Portal login.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="shrink-0"
              disabled={slugGenerating || enrichingBulk}
              onClick={() => void handleGenerateMissingSlugs()}
            >
              {slugGenerating ? 'Generating…' : 'Generate Missing Slugs'}
            </Button>
            <Button
              type="button"
              variant="secondary"
              className="shrink-0"
              disabled={enrichingBulk}
              onClick={() => void handleEnrichAll()}
            >
              {enrichingBulk
                ? 'Linking places...'
                : 'Link Google Places'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {restaurants.length === 0 ? (
            <p className="text-sm text-muted-foreground">No restaurants yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Partner URL</TableHead>
                    <TableHead>Address</TableHead>
                    <TableHead>Neighborhood</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>PIN set</TableHead>
                    <TableHead className="min-w-[180px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {restaurants.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {r.name}
                          {r.has_google_place ? (
                            <span className="rounded-full bg-emerald-600/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                              Photo ✓
                            </span>
                          ) : null}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[220px]">
                        {r.slug ? (
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate font-mono text-xs text-muted-foreground">
                              {`/partner/${r.slug}`}
                            </span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="shrink-0"
                              title="Copy partner URL"
                              onClick={() => {
                                const full =
                                  typeof window !== 'undefined'
                                    ? `${window.location.origin}/partner/${r.slug}`
                                    : `/partner/${r.slug}`;
                                void navigator.clipboard.writeText(full);
                                toast.success('URL copied');
                              }}
                            >
                              <Copy className="size-4" aria-hidden />
                            </Button>
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-sm text-muted-foreground">
                        {r.address ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm">{r.neighborhood ?? '—'}</TableCell>
                      <TableCell className="text-sm">{r.price_range ?? '—'}</TableCell>
                      <TableCell>
                        <div className="flex min-w-[12rem] flex-col gap-2">
                          <span className="text-sm">{r.has_pin ? 'Yes' : '—'}</span>
                          <SetRestaurantPinForm restaurantId={r.id} disabled={deleting} />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={deleting || enrichingBulk || enrichingId === r.id}
                            onClick={() => void handleRefreshPhoto(r.id)}
                          >
                            {enrichingId === r.id ? 'Refreshing…' : 'Refresh Photo'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setDeleteId(r.id)}
                            disabled={deleting || enrichingBulk}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-violet-200">
        <CardHeader>
          <CardTitle className="text-primary">User List</CardTitle>
          <CardDescription>All users (subscribers).</CardDescription>
        </CardHeader>
        <CardContent>
          {users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Subscription</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell className="font-medium">{u.email}</TableCell>
                      <TableCell className="text-sm">{u.full_name}</TableCell>
                      <TableCell className="text-sm">{u.username}</TableCell>
                      <TableCell className="text-sm">{u.subscription_status}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-violet-200">
        <CardHeader>
          <CardTitle className="text-primary">Recent Admin Activity</CardTitle>
          <CardDescription>Last 25 admin mutations.</CardDescription>
        </CardHeader>
        <CardContent>
          {auditEntries.length === 0 ? (
            <p className="text-sm text-muted-foreground">No admin actions recorded yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Who</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-sm">{entry.createdAt}</TableCell>
                      <TableCell className="text-sm">{entry.actorEmail}</TableCell>
                      <TableCell className="font-mono text-sm">{entry.action}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {entry.target}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete restaurant?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the restaurant and its offer. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && handleDelete(deleteId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
