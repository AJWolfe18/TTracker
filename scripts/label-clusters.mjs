import fs from 'fs';

// Read the CSV
const csv = fs.readFileSync('./exports/single-article-stories-labeled.csv', 'utf8');
const lines = csv.split('\n');
const header = lines[0];
const rows = lines.slice(1);

// Define cluster patterns (title substring -> cluster label)
const patterns = [
  // Shutdown cluster
  [/shutdown/i, 'SHUTDOWN'],
  [/layoff.*federal|federal.*layoff/i, 'SHUTDOWN'],

  // Voting Rights Act / Supreme Court Louisiana case
  [/voting rights act/i, 'VOTING_RIGHTS_ACT'],
  [/louisiana.*map|louisiana.*district|louisiana.*voters/i, 'VOTING_RIGHTS_ACT'],
  [/supreme court.*voting/i, 'VOTING_RIGHTS_ACT'],
  [/rearguments are rare/i, 'VOTING_RIGHTS_ACT'],
  [/affirmative action.*suggest/i, 'VOTING_RIGHTS_ACT'],
  [/lawyers appearing before the court/i, 'VOTING_RIGHTS_ACT'],
  [/Black representatives to Congress/i, 'VOTING_RIGHTS_ACT'],
  [/politics drove this map/i, 'VOTING_RIGHTS_ACT'],
  [/non-African-American.*voters/i, 'VOTING_RIGHTS_ACT'],
  [/shelby county ruling/i, 'VOTING_RIGHTS_ACT'],

  // China tariffs
  [/100.*tariff.*chin/i, 'CHINA_100_TARIFFS'],
  [/chin.*100.*tariff/i, 'CHINA_100_TARIFFS'],
  [/tariff.*100.*percent/i, 'CHINA_100_TARIFFS'],
  [/100 percent tariffs on China/i, 'CHINA_100_TARIFFS'],

  // Young Republicans racist texts
  [/young republican/i, 'YOUNG_GOP_RACIST_TEXTS'],
  [/racist.*text/i, 'YOUNG_GOP_RACIST_TEXTS'],
  [/homophobic.*text/i, 'YOUNG_GOP_RACIST_TEXTS'],
  [/love hitler/i, 'YOUNG_GOP_RACIST_TEXTS'],
  [/swastika/i, 'YOUNG_GOP_RACIST_TEXTS'],
  [/hate.*laced.*chat/i, 'YOUNG_GOP_RACIST_TEXTS'],
  [/stupid things.*boys/i, 'YOUNG_GOP_RACIST_TEXTS'],
  [/condemn.*republican.*text/i, 'YOUNG_GOP_RACIST_TEXTS'],

  // Venezuela
  [/venezuela/i, 'VENEZUELA_STRIKES'],
  [/maduro/i, 'VENEZUELA_STRIKES'],

  // National Guard deployments
  [/national guard/i, 'NATIONAL_GUARD'],

  // Hegseth Russia
  [/hegseth.*russia/i, 'HEGSETH_RUSSIA'],
  [/hegseth.*costs/i, 'HEGSETH_RUSSIA'],
  [/russia.*hegseth/i, 'HEGSETH_RUSSIA'],

  // CDC layoffs
  [/cdc.*layoff/i, 'CDC_LAYOFFS'],
  [/cdc.*fired/i, 'CDC_LAYOFFS'],
  [/cdc.*staff/i, 'CDC_LAYOFFS'],
  [/cdc.*experts/i, 'CDC_LAYOFFS'],
  [/cdc.*officials/i, 'CDC_LAYOFFS'],

  // Letitia James indictment
  [/letitia james/i, 'LETITIA_JAMES'],

  // Charlie Kirk visa
  [/charlie kirk/i, 'CHARLIE_KIRK_VISA'],
  [/visa.*kirk/i, 'CHARLIE_KIRK_VISA'],
  [/criticized charlie/i, 'CHARLIE_KIRK_VISA'],

  // Mamdani NYC mayoral
  [/mamdani/i, 'MAMDANI_NYC_MAYOR'],
  [/zohran/i, 'MAMDANI_NYC_MAYOR'],

  // Netanyahu pardon
  [/netanyahu.*pardon/i, 'NETANYAHU_PARDON'],
  [/pardon.*netanyahu/i, 'NETANYAHU_PARDON'],

  // Moulton/Markey Senate
  [/moulton.*markey/i, 'MOULTON_MARKEY_SENATE'],
  [/moulton.*senate/i, 'MOULTON_MARKEY_SENATE'],
  [/markey.*massachusetts/i, 'MOULTON_MARKEY_SENATE'],
  [/senator.*80.*run/i, 'MOULTON_MARKEY_SENATE'],

  // Biden health
  [/biden.*cancer/i, 'BIDEN_HEALTH'],
  [/biden.*radiation/i, 'BIDEN_HEALTH'],

  // Grijalva Arizona
  [/grijalva/i, 'GRIJALVA_ARIZONA'],

  // Epstein (from earlier analysis)
  [/epstein/i, 'EPSTEIN_FILES'],

  // Comey case
  [/comey/i, 'COMEY_CASE'],

  // ICE / Immigration enforcement
  [/\bice\b.*aggressive|ice.*crackdown|ice.*detention/i, 'ICE_ENFORCEMENT'],
  [/mandatory detention/i, 'ICE_ENFORCEMENT'],
  [/latinos.*changing habits/i, 'ICE_ENFORCEMENT'],
  [/illegals/i, 'ICE_ENFORCEMENT'],

  // Gaza / Middle East
  [/gaza.*deal|hostage.*deal|cease.*fire/i, 'GAZA_CEASEFIRE'],
  [/hamas.*disarm/i, 'GAZA_CEASEFIRE'],

  // Trump tariffs general
  [/tariff.*spain/i, 'TARIFFS_GENERAL'],
  [/tariff.*steel/i, 'TARIFFS_GENERAL'],

  // Eric Adams
  [/eric adams/i, 'ERIC_ADAMS'],
  [/\badams\b.*reelection/i, 'ERIC_ADAMS'],
  [/\badams\b.*mayor/i, 'ERIC_ADAMS'],

  // Portland troops/protests
  [/portland.*troop|troop.*portland/i, 'PORTLAND_TROOPS'],
  [/portland.*protest/i, 'PORTLAND_TROOPS'],
  [/portland.*guard/i, 'PORTLAND_TROOPS'],
  [/full force.*portland/i, 'PORTLAND_TROOPS'],
  [/obsessed with portland/i, 'PORTLAND_TROOPS'],
  [/oregon.*troop/i, 'PORTLAND_TROOPS'],

  // Giuliani/Dominion settlement
  [/giuliani.*dominion|dominion.*giuliani/i, 'GIULIANI_DOMINION'],

  // Birthright citizenship
  [/birthright citizenship/i, 'BIRTHRIGHT_CITIZENSHIP'],

  // Foreign aid freeze Supreme Court
  [/foreign aid.*freeze|freeze.*foreign aid/i, 'FOREIGN_AID_FREEZE'],
  [/withhold.*foreign aid/i, 'FOREIGN_AID_FREEZE'],
  [/supreme court.*foreign aid/i, 'FOREIGN_AID_FREEZE'],

  // Melania Putin Ukrainian children
  [/melania.*putin/i, 'MELANIA_PUTIN'],
  [/putin.*ukrainian children/i, 'MELANIA_PUTIN'],

  // AstraZeneca drug deal
  [/astrazeneca/i, 'ASTRAZENECA_DEAL'],
  [/drug.*price.*deal/i, 'ASTRAZENECA_DEAL'],

  // Congressional redistricting
  [/redistrict/i, 'REDISTRICTING'],
  [/redraw.*map/i, 'REDISTRICTING'],
  [/congressional map/i, 'REDISTRICTING'],

  // Nobel Prize
  [/nobel.*prize/i, 'NOBEL_PRIZE'],
  [/nobel snub/i, 'NOBEL_PRIZE'],
  [/machado.*nobel/i, 'NOBEL_PRIZE'],

  // Abrego Garcia
  [/abrego garcia/i, 'ABREGO_GARCIA'],

  // MTG/Greene
  [/marjorie taylor greene/i, 'MTG_GREENE'],
  [/greene.*straying/i, 'MTG_GREENE'],
  [/greene.*maga split/i, 'MTG_GREENE'],

  // Hegseth generals meeting
  [/hegseth.*general|hegseth.*admiral/i, 'HEGSETH_GENERALS'],
  [/hegseth.*meeting/i, 'HEGSETH_GENERALS'],

  // TikTok deal
  [/tiktok.*deal/i, 'TIKTOK_DEAL'],
  [/tiktok.*order/i, 'TIKTOK_DEAL'],

  // Kamala Harris
  [/kamala harris/i, 'KAMALA_HARRIS'],
  [/harris.*memoir/i, 'KAMALA_HARRIS'],
  [/harris.*biden/i, 'KAMALA_HARRIS'],

  // Zelensky/Ukraine
  [/zelensky/i, 'ZELENSKY_UKRAINE'],
  [/pivot on ukraine/i, 'ZELENSKY_UKRAINE'],

  // Obamacare/ACA
  [/obamacare/i, 'OBAMACARE_ACA'],
  [/aca.*subsid/i, 'OBAMACARE_ACA'],
  [/health insurance.*expire/i, 'OBAMACARE_ACA'],

  // Soros
  [/soros/i, 'SOROS'],

  // Supreme Court emergency orders
  [/supreme court.*emergency/i, 'SCOTUS_EMERGENCY'],
  [/judicial crisis/i, 'SCOTUS_EMERGENCY'],
];

