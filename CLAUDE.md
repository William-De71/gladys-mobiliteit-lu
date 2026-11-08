# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration** for Mobiliteit.lu, the buses,
trams and trains of Luxembourg: a Node.js service (Node 22+, ESM, no build
step) that runs in its own sandboxed Docker container and talks to Gladys
through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It reads the official real-time API of the
Administration des transports publics (ATP), a HAFAS ReST server
(`https://cdt.hafas.de/opendata/apiserver/`, schema `xsd/rest-2.52.xsd`,
CC BY 4.0) with the personal key of the user (`accessId`): the departure board
of each followed stop — three in the form, up to 7 more added with the "Add a
stop" button. The names and numbers of the stops come from the open GTFS of
the ATP on data.public.lu (only `stops.txt`, read weekly, kept in /data).
Transport: cloud only.
API: https://data.public.lu/fr/datasets/api-mobiliteit-lu/ (only
`departureBoard` and `location.nearbystops` are published; `location.name`
and `himsearch` answer 404).

**Never tested with a real key** (none was at hand when it was written): the
fields read are those of the schema and the community documentation
(https://github.com/Felix3qH4/Mobiliteit.lu-API-documentation). The fixtures
of the boards are built, not recorded: replace them with real answers as soon
as a user sends some.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/widgets.test.js          # one file
DEBUG=gladys-integration-sdk npm test     # with the SDK debug logs
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store . --skip-image-check   # store checks
scripts/build-cover.sh                    # cover.jpg from docs/assets/cover.svg
docs/illustrations/render.sh              # docs/assets/widgets.<lang>.png
node .github/scripts/release.mjs next     # the version the next release would get
```

## Architecture

```
index.js                SDK wiring only (new GladysIntegration + createApp)
src/app.js              every handler, registered before connect(); the timers
src/hafas-api.js        HTTP client of the departure board: key, errors (API_AUTH, API_QUOTA…), redaction
src/quota.js            requests counted by minute in /data, budgets, the interval of many stops
src/stops.js            the stop list of the open GTFS (data.public.lu), typed names -> HAFAS ids
src/zip.js              a zip archive and its CSV, without dependency
src/departures.js       board -> passages (real time, delay, cancelled, line, mode) and messages
src/events.js           scene trigger transitions, payloads, scene action outputs
src/device.js           the stop devices and their states
src/widgets.js          departures and traffic messages dashboard widgets
src/store.js            /data/mobiliteit-lu.json: stops, `seen`, `quota`
src/time.js             Luxembourg wall-clock times, times of day (TZ)
src/config.js           configuration (key, three stops + `added_stops`, interval, language)
src/i18n.js             runtime texts, en / fr / de / es
gladys-assistant-integration.json   manifest
docs/{en,fr,de,es}.md   user documentation, re-hosted by the store
docs/illustrations/     generated widget images (render.sh, gen.mjs, render.js)
test/fixtures/          boards built from the schema, a reduced real stops.txt (CC BY 4.0)
.github/scripts/release.mjs         version, changelog, bump (tested in test/)
```

## Rules

- **External ids are forever**, and so is every key users store: device and
  feature external ids (`stop:<HAFAS id>_<line slug>_<direction slug>`, e.g.
  `stop:200405020_16_kirchberg`: the number of the stop, never its name;
  the line is the typed one without "bus", "tram", "ligne"…), feature
  `category` / `type` / `unit` / `min` / `max` / `step`, the keys of
  `config_schema`, `actions`, the widgets and their settings, scene triggers
  (fields, options, variables) and scene actions (fields, outputs), and the
  internal config keys `added_stops` (`[{ stop, line, direction }]`, the stop
  stored as its HAFAS id) and `last_language`. `test/structure.test.js`
  compares them to `test/fixtures/discovery.baseline.json`: never update the
  baseline to make a test pass without a documented migration.
- **Category / type pairs.** The next passage is `text` / `text`, the waits
  and the delay `duration` / `integer` in minutes (0-180, 0-120), the count of
  messages `counter-sensor` / `integer` (0-20). Without a passage the waits
  are not published (a 0 would announce a bus now); without real time the
  delay is not published; an early vehicle counts 0.
- **The key.** `access_id` is a `secret`: never log it, never put it in an
  error message or the diagnostic (`redact()` in hafas-api.js; a test checks
  every log line). A refused key (API_AUTH) is not asked again until the
  configuration is saved.
- **The quota.** 500 requests an hour and 5 000 a day by default per key.
  Every request goes through `readBoard()`, which asks `quota.allow()` and
  `quota.record()`s it (buckets by minute in /data). Budgets: 450 an hour,
  4 500 a day; the timer plans 3 600 a day (`minimumInterval()` makes the
  interval longer with many stops). After API_QUOTA nothing is asked before
  the next full hour. Never add a request that bypasses `readBoard()`.
- **`should_poll` stays false**: the integration reads on its own timer —
  each followed stop id in ONE request every interval (1 to 10 min, 2 min by
  default, longer with many stops; 10 min while no stop announces anything
  in the next 45 minutes), devices of one stop sharing the request. A widget
  or a scene action reuses a reading of less than 2 minutes; a stop typed in
  a widget costs one request every 2 minutes at most.
- **Stops.** The stop list is the `stops.txt` of the newest zip of the GTFS
  dataset (only that file is inflated), read weekly; a GTFS id is the HAFAS
  id zero-padded to 12 digits. Searching never spends the key. A number typed
  is accepted even when the list cannot be read.
- **Times.** The board writes Luxembourg wall-clock dates and times with
  their offset (`tz`, minutes); without it, `wallToInstant()` in
  Europe/Luxembourg. Never `Date.parse()` them.
- **Real time.** `rtTime` gives the estimate and the delay; without it, the
  timetable only (say it: "(timetable)"). `cancelled` is a cancelled trip
  (left out of the waits, fired once by `departure_cancelled`). Never invent
  a delay.
- **Messages.** The traffic messages are those the API attaches to the
  departures (`Messages.Message[]`) and to the board (`Message[]`), active
  ones only, one per id, with the lines of the departures that carry them.
- **Events once.** `seen` (in /data) remembers per stop the reminders fired,
  the cancellations and delays reported, the messages seen (a week). The
  first reading of a stop is a baseline: nothing fires. A scene action or a
  widget never fires an event.
- **Data licence.** CC BY 4.0: keep "Mobiliteit.lu (ATP)" and the time of the
  reading visible in the widgets, and the credit (Administration des
  transports publics / mobiliteit.lu) in the README, the docs and NOTICE.
- **The container rootfs is read-only.** Write only under `/data`.
- **Four languages.** Every user-facing text (manifest, runtime messages in
  `src/i18n.js`, `docs/*.md`, README) exists in English, French, German and
  Spanish. `test/i18n.test.js` checks it. Names of stops and destinations
  stay as the ATP writes them; the traffic messages come in the language
  asked to the API (fr, de, en).
- **Widget images.** After any change to the content of a widget, run
  `docs/illustrations/render.sh` again and look at the four PNG files.
- **Versions belong to the Release workflow**: never edit `version` in
  `package.json`, the lockfile or the manifest, nor the `docker_image` tag.
  The version stays below 1.0.0 until the maintainer runs the Release workflow
  with `release-as: 1.0.0`.
- **Changelog.** Never edit CHANGELOG.md by hand, it is generated at the
  release. Write the PR title as the line the user will read.
- **Commits and PR titles** follow Conventional Commits, in English: `feat` ->
  minor, `fix` / `perf` -> patch, `!` or `BREAKING CHANGE:` -> major (minor
  below 1.0.0); `docs`, `chore`, `ci`, `test`, `style`, `refactor`, `build`
  release nothing.
- **Manifest.** Texts are objects `{ "en", "fr", "de", "es" }`; the catalog
  `description` holds 10 to 100 characters per language; the file stays under
  100 KB. `gladys_version` is `>=5.3.0` (widgets, scene triggers, catalog
  `keywords` and `countries`). Transport: `["cloud"]`. No permission, no
  secret.
- **Forum drafts** (`.github/forum-*.md`) are never committed.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network (the fake ATP of
  `test/helpers/fixtures.js`).
