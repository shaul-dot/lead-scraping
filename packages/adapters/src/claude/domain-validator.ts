import Anthropic from '@anthropic-ai/sdk';

// Use Haiku for cost — this is a simple yes/no judgment.
const MODEL = 'claude-haiku-4-5-20251001';

export type DomainCandidate = {
  url: string;
  title: string;
  description: string;
};

export type DomainValidationInput = {
  personName: string;
  niche: string;
  candidates: DomainCandidate[];
};

export type DomainValidationResult = {
  /** The selected candidate's URL, or null if no candidate is a confident match. */
  selectedUrl: string | null;
  /** Claude's reasoning (short). */
  reasoning: string;
};

/**
 * Given a lead's name + niche and a list of Google search result candidates,
 * ask Claude Haiku to pick the candidate URL that's most likely the lead's
 * personal website (or null if none is a confident match).
 *
 * Strict mode: returns null unless Claude is confident.
 */
export async function validateDomainCandidate(
  client: Anthropic,
  input: DomainValidationInput,
): Promise<DomainValidationResult> {
  const candidatesText = input.candidates
    .map(
      (c, i) =>
        `Candidate ${i + 1}:\n  URL: ${c.url}\n  Title: ${c.title}\n  Description: ${c.description}`,
    )
    .join('\n\n');

  const userMessage = `I'm trying to find the personal website of a coach named "${input.personName}" who works in the niche of "${input.niche}".

Below are the top Google search results for this person. Your job is to determine which (if any) is their actual personal coaching website.

${candidatesText}

Reply with JSON only, no other text:
{
  "selected": <number 1-${input.candidates.length}, or null if none is a confident match>,
  "reasoning": "<one short sentence>"
}

Rules:
- "selected" must be the candidate number (1-${input.candidates.length}) of their personal coaching site, OR null.
- Return null if you're not confident — better to miss than match the wrong person.
- Reject directories, listings, social media profiles, news articles, or unrelated sites.
- Reject if the result appears to be a different person with the same name.
- A real coaching site usually: has the coach's name in the URL or title, describes their coaching offer, and matches the niche.`;

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 200,
    messages: [{ role: 'user', content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    return { selectedUrl: null, reasoning: 'No text response from Claude' };
  }

  // Strip markdown code fences if present, parse JSON.
  const cleaned = textBlock.text.replace(/```json\s*|\s*```/g, '').trim();

  try {
    const parsed = JSON.parse(cleaned) as { selected: number | null; reasoning: string };

    if (parsed.selected === null || typeof parsed.selected !== 'number') {
      return { selectedUrl: null, reasoning: parsed.reasoning ?? 'No confident match' };
    }

    const idx = parsed.selected - 1;
    if (idx < 0 || idx >= input.candidates.length) {
      return { selectedUrl: null, reasoning: 'Invalid candidate number from Claude' };
    }

    return {
      selectedUrl: input.candidates[idx].url,
      reasoning: parsed.reasoning ?? 'Validated by Claude',
    };
  } catch (err) {
    return {
      selectedUrl: null,
      reasoning: `Failed to parse Claude response: ${err instanceof Error ? err.message : 'unknown'}`,
    };
  }
}
