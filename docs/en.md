# Mobiliteit.lu

## Overview

This integration brings the **buses, trams and trains of Luxembourg** into Gladys, through **Mobiliteit.lu**. It gives the **next departures in real time, with their delay**, at the stops you choose (three in the form, up to 7 more with a button), filtered by line and direction: RGTR, AVL, TICE and CFL buses, the Luxtram, CFL trains. It also shows the **traffic messages** the API attaches to the departures (works, diversions). Each stop becomes a device to show on a dashboard and to use in scenes.

The departures come from the **official real-time API of the Administration des transports publics (ATP)**, the one behind mobiliteit.lu, under the CC BY 4.0 licence. It needs a **personal key**, free, asked by e-mail. The names and numbers of the stops come from the open stop list of the ATP (its GTFS on data.public.lu), read once a week: finding a stop never spends the key.

A key allows **about 500 requests an hour and 5,000 a day**. Each followed stop is one request per reading, every 2 minutes by default. The integration counts its requests: with many stops, it spaces the readings out on its own (the connection status gives the interval used); at night, while no stop announces anything in the next 45 minutes, it reads every 10 minutes. If the quota is reached anyway, it waits for the next full hour.

A departure is **followed in real time** when the API gives an estimated time: its delay is then known. Otherwise it is the **timetable**, marked "(timetable)". **Cancelled trips** are reported.

This is a **cloud** integration: it contacts `cdt.hafas.de` (the API server of the ATP) and `data.public.lu`. Your key and the numbers of your stops are sent to the API; nothing else leaves your network.

The integration was written from the published schema of the API (rest-2.52.xsd) and its documentation; it has not yet been tested with a real key. Your feedback is welcome.

## Requirements

- Gladys Assistant 5.3.0 or later.
- A personal key of the API: ask for it by e-mail to `opendata-api@atp.etat.lu`, with a few words on your use (for example "Gladys Assistant home automation"). The key looks like `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

## Configuration

| Field                 | What to type                                                                                                    |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Access key            | The key received from the ATP. Stored as a secret, never written in the logs.                                   |
| Stop 1, 2, 3          | The name of the stop ("Hamilius", "Luxembourg, Gare Centrale") or its number ("200405060").                     |
| Line                  | Only this line: "16", "T1", "RE 11", or a mode alone: "tram", "train", "bus". Empty: every line of the stop.    |
| Direction             | Only the destinations holding these words: "Kirchberg", "Findel \| Kirchberg". Empty: both directions.          |
| Reading of the stops  | Every minute, 2 minutes (default), 5 minutes or 10 minutes; longer on its own with many stops.                  |
| Language of the texts | Names of the devices, summaries and outputs of the scenes, and language of the traffic messages (FR, DE or EN). |

The **Find a stop** button gives the stops holding a few words, with their number ("Luxembourg, Gare Centrale [200405060]"). A stop often exists twice, one for the buses and one for the tram ("Hamilius (Bus)", "Hamilius-Centre (Tram)"): copy the name or the number of the one you want. **Test the connection** reads the stop list, each stop right away (one request per stop), and gives the quota used.

More stops than the three of the form (home, work, school…): **Add a stop** takes the same three fields — stop, line, direction — and follows up to 7 more stops. **List the stops** shows every followed stop, numbered; **Remove a stop** takes that number (or the name). The added stops are kept in the configuration of Gladys, so they follow its backups.

## Usage

### Devices

In the **Discover** tab, create the devices you want, named **Mobiliteit.lu \<stop\>**: the next departure as text ("16 → Kirchberg, Gare routière · 3 min (+2 min late)"), the wait of the next departure and of the one after (minutes), the delay of the next one (minutes, published only when it is followed in real time; an early bus counts 0) and the number of traffic messages.

At night, without any departure, the waits keep their last value.

### Quota of the key

Each reading of a stop is one request: 3 stops read every 2 minutes make about 2,200 requests a day. With more stops, the interval grows so that a day of readings stays under 3,600 requests, leaving room for the widgets and the scene actions (a widget or an action reuses a reading of less than 2 minutes). The **Diagnostic** button gives the requests of the last hour and of the last 24 hours.

### Dashboard widgets

![The Mobiliteit.lu departures widget at Hamilius and the traffic messages widget (generated illustration, not a screenshot)](https://raw.githubusercontent.com/William-De71/gladys-mobiliteit-lu/main/docs/assets/widgets.en.png)

- **Departures**: the next departures of a stop, compact. One row per line and destination, with its next departures in a row ("3 · 18 min"). A delay of 5 minutes or more, or a cancelled trip, turns the row orange. The **Routes shown** setting sets the number of rows. Choose a followed stop, or type any stop (and a line) in the widget settings: such a stop costs one more request at each refresh, every 2 minutes at most. With **Several stops**, one widget shows several stop devices.
- **Traffic messages**: the messages about the departures of your stops, with the lines they concern and their period. Tap a card for the full text.

### Scenes

Triggers, once per change (the first reading is only a baseline):

- **Mobiliteit.lu: departure soon**: a departure at a followed stop leaves in 2, 3, 5, 10, 15 or 20 minutes, counted on its real-time estimate.
- **Mobiliteit.lu: departure delayed**: the delay of a departure of the next hour reaches 3, 5, 10 or 15 minutes.
- **Mobiliteit.lu: departure cancelled**: a trip of the next hour at a followed stop is cancelled.
- **Mobiliteit.lu: new traffic message**: a new message about the departures of a followed stop.

Each gives a ready-made sentence, `{{triggerEvent.data.summary}}`, and its values (line, destination, planned and estimated time, delay, title, text, start and end…). The action **Mobiliteit.lu: next departures** returns the same kind of values, to put in a message or to test in a condition.

Examples:

- When the 16 towards Kirchberg leaves Hamilius in 5 minutes → turn the hall lamp green.
- When your train is 10 minutes late or cancelled → send the summary to your phone before you leave.
- Every weekday at 7:30 → read the next departures of your stop and have the kitchen speaker announce them.

### Transport

Cloud only: the data come from the internet. Only the stops you follow are asked to the API, one by one.

## Troubleshooting

- **"Enter the access key"**: the key is missing; ask for it at `opendata-api@atp.etat.lu` and paste it in the configuration.
- **"The API refuses the access key"**: check it (no space before or after); the integration does not ask again until the configuration is saved.
- **"The quota of the access key is spent"**: the API answered that the quota is reached; the readings resume at the next full hour. Follow fewer stops or choose a longer interval.
- **"Unknown or ambiguous"**: use **Find a stop**, then copy the exact name or the number.
- **"(timetable)" after a departure**: the API does not follow that vehicle in real time; the time is the one of the timetable.
- **No departure**: at night the network sleeps; the stops are read every 10 minutes.
- **To report a problem**: press **Diagnostic**, then copy the lines starting with "Mobiliteit.lu diagnostic" from the Logs tab (the key is not in them) into a GitHub issue or a reply on the forum, with the versions of Gladys and of the integration.
