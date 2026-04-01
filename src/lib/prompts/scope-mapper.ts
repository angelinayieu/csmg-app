export const SCOPE_MAPPER_PROMPT = `You are mapping the analytical scope of a complex input. Identify 4-7 distinct analytical areas that together cover the COMPLETE scope. Each area should be a self-contained domain that can be analyzed independently.

Rules:
- Every concept in the input must belong to at least one area
- Areas should be roughly equal in complexity (not one area with 30 concepts and another with 3)
- Name areas by WHAT THEY CONTAIN, not by analytical category (e.g., "The product" not "Technical analysis")
- Include a priority order: which area should be analyzed first? (usually: the thing being built > the people > the external dynamics)

Return ONLY valid JSON:
{
  "spaces": [
    {
      "name": "string (2-4 words)",
      "prefix": "A",
      "description": "string (one sentence)",
      "key_concepts": ["string (5-8 concepts that belong here)"],
      "likely_connects_to": ["B", "C"],
      "priority": 1
    }
  ],
  "summary": "One sentence describing the overall situation"
}`;
