# Front review: Israel & Gaza (`israel-gaza`)

ADO-592 per-front review, October 4, 2026. Model: the ADO-610 Trump Corruption review. Proposals only: nothing here has been applied anywhere.

**How this was measured.** One read-only pass over PROD with the anon key: every story's id, headline, status, date and alarm (16,383 stories, January 3 to October 4, 2026; about 3 MB of egress, no summaries or content), plus `story_event` and `events`. All regex checks ran in PGlite (Postgres 17, the same ARE engine) against those real headlines, simulating the migration-115 sweep (headline only, lowest priority wins, only unassigned active stories). PROD event id 10, priority 75, 156 members today. Summaries were not read, so agent pool sizes below are headline-only lower bounds.

## 1. Threads (term 2)

Josh's three strands (October 2, 2026): elections and AIPAC, pushing the US toward Iran, and Gaza.

1. US weapons for Israel: arms sales, emergency declarations that skip Congress, the 2,000-pound bombs, holds and disapproval votes in Congress.
2. US cover at the UN: Security Council vetoes, Resolution 2803.
3. US sanctions on the International Criminal Court (judges, president, prosecutor), on UN rapporteur Francesca Albanese and on Palestinian rights groups.
4. Genocide and famine findings (UN commission of inquiry, ICJ, IAGS, IPC, B'Tselem), always attributed, never in the site's voice.
5. Trump's Gaza plan: "take over Gaza", the ceasefire phases, the Board of Peace, the stabilization force, reconstruction contracts, the Gaza Humanitarian Foundation.
6. The West Bank: annexation steps, settler violence, visa bans on Palestinian officials, and how Washington responds.
7. Israel pushing the US toward war with Iran: Netanyahu's case to Trump, who struck first, US-Israel splits over the Iran deal.
8. AIPAC and pro-Israel super PAC money in US primaries (United Democracy Project, DMFI, Massie, Bush and Bell, El-Sayed and Stevens) and the backlash inside both parties.
9. Israeli government influence operations aimed at Americans: FARA contracts (Clock Tower X, Havas, Bridges Partners, the Esther Project), the Diaspora Ministry, paid influencers.
10. US speech penalties tied to Israel: green-card screening for criticism of Israel, anti-boycott bills, the Palestine Action terror designation.
11. Israel's other wars (Lebanon, Syria) only where the US arms, brokers or restrains them.

## 2. PROD misses

The sweep words are already well covered: only 8 loose ends contain them, and all 8 are pro-Palestinian campus or speech stories the co-word excludes on purpose. The misses are stories without those words:

- **ICC sanctions: 7 loose ends**, mostly alarm 4, for example "US sanctions international criminal court president and prosecutor" (14034), "ICC Judges Sue Trump Administration Over Sanctions" (11644), "Human rights groups sue Trump administration over 'crippling' ICC sanctions" (13729).
- **Board of Peace: 21 loose ends**, alarm 3 to 5, for example "Trump Seeks $1B From Nations for Board of Peace Permanent Membership" (946, alarm 5), "Trump vows $10 billion contribution to his own Board of Peace" (3389). About ten Board stories are already members, because their headlines also say Gaza or Israel.
- **Strand 2 (Iran) is almost empty by construction.** 69 PROD headlines name both Iran and Israel; the current "Israel pushes the US" rule matches 0 of them, so all 69 sit on Iran. About 10 are really this strand, for example "Push from Saudis, Israel helped move Trump to attack Iran" (4124), "Trump Given Four Iran Demands by Israel's Netanyahu" (3107), "White House officials believe 'the politics are a lot better' if Israel strikes Iran first" (3854), "Was Trump ignorant to the realities of Netanyahu's promised 'easy' war on Iran?" (6760), plus 724, 4387, 4402, 7116, 7037, 12061. Iran's sweep runs every 2 hours and the agent only sees unassigned stories, so the agent can never rescue these; only a hand move can.
- **One false member:** "Trump Pledges $10m to Continued Recovery From East Palestine Train Disaster" (3394): `palestin\w*` matched East Palestine, Ohio.
- Weak members to glance at in admin: 2386 (Syria's Druze, no US role), 4089 (India), 4598 (Beirut assault, no US actor). Four activist-deportation stories (2455, 3220, 10269, 12827) were filed here because Israel was swept before the ICE front existed; under today's priorities ICE wins them.

## 3. Keyword changes (verified on PROD headlines)

- Sweep adds `board of peace`, `francesca albanese`, and ICC or "international criminal court" only when the headline also names a US actor (so a Duterte trial headline stays out).
- Co-word adds `east palestine` to the exclusions, three push verbs (`forc*`, `sway*`, `lean on`) and "to" to the words that cancel a push verb ("Israel forced to..." is not Israel pushing Washington).

```
sweep_pattern:
\m(israel|israeli|israelis|netanyahu|gaza|gazans?|aipac|united democracy project|pro-israel|idf|west bank|hamas|palestin\w*|board of peace|francesca albanese)\M|^(?=.*\m(sanction\w*|trump|rubio|washington|u\.s|us|america\w*)\M).*\m(icc|international criminal court)\M

sweep_coword:
^(?!.*\m(pro-palestinian|pro-hamas|east palestine)\M)((?!.*\miran(ian)?\M)|.*\m(israel\w*|netanyahu)\M.{0,60}\m(urg(es|ed|ing)|press(es|ed|ing)|pressur(es|ed|ing)|lobb(ies|ied|ying)|push(es|ed|ing)|convinc(es|ed|ing)|persuad(es|ed|ing)|goad(s|ed|ing)|lur(es|ed|ing)|drag(s|ged|ging)|forc(es|ed|ing)|sway(s|ed|ing)|lean(s|ed|ing)? on)\M(?!\s+(back|by|to)\M).{0,60}\m(us|u\.s|america\w*|trump|washington|white house|congress)\M|.*\m(trump|washington|white house|congress)\M.{0,40}\m(pressured|pushed|lobbied|urged|persuaded|convinced|dragged|goaded|lured|forced|swayed)\s+by\s+(the\s+)?(israel\w*|netanyahu)\M)
```

**Result on PROD (PGlite):** the targeted sweep would file 28 loose ends (7 ICC, 21 Board of Peace), lose none, and no other front loses a story (4 Corruption and 2 Iran members also match; they stay put). The co-word change drops only story 3394 and newly accepts 2 of the 69 Iran-and-Israel headlines (4387 "Israel forced US's hand", 7116 "Lean on Trump"), both correct; both are already on Iran, so this only affects future stories. Speed: 0.4 s per 16,000 headlines (the old rule was 0.27 s).

Left to the agent on purpose: Massie, El-Sayed, Zionist, Abraham Accords, Hezbollah, Lebanon (each is mostly horse race or has no US actor).

## 4. Agent input

**agent_pattern** (new sweep verbatim, then extras). Changes from today: bare `albanese` becomes `francesca albanese` (it matched 5 PROD headlines about Australia's prime minister); `war powers`, `epic fury` and `midnight hammer` move out (they are Iran's, and pulled Venezuela, Greenland and Cuba war-powers votes into this pool); `abraham accords`, `mike huckabee`, `zionis\w*`, `hezbollah`, `special rapporteur` come in.

```
\m(israel|israeli|israelis|netanyahu|gaza|gazans?|aipac|united democracy project|pro-israel|idf|west bank|hamas|palestin\w*|board of peace|francesca albanese)\M|^(?=.*\m(sanction\w*|trump|rubio|washington|u\.s|us|america\w*)\M).*\m(icc|international criminal court)\M|\m(fara|foreign agents? registration|havas|clock tower x|bridges partners|esther project|stoic|diaspora ministry|ministry of diaspora|democratic majority for israel|dmfi|adelson|gaza humanitarian foundation|ghf|international stabilization force|international criminal court|icc|special rapporteur|icj|international court of justice|famine|genocide|abraham accords|mike huckabee|zionis\w*|hezbollah)\M
```

Member gate: all 156 members match on the headline. Headline-only pool after the new sweep: 14 (41 today).

**Plain definition.** This front is the record of what the US government does for, with, or because of Israel's government, and of Israel's government and US pro-Israel groups acting on American politics. A story belongs when a US actor (the President, State, the Pentagon, Treasury, Congress, a US court) arms, funds, shields, sanctions on Israel's behalf, plans for Gaza, or goes to war alongside Israel at Israel's urging; or when Israel's government or a named pro-Israel group spends on, lobbies, or runs influence campaigns aimed at US elections and officials. Gaza's toll belongs when it comes with a US decision or a finding by a named body. Name Israel's government and US groups separately; never call a group "Israel". Genocide is always "X concludes", never the site's own claim.

Decline: Israeli domestic politics, IDF operations and Israel's wars in Lebanon or Syria with no US actor; antisemitism and campus stories with no named lobbying or election spending; candidate profiles and horse race that merely mention AIPAC; general Middle East coverage (oil, troop movements).

Tie-breaks (lower sweep priority wins on keywords; the agent follows the same order): Trump Corruption (15) takes money for Trump, his family or the envoys (Kushner's and Witkoff's business deals; diplomacy alone is not corruption). Election Suppression (50) takes anything about who votes. ICE (72) takes the detention or deportation of pro-Palestinian activists (Khalil, Mahdawi, Ozturk). Iran (80) takes the war itself, strikes, Hormuz, war-powers votes and talks; this front takes an Iran story only when Israel or Netanyahu is shown steering the US decision. The Board of Peace belongs here (it was created by the Gaza resolution and runs Gaza's plan) unless the story is about money reaching Trump or his family, which is Corruption.

**Calibration (real PROD headlines)**

| Headline | Decision | Why |
|---|---|---|
| State Department Bypasses Congress to Send Israel More Than 20,000 Bombs (4690) | assign | US arms, skipping Congress |
| US sanctions international criminal court president and prosecutor (14034) | assign | US shields Israel from the court |
| AIPAC Spending Dominates the Michigan Democratic Senate Primary (13467) | assign | Named group spending on a US election |
| Push from Saudis, Israel helped move Trump to attack Iran (4124) | assign (if unassigned) | Israel steering the US war decision |
| U.S. and Israel launch airstrikes against Iran (4065) | decline, Iran | The war itself |
| Pro-Palestinian activists accused of intimidation campaign against University of Michigan officials (10979) | decline | Campus story, no US-Israel policy or spending |

**Most important open question:** strand 2. Accept that "Israel pulling us into Iran" mostly lives on the Iran front, or approve a one-time hand move of the 10 stories listed in section 2 (ids 724, 3107, 3854, 4124, 4387, 4402, 6760, 7037, 7116, 12061)? Recommendation: approve the move; there is no keyword fix that separates these from war coverage.