let updatedCount = 0;
const labelCounts = {};

const updatedRows = rows.map(row => {
  if (!row || !row.trim()) return row;

  // Extract title from CSV (it's the 4th field, quoted)
  const fields = row.match(/("(?:[^"]*(?:""[^"]*)*)"|[^,]+)/g);
  if (!fields || fields.length < 6) return row;

  const title = fields[3]?.replace(/^"|"$/g, '') || '';
  const headline = fields[1]?.replace(/^"|"$/g, '') || '';

  // Check patterns against title and headline
  let clusterLabel = '';
  for (const [pattern, label] of patterns) {
    if (pattern.test(title) || pattern.test(headline)) {
      clusterLabel = label;
      break;
    }
  }

  if (clusterLabel) {
    updatedCount++;
    labelCounts[clusterLabel] = (labelCounts[clusterLabel] || 0) + 1;
    // Append label to the row (don't replace)
    return row.replace(/,\s*$/, '') + ',' + clusterLabel;
  }

  return row;
});

// Write updated CSV
const output = [header, ...updatedRows].join('\n');
fs.writeFileSync('./exports/single-article-stories-labeled.csv', output);

console.log('Updated ' + updatedCount + ' rows with cluster labels');
console.log('');
console.log('Labels by count:');
const sorted = Object.entries(labelCounts).sort((a, b) => b[1] - a[1]);
for (const [label, count] of sorted) {
  console.log('  ' + label + ': ' + count);
}
