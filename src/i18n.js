// -----------------------------------------------------------------------------
// Texts of the integration, in English, French, German and Spanish (English
// fallback).
//
// The manifest carries its own labels; these are the texts the code writes at
// runtime: device and feature names, widget contents, scene
// summaries, messages of the Configuration screen. Vocabulary of the Gladys
// interface (appareil / Gerät / dispositivo, scène / Szene / escena) and of
// public transport (arrêt, ligne, passage, info trafic). The names of stops
// and lines and the destinations stay as the ATP writes them; the traffic
// messages come in the language asked to the API (French, German or English).
// -----------------------------------------------------------------------------

import { minutesLeft } from './departures.js';
import { formatTime } from './time.js';

const LANGUAGES = ['en', 'fr', 'de', 'es'];
const TEXTS = {
  stopDeviceName: {
    en: 'Mobiliteit.lu {stop}',
    fr: 'Mobiliteit.lu {stop}',
    de: 'Mobiliteit.lu {stop}',
    es: 'Mobiliteit.lu {stop}',
  },
  featureNext: {
    en: 'Next passage',
    fr: 'Prochain passage',
    de: 'Nächste Abfahrt',
    es: 'Próximo paso',
  },
  featureWait: {
    en: 'Wait',
    fr: 'Attente',
    de: 'Wartezeit',
    es: 'Espera',
  },
  featureFollowing: {
    en: 'Wait for the following one',
    fr: 'Attente du suivant',
    de: 'Wartezeit der folgenden',
    es: 'Espera del siguiente',
  },
  featureDelay: {
    en: 'Delay of the next passage',
    fr: 'Retard du prochain passage',
    de: 'Verspätung der nächsten Abfahrt',
    es: 'Retraso del próximo paso',
  },
  featureMessages: {
    en: 'Traffic messages',
    fr: 'Infos trafic',
    de: 'Verkehrsmeldungen',
    es: 'Avisos de tráfico',
  },
  noPassage: {
    en: 'No passage announced',
    fr: 'Aucun passage annoncé',
    de: 'Keine Abfahrt angekündigt',
    es: 'Ningún paso anunciado',
  },
  minutesValue: {
    en: '{n} min',
    fr: '{n} min',
    de: '{n} Min.',
    es: '{n} min',
  },
  approaching: {
    en: 'Approaching',
    fr: 'À l’approche',
    de: 'Fährt ein',
    es: 'Llegando',
  },
  inMinutes: {
    en: 'in {n} min',
    fr: 'dans {n} min',
    de: 'in {n} Min.',
    es: 'dentro de {n} min',
  },
  atTime: {
    en: 'at {time}',
    fr: 'à {time}',
    de: 'um {time}',
    es: 'a las {time}',
  },
  scheduledMark: {
    en: '(timetable)',
    fr: '(théorique)',
    de: '(Fahrplan)',
    es: '(teórico)',
  },
  lateMark: {
    en: '(+{n} min late)',
    fr: '(+{n} min de retard)',
    de: '(+{n} Min. Verspätung)',
    es: '(+{n} min de retraso)',
  },
  partCancelledMark: {
    en: '(partly cancelled)',
    fr: '(partiellement supprimé)',
    de: '(teilweise entfallen)',
    es: '(parcialmente suprimido)',
  },
  cancelledShort: {
    en: 'cancelled {time}',
    fr: 'supprimé {time}',
    de: 'entfällt {time}',
    es: 'suprimido {time}',
  },
  summarySoon: {
    en: '{line} towards {destination} leaves {stop} in {minutes} min ({time}).',
    fr: '{line} vers {destination} passe à {stop} dans {minutes} min ({time}).',
    de: '{line} Richtung {destination} fährt an {stop} in {minutes} Min. ab ({time}).',
    es: '{line} hacia {destination} pasa por {stop} dentro de {minutes} min ({time}).',
  },
  summarySoonLate: {
    en: '{line} towards {destination} leaves {stop} in {minutes} min ({time}, {delay} min late).',
    fr: '{line} vers {destination} passe à {stop} dans {minutes} min ({time}, {delay} min de retard).',
    de: '{line} Richtung {destination} fährt an {stop} in {minutes} Min. ab ({time}, {delay} Min. Verspätung).',
    es: '{line} hacia {destination} pasa por {stop} dentro de {minutes} min ({time}, {delay} min de retraso).',
  },
  summaryCancelled: {
    en: 'The {time} {line} towards {destination} at {stop} is cancelled.',
    fr: 'Le {line} de {time} vers {destination} à {stop} est supprimé.',
    de: 'Die {line} um {time} Richtung {destination} an {stop} entfällt.',
    es: 'El {line} de las {time} hacia {destination} en {stop} está suprimido.',
  },
  summaryDelayed: {
    en: 'The {scheduled} {line} towards {destination} at {stop} is {delay} min late: expected at {time}.',
    fr: 'Le {line} de {scheduled} vers {destination} à {stop} a {delay} min de retard : attendu à {time}.',
    de: 'Die {line} um {scheduled} Richtung {destination} an {stop} hat {delay} Min. Verspätung: erwartet um {time}.',
    es: 'El {line} de las {scheduled} hacia {destination} en {stop} lleva {delay} min de retraso: previsto a las {time}.',
  },
  summaryMessage: {
    en: 'Traffic message at {stop}: {title}',
    fr: 'Info trafic à {stop} : {title}',
    de: 'Verkehrsmeldung an {stop}: {title}',
    es: 'Aviso de tráfico en {stop}: {title}',
  },
  summaryMessageLines: {
    en: 'Traffic message at {stop} ({lines}): {title}',
    fr: 'Info trafic à {stop} ({lines}) : {title}',
    de: 'Verkehrsmeldung an {stop} ({lines}): {title}',
    es: 'Aviso de tráfico en {stop} ({lines}): {title}',
  },
  outputNext: {
    en: 'Next passage at {stop}: {line} towards {destination} {when}.',
    fr: 'Prochain passage à {stop} : {line} vers {destination} {when}.',
    de: 'Nächste Abfahrt an {stop}: {line} Richtung {destination} {when}.',
    es: 'Próximo paso en {stop}: {line} hacia {destination} {when}.',
  },
  outputFollowing: {
    en: 'The following one {when}.',
    fr: 'Le suivant {when}.',
    de: 'Die folgende {when}.',
    es: 'El siguiente {when}.',
  },
  outputNone: {
    en: 'No passage announced at {stop}.',
    fr: 'Aucun passage annoncé à {stop}.',
    de: 'Keine Abfahrt an {stop} angekündigt.',
    es: 'Ningún paso anunciado en {stop}.',
  },
  readAt: {
    en: 'read at {time}',
    fr: 'lu à {time}',
    de: 'gelesen um {time}',
    es: 'leído a las {time}',
  },
  updatedAt: {
    en: 'Mobiliteit.lu (ATP) · updated at {time}',
    fr: 'Mobiliteit.lu (ATP) · mis à jour à {time}',
    de: 'Mobiliteit.lu (ATP) · aktualisiert um {time}',
    es: 'Mobiliteit.lu (ATP) · actualizado a las {time}',
  },
  creditShort: {
    en: 'Mobiliteit.lu (ATP)',
    fr: 'Mobiliteit.lu (ATP)',
    de: 'Mobiliteit.lu (ATP)',
    es: 'Mobiliteit.lu (ATP)',
  },
  minutesShort: {
    en: 'min',
    fr: 'min',
    de: 'Min.',
    es: 'min',
  },
  messagesTitle: {
    en: 'Traffic messages',
    fr: 'Infos trafic',
    de: 'Verkehrsmeldungen',
    es: 'Avisos de tráfico',
  },
  periodFromTo: {
    en: '{start} → {end}',
    fr: '{start} → {end}',
    de: '{start} → {end}',
    es: '{start} → {end}',
  },
  periodFrom: {
    en: 'from {start}',
    fr: 'depuis {start}',
    de: 'seit {start}',
    es: 'desde {start}',
  },
  noMessage: {
    en: 'No traffic message for the followed stops.',
    fr: 'Aucune info trafic pour les arrêts suivis.',
    de: 'Keine Verkehrsmeldung für die verfolgten Haltestellen.',
    es: 'Ningún aviso de tráfico para las paradas seguidas.',
  },
  widgetNoStop: {
    en: 'No stop is followed: add one on the Configuration screen of the integration, or type one in the widget settings.',
    fr: 'Aucun arrêt n’est suivi : ajoutez-en un dans l’écran Configuration de l’intégration, ou saisissez-en un dans les réglages du widget.',
    de: 'Keine Haltestelle wird verfolgt: Füge eine im Konfigurationsbildschirm der Integration hinzu oder gib eine in den Widget-Einstellungen ein.',
    es: 'No se sigue ninguna parada: añade una en la pantalla Configuración de la integración, o escribe una en los ajustes del widget.',
  },
  quotaPaused: {
    en: 'Readings paused to spare the quota of the key until {time}.',
    fr: 'Lectures en pause pour ménager le quota de la clé jusqu’à {time}.',
    de: 'Abfragen pausiert, um das Kontingent des Schlüssels zu schonen, bis {time}.',
    es: 'Lecturas en pausa para ahorrar la cuota de la clave hasta las {time}.',
  },
  statusNoKey: {
    en: 'Enter the access key of the API (asked by e-mail to opendata-api@atp.etat.lu) on the Configuration screen.',
    fr: 'Saisissez la clé d’accès de l’API (demandée par e-mail à opendata-api@atp.etat.lu) dans l’écran Configuration.',
    de: 'Gib den Zugangsschlüssel der API (per E-Mail bei opendata-api@atp.etat.lu angefragt) im Konfigurationsbildschirm ein.',
    es: 'Escribe la clave de acceso de la API (solicitada por correo a opendata-api@atp.etat.lu) en la pantalla Configuración.',
  },
  statusAuth: {
    en: 'The API refuses the access key: check it on the Configuration screen.',
    fr: 'L’API refuse la clé d’accès : vérifiez-la dans l’écran Configuration.',
    de: 'Die API lehnt den Zugangsschlüssel ab: Prüfe ihn im Konfigurationsbildschirm.',
    es: 'La API rechaza la clave de acceso: compruébala en la pantalla Configuración.',
  },
  statusQuota: {
    en: 'The quota of the access key is spent: readings resume at {time}.',
    fr: 'Le quota de la clé d’accès est épuisé : reprise des lectures à {time}.',
    de: 'Das Kontingent des Zugangsschlüssels ist aufgebraucht: Abfragen ab {time}.',
    es: 'La cuota de la clave de acceso está agotada: las lecturas se reanudan a las {time}.',
  },
  statusBudget: {
    en: 'The integration paused its readings to stay under the quota of the key ({hour} requests in the last hour, {day} today).',
    fr: 'L’intégration a mis ses lectures en pause pour rester sous le quota de la clé ({hour} requêtes la dernière heure, {day} sur 24 h).',
    de: 'Die Integration hat ihre Abfragen pausiert, um unter dem Kontingent des Schlüssels zu bleiben ({hour} Anfragen in der letzten Stunde, {day} in 24 h).',
    es: 'La integración pausó sus lecturas para no superar la cuota de la clave ({hour} peticiones en la última hora, {day} en 24 h).',
  },
  statusUnreachable: {
    en: 'The Mobiliteit.lu API does not answer ({detail}). Next try in {minutes} min.',
    fr: 'L’API Mobiliteit.lu ne répond pas ({detail}). Nouvel essai dans {minutes} min.',
    de: 'Die Mobiliteit.lu-API antwortet nicht ({detail}). Neuer Versuch in {minutes} Min.',
    es: 'La API de Mobiliteit.lu no responde ({detail}). Nuevo intento dentro de {minutes} min.',
  },
  statusConnected: {
    en: 'Connected to Mobiliteit.lu: {stops} stop(s), read every {interval} s ({day} requests in 24 h).',
    fr: 'Connecté à Mobiliteit.lu : {stops} arrêt(s), lus toutes les {interval} s ({day} requêtes sur 24 h).',
    de: 'Mit Mobiliteit.lu verbunden: {stops} Haltestelle(n), alle {interval} s gelesen ({day} Anfragen in 24 h).',
    es: 'Conectado a Mobiliteit.lu: {stops} parada(s), leídas cada {interval} s ({day} peticiones en 24 h).',
  },
  statusNotFound: {
    en: 'Unknown or ambiguous: {names}.',
    fr: 'Inconnu ou ambigu : {names}.',
    de: 'Unbekannt oder mehrdeutig: {names}.',
    es: 'Desconocido o ambiguo: {names}.',
  },
  statusNothing: {
    en: 'Access key saved. Add a stop on the Configuration screen.',
    fr: 'Clé d’accès enregistrée. Ajoutez un arrêt dans l’écran Configuration.',
    de: 'Zugangsschlüssel gespeichert. Füge im Konfigurationsbildschirm eine Haltestelle hinzu.',
    es: 'Clave de acceso guardada. Añade una parada en la pantalla Configuración.',
  },
  testStopsOk: {
    en: 'Stop list of the ATP read: {stops} stops',
    fr: 'Liste des arrêts de l’ATP lue : {stops} arrêts',
    de: 'Haltestellenliste der ATP gelesen: {stops} Haltestellen',
    es: 'Lista de paradas de la ATP leída: {stops} paradas',
  },
  testStopsError: {
    en: 'Stop list: {error}',
    fr: 'Liste des arrêts : {error}',
    de: 'Haltestellenliste: {error}',
    es: 'Lista de paradas: {error}',
  },
  testStop: {
    en: '{stop}: {count} passage(s), next {next}',
    fr: '{stop} : {count} passage(s), prochain {next}',
    de: '{stop}: {count} Abfahrt(en), nächste {next}',
    es: '{stop}: {count} paso(s), próximo {next}',
  },
  testStopError: {
    en: '{stop}: {error}',
    fr: '{stop} : {error}',
    de: '{stop}: {error}',
    es: '{stop}: {error}',
  },
  testNoStop: {
    en: 'no stop followed yet',
    fr: 'aucun arrêt suivi pour l’instant',
    de: 'noch keine Haltestelle verfolgt',
    es: 'aún no se sigue ninguna parada',
  },
  testQuota: {
    en: 'quota: {hour} requests in the last hour, {day} in 24 h',
    fr: 'quota : {hour} requêtes la dernière heure, {day} sur 24 h',
    de: 'Kontingent: {hour} Anfragen in der letzten Stunde, {day} in 24 h',
    es: 'cuota: {hour} peticiones en la última hora, {day} en 24 h',
  },
  unknownEntry: {
    en: 'unknown or ambiguous: {name}',
    fr: 'inconnu ou ambigu : {name}',
    de: 'unbekannt oder mehrdeutig: {name}',
    es: 'desconocido o ambiguo: {name}',
  },
  errorUnreachable: {
    en: 'the Mobiliteit.lu API does not answer',
    fr: 'l’API Mobiliteit.lu ne répond pas',
    de: 'die Mobiliteit.lu-API antwortet nicht',
    es: 'la API de Mobiliteit.lu no responde',
  },
  errorBusy: {
    en: 'the Mobiliteit.lu server is busy, try again in a moment',
    fr: 'le serveur Mobiliteit.lu est occupé, réessayez dans un instant',
    de: 'der Mobiliteit.lu-Server ist ausgelastet, versuche es gleich noch einmal',
    es: 'el servidor de Mobiliteit.lu está ocupado, inténtalo de nuevo en un momento',
  },
  errorAuth: {
    en: 'the access key is refused',
    fr: 'la clé d’accès est refusée',
    de: 'der Zugangsschlüssel wird abgelehnt',
    es: 'la clave de acceso es rechazada',
  },
  errorQuota: {
    en: 'the quota of the access key is spent',
    fr: 'le quota de la clé d’accès est épuisé',
    de: 'das Kontingent des Zugangsschlüssels ist aufgebraucht',
    es: 'la cuota de la clave de acceso está agotada',
  },
  errorNoKey: {
    en: 'no access key: enter it on the Configuration screen',
    fr: 'pas de clé d’accès : saisissez-la dans l’écran Configuration',
    de: 'kein Zugangsschlüssel: Gib ihn im Konfigurationsbildschirm ein',
    es: 'sin clave de acceso: escríbela en la pantalla Configuración',
  },
  errorUnknownStop: {
    en: 'the API does not know this stop',
    fr: 'l’API ne connaît pas cet arrêt',
    de: 'die API kennt diese Haltestelle nicht',
    es: 'la API no conoce esta parada',
  },
  errorStops: {
    en: 'the stop list of the ATP cannot be read',
    fr: 'la liste des arrêts de l’ATP ne peut pas être lue',
    de: 'die Haltestellenliste der ATP kann nicht gelesen werden',
    es: 'la lista de paradas de la ATP no se puede leer',
  },
  searchTooShort: {
    en: 'Type at least two letters of the stop name.',
    fr: 'Saisissez au moins deux lettres du nom de l’arrêt.',
    de: 'Gib mindestens zwei Buchstaben des Haltestellennamens ein.',
    es: 'Escribe al menos dos letras del nombre de la parada.',
  },
  searchNone: {
    en: 'No stop matches "{query}".',
    fr: 'Aucun arrêt ne correspond à « {query} ».',
    de: 'Keine Haltestelle passt zu „{query}“.',
    es: 'Ninguna parada coincide con «{query}».',
  },
  searchFound: {
    en: 'Type the name, or the number in brackets:\n{list}',
    fr: 'Saisissez le nom, ou le numéro entre crochets :\n{list}',
    de: 'Gib den Namen oder die Nummer in Klammern ein:\n{list}',
    es: 'Escribe el nombre, o el número entre corchetes:\n{list}',
  },
  searchMore: {
    en: '… and {n} more: add words to the name.',
    fr: '… et {n} autres : ajoutez des mots au nom.',
    de: '… und {n} weitere: Füge dem Namen Wörter hinzu.',
    es: '… y {n} más: añade palabras al nombre.',
  },
  stopAdded: {
    en: 'Stop added: {name}. {count} stop(s) followed. Its device is offered in the Discover tab.',
    fr: 'Arrêt ajouté : {name}. {count} arrêt(s) suivi(s). Son appareil est proposé dans l’onglet Découvrir.',
    de: 'Haltestelle hinzugefügt: {name}. {count} Haltestelle(n) verfolgt. Ihr Gerät wird im Tab Entdecken angeboten.',
    es: 'Parada añadida: {name}. {count} parada(s) seguida(s). Su dispositivo se ofrece en la pestaña Descubrir.',
  },
  stopAlreadyFollowed: {
    en: '{name} is already followed.',
    fr: '{name} est déjà suivi.',
    de: '{name} wird bereits verfolgt.',
    es: '{name} ya se sigue.',
  },
  stopsFull: {
    en: 'Already {max} stops added: remove one first.',
    fr: 'Déjà {max} arrêts ajoutés : retirez-en un d’abord.',
    de: 'Bereits {max} Haltestellen hinzugefügt: entferne zuerst eine.',
    es: 'Ya hay {max} paradas añadidas: quita una primero.',
  },
  stopRemoved: {
    en: 'Stop removed: {name}. Delete its device in Gladys if you no longer want it.',
    fr: 'Arrêt retiré : {name}. Supprimez son appareil dans Gladys si vous n’en voulez plus.',
    de: 'Haltestelle entfernt: {name}. Lösche ihr Gerät in Gladys, wenn du es nicht mehr brauchst.',
    es: 'Parada quitada: {name}. Borra su dispositivo en Gladys si ya no lo quieres.',
  },
  stopRemoveUnknown: {
    en: 'No added stop matches "{query}": type its number given by "List the stops".',
    fr: 'Aucun arrêt ajouté ne correspond à « {query} » : saisissez son numéro donné par « Lister les arrêts ».',
    de: 'Keine hinzugefügte Haltestelle passt zu „{query}“: gib ihre Nummer aus „Haltestellen auflisten“ ein.',
    es: 'Ninguna parada añadida coincide con «{query}»: escribe su número dado por «Listar las paradas».',
  },
  stopRemoveAmbiguous: {
    en: 'Several added stops match "{query}": type the number given by "List the stops".',
    fr: 'Plusieurs arrêts ajoutés correspondent à « {query} » : saisissez le numéro donné par « Lister les arrêts ».',
    de: 'Mehrere hinzugefügte Haltestellen passen zu „{query}“: gib die Nummer aus „Haltestellen auflisten“ ein.',
    es: 'Varias paradas añadidas coinciden con «{query}»: escribe el número dado por «Listar las paradas».',
  },
  stopInForm: {
    en: '{name} is stop {slot} of the form: empty its field, then save the configuration.',
    fr: '{name} est l’arrêt {slot} du formulaire : videz son champ, puis enregistrez la configuration.',
    de: '{name} ist Haltestelle {slot} des Formulars: leere ihr Feld und speichere dann die Konfiguration.',
    es: '{name} es la parada {slot} del formulario: vacía su campo y guarda la configuración.',
  },
  stopsNone: {
    en: 'No stop followed yet: fill in a stop of the form or press "Add a stop".',
    fr: 'Aucun arrêt suivi pour l’instant : remplissez un arrêt du formulaire ou appuyez sur « Ajouter un arrêt ».',
    de: 'Noch keine Haltestelle verfolgt: fülle eine Haltestelle im Formular aus oder drücke „Haltestelle hinzufügen“.',
    es: 'Aún no se sigue ninguna parada: rellena una parada del formulario o pulsa «Añadir una parada».',
  },
  stopsList: {
    en: '{count} stop(s) followed:\n{list}',
    fr: '{count} arrêt(s) suivi(s) :\n{list}',
    de: '{count} Haltestelle(n) verfolgt:\n{list}',
    es: '{count} parada(s) seguida(s):\n{list}',
  },
  stopFromForm: {
    en: 'form, stop {slot}',
    fr: 'formulaire, arrêt {slot}',
    de: 'Formular, Haltestelle {slot}',
    es: 'formulario, parada {slot}',
  },
  stopUnknownMark: {
    en: 'unknown or ambiguous',
    fr: 'inconnu ou ambigu',
    de: 'unbekannt oder mehrdeutig',
    es: 'desconocido o ambiguo',
  },
  diagnosticDone: {
    en: 'Diagnostic written to the Logs tab ({count} line(s) starting with "Mobiliteit.lu diagnostic"). The key is not in it.',
    fr: 'Diagnostic écrit dans l’onglet Journaux ({count} ligne(s) commençant par « Mobiliteit.lu diagnostic »). La clé n’y figure pas.',
    de: 'Diagnose in den Tab Protokolle geschrieben ({count} Zeile(n), beginnend mit „Mobiliteit.lu diagnostic“). Der Schlüssel steht nicht darin.',
    es: 'Diagnóstico escrito en la pestaña Registros ({count} línea(s) que empiezan por «Mobiliteit.lu diagnostic»). La clave no figura en él.',
  },
};

