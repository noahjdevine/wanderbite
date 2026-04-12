'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { updateProfile } from '@/app/actions/profile';

type ProfileFormProps = {
  initial: {
    full_name: string;
    email: string;
    username: string;
    phone_number: string;
    address: string;
    dietary_flags: string[];
  };
  dietaryOptions: readonly { value: string; label: string }[];
};

export function ProfileForm({ initial, dietaryOptions }: ProfileFormProps) {
  const [fullName, setFullName] = useState(initial.full_name);
  const [email, setEmail] = useState(initial.email);
  const [username, setUsername] = useState(initial.username);
  const [phoneNumber, setPhoneNumber] = useState(initial.phone_number);
  const [address, setAddress] = useState(initial.address);
  const [dietaryFlags, setDietaryFlags] = useState<string[]>(initial.dietary_flags);
  const [saving, setSaving] = useState(false);

  function toggleDietary(value: string) {
    setDietaryFlags((prev) =>
      prev.includes(value) ? prev.filter((f) => f !== value) : [...prev, value]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const result = await updateProfile({
        full_name: fullName.trim() || null,
        email: email.trim() || null,
        username: username.trim() || null,
        phone_number: phoneNumber.trim() || null,
        address: address.trim() || null,
        dietary_flags: dietaryFlags.length ? dietaryFlags : null,
      });
      if (result.ok) {
        toast.success('Profile saved.');
      } else {
        toast.error(result.error);
      }
    } catch {
      toast.error('Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit profile</CardTitle>
        <CardDescription>Name, contact, and dietary restrictions</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-2">
            <label htmlFor="full_name" className="text-sm font-medium">
              Name
            </label>
            <input
              id="full_name"
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="username" className="text-sm font-medium">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="phone_number" className="text-sm font-medium">
              Phone number
            </label>
            <input
              id="phone_number"
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="(555) 123-4567"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              disabled={saving}
            />
          </div>
          <div className="space-y-2">
            <label htmlFor="address" className="text-sm font-medium">
              Address
            </label>
            <textarea
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, City, State ZIP"
              rows={2}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/20"
              disabled={saving}
            />
          </div>
          <fieldset className="space-y-3">
            <legend className="text-sm font-medium">Dietary restrictions</legend>
            <div className="space-y-2">
              {dietaryOptions.map((opt) => (
                <label
                  key={opt.value}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-input px-3 py-2 hover:bg-muted/50"
                >
                  <input
                    type="checkbox"
                    checked={dietaryFlags.includes(opt.value)}
                    onChange={() => toggleDietary(opt.value)}
                    className="size-4 rounded border-input"
                    disabled={saving}
                  />
                  <span className="text-sm">{opt.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <Button type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
