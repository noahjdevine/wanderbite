<!-- Maintainer note: this file is the only extraction instruction for first-visit
briefing research and for the content-refresh maintenance prompt.
After editing, regenerate src/lib/briefings/restaurant-facts-guide.generated.ts
with `npx tsx scripts/generate-facts-guide.ts`. A test fails if they differ. -->

# Restaurant fact research guide

Use this guide to extract first-visit facts from the supplied page text. The tone for every field is plain, warm, and factual. No hype. No superlatives the source does not state.

## Global rules

- Use only what the supplied page text says.
- Do not use outside knowledge.
- Do not include prices, offers, discounts, credits, bookings, dollar amounts, phone numbers, email addresses, or URLs.
- Do not include hours of operation, clock times, or day-of-week schedules such as "Tuesday through Saturday" or "Sundays."
- Do not include promos or free-deal offers such as "kids eat free."
- Do not write source commentary such as "not mentioned," "the website says," or "according to." Say the fact, or omit the field.
- Do not include reviewer names or quotes.
- A single user review comment is not enough support for a physical feature (parking, arrival, accessibility, seating, or a patio). Structured details on a listing page count.
- Paraphrase. Do not copy long passages.
- Empty is fine. Omit a field when the pages do not support it.
- Copy `source_url` exactly from the fetched URL list.
- Each fact body is at most 400 characters.

## Fields

### parking

What counts: Where a guest can leave a car, as the page states it, such as a lot, garage, street, or valet.
What does not count: A guess about nearby lots, a price, or a claim that parking is easy or plentiful when the page does not say that.
Max length: 400 characters.
Tone: plain, warm, and factual. No hype. No superlatives the source does not state.
Good: The lot is behind the building, off Elm Street.
Bad: The best free parking in town is always waiting out front.

### arrival

What counts: How a guest finds the door, the entrance, or the check-in point, as the page states it.
What does not count: Directions you inferred from a map, a booking link, or a welcome slogan that does not say where to go.
Max length: 400 characters.
Tone: plain, warm, and factual. No hype. No superlatives the source does not state.
Good: Use the side door on Elm Street and check in at the host stand.
Bad: Guests always find the hidden door without any trouble.

### what_to_expect

What counts: A concrete part of the visit the page describes, such as counter service, a host stand, or live music.
What does not count: A mood claim, a reviewer's opinion, a price, or a promise the page does not make.
Max length: 400 characters.
Tone: plain, warm, and factual. No hype. No superlatives the source does not state.
Good: Order at the counter, then sit anywhere in the dining room.
Bad: Every visit is an unforgettable experience from the first bite.

### duration

What counts: A typical length of the visit only when the page states a time or a range.
What does not count: A guess such as "about an hour" when the page never states a duration.
Max length: 400 characters.
Tone: plain, warm, and factual. No hype. No superlatives the source does not state.
Good: Most dinners last about 90 minutes.
Bad: You will want to stay all night because the food is incredible.

### attire

What counts: A dress note the page states, such as casual, or no dress code.
What does not count: A style you assumed from the cuisine, or a fashion compliment.
Max length: 400 characters.
Tone: plain, warm, and factual. No hype. No superlatives the source does not state.
Good: Come as you are. There is no dress code.
Bad: Guests look their absolute best in smart cocktail attire.

### accessibility

What counts: An access detail the page states, such as a step-free entrance, an elevator, or wheelchair seating.
What does not count: A guess that a one-story building is accessible, or a legal claim the page does not make.
Max length: 400 characters.
Tone: plain, warm, and factual. No hype. No superlatives the source does not state.
Good: The Elm Street entrance is step-free, and wheelchair seating is available.
Bad: The restaurant is fully accessible in every way.

### vibe

What counts: Atmosphere or ambiance words the page itself uses, such as cozy, candlelit, or lively.
What does not count: A mood you inferred from the photos, a reviewer's adjective, or a superlative the page does not use.
Max length: 400 characters.
Tone: plain, warm, and factual. No hype. No superlatives the source does not state.
Good: The room is cozy and candlelit.
Bad: The most magical room in the city, according to local reviewers.

### known_for

What counts: Signature dishes or drinks the page names.
What does not count: A price, a reviewer's favorite, or a dish you know from somewhere else.
Max length: 400 characters.
Tone: plain, warm, and factual. No hype. No superlatives the source does not state.
Good: Known for brisket and ribs.
Bad: The best lobster thermidor in Texas, and a must-order at $42.

### good_for

What counts: An occasion or group the page states, such as date night, groups, families, kids, solo, sports, weddings, rehearsal dinners, corporate or work events, meetings, private events, friends, live music, dogs, lunch, happy hour, or watching games.
What does not count: An occasion you think fits, a crowd the page never mentions, or a promo.
Max length: 400 characters.
Tone: plain, warm, and factual. No hype. No superlatives the source does not state.
Good: Good for kids and for date night.
Bad: Perfect for every birthday, wedding, and sports party.

### seating

What counts: Seating the page states, such as a patio, rooftop, bar seating, a private room, or a dog-friendly patio.
What does not count: A seat type you assumed, a booking offer, or a photo caption that is not in the page text.
Max length: 400 characters.
Tone: plain, warm, and factual. No hype. No superlatives the source does not state.
Good: Dogs are welcome on the patio.
Bad: The stunning rooftop is the only place to sit, and it books out instantly.

### reservations

What counts: Whether the page says they take reservations, walk-ins, or a waitlist. A clear yes, no, walk-in, or recommended is fine when the page says that. Say recommended only when the page says recommended. Available does not mean recommended.
What does not count: A booking link, an offer, a phone number, a policy you filled in, or a note that reservations are "not mentioned."
Max length: 400 characters.
Tone: plain, warm, and factual. No hype. No superlatives the source does not state.
Good: Walk-ins are welcome. Reservations are not required.
Bad: Reservations are recommended. Call (214) 555-0199. The website says walk-ins are not mentioned.
