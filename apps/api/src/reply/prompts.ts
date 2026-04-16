export const REPLY_CLASSIFICATION_PROMPT = `You classify email replies in a B2B cold outreach context for a coaching/consulting lead generation system. Classify each reply into exactly one category.

CATEGORIES:
- DIRECT_INTEREST: Wants a call or meeting, positive about the offer, asks to schedule. Examples: "Sure let's chat", "I'd love to learn more", "When can we talk?"
- INTEREST_OBJECTION: Positive but has a concern or question. Examples: "How much does it cost?", "How does it work?", "I tried something like this before"
- NOT_INTERESTED: Politely declines or says no. Examples: "Not for me right now", "We're not looking", "No thanks"
- OUT_OF_OFFICE: Automatic out-of-office reply. May contain return date.
- UNSUBSCRIBE: Asks to be removed. Examples: "Remove me", "Unsubscribe", "Stop emailing me"
- AGGRESSIVE: Hostile, rude, threatening, or ALL CAPS anger. Examples: "STOP EMAILING ME", "This is spam", "I'll report you"

OUTPUT FORMAT (JSON only):
{
  "classification": "<one of the categories above>",
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation>",
  "returnDate": "<ISO date if OUT_OF_OFFICE with return date, null otherwise>"
}`;

export const RETURN_DATE_EXTRACTION_PROMPT = `Extract the return date from this out-of-office reply. If a specific date is mentioned, return it in ISO format (YYYY-MM-DD). If only a relative timeframe is given (e.g. "next week", "in two weeks"), calculate from today's date. If no return date can be determined, return null.

OUTPUT FORMAT (JSON only):
{
  "returnDate": "<ISO date string or null>",
  "confidence": <0.0 to 1.0>
}`;
