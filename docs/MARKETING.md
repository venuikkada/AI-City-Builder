# Go-to-market playbook

How to sell and market AI City Builder: what to say, who to say it to, how to charge, and what to do in the first 30 and 90 days.

---

## 1. Positioning

**One-liner:** *Describe your dream city. AI plans it. You build it.*

**The hook nobody else has:** every player gets a different game from their own sentence. “Build a futuristic Hyderabad” gives you a Charminar Holo-Arch, Hussain Sagar, HITEC City towers and an AI advisor called Nizam-9. Classic city builders can't do that, and AI image toys don't give you a game.

**Three proof points to repeat everywhere:**
1. *Personal:* your city, your words, your local landmarks.
2. *Real challenge:* money, traffic and population are actually simulated. Jams appear on the roads you built.
3. *Instant:* plays in the browser and on phones, with no download.

**Name check.** “AI City Builder” describes the product but is hard to own as a brand. Before spending on ads, consider a brandable name and check domains and trademarks first. Ideas: *Promptopolis*, *CityGenie*, *Nagaram* (Telugu for “city”, a great fit for a Hyderabad launch), *Shehar.ai*.

---

## 2. Who to sell to (in this order)

| Segment | Why they care | How you reach them | How they pay |
| --- | --- | --- | --- |
| **Indian mobile gamers and city fans** (start with Hyderabad, then Bengaluru, Mumbai, Chennai) | City pride plus “what will AI do with my city?” curiosity | Instagram Reels, YouTube Shorts, city subreddits and Facebook groups, Telugu/Hindi creators | Freemium: AI credits or a monthly pass |
| **Global city-builder fans** | A fresh twist on SimCity and Cities: Skylines | r/CityBuilders, itch.io, web-game portals, Product Hunt | Same freemium |
| **Schools, colleges and coaching centres** | Civics, geography and urban planning made hands-on | Teacher communities, school chains, ed-tech partners | Annual classroom or school licence |
| **Smart-city missions, municipal innovation cells, urban-planning NGOs** | Citizen engagement (“Imagine Hyderabad 2047”) | Direct outreach, civic-tech events, hackathons | Paid pilots and workshops |
| **Brands and real-estate developers** | A memorable branded experience | Agency partners | Sponsored challenges or custom flavour packs |

Start with segment 1 to get traction and screenshots, then use those numbers to sell segments 3–5.

---

## 3. Pricing and unit economics

**Your AI cost.** These are estimates; the server logs real token counts for every call, so re-check them in week one. On the default model, `claude-opus-5-5`:

| Call | Approx. cost |
| --- | --- |
| AI city plan (medium effort) | ~$0.09 ≈ ₹8 |
| Advisor missions / invented building (low effort) | ~$0.01–0.03 ≈ ₹1–2.5 |
| Offline planner | free |

**Sell credits, not “unlimited”.** One credit ≈ one advisor or invention call (≈ ₹1.7 of AI cost), and an AI city plan costs 5 credits. This keeps every tier profitable even for your heaviest users.

| Tier | Price | Includes | Worst-case AI cost |
| --- | --- | --- | --- |
| **Free** | ₹0 | Unlimited offline-planner cities, 15 credits on sign-up (≈ 3 AI cities) + 10 credits per week | ≈ ₹70/month for a very active player; most cost far less |
| **Credit pack** | ₹99 | 35 credits (UPI-friendly impulse buy) | ≈ ₹60 |
| **City Pass** | ₹199/month or ₹1,499/year | 75 credits/month, cloud saves, HD snapshots, early access to new city packs | ≈ ₹128 at full use; typical use is 30–60% of that |
| **Classroom** | ₹4,999 per class per year | 40 seats, a shared credit pool, teacher prompt packs (e.g. “a flood-resilient Chennai”) | Pool-capped |
| **Civic / brand pilot** | ₹1.5–10 lakh per engagement | Custom flavour pack, branded landing page, citizen-vision report, workshops | Negligible vs. price |

**Rules of thumb:**
- Prices above include 18% GST, and payment gateways take about 2%. Keep worst-case AI cost below about 80% of net revenue per tier, as the table does.
- Always let a new player's first city be designed by the AI. That reveal is what sells the City Pass.
- In India, use UPI-friendly amounts (₹49, ₹99, ₹199) and show the yearly discount clearly.
- The model is your biggest cost lever. `ANTHROPIC_MODEL` can point to a cheaper model (Claude Sonnet 5.5 costs about half as much per token), for example for free-tier advisor calls. Compare plan quality side by side before switching, because the AI reveal is the product.

**Missing from the product today:** accounts, payments (Razorpay or Stripe), cloud saves and per-user credit tracking. Build them before charging (see section 8). Until then, the server's per-IP and daily caps protect your bill.

---

## 4. Built-in growth loops (use them deliberately)

1. **📸 Snapshot button.** Every snapshot is captioned with the city name, population and the player's prompt. Add your domain or a QR code to that caption band (`snapshot()` in `public/js/main.js`) so every share is an ad.
2. **City pride.** Each flavour pack (Hyderabad, Mumbai, Bengaluru, Delhi, Chennai, Kolkata, Pune, Jaipur, Dubai, Singapore, Tokyo, New York, London, Paris, Amsterdam) is a separate post in that city's communities.
3. **Challenges.** Run a weekly prompt challenge (“Fix Bengaluru traffic”, “Monsoon-proof Mumbai”, “Hyderabad 2047”). Players post snapshots with a hashtag, and you feature the best.
4. **Comparison bait.** “Mumbai vs Hyderabad: whose AI city is better?” posts drive comments and duets.