/**
 * @description Whether a value is a supported language.
 * @param {unknown} value - The value.
 * @returns {boolean} True for en, fr, de, es.
 */
function isLanguage(value) {
  return LANGUAGES.includes(value);
}

/**
 * @description A text in a language, its placeholders filled.
 * @param {string} key - A TEXTS key.
 * @param {string} language - The language (English when unknown).
 * @param {object} [values] - The placeholder values.
 * @returns {string} The text.
 * @example
 * t('inMinutes', 'fr', { n: 3 }); // -> 'dans 3 min'
 */
function t(key, language, values = {}) {
  const entry = TEXTS[key];
  if (!entry) {
    return key;
  }
  const template = entry[isLanguage(language) ? language : 'en'] ?? entry.en;
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    values[name] === undefined || values[name] === null ? '' : String(values[name]),
  );
}

/**
 * @description A text in the four languages.
 * @param {string} key - A TEXTS key.
 * @param {object|Function} [values] - The values, or `(language) => values`.
 * @returns {object} `{ en, fr, de, es }`.
 */
function all(key, values = {}) {
  return Object.fromEntries(
    LANGUAGES.map((language) => [
      language,
      t(key, language, typeof values === 'function' ? values(language) : values),
    ]),
  );
}

/**
 * @description When a passage comes, in a sentence: "in 3 min", "at 10:32".
 * @param {object} passage - The passage.
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {string} The words.
 */
