import {
  syncNvd, syncKev, syncEpss, syncCwe, syncAttack, syncOsv,
  syncUrlhaus, syncThreatfox, syncMalwarebazaar, syncPhishtank
} from './connectors-cyber.js';
import {
  syncPubchem, syncPubmed, syncOpenfdaFood, syncOpenfdaDrug, syncUsdaFdc
} from './connectors-health.js';

export const CONNECTORS = {
  nvd: { run: syncNvd, label: 'NVD CVE 2.0', table: 'vulnerabilities' },
  kev: { run: syncKev, label: 'CISA KEV', table: 'vulnerabilities' },
  epss: { run: syncEpss, label: 'FIRST EPSS', table: 'vulnerabilities' },
  cwe: { run: syncCwe, label: 'MITRE CWE', table: 'threat_intel' },
  attack: { run: syncAttack, label: 'MITRE ATT&CK', table: 'threat_intel' },
  osv: { run: syncOsv, label: 'OSV.dev', table: 'threat_intel' },
  urlhaus: { run: syncUrlhaus, label: 'URLhaus', table: 'threat_intel' },
  threatfox: { run: syncThreatfox, label: 'ThreatFox', table: 'threat_intel' },
  malwarebazaar: { run: syncMalwarebazaar, label: 'MalwareBazaar', table: 'threat_intel' },
  phishtank: { run: syncPhishtank, label: 'PhishTank', table: 'threat_intel' },
  pubchem: { run: syncPubchem, label: 'PubChem', table: 'chemicals' },
  pubmed: { run: syncPubmed, label: 'PubMed', table: 'research_articles' },
  'openfda-food': { run: syncOpenfdaFood, label: 'openFDA Food Enforcement', table: 'food_safety' },
  'openfda-drug': { run: syncOpenfdaDrug, label: 'openFDA Drug Labels', table: 'drug_reference' },
  'usda-fdc': { run: syncUsdaFdc, label: 'USDA FoodData Central', table: 'foods' }
};

export const CONNECTOR_KEYS = Object.keys(CONNECTORS);
