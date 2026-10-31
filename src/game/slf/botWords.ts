import { SLF } from '../../config';

// Answers of the test bots, per category and letter (in the order of SLF.letters). Small on
// purpose: bots share it, so they now and then write the same thing and the 5-point rule shows.

const RAW: Record<string, string> = {
  Stadt:
    'Aachen,Augsburg|Berlin,Bremen|Chemnitz,Cottbus|Dresden,Dortmund|Essen,Erfurt|Frankfurt,Freiburg|Göttingen,Gera|Hamburg,Hannover|Ingolstadt,Innsbruck|Jena|Köln,Kiel|Leipzig,Lübeck|München,Mainz|Nürnberg|Oldenburg,Oslo|Potsdam,Paris|Rostock,Rom|Stuttgart,Siegen|Trier|Ulm|Venedig|Wien,Würzburg|Zürich,Zwickau',
  Land: 'Argentinien,Australien|Belgien,Brasilien|Chile,China|Dänemark,Deutschland|Estland,England|Frankreich,Finnland|Griechenland|Haiti,Honduras|Italien,Island|Japan,Jamaika|Kanada,Kenia|Lettland,Litauen|Mexiko,Marokko|Norwegen,Nepal|Österreich,Oman|Polen,Portugal|Russland,Rumänien|Spanien,Schweden|Tschechien,Türkei|Ungarn,Uganda|Vietnam|Wales|Zypern',
  Fluss: 'Aller,Amazonas|Brahmaputra|Colorado|Donau|Elbe,Ems|Fulda|Ganges|Havel|Isar,Inn|Jordan|Kongo|Lahn,Lech|Main,Mosel|Neckar,Nil|Oder,Oker|Po|Rhein|Saale,Spree|Themse,Tiber|Unstrut|Vechte|Weser,Werra|Zschopau',
  Name: 'Anna,Alex|Ben,Berta|Clara|David|Emma|Felix|Greta|Hannah|Ida|Jonas|Karl|Lena|Max|Nina|Otto|Paul|Rosa|Sophie|Tim|Ute|Valentin|Willi|Zoe',
  Tier: 'Affe,Ameise|Bär,Biber|Chamäleon|Dachs,Delfin|Esel,Elefant|Fuchs,Frosch|Giraffe,Gans|Hund,Hase|Igel|Jaguar|Katze,Kuh|Löwe,Lama|Maus,Marder|Nashorn|Otter|Pinguin,Pferd|Rabe,Reh|Schwein,Schaf|Tiger|Uhu|Vogelspinne|Wal,Wolf|Zebra,Ziege',
  Beruf: 'Arzt,Anwalt|Bäcker|Chemiker|Dachdecker|Elektriker|Förster|Gärtner|Hausmeister|Imker|Journalist|Koch|Lehrer|Maurer|Notar|Optiker|Pilot|Richter|Schreiner|Tischler|Uhrmacher|Verkäufer|Winzer|Zimmermann',
  Essen: 'Apfel|Banane|Curry|Dattel|Erdbeere|Fisch|Gurke|Honig|Ingwer|Joghurt|Käse|Lasagne|Mango|Nudeln|Orange|Pfannkuchen|Reis|Suppe|Tomate|Udon|Vanilleeis|Wurst|Zwiebel',
  Gegenstand: 'Axt|Bürste|Computer|Dose|Eimer|Fernseher|Gabel|Hocker|Isomatte|Jacke|Kerze|Lampe|Messer|Nagel|Ofen|Pinsel|Radiergummi|Schere|Tasse|Uhr|Vase|Waage|Zange',
  Pflanze: 'Ahorn|Birke|Chili|Distel|Efeu|Farn|Gänseblümchen|Hanf|Iris|Jasmin|Kaktus|Lavendel|Minze|Nelke|Orchidee|Palme|Rose|Sonnenblume|Tulpe|Ulme|Veilchen|Weide|Zitrone',
  Fahrzeug: 'Auto|Bus|Cabrio|Dreirad|Eisenbahn|Fähre|Gabelstapler|Hubschrauber|ICE|Jeep|Kran|Lkw|Motorrad|Nachtbus|Oldtimer|Panzer|Roller|Straßenbahn|Taxi|U-Boot|Vespa|Wohnmobil|Zug',
  Promi: 'Adele|Beyoncé|Cher|Dieter Bohlen|Elton John|Freddie Mercury|Günther Jauch|Helene Fischer|Iris Berben|Jan Delay|Kylie Minogue|Lena|Madonna|Nena|Ozzy Osbourne|Pink|Rihanna|Shakira|Taylor Swift|Udo Lindenberg|Vin Diesel|Wolfgang Petry|Zlatan',
};

const TABLE: Record<string, Record<string, string[]>> = Object.fromEntries(
  Object.entries(RAW).map(([cat, row]) => {
    const cells = row.split('|');
    return [cat, Object.fromEntries([...SLF.letters].map((l, i) => [l, (cells[i] ?? '').split(',').filter(Boolean)]))];
  }),
);

const SYLLABLES = ['ra', 'lo', 'ne', 'ki', 'bu', 'mo', 'ten', 'del', 'rin', 'sa'];

/** Known words for a category and letter (empty for categories the bots don't know). */
export function botWords(category: string, letter: string): string[] {
  return TABLE[category]?.[letter] ?? [];
}

/**
 * A bot's answer: a known word, or a made-up one for unknown categories. Now and then just the bare
 * letter (a filler the others can flag as "ungültig") or nothing at all.
 */
export function botAnswer(category: string, letter: string, rand: () => number): string {
  const r = rand();
  if (r < 0.1) return letter;
  if (r < 0.16) return '';
  const known = botWords(category, letter);
  if (known.length) return known[Math.floor(rand() * known.length)];
  let w = letter;
  for (let i = 0; i < 2 + Math.floor(rand() * 2); i++) w += SYLLABLES[Math.floor(rand() * SYLLABLES.length)];
  return w;
}
