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
  Text,
} from '@react-email/components';

const ACCENT = '#E85D26';

export type RevealPickReminderEmailProps = {
  baseUrl: string;
  unsubscribeUrl: string;
};

function normalizeBase(url: string) {
  return url.replace(/\/+$/, '');
}

export function RevealPickReminderEmail({
  baseUrl,
  unsubscribeUrl,
}: RevealPickReminderEmailProps) {
  const root = normalizeBase(baseUrl);
  const challengesUrl = `${root}/challenges`;
  const termsUrl = `${root}/terms`;
  const privacyUrl = `${root}/privacy`;

  return (
    <Html lang="en">
      <Head />
      <Preview>Your challenges for this month are ready to pick.</Preview>
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
          <Heading
            style={{
              margin: '0 0 12px',
              fontSize: 24,
              lineHeight: 1.3,
              color: '#2b2118',
            }}
          >
            Your challenges for this month are ready to pick
          </Heading>
          <Text
            style={{
              margin: '0 0 20px',
              fontSize: 16,
              lineHeight: 1.55,
              color: '#5c534c',
            }}
          >
            Nothing is assigned until you press Reveal. Open Challenges, add a note if you want, and choose this month’s pair.
          </Text>
          <Button
            href={challengesUrl}
            style={{
              backgroundColor: ACCENT,
              color: '#ffffff',
              borderRadius: 999,
              padding: '12px 20px',
              fontSize: 16,
              textDecoration: 'none',
            }}
          >
            Pick this month’s challenges
          </Button>
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
            <Link href={unsubscribeUrl} style={{ color: ACCENT }}>
              Unsubscribe from adventure reminders
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
