# G15 delivery classifications

G15 records these classes so later groups can name a topic before they send. G15 did not add senders for E04, E06, E07, or E09. It does not change hosted Auth templates or SMTP.

| Class | Sender | Member opt-out | Provider hard suppression |
|---|---|---|---|
| Security / account | Supabase Auth templates only. This build does not send them and does not change hosted Auth or SMTP. | No topic. A reminder unsubscribe must not block reset, confirm, magic link, or email-change mail. | Hosted Auth path. G15 does not claim to suppress it. |
| Entitlement receipt | `subscription_confirmation_email` in the outbox worker. | No. Topic opt-out still allows this send. The receipt has no unsubscribe control. | Yes. Do not call Resend. The outbox row becomes `suppressed`, so the worker does not retry it for 14 days. |
| Adventure reminder | End-of-month cron, then `email_reminder_deliveries`, then Resend. | Yes. Topic `adventure_reminders`. No row means the member still receives the reminder. | Yes. Terminal skip `skipped_suppressed`. |
| Future optional notice | No sender. E04 curation invite, E06 briefing notice, E09 campaign or drawing mail. | Name the topic in this doc before that group sends. Reserved names, not yet in `email_topic_preferences`: E04 `curation_invites`, E06 `monthly_briefing`, E09 `campaign_notices`. | Yes, through the same send-time gate, when that group is built. |
| Future case notice | No sender. E07 member case outcome. | Member-requested operational mail, separate from marketing. No marketing topic. | Yes, when that group is built. |

App mail from `src/lib/resend.tsx` uses `Wanderbite <noreply@wanderbite.com>`. That is separate from the open G13-B checks for `wanderbite.co` Auth SMTP. A verified `.co` domain does not show that `.com` is verified, or that DKIM signs `List-Unsubscribe` and `List-Unsubscribe-Post`. Those checks stay open until observed.

Local completion of G15 is not release readiness. Before any G15 release, integrate and retest against the merged G14 baseline.
