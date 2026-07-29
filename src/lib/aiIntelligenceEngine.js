import { base44 } from '@/api/base44Client';

// STUB DISCLOSURE — read before touching this file.
// There is no real Claude/LLM call anywhere in this app; the only AI
// integration mock (base44.integrations.Core.InvokeLLM, used by the existing
// AIReviewSkill/BidReviewReport system) just echoes the prompt text back, so
// routing through it would add nothing real. This engine is instead an
// honest, deterministic keyword/regex text analyzer that actually reads the
// contract text you give it — it stands in for where a real Claude API call
// would go, and is commented as such rather than pretending to be one.

const snippet = (text, index, length, radius = 60) => {
  const start = Math.max(0, index - radius);
  const end = Math.min(text.length, index + length + radius);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
};

const LD_PHRASE = /liquidated damages/i;
const DOLLAR_PER_DAY = /\$\s?([\d,]+(?:\.\d{2})?)\s*(?:per|\/)\s*(?:calendar\s+)?day/i;

function analyzeLiquidatedDamages(text) {
  const dollarMatch = text.match(DOLLAR_PER_DAY);
  if (dollarMatch) {
    return {
      category: 'Liquidated_Damages',
      severity: 'Red',
      title: `Liquidated damages: $${dollarMatch[1]}/day`,
      detail: "A per-day dollar penalty for schedule overruns was found — verify it's covered by the estimate's schedule contingency before signing.",
      matched_text: snippet(text, dollarMatch.index, dollarMatch[0].length),
    };
  }
  const phraseMatch = text.match(LD_PHRASE);
  if (phraseMatch) {
    return {
      category: 'Liquidated_Damages',
      severity: 'Yellow',
      title: 'Liquidated damages clause present — amount unclear',
      detail: 'The phrase "liquidated damages" appears but no extractable $/day amount was found nearby. Review manually.',
      matched_text: snippet(text, phraseMatch.index, phraseMatch[0].length),
    };
  }
  return {
    category: 'Liquidated_Damages',
    severity: 'Green',
    title: 'No liquidated damages clause detected',
    detail: 'The provided text does not appear to reference liquidated damages.',
    matched_text: '',
  };
}

const RETAINAGE_PHRASE = /retainage|retention/i;
const RETAINAGE_PCT = /(retainage|retention)[^.\n]{0,60}?(\d{1,2}(?:\.\d+)?)\s?%/i;

function analyzeRetainage(text) {
  const pctMatch = text.match(RETAINAGE_PCT);
  if (pctMatch) {
    const pct = parseFloat(pctMatch[2]);
    const severity = pct > 10 ? 'Red' : pct >= 5 ? 'Green' : 'Yellow';
    const detail = pct > 10
      ? 'Retainage exceeds the standard 5-10% range — this ties up more cash than typical, flag for negotiation.'
      : pct >= 5
        ? 'Retainage is within the standard 5-10% range.'
        : `Retainage of ${pct}% is below the typical 5% floor — verify this isn't a transcription error.`;
    return {
      category: 'Retainage',
      severity,
      title: `Retainage: ${pct}%`,
      detail,
      matched_text: snippet(text, pctMatch.index, pctMatch[0].length),
    };
  }
  const phraseMatch = text.match(RETAINAGE_PHRASE);
  if (phraseMatch) {
    return {
      category: 'Retainage',
      severity: 'Yellow',
      title: 'Retainage referenced — percentage unclear',
      detail: 'A retainage/retention clause was found but no percentage could be extracted nearby.',
      matched_text: snippet(text, phraseMatch.index, phraseMatch[0].length),
    };
  }
  return {
    category: 'Retainage',
    severity: 'Yellow',
    title: 'No retainage terms found',
    detail: 'No retainage or retention clause was detected — confirm this is intentional before signing.',
    matched_text: '',
  };
}

const SCOPE_KEYWORDS = [
  { label: 'Joist & Deck', pattern: /joist|metal deck|steel deck/i },
  { label: 'Shop Priming / Paint', pattern: /shop prim|primer|painting spec|coating spec/i },
];

function analyzeScopeGaps(text) {
  return SCOPE_KEYWORDS.map(({ label, pattern }) => {
    const match = text.match(pattern);
    if (match) {
      return {
        category: 'Scope_Gap',
        severity: 'Green',
        title: `${label} scope referenced`,
        detail: `The contract text references ${label.toLowerCase()} — confirm it matches the estimate's scope exactly.`,
        matched_text: snippet(text, match.index, match[0].length),
      };
    }
    return {
      category: 'Scope_Gap',
      severity: 'Yellow',
      title: `${label} not mentioned`,
      detail: `No reference to ${label.toLowerCase()} was found in the provided text — verify whether it belongs in scope before including or excluding it in the bid.`,
      matched_text: '',
    };
  });
}

const PAY_WHEN_PAID = /pay[- ]when[- ]paid|pay[- ]if[- ]paid/i;
const NET_TERMS = /net[- ]?(\d{2,3})\b/i;

function analyzePaymentMilestones(text) {
  const pwpMatch = text.match(PAY_WHEN_PAID);
  if (pwpMatch) {
    return {
      category: 'Payment_Milestone',
      severity: 'Red',
      title: 'Pay-when-paid / pay-if-paid trigger found',
      detail: 'Payment is contingent on the upstream party being paid first — this shifts non-payment risk onto us. Flag for negotiation.',
      matched_text: snippet(text, pwpMatch.index, pwpMatch[0].length),
    };
  }
  const netMatch = text.match(NET_TERMS);
  if (netMatch) {
    const days = parseInt(netMatch[1], 10);
    const severity = days > 45 ? 'Red' : days > 30 ? 'Yellow' : 'Green';
    return {
      category: 'Payment_Milestone',
      severity,
      title: `Net-${days} payment terms`,
      detail: days > 30 ? `Payment terms of Net-${days} are slower than the standard Net-30 — factor into cash flow planning.` : 'Standard Net-30 payment terms.',
      matched_text: snippet(text, netMatch.index, netMatch[0].length),
    };
  }
  return {
    category: 'Payment_Milestone',
    severity: 'Yellow',
    title: 'No clear payment terms identified',
    detail: 'No Net-30/60 or pay-when-paid language was found — payment timing is unclear from the provided text.',
    matched_text: '',
  };
}

export function extractContractRisks(rawText) {
  const text = String(rawText || '');
  if (!text.trim()) return [];
  return [
    analyzeLiquidatedDamages(text),
    analyzeRetainage(text),
    ...analyzeScopeGaps(text),
    analyzePaymentMilestones(text),
  ];
}

export async function runContractRiskAudit(bid, rawText) {
  const findings = extractContractRisks(rawText);
  return base44.entities.ai_contract_reviews.create({
    bid_id: bid.id,
    project_id: bid.project_id || bid.won_project_id || '',
    raw_extracted_text: rawText,
    review_summary_json: findings,
    analyzed_at: new Date().toISOString(),
  });
}
