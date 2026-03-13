const BLOCK_PATTERNS = [
  /ignore\s+(previous|all|above|prior|your)\s+instructions?/i,
  /forget\s+your\s+instructions?/i,
  /disregard\s+your\s+training/i,
  /override\s+your\s+system\s+prompt/i,
  /you\s+are\s+now\b/i,
  /\bact\s+as\b/i,
  /pretend\s+you\s+are/i,
  /from\s+now\s+on\s+you\s+are/i,
  /\bjailbreak\b/i,
  /\bdan\s+mode\b/i,
  /developer\s+mode/i,
  /show\s+me\s+your\s+prompt/i,
  /reveal\s+your\s+instructions?/i,
  /what\s+is\s+in\s+agents\.md/i,
  /repeat\s+your\s+system\s+prompt/i,
  /print\s+your\s+rules/i,
  /\bsqlite3\b/i,
  /\bSELECT\b/,
  /\bDROP\b/,
  /\bINSERT\b/,
  /\bDELETE\b/,
  /&&|\|\||\$\(/,
];

const BLOCK_REPLY = "Hi! This number is only for Ray's Home Kitchen orders and enquiries. 🍽️";

function promptGuard(message) {
  for (const pattern of BLOCK_PATTERNS) {
    if (pattern.test(message)) return { blocked: true, reply: BLOCK_REPLY };
  }
  return { blocked: false };
}

module.exports = { promptGuard };
