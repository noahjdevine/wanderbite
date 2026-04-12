import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

const ACCENT = '#E85D26';

export type SubscriptionConfirmationEmailProps = {
  baseUrl: string;
};

function normalizeBase(url: string) {
  return url.replace(/\/+$/, '');
}

export function SubscriptionConfirmationEmail({
  baseUrl,
}: SubscriptionConfirmationEmailProps) {
  const root = normalizeBase(baseUrl);
  const dashboardUrl = `${root}/dashboard`;
  const termsUrl = `${root}/terms`;
  const privacyUrl = `${root}/privacy`;
  const rulesUrl = `${root}/rules`;

  return (
    <Html lang="en">
      <Head />
      <Preview>You&apos;re in. Welcome to Wanderbite.</Preview>
      <Body
        style={{
          backgroundColor: '#faf7f4',
          margin: 0,
          padding: '32px 16px',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <Container
          style={{
            maxWidth: 560,
            margin: '0 auto',
            backgroundColor: '#ffffff',
            borderRadius: 12,
            padding: '32px 28px',
            border: '1px solid #eee6df',
          }}
        >
          <Section
            style={{
              borderLeft: `4px solid ${ACCENT}`,
              paddingLeft: 16,
              marginBottom: 24,
            }}
          >
            <Heading
              as="h1"
              style={{
                margin: '0 0 8px',
                fontSize: 26,
                lineHeight: 1.25,
                color: '#1a1a1a',
                fontWeight: 700,
              }}
            >
              You&apos;re in. Welcome to Wanderbite.
            </Heading>
            <Text
              style={{
                margin: 0,
                fontSize: 15,
                lineHeight: 1.5,
                color: '#5c534c',
              }}
            >
              Your subscription is active. Here&apos;s what you get every month.
            </Text>
          </Section>

          <Section style={{ marginBottom: 28 }}>
            <Text
              style={{
                margin: '0 0 10px',
                fontSize: 15,
                lineHeight: 1.55,
                color: '#333',
              }}
            >
              • <strong>2 restaurant challenges</strong> per month
            </Text>
            <Text
              style={{
                margin: '0 0 10px',
                fontSize: 15,
                lineHeight: 1.55,
                color: '#333',
              }}
            >
              • <strong>1 swap</strong> per month
            </Text>
            <Text
              style={{
                margin: 0,
                fontSize: 15,
                lineHeight: 1.55,
                color: '#333',
              }}
            >
              • <strong>$10 off $40+</strong> per challenge (see Rules for details)
            </Text>
          </Section>

          <Section style={{ textAlign: 'center', marginBottom: 28 }}>
            <Button
              href={dashboardUrl}
              style={{
                backgroundColor: ACCENT,
                color: '#ffffff',
                fontSize: 15,
                fontWeight: 600,
                textDecoration: 'none',
                textAlign: 'center',
                display: 'inline-block',
                padding: '14px 28px',
                borderRadius: 8,
              }}
            >
              Visit Dashboard
            </Button>
          </Section>

          <Text
            style={{
              margin: '0 0 20px',
              fontSize: 14,
              lineHeight: 1.55,
              color: '#5c534c',
            }}
          >
            Your plan is $15/month, billed monthly and auto-renewing until canceled.
            Cancel anytime in Settings → Manage Subscription; cancellation takes effect
            at the end of your current billing period.
          </Text>

          <Hr style={{ borderColor: '#eee6df', margin: '24px 0' }} />

          <Text
            style={{
              margin: 0,
              fontSize: 13,
              lineHeight: 1.6,
              color: '#7a726b',
              textAlign: 'center',
            }}
          >
            <Link href={termsUrl} style={{ color: ACCENT }}>
              Terms
            </Link>
            {' · '}
            <Link href={privacyUrl} style={{ color: ACCENT }}>
              Privacy
            </Link>
            {' · '}
            <Link href={rulesUrl} style={{ color: ACCENT }}>
              Rules
            </Link>
            {' · '}
            <Link href="mailto:support@wanderbite.com" style={{ color: ACCENT }}>
              support@wanderbite.com
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default SubscriptionConfirmationEmail;
