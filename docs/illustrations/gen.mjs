// Builds the widget contents of the illustrations with the integration's own
// code: node gen.mjs <repo> <out.json> (run by render.sh)
//
// The two widgets on a Saturday evening at Hamilius: the boards of
// test/fixtures (built from the schema of the API, the stop names of the real
// GTFS of the ATP) go through the real parser (src/departures.js) and the
// real widget builders (src/widgets.js).
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [repo, out] = process.argv.slice(2);
const load = (path) => import(pathToFileURL(`${repo}/${path}`).href);
const { buildDeparturesWidget, buildMessagesWidget } = await load('src/widgets.js');
const { parsePassages, boardMessages } = await load('src/departures.js');
const { LANGUAGES } = await load('src/i18n.js');
const fixture = (name) => JSON.parse(readFileSync(`${repo}/test/fixtures/${name}`, 'utf8'));
const manifest = JSON.parse(readFileSync(`${repo}/gladys-assistant-integration.json`, 'utf8'));

// Saturday 7 November 2026, 18:30 in Luxembourg.
const NOW = Date.parse('2026-11-07T17:30:00Z');
const TZ = 'Europe/Luxembourg';

const hamilius = fixture('board-hamilius.json');
const gare = fixture('board-gare-centrale.json');
const hamPassages = parsePassages(hamilius);
const garePassages = parsePassages(gare);

const contents = {};
for (const language of LANGUAGES) {
  contents[language] = {
    departures: buildDeparturesWidget({
      title: 'Hamilius (Bus)',
      passages: hamPassages,
      readAt: NOW,
      count: 6,
      language,
      now: NOW,
      timeZone: TZ,
    }),
    messages: buildMessagesWidget({
      boards: [
        { name: 'Hamilius (Bus)', messages: boardMessages(hamilius, hamPassages), readAt: NOW },
        {
          name: 'Luxembourg, Gare Centrale',
          messages: boardMessages(gare, garePassages),
          readAt: NOW - 60 * 1000,
        },
      ],
      language,
      now: NOW,
      timeZone: TZ,
    }),
  };
}
const widgets = Object.fromEntries(
  manifest.widgets.map((w) => [w.key, { icon: w.icon, label: w.label }]),
);
writeFileSync(out, JSON.stringify({ now: NOW, widgets, contents }));
