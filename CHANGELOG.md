# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions
follow [Semantic Versioning](https://semver.org/). This file is generated at
each release from the Conventional Commits: do not edit it by hand.

## [0.1.0] - 2026-11-08

### Added

- One device per followed stop in Luxembourg (three in the form and up to 7 more with the "Add a stop" button, typed by name or by number, filtered by line and direction): the next departure as text, the wait of the next two departures, the delay of the next one and the number of traffic messages, in real time, from the official API of the Administration des transports publics (mobiliteit.lu).
- Buses (RGTR, AVL, TICE, CFL), the Luxtram and the trains: a line typed as on the screens ("16", "T1", "RE 11"), or a mode alone ("tram", "train").
- Scene triggers: departure soon (2 to 20 minutes before, on the real-time estimate), departure delayed (3 to 15 minutes), departure cancelled, and a new traffic message about the departures of a followed stop.
- Scene action: read the next departures of a stop (with the delay), with a ready-made sentence.
- Dashboard widgets: the next departures of one or several stops, like the screens of the stops, with delays highlighted (any stop can be typed in the widget); the traffic messages of the followed stops, with the lines they concern and their period.
- Configuration actions: test the connection, find a stop by name (from the open stop list of the ATP, without spending the quota of the key), add, list and remove stops, and a diagnostic written to the Logs tab (without the key).
- The quota of the personal key kept: requests counted in /data, the reading interval made longer with many stops, readings paused before the hourly and daily limits, and until the next full hour after an API_QUOTA answer.
- Cloud transport: the departure board of the HAFAS API of the ATP (personal key, CC BY 4.0) and the stop list of its open GTFS, read weekly and kept in /data.
- English, French, German and Spanish everywhere: settings, devices, widgets, scenes and documentation.

[0.1.0]: https://github.com/William-De71/gladys-mobiliteit-lu/releases/tag/v0.1.0
