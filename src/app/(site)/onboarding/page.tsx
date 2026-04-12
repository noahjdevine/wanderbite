'use client';

import { useState } from 'react';
import { completeOnboarding } from '@/app/actions/onboarding';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';

const DIETARY_OPTIONS = [
  { value: 'vegetarian', label: 'Vegetarian' },
  { value: 'vegan', label: 'Vegan' },
  { value: 'gluten_free', label: 'Gluten-Free' },
  { value: 'halal', label: 'Halal' },
] as const;

const DISTANCE_OPTIONS = [
  { value: '5_mi', label: '5 Miles (Neighborhood)' },
  { value: '15_mi', label: '15 Miles (City)' },
  { value: '25_mi', label: '25 Miles (Metro)' },
  { value: '40_mi', label: '40 Miles (Road Trip)' },
] as const;

export default function OnboardingPage() {
  const [dietaryFlags, setDietaryFlags] = useState<string[]>([]);
  const [distanceBand, setDistanceBand] = useState<string>('15_mi');
  const [wantsCocktailExperience, setWantsCocktailExperience] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleDietary(value: string) {
    setDietaryFlags((prev) =>
      prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setIsLoading(true);
    try {
      const result = await completeOnboarding({
        dietary_flags: dietaryFlags,
        distance_band: distanceBand,
        wants_cocktail_experience: wantsCocktailExperience,
      });
      if (!result.ok) {
        setError(result.error);
      }
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Set your preferences</CardTitle>
          <CardDescription>
            We&apos;ll use these to personalize your restaurant challenges.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium">Dietary preferences</legend>
              <div className="space-y-2">
                {DIETARY_OPTIONS.map((opt) => (
                  <label
                    key={opt.value}
                    className="flex cursor-pointer items-center gap-3 rounded-md border border-input px-3 py-2 hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={dietaryFlags.includes(opt.value)}
                      onChange={() => toggleDietary(opt.value)}
                      className="size-4 rounded border-input"
                      disabled={isLoading}
                    />
                    <span className="text-sm">{opt.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="space-y-2">
              <label htmlFor="distance" className="text-sm font-medium">
                Distance preference
              </label>
              <select
                id="distance"
                value={distanceBand}
                onChange={(e) => setDistanceBand(e.target.value)}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
                disabled={isLoading}
              >
                {DISTANCE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            <fieldset className="space-y-2">
              <label className="flex cursor-pointer items-start gap-3 rounded-md border border-input px-3 py-3 hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={wantsCocktailExperience}
                  onChange={(e) => setWantsCocktailExperience(e.target.checked)}
                  className="mt-1 size-4 rounded border-input"
                  disabled={isLoading}
                />
                <div>
                  <span className="text-sm font-medium">Are you interested in Cocktail/Bar experiences?</span>
                  <p className="mt-1 text-xs text-muted-foreground">
                    If selected, we will curate 1 high-end cocktail bar or lounge experience for you per month.
                  </p>
                </div>
              </label>
            </fieldset>

            {error && (
              <Alert variant="destructive">
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={isLoading}
            >
              {isLoading ? 'Saving…' : 'Start My Journey'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