function passageWhen(passage, { language, now, timeZone }) {
  const minutes = minutesLeft(passage, now);
  if (minutes >= 60) {
    return t('atTime', language, { time: formatTime(passage.at, timeZone) });
  }
  return minutes === 0
    ? t('approaching', language).toLowerCase()
    : t('inMinutes', language, { n: minutes });
}

/**
 * @description The short time of a passage, as on the screens of the stops:
 * "3 min", "10:32", "Approaching".
 * @param {object} passage - The passage.
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {string} The time.
 */
function passageShort(passage, { language, now, timeZone }) {
  const minutes = minutesLeft(passage, now);
  if (minutes >= 60) {
    return formatTime(passage.at, timeZone);
  }
  return minutes === 0 ? t('approaching', language) : t('minutesValue', language, { n: minutes });
}

/**
 * @description One line for a passage: "16 → Kirchberg · 3 min (+2 min de retard)".
 * @param {object|null} passage - The passage, null when none.
 * @param {object} options - `{ language, now, timeZone }`.
 * @returns {string} The text.
 */
function passageText(passage, options) {
  if (!passage) {
    return t('noPassage', options.language);
  }
  const head = passage.destination ? `${passage.line} → ${passage.destination}` : passage.line;
  let mark = '';
  if (passage.partCancelled) {
    mark = ` ${t('partCancelledMark', options.language)}`;
  } else if (!passage.realtime) {
    mark = ` ${t('scheduledMark', options.language)}`;
  } else if (passage.delay > 0) {
    mark = ` ${t('lateMark', options.language, { n: passage.delay })}`;
  }
  return `${head} · ${passageShort(passage, options)}${mark}`;
}

export { LANGUAGES, TEXTS, isLanguage, t, all, passageWhen, passageShort, passageText };
