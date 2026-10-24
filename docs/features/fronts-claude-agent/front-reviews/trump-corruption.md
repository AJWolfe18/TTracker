# Front review: Trump Corruption (`trump-corruption`), agent definition only

ADO-592, October 4, 2026. The keywords were reviewed on October 4, 2026 (ADO-610, `scripts/maintenance/2026-10-04-ado-610-trump-corruption-front.sql`), so this file is the agent's definition plus one problem found along the way. Measured read-only against PROD headlines (16,383 stories, no summaries) with PGlite. PROD event id 14, priority 15 (wins every keyword overlap), 318 members.

**agent_pattern:** keep the ADO-610 value. Headline-only pool today: 238 loose ends (the arch, donors, watchdogs, golf, sovereign wealth and Board of Peace terms bring most of them).

**Problem found: 10 members are envoy diplomacy, not money.** They came over from The Envoys' Deals, filed back when its sweep was a bare "kushner" at priority 20 (it beat Iran's 80), and none of them matches the corruption agent_pattern on the headline: "Trump sending Vance, Witkoff and Kushner to Pakistan for ceasefire talks with Iran" (6946), plus 2896, 8068, 8078, 8127, 8137, 12077, 14235, 14527 (Josh Kushner, a different Kushner) and 14807. If ADO-592 re-runs the 592 member gate (headline OR summary must match), they may pass on the summary's "special envoy", but they do not belong. Recommendation: move the six about the Iran talks (6946, 8068, 8078, 8127, 8137, 12077) to Iran and make the other four loose ends, by hand, before the agent goes live. Do not add bare `kushner` or `witkoff` to the pattern to make them pass.

**Plain definition.** This front is the record of public power used for private gain by Trump, his family, his envoys and his allies. A story belongs when money, gifts or business flow to Trump, his family (Eric, Don Jr., Ivanka, Melania, Barron, Jared Kushner) or their companies (Trump Organization, Trump Media, World Liberty Financial, the memecoin, licensing deals), or to Steve Witkoff and his family, from people with business before the government (foreign governments, donors, companies); when an official act follows money (a pardon, contract, regulatory decision, tariff break or lawsuit settlement for a donor or crony; the payout funds for allies; paid access to Trump); when Trump profits from his own policy moves (stock and crypto timing, insider trading near announcements, oil deals for allies); when public property or money is turned to his projects (the Qatar jet, the ballroom and its donors, the Reflecting Pool and East Potomac contracts, the presidential library, the gold card); or when the checks on all this are removed (inspectors general fired, ethics and anti-corruption units disbanded, FCPA enforcement paused).

Decline: corruption cases with no link to Trump's circle (a mayor's bribery plea, a state official); rhetoric ("Biden calls Trump corrupt") and campaign attacks; Kushner's and Witkoff's diplomacy when no money is in the story; Trump's construction projects (the arch, renovations) unless the story is about who is paid or who donated; general budget, debt or watchdog stories outside the Trump circle; golf-course incidents.

Tie-breaks: this front wins any keyword overlap, so the agent should be the one to keep it honest. A story goes here only when the money or favor is the news. A pardon for a donor or a crony's company comes here; the pardon itself as clemency stays off the fronts. The Epstein files stay on Epstein unless the story is about money for favors. The Board of Peace goes to Israel & Gaza unless money reaches Trump or his family. An FDA, Pentagon or immigration decision that followed a donation comes here ahead of RFK, Hegseth or ICE.

**Calibration (real PROD headlines)**

| Headline | Decision | Why |
|---|---|---|
| Steve Witkoff, Trump's Special Envoy, Made More Than $250 Million While in Government (15080, a loose end today) | assign | Envoy profiting in office; the sweep misses it because "made ... million" is not one of its money words |
| For $1 Million, Donors to U.S.A. Birthday Group Offered Access to Trump (2578) | assign | Paid access |
| Trump Plans to Protect Methane-Leaking Stripper Wells. This Billionaire Donor Will Benefit. (11220) | assign | Policy following a donor |
| A $5 Million Donation From Big Tobacco Preceded F.D.A. Vape Decision (9828) | assign | Donation, then a decision; wins over RFK |
| Trump sending Vance, Witkoff and Kushner to Pakistan for ceasefire talks with Iran (6946) | decline, Iran | Diplomacy, no money |
| Former mayor of Mississippi's capital pleads guilty to bribery and fraud (12251) | decline | Not Trump's circle |
