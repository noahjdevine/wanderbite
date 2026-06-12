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

export type RedemptionReminderEmailProps = {
  baseUrl: string;
  restaurantNames: string[];
  daysLeft: number;
};

function normalizeBase(url: string) {
  return url.replace(/\/+$/, '');
}

export function RedemptionReminderEmail({
  baseUrl,
  restaurantNames,
  daysLeft,
}: RedemptionReminderEmailProps) {
  const root = normalizeBase(baseUrl);
  const challengesUrl = `${root}/challenges`;
  const termsUrl = `${root}/terms`;
  const privacyUrl = `${root}/privacy`;

  const restaurantList =
    restaurantNames.length === 1
      ? restaurantNames[0]
      : restaurantNames.length === 2
        ? `${restaurantNames[0]} and ${restaurantNames[1]}`
        : `${restaurantNames.slice(0, -1).join(', ')}, and ${
            restaurantNames[restaurantNames.length - 1]
          }`;

  const dayCopy = daysLeft === 1 ? '1 day' : `${daysLeft} days`;

  return (
    <Html lang="en">
      <Head />
      <Preview>{`Your Wanderbite picks expire in ${dayCopy}.`}</Preview>
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
              {`${dayCopy} left to redeem your picks.`}
            </Heading>
            <Text
              style={{
                margin: 0,
                fontSize: 15,
                lineHeight: 1.5,
                color: '#5c534c',
              }}
            >
              Your monthly Wanderbite challenges expire at the end of the month.
              That&apos;s $10 off, twice — don&apos;t leave it on the table.
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
              Still waiting on you this month:
            </Text>
            <Text
              style={{
                margin: 0,
                fontSize: 17,
                lineHeight: 1.5,
                color: '#1a1a1a',
                fontWeight: 600,
              }}
            >
              {restaurantList}
            </Text>
          </Section>

          <Section style={{ textAlign: 'center', marginBottom: 28 }}>
            <Button
              href={challengesUrl}
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
              View My Challenges
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
            Open the link, grab the WB- code, show it at the restaurant. That&apos;s
            the whole thing. Picks not redeemed by month end roll over into the void.
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
            <Link href="mailto:support@wanderbite.com" style={{ color: ACCENT }}>
              support@wanderbite.com
            </Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default RedemptionReminderEmail;