---

## 5. Launch plan: first 30 days

**Week 0: get ready**
- Deploy to a Node host with a custom domain (see README → Deploying). Set the AI caps.
- Add privacy-friendly analytics (e.g. Plausible) to measure: prompt submitted → plan generated → first road built → first mission complete.
- Write a privacy policy and terms (AI-generated content, fair use, minimum age).
- Create Instagram, YouTube and X accounts and a Discord server under the final brand name.

**Week 1: content seeding** (record 15–20 short vertical videos before launch; formats in section 6)
- Post 1–2 per day on Reels and Shorts. Put “Play free: link in bio” on screen and in the caption.

**Week 2: community launch**
- Post a Hyderabad-first story to r/hyderabad, r/india, r/IndianGaming and r/CityBuilders. Lead with the screenshot and the prompt, not a sales pitch. Reply to every comment.
- Publish an itch.io page (upload `public/`; the offline planner works there with no server).
- Do a “Show HN” post and an IndieHackers post about building it with Claude.

**Week 3: creators**
- Contact 20–30 Telugu, Hindi and Tamil tech and gaming creators (10k–200k followers). Offer them a custom flavour pack of their city and a free City Pass for their audience. Small creators convert better and cost less.
- Launch the first weekly challenge with a small prize (₹5,000 or merchandise).

**Week 4: portals and press**
- Submit to web-game portals (CrazyGames, Poki, GameDistribution). They bring traffic and share ad revenue, and the game is iframe-friendly.
- Pitch Indian tech and city media (YourStory, Inc42, city pages of national dailies) with the angle “AI reimagines Hyderabad in 2080”, plus 4 striking screenshots and a 30-second video.
- Launch on Product Hunt (Tuesday–Thursday, 12:01 am PT), with a demo GIF and maker comment ready.

---

## 6. Content hooks (ready to film)

| Hook (first 2 seconds) | What to show |
| --- | --- |
| “I typed *futuristic Hyderabad* and AI designed this…” | Typing the prompt → plan reveal → zoom on the Charminar Holo-Arch |
| “Can you fix Bengaluru's traffic?” | Traffic overlay all red → add metro and avenues → green |
| “AI invented a biryani food court for my city” | The Invent dialog → new building appears → place it |
| “Mumbai vs Hyderabad: rate the AI's city” | Side-by-side snapshots; ask viewers to vote in comments |
| “I let my city go bankrupt to see what happens” | Tax at 0%, money goes red, the advisor panics |
| “Building Neo Hyderabad from 0 to 10,000 people” | 30-second timelapse at max speed |

Tips: vertical 9:16, captions on, the result shown within the first 3 seconds, and local-language voiceover for regional reach.

---

## 7. Selling to schools, cities and brands

**Demo script (10 minutes):**
1. Ask the buyer which city they care about and type it in live. The reveal is the “wow” moment.
2. Build a neighbourhood and show jobs vs. homes.
3. Turn on the traffic overlay and fix a jam with a metro. That's the learning moment.
4. Ask the advisor for missions. They're tailored to the city's problems.
5. Close with the offer: a pilot, a price and a start date.

**Pilot structure (municipal or education):** 6 weeks, with a custom flavour pack (real neighbourhoods and landmarks), a branded landing page and 2 workshops. Report back with the citizen or student prompts collected (“what people want their city to become”). That report is often what the buyer values most.

**Cold email template:**

> Subject: “What should [City] look like in 2047?” — a 5-minute playable answer
>
> Hi [Name], we built a browser game where anyone types how they imagine [City] and AI turns it into a playable city: their landmarks, their neighbourhoods, real traffic and budget trade-offs. Schools use it to teach urban planning; cities can use it to collect citizens' visions in a fun way.
> Here's a 60-second demo of [City]: [link]. Could I show you a live version with your city in 15 minutes next week?

---

## 8. Product work that unlocks revenue (priority order)

1. **Accounts, cloud saves and per-user AI quotas.** Needed for paid tiers, and it protects AI spend.
2. **Payments** (Razorpay for UPI and cards in India; Stripe elsewhere).
3. **Share links:** a public URL showing the city snapshot and its prompt, with a “Play this city” button.
4. **Weekly challenge mode and leaderboard** (same prompt for everyone; ranked by population, happiness and traffic).
5. **Localisation:** Telugu, Hindi and Tamil UI, plus AI plans written in the player's language.
6. **Installable app:** the PWA manifest is already there. Wrap it as a Trusted Web Activity for a Play Store listing.

---

## 9. Metrics that matter

| Metric | Target to aim for |
| --- | --- |
| Prompt → plan generated | > 90% |
| Plan → first road built (activation) | > 60% |
| First mission completed | > 40% of activated players |
| Snapshot shares per 100 players | > 10 |
| Day-7 retention | > 15% (casual web benchmark) |
| Free → paid conversion | 2–5% |
| AI cost per monthly active user | Well below revenue per user; watch it weekly |

Review weekly. If activation is low, simplify the first minute (the advisor's first tip and the highlighted road tool). If shares are low, make the snapshot more striking. If conversion is low, make the AI's uniqueness more obvious in the free tier.

---

## 10. 90-day goal

- 10,000 players, 1,000 weekly actives and 200 paying users.
- 1 school-chain pilot and 1 civic or brand pilot.
- A library of 50+ short videos and 15 city flavour packs promoted in their own communities.

Then double down on whichever channel produced the cheapest activated player.
