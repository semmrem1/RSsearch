export type MarktStatus = 'aktiv' | 'reserviert' | 'verkauft' | 'offline' | 'unbekannt';
export type ObjektTyp = 'wohnung' | 'haus' | 'andere';

export interface Profile {
  id: string;
  name: string;
  kuerzel: string;
  farbe: string;
  arbeitsort?: string | null;
  arbeitsort_lat?: number | null;
  arbeitsort_lng?: number | null;
  arbeitsort_station?: string | null;
  nettolohn_100_monat?: number | null;
  pensum_pct?: number | null;
}

export interface Haushalt {
  id: number;
  eigenkapital: number | null;
  einkommen_jahr: number | null;
  zins_kalk: number;
  nebenkosten_pct: number;
  amortisation_jahre: number;
  belehnung_max: number;
  tragbarkeit_max: number;
  zins_effektiv: number;
  weitere_einkuenfte_monat: number;
}

export interface BudgetPosten { id: string; name: string; betrag_monat: number; kategorie: 'fix' | 'variabel' | 'sparen'; sort: number }
export interface ObjektBudgetDaten {
  pensum?: Record<string, number>;
  posten?: Record<string, number>;
  extra?: { name: string; betrag: number }[];
  zins_effektiv?: number;
  weitere_einkuenfte?: number;
}

export interface Gemeinde {
  name: string;
  kanton: string;
  steuerfuss: number | null;
  steuerfuss_jahr: number | null;
  steuerfuss_hinweis: string | null;
  steuer_index: number | null;
  steuer_index_hinweis: string | null;
  steuer_beispiel_chf: number | null;
  steuer_beispiel_hinweis: string | null;
  quelle_url: string | null;
}

export interface Kriterium { code: string; name: string; beschreibung: string | null; sort: number }
export interface KriterienBewertung { objekt_id: string; user_id: string; kriterium: string; wert: number }
export interface ObjektBildRow { id: string; objekt_id: string; quelle_url: string; pfad: string | null; sort: number; fehler: string | null }
export interface ExposeExtrakt { dokument_id: string; objekt_id: string; daten: Record<string, unknown>; zusammenfassung: string | null; modell: string | null; erstellt_am: string }
export interface Pendelzeit { minuten: number; umstiege: number | null; von: string | null; nach: string | null }

export interface Stufe {
  code: string;
  name: string;
  phase: number;
  phase_name: string;
  sort: number;
  terminal: boolean;
  hinweis: string | null;
}

export interface Quelle {
  id: string;
  makler: string;
  externe_id: string | null;
  url: string | null;
  url_direkt?: boolean;
  offline_seit?: string | null;
  spiegel_von?: string | null;
  status: MarktStatus;
  preis_chf: number | null;
  kontakt?: string | null;
  erstmals_gesehen?: string;
  zuletzt_gesehen?: string;
}

export interface BewertungKurz {
  sterne: number;
  favorit: boolean;
  uninteressant: boolean;
}

export interface Objekt {
  id: string;
  titel: string | null;
  ort: string;
  plz: string | null;
  kanton: string | null;
  adresse: string | null;
  typ: ObjektTyp;
  zimmer: number | null;
  flaeche_m2: number | null;
  grundstueck_m2: number | null;
  baujahr: number | null;
  preis_chf: number | null;
  markt_status: MarktStatus;
  stufe_code: string;
  stufe_geaendert_am: string;
  erstmals_gesehen: string;
  zuletzt_gesehen: string;
  notizen: string | null;
  lage_hinweis: string | null;
  lat: number | null;
  lng: number | null;
  geo_genauigkeit: 'adresse' | 'ort' | 'manuell' | null;
  geo_suchtext: string | null;
  bild_url: string | null;
  bild_pfad: string | null;
  bild_fehler: string | null;
  offline_seit: string | null;
  zusammengefuehrt_in?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ObjektUebersicht extends Objekt {
  stufe_name: string;
  stufe_phase: number;
  stufe_phase_name: string;
  stufe_sort: number;
  stufe_terminal: boolean;
  quellen: Quelle[];
  bewertungen: Record<string, BewertungKurz>;
  preis_vorher_chf: number | null;
  preis_geaendert_am: string | null;
  kriterien_scores: Record<string, number>;
  score_gesamt: number | null;
  pendelzeiten: Record<string, Pendelzeit>;
  bilder_anzahl: number;
  letzte_aktivitaet_am: string | null;
  letzte_aktivitaet_user: string | null;
  mein_besuch_am: string | null;
  gemeinde: string | null;
  gemeinde_kanton: string | null;
  steuerfuss: number | null;
  steuerfuss_jahr: number | null;
  steuer_index: number | null;
  steuer_beispiel_chf: number | null;
  tage_am_markt: number;
}

export interface Snapshot {
  id: number;
  objekt_id: string;
  quelle_id: string | null;
  datum: string;
  typ: 'erfasst' | 'preis' | 'status' | 'flaeche' | 'zimmer' | 'bestaetigt' | 'neue_quelle' | 'dublette' | 'sonstiges';
  alt: string | null;
  neu: string | null;
  kommentar: string | null;
}

export type AktivitaetTyp = 'notiz' | 'mail' | 'telefon' | 'besichtigung' | 'termin' | 'stufe' | 'system' | 'dokument';

export interface Aktivitaet {
  id: number;
  objekt_id: string;
  user_id: string | null;
  typ: AktivitaetTyp;
  titel: string;
  text: string | null;
  datum: string;
  faellig_am: string | null;
  erledigt: boolean;
}

export interface Bewertung extends BewertungKurz {
  objekt_id: string;
  user_id: string;
  kommentar: string | null;
  tags: string[];
  updated_at: string;
}

export interface Dokument {
  id: string;
  objekt_id: string;
  user_id: string | null;
  name: string;
  storage_path: string;
  groesse_bytes: number | null;
  mime: string | null;
  kategorie: string | null;
  created_at: string;
}

export interface Standortfaktor {
  id: number;
  objekt_id: string;
  titel: string;
  text: string | null;
  bewertung: 'positiv' | 'neutral' | 'negativ';
  quelle_url: string | null;
  stand: string;
}

export interface LaufProtokoll {
  id: number;
  gestartet_am: string;
  beendet_am: string | null;
  makler: string;
  geprueft: boolean;
  anzahl_inserate: number | null;
  neue: number;
  geaendert: number;
  fehler: string | null;
}
