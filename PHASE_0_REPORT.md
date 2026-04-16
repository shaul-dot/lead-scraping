# Phase 0 Quality Report

Generated: {{TIMESTAMP}}

---

## Pipeline Summary

| Metric | Count |
|--------|-------|
| Total input | {{TOTAL_INPUT}} |
| Enriched (standard) | {{ENRICHED_STANDARD}} |
| Enriched (Exa fallback) | {{ENRICHED_EXA_FALLBACK}} |
| Enriched total | {{ENRICHED_TOTAL}} |
| ICP pass | {{ICP_PASS}} |
| ICP fail | {{ICP_FAIL}} |
| Duplicates detected | {{DUPLICATES_DETECTED}} |
| Validation valid | {{VALIDATION_VALID}} |
| Validation invalid | {{VALIDATION_INVALID}} |
| Personalization passed | {{PERSONALIZATION_PASSED}} |
| Uploaded | {{UPLOADED}} |
| Remediation events | {{REMEDIATION_EVENTS}} |
| Tier 3 escalations | {{TIER3_ESCALATIONS}} |

## Status Breakdown

- **RAW**: {{STATUS_RAW}}
- **ENRICHING**: {{STATUS_ENRICHING}}
- **ENRICHED**: {{STATUS_ENRICHED}}
- **SCORING**: {{STATUS_SCORING}}
- **SCORED_PASS**: {{STATUS_SCORED_PASS}}
- **SCORED_FAIL**: {{STATUS_SCORED_FAIL}}
- **DEDUPED_DUPLICATE**: {{STATUS_DEDUPED_DUPLICATE}}
- **VALIDATING**: {{STATUS_VALIDATING}}
- **VALIDATED_VALID**: {{STATUS_VALIDATED_VALID}}
- **VALIDATED_INVALID**: {{STATUS_VALIDATED_INVALID}}
- **PERSONALIZING**: {{STATUS_PERSONALIZING}}
- **READY_TO_UPLOAD**: {{STATUS_READY_TO_UPLOAD}}
- **UPLOADED**: {{STATUS_UPLOADED}}
- **ESCALATED**: {{STATUS_ESCALATED}}
- **ERROR**: {{STATUS_ERROR}}

## Cost Breakdown

| Provider Category | Cost |
|-------------------|------|
| Enrichment | ${{COST_ENRICHMENT}} |
| Scoring (LLM) | ${{COST_SCORING}} |
| Validation | ${{COST_VALIDATION}} |
| Personalization (LLM) | ${{COST_PERSONALIZATION}} |
| Exa | ${{COST_EXA}} |
| Upload (Instantly) | ${{COST_UPLOAD}} |
| **Total** | **${{COST_TOTAL}}** |

## Acceptance Criteria

| Criteria | Target | Actual | Pass |
|----------|--------|--------|------|
| Enrichment rate | >=70% | {{AC_ENRICHMENT_RATE}} | {{AC_ENRICHMENT_PASS}} |
| ICP pass rate | >=40% | {{AC_ICP_RATE}} | {{AC_ICP_PASS}} |
| Email validation rate | >=80% | {{AC_VALIDATION_RATE}} | {{AC_VALIDATION_PASS}} |
| End-to-end upload rate | >=20% | {{AC_UPLOAD_RATE}} | {{AC_UPLOAD_PASS}} |
| Total cost under cap | <=$100 | ${{AC_COST_ACTUAL}} | {{AC_COST_PASS}} |

## Verdict

{{VERDICT}}

<!--
  This template is auto-populated by scripts/phase0-import.ts.

  To run Phase 0:
    pnpm run phase0:import --file=./existing-leads.csv

  The script replaces all {{PLACEHOLDER}} values with actual metrics
  and writes the result to this file.

  Acceptance criteria thresholds:
    - Enrichment rate:        >= 70% of input leads get an email
    - ICP pass rate:          >= 40% of enriched leads pass ICP scoring
    - Email validation rate:  >= 80% of ICP-passed leads have a valid email
    - End-to-end upload rate: >= 20% of input leads reach UPLOADED status
    - Total cost:             <= $100 hard cap for Phase 0 runs
-->
